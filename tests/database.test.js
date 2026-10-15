// The Supabase migrations, run against a real Postgres (PGlite).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { freshDatabase } = await import('./helpers/db.js');

describe('database access rules', () => {
  test('row-level security is on for every table', async () => {
    const { db } = await freshDatabase();
    const { rows } = await db.query(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'atlas' and c.relkind = 'r'`);
    assert.ok(rows.length >= 8);
    for (const row of rows) assert.equal(row.relrowsecurity, true, `${row.relname} has row-level security`);
  });

  test('only the server key (service_role) can reach the data', async () => {
    const { db } = await freshDatabase();
    const { rows: fns } = await db.query(`select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'atlas\\_%'`);
    assert.ok(fns.length > 20);
    for (const { sig } of fns) {
      for (const role of ['anon', 'authenticated']) {
        const { rows } = await db.query('select has_function_privilege($1, $2, \'execute\') as ok', [role, sig]);
        assert.equal(rows[0].ok, false, `${role} can't call ${sig}`);
      }
      const { rows } = await db.query('select has_function_privilege(\'service_role\', $1, \'execute\') as ok', [sig]);
      assert.equal(rows[0].ok, true, `service_role can call ${sig}`);
    }
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await db.query('select has_schema_privilege($1, \'atlas\', \'usage\') as ok', [role]);
      assert.equal(rows[0].ok, false, `${role} has no access to the atlas schema`);
      const { rows: t } = await db.query('select has_table_privilege($1, \'atlas.accounts\', \'select\') as ok', [role]);
      assert.equal(t[0].ok, false);
    }
  });
});

describe('database functions', () => {
  const account = (rpc, id, key) => rpc('atlas_create_account', {
    p_id: id, p_username: key, p_username_key: key, p_emoji: '🦊', p_code_hash: 'h', p_created_at: 1,
    p_data: { profile: { grade: 11 }, chat: [{ role: 'user', content: 'private' }], lab: { stats: { gpa: 3.5 }, essays: ['private essay'] } },
  });

  test('usernames are unique, but an expired account frees its name', async () => {
    const { rpc, db } = await freshDatabase();
    assert.equal(await account(rpc, 'a1', 'bluefox'), true);
    assert.equal(await account(rpc, 'a2', 'bluefox'), false);
    await db.exec(`update atlas.accounts set expires_at = now() - interval '1 second' where id = 'a1'`);
    assert.equal(await rpc('atlas_get_account', { p_id: 'a1' }), null);
    assert.equal(await account(rpc, 'a2', 'bluefox'), true);
  });

  test('rooms cap their size and teachers never receive chats or essays', async () => {
    const { rpc } = await freshDatabase();
    await rpc('atlas_create_room', { p_code: 'ROOM01', p_name: 'Period 1', p_auth_hash: 'x', p_public_key: 'k', p_wrapped_key: 'w', p_wrap_iv: 'i', p_created_at: 1 });
    await account(rpc, 'a1', 'one');
    await account(rpc, 'a2', 'two');
    const join = (id) => rpc('atlas_join_room', { p_code: 'ROOM01', p_account_id: id, p_enc_name: 'enc', p_grade: 11, p_joined_at: 2, p_max: 1 });
    assert.equal(await join('a1'), 'ok');
    assert.equal(await join('a1'), 'ok');
    assert.equal(await join('a2'), 'full');
    const [student] = await rpc('atlas_room_students', { p_code: 'ROOM01' });
    assert.equal(student.user.id, 'a1');
    assert.deepEqual(student.stored.data, { profile: { grade: 11 }, lab: { stats: { gpa: 3.5 } } });
    await rpc('atlas_delete_room', { p_code: 'ROOM01' });
    assert.equal((await rpc('atlas_get_account', { p_id: 'a1' })).room, null);
  });

  test('rate limits count up and reset after they expire', async () => {
    const { rpc, db } = await freshDatabase();
    assert.equal(await rpc('atlas_hit', { p_bucket: 'b', p_seconds: 60 }), 1);
    assert.equal(await rpc('atlas_hit', { p_bucket: 'b', p_seconds: 60 }), 2);
    assert.deepEqual(await rpc('atlas_peek', { p_buckets: ['b', 'none'] }), [2, 0]);
    await db.exec(`update atlas.rate_limits set expires_at = now() - interval '1 second'`);
    assert.deepEqual(await rpc('atlas_peek', { p_buckets: ['b'] }), [0]);
    assert.equal(await rpc('atlas_hit', { p_bucket: 'b', p_seconds: 60 }), 1);
  });
});
