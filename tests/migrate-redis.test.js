// The one-time Redis -> Supabase copy, from data in the old Redis layout to a
// student signing in with their existing code on the new store.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const { collect, importAll, redisFromEnv } = await import('../scripts/migrate-redis-to-supabase.js');
const { createAccountHandlers } = await import('../server/accounts/handler.js');
const { createReviewHandlers } = await import('../server/reviews/handler.js');
const { SupabaseReviewStore } = await import('../server/reviews/store.js');
const { freshDatabase } = await import('./helpers/db.js');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SALT = 'old-salt';

/** Just enough of Upstash's REST API to read the old keys. */
function fakeUpstash(keys) {
  const fetch = async (_url, init) => {
    const [cmd, ...a] = JSON.parse(init.body);
    const entry = keys[a[0]];
    const glob = (p) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    const result = {
      SCAN: () => ['0', Object.keys(keys).filter((k) => glob(a[2]).test(k))],
      GET: () => entry?.value ?? null,
      TTL: () => (entry ? entry.ttl ?? -1 : -2),
      HGETALL: () => Object.entries(entry?.value ?? {}).flat(),
      ZRANGE: () => entry?.value ?? [],
      SMEMBERS: () => entry?.value ?? [],
    }[cmd]();
    return new Response(JSON.stringify({ result }));
  };
  return redisFromEnv({ KV_REST_API_URL: 'https://kv.test', KV_REST_API_TOKEN: 't' }, fetch);
}

describe('Redis to Supabase migration', () => {
  test('students keep their username, sign-in code, data, session, and room', async () => {
    const teacherToken = 'ab'.repeat(32);
    const sessionToken = 'session-token-123';
    const review = { id: 'rev00001', opportunityId: 'test-program', rating: 5, title: 'Great', body: 'Really good program for me.', name: 'Sam', createdAt: 5, status: 'published' };
    const redis = fakeUpstash({
      'atlas:ac:u:id1': { value: JSON.stringify({ id: 'id1', username: 'BraveOtter12', emoji: '🦦', codeHash: sha256(`${SALT}:code:id1:ABCDE23456`), createdAt: 1, lastActive: 2, room: 'ROOM01' }), ttl: 1000 },
      'atlas:ac:un:braveotter12': { value: 'id1', ttl: 1000 },
      'atlas:ac:d:id1': { value: JSON.stringify({ version: 4, updatedAt: 3, data: { saved: ['test-program'], profile: { grade: 10 } } }), ttl: 1000 },
      ['atlas:ac:s:' + sha256(sessionToken)]: { value: 'id1', ttl: 500 },
      'atlas:ac:r:ROOM01': { value: JSON.stringify({ code: 'ROOM01', name: 'Period 1', open: true, createdAt: 1, authHash: sha256(teacherToken), publicKey: 'pk', wrappedKey: 'wk', wrapIv: 'iv' }), ttl: 1000 },
      'atlas:ac:rm:ROOM01': { value: { id1: JSON.stringify({ encName: 'ZW5jcnlwdGVk', grade: 10, joinedAt: 2 }) } },
      'atlas:ac:rl:c:xyz': { value: '3', ttl: 100 },
      'atlas:rv:r:rev00001': { value: JSON.stringify(review) },
      'atlas:rv:pub:test-program': { value: ['rev00001'] },
      'atlas:rv:pending': { value: [] },
      'atlas:rv:rep:rev00001': { value: ['reporter-hash'] },
    });

    const rows = await collect(redis);
    assert.equal(rows.accounts.length, 1);
    assert.equal(rows.accounts[0].usernameKey, 'braveotter12');
    assert.equal(rows.members.length, 1);
    assert.equal(rows.sessions.length, 1);
    assert.deepEqual(rows.reviews.map((r) => r.state), ['published']);

    const { rpc } = await freshDatabase();
    assert.deepEqual(await importAll(rpc, rows), { rooms: 1, accounts: 1, members: 1, sessions: 1, reviews: 1, reporters: 1, once: 0 });
    // Running it again adds nothing.
    assert.deepEqual(await importAll(rpc, rows), { rooms: 0, accounts: 0, members: 0, sessions: 0, reviews: 0, reporters: 0, once: 0 });

    const { account, rooms } = createAccountHandlers({ db: rpc, env: { ACCOUNTS_SALT: SALT } });
    const post = (body) => account(new Request('https://atlas.test/api/account', { method: 'POST', headers: { host: 'atlas.test', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    const login = await post({ action: 'login', username: 'braveotter12', code: 'abcde-23456' });
    assert.equal(login.status, 200);
    const signedIn = await login.json();
    assert.deepEqual(signedIn.user.room, { code: 'ROOM01', name: 'Period 1' });
    assert.equal(signedIn.version, 4);
    assert.deepEqual(signedIn.data.saved, ['test-program']);

    const still = await account(new Request('https://atlas.test/api/account', { headers: { cookie: `atlas_session=${sessionToken}` } }));
    assert.equal((await still.json()).signedIn, true);

    const roster = await rooms(new Request('https://atlas.test/api/rooms?code=ROOM01&view=roster', { headers: { authorization: `Bearer ${teacherToken}` } }));
    assert.equal(roster.status, 200);
    assert.equal((await roster.json()).students[0].encName, 'ZW5jcnlwdGVk');

    const { reviews } = createReviewHandlers({ store: new SupabaseReviewStore(rpc), knownIds: new Set(['test-program']) });
    const list = await (await reviews(new Request('https://atlas.test/api/reviews?id=test-program'))).json();
    assert.equal(list.reviews[0].title, 'Great');
    assert.equal(list.summary.count, 1);
  });
});
