import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { createAccountHandlers, sharedView } = await import('../server/accounts/handler.js');
const { MemoryKV } = await import('../server/kv.js');
const { normalizeUsername } = await import('../server/accounts/names.js');
const crypto = await import('../public/js/lib/room-crypto.js');

function setup() {
  const kv = new MemoryKV();
  const { account, rooms } = createAccountHandlers({ kv, env: {} });
  const call = (handler, path) => async (method, { body, query = '', cookie, auth, ip = '1.1.1.1' } = {}) => {
    const headers = { 'x-real-ip': ip, host: 'atlas.test' };
    if (body) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    if (auth) headers.authorization = `Bearer ${auth}`;
    const res = await handler(new Request(`https://atlas.test${path}${query}`, { method, headers, body: body ? JSON.stringify(body) : undefined }));
    const setCookie = res.headers.get('set-cookie');
    return { status: res.status, data: await res.json(), cookie: setCookie ? setCookie.split(';')[0] : null, setCookie };
  };
  return { kv, acct: call(account, '/api/account'), room: call(rooms, '/api/rooms') };
}

async function newStudent(s, data) {
  const r = await s.acct('POST', { body: { action: 'create', data } });
  assert.equal(r.status, 201);
  return { ...r.data, cookie: r.cookie };
}

async function newRoom(s, code) {
  const teacherKey = crypto.generateTeacherKey();
  const keys = await crypto.createRoomKeys(teacherKey);
  const r = await s.room('POST', { body: { action: 'create', code, name: 'Period 3 Careers', ...keys } });
  return { status: r.status, data: r.data, teacherKey, auth: keys.authToken, keys };
}

describe('anonymous accounts', () => {
  test('creates a random username with a secure, HttpOnly session cookie', async () => {
    const s = setup();
    const r = await s.acct('POST', { body: { action: 'create' } });
    assert.equal(r.status, 201);
    assert.match(r.data.user.username, /^[A-Z][a-z]+[A-Z][a-z]+\d{2,4}$/);
    assert.match(r.data.signInCode, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    assert.match(r.setCookie, /HttpOnly/);
    assert.match(r.setCookie, /Secure/);
    assert.match(r.setCookie, /SameSite=Lax/);
    const me = await s.acct('GET', { cookie: r.cookie });
    assert.equal(me.data.signedIn, true);
    assert.equal(me.data.user.username, r.data.user.username);
    assert.equal((await s.acct('GET')).data.signedIn, false);
  });

  test('migrates local data on creation and syncs with version checks', async () => {
    const s = setup();
    const st = await newStudent(s, { saved: ['a'], profile: { grade: 10 }, junk: 'dropped' });
    const first = await s.acct('GET', { cookie: st.cookie, query: '?data=1' });
    assert.deepEqual(first.data.data, { saved: ['a'], profile: { grade: 10 } });
    assert.equal(first.data.version, 1);

    const ok = await s.acct('POST', { cookie: st.cookie, body: { action: 'sync', baseVersion: 1, data: { saved: ['a', 'b'] } } });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.version, 2);
    const stale = await s.acct('POST', { cookie: st.cookie, body: { action: 'sync', baseVersion: 1, data: { saved: [] } } });
    assert.equal(stale.status, 409);
    assert.deepEqual(stale.data.data.saved, ['a', 'b']);
    assert.equal((await s.acct('POST', { body: { action: 'sync', baseVersion: 2, data: {} } })).status, 401);
  });

  test('signs in on another device with username and sign-in code, and limits guessing', async () => {
    const s = setup();
    const st = await newStudent(s, { saved: ['x'] });
    const r = await s.acct('POST', { body: { action: 'login', username: `🪐 ${st.user.username.toLowerCase()}`, code: st.signInCode.toLowerCase() } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.data.saved, ['x']);
    assert.ok(r.cookie);
    // Ten wrong codes for one username lock that username for a while, from any IP.
    for (let i = 0; i < 10; i += 1) {
      assert.equal((await s.acct('POST', { ip: `9.9.9.${i}`, body: { action: 'login', username: st.user.username, code: 'AAAAA-AAAAA' } })).status, 401);
    }
    assert.equal((await s.acct('POST', { ip: '8.8.8.8', body: { action: 'login', username: st.user.username, code: st.signInCode } })).status, 429);
  });

  test('a new sign-in code replaces the old one', async () => {
    const s = setup();
    const st = await newStudent(s);
    const r = await s.acct('POST', { cookie: st.cookie, body: { action: 'new-code' } });
    assert.notEqual(r.data.signInCode, st.signInCode);
    assert.equal((await s.acct('POST', { body: { action: 'login', username: st.user.username, code: st.signInCode } })).status, 401);
    assert.equal((await s.acct('POST', { body: { action: 'login', username: st.user.username, code: r.data.signInCode } })).status, 200);
  });

  test('log out ends the session and clears the cookie', async () => {
    const s = setup();
    const st = await newStudent(s);
    const r = await s.acct('POST', { cookie: st.cookie, body: { action: 'logout' } });
    assert.match(r.setCookie, /Max-Age=0/);
    assert.equal((await s.acct('GET', { cookie: st.cookie })).data.signedIn, false);
  });

  test('deleting an account removes the data and frees the username', async () => {
    const s = setup();
    const st = await newStudent(s, { saved: ['x'] });
    assert.equal((await s.acct('POST', { cookie: st.cookie, body: { action: 'delete' } })).status, 200);
    assert.equal(await s.kv.cmd('GET', `atlas:ac:un:${normalizeUsername(st.user.username)}`), null);
    assert.equal((await s.acct('POST', { body: { action: 'login', username: st.user.username, code: st.signInCode } })).status, 401);
  });

  test('rejects cross-site posts and non-JSON bodies', async () => {
    const s = setup();
    const { account } = createAccountHandlers({ kv: s.kv });
    const cross = await account(new Request('https://atlas.test/api/account', { method: 'POST', headers: { origin: 'https://evil.test', host: 'atlas.test', 'content-type': 'application/json' }, body: '{"action":"create"}' }));
    assert.equal(cross.status, 403);
    const form = await account(new Request('https://atlas.test/api/account', { method: 'POST', headers: { host: 'atlas.test', 'content-type': 'text/plain' }, body: 'action=create' }));
    assert.equal(form.status, 415);
  });

  test('reports accounts as off when no storage is configured', async () => {
    const { account } = createAccountHandlers({ kv: null });
    const r = await account(new Request('https://atlas.test/api/account'));
    assert.deepEqual(await r.json(), { enabled: false, signedIn: false });
  });
});

describe('classroom rooms', () => {
  test('a student joins with an encrypted real name the server cannot read', async () => {
    const s = setup();
    const room = await newRoom(s, 'career2026');
    assert.equal(room.status, 201);
    assert.equal(room.data.room.code, 'CAREER2026');

    const info = await s.room('GET', { query: '?code=Career-2026' });
    assert.equal(info.data.room.name, 'Period 3 Careers');
    const st = await newStudent(s, { profile: { grade: 11, financialNeed: true }, portfolio: { milestones: { done: ['college-list'] } } });
    const encryptedName = await crypto.encryptName(info.data.room.publicKey, 'Stella Example');
    const joined = await s.acct('POST', { cookie: st.cookie, body: { action: 'join', code: 'CAREER2026', encryptedName, grade: 11 } });
    assert.equal(joined.status, 200);
    assert.deepEqual(joined.data.user.room, { code: 'CAREER2026', name: 'Period 3 Careers' });

    // Nothing stored contains the real name.
    const everything = JSON.stringify([...s.kv.data.entries()].map(([k, v]) => [k, v.value instanceof Map ? [...v.value] : v.value]));
    assert.doesNotMatch(everything, /Stella/);

    // The teacher's browser can decrypt it.
    const roster = await s.room('GET', { query: '?code=CAREER2026&view=roster', auth: room.auth });
    assert.equal(roster.status, 200);
    assert.equal(roster.data.students.length, 1);
    const student = roster.data.students[0];
    assert.equal(student.username, st.user.username);
    assert.ok(student.insights.flags.includes('financial-aid'));
    const opened = await crypto.openRoom(room.teacherKey, roster.data.room);
    assert.equal(await opened.decryptName(student.encName), 'Stella Example');
    await assert.rejects(crypto.openRoom(crypto.generateTeacherKey(), roster.data.room));
  });

  test('the roster and portfolios need the teacher key', async () => {
    const s = setup();
    const room = await newRoom(s, 'ROOMONE1');
    assert.equal((await s.room('GET', { query: '?code=ROOMONE1&view=roster' })).status, 401);
    assert.equal((await s.room('GET', { query: '?code=ROOMONE1&view=roster', auth: 'a'.repeat(64) })).status, 401);
    const other = await newRoom(s, 'ROOMTWO2');
    assert.equal((await s.room('GET', { query: '?code=ROOMONE1&view=roster', auth: other.auth })).status, 401);
    assert.equal((await s.room('GET', { query: '?code=ROOMONE1&view=roster', auth: room.auth })).status, 200);
  });

  test('joining a school later keeps existing data (the bridge)', async () => {
    const s = setup();
    const st = await newStudent(s, { saved: ['opp-1'], tracker: { 'opp-1': { id: 'opp-1', title: 'Program', status: 'submitted', notes: 'private' } } });
    const room = await newRoom(s, 'BRIDGE01');
    const encryptedName = await crypto.encryptName(room.keys.publicKey, 'Timmy');
    await s.acct('POST', { cookie: st.cookie, body: { action: 'join', code: 'BRIDGE01', encryptedName, grade: 9 } });
    const detail = await s.room('GET', { query: `?code=BRIDGE01&student=${encodeURIComponent(st.user.username)}`, auth: room.auth });
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.data.shared.saved, ['opp-1']);
    assert.equal(detail.data.shared.tracker['opp-1'].status, 'submitted');
    assert.equal(detail.data.shared.tracker['opp-1'].notes, undefined, 'private notes stay private');
    const mine = await s.acct('GET', { cookie: st.cookie, query: '?data=1' });
    assert.deepEqual(mine.data.data.saved, ['opp-1']);
  });

  test('teachers can close a room, reset a sign-in code, remove a student, and delete the room', async () => {
    const s = setup();
    const room = await newRoom(s, 'CLOSEME1');
    const st = await newStudent(s);
    const enc = await crypto.encryptName(room.keys.publicKey, 'Sam');
    await s.acct('POST', { cookie: st.cookie, body: { action: 'join', code: 'CLOSEME1', encryptedName: enc, grade: 10 } });

    const reset = await s.room('POST', { auth: room.auth, body: { action: 'reset-code', code: 'CLOSEME1', username: st.user.username } });
    assert.equal(reset.status, 200);
    assert.equal((await s.acct('POST', { body: { action: 'login', username: st.user.username, code: reset.data.signInCode } })).status, 200);

    await s.room('POST', { auth: room.auth, body: { action: 'settings', code: 'CLOSEME1', open: false } });
    const late = await newStudent(s);
    assert.equal((await s.acct('POST', { cookie: late.cookie, body: { action: 'join', code: 'CLOSEME1', encryptedName: enc } })).status, 403);

    await s.room('POST', { auth: room.auth, body: { action: 'remove', code: 'CLOSEME1', username: st.user.username } });
    assert.equal((await s.room('GET', { query: '?code=CLOSEME1&view=roster', auth: room.auth })).data.students.length, 0);
    assert.equal((await s.acct('GET', { cookie: st.cookie })).data.user.room, null);

    assert.equal((await s.room('POST', { auth: room.auth, body: { action: 'delete', code: 'CLOSEME1' } })).status, 200);
    assert.equal((await s.room('GET', { query: '?code=CLOSEME1' })).status, 404);
  });

  test('room codes must be unique', async () => {
    const s = setup();
    assert.equal((await newRoom(s, 'SAMECODE')).status, 201);
    assert.equal((await newRoom(s, 'samecode')).status, 409);
    assert.equal((await newRoom(s, 'ab')).status, 422);
    assert.match((await newRoom(s)).data.room.code, /^[A-Z2-9]{8}$/);
  });
});

describe('what teachers can see', () => {
  test('never chats, essays, transcripts, private notes, exact finances, or unshared obstacles', () => {
    const view = sharedView({
      profile: { grade: 12, goals: 'private goal', incomeBand: 'lt30', householdSize: 4, benefits: true, firstGen: true },
      chat: [{ role: 'user', content: 'secret' }],
      lab: { stats: { gpa: 3.4 }, essays: [{ text: 'essay' }], transcript: { courses: [] }, chat: [{}] },
      tracker: { a: { title: 'A', notes: 'note' } },
      portfolio: { insight: { obstacles: 'hardship', proudest: 'robotics', share: false } },
    });
    const text = JSON.stringify(view);
    for (const secret of ['private goal', 'secret', 'essay', 'note', 'hardship', 'lt30', 'transcript']) assert.ok(!text.includes(secret), secret);
    assert.equal(view.profile.financeTier, 'low');
    assert.equal(view.stats.gpa, 3.4);
    assert.equal(view.portfolio.insight.proudest, 'robotics');
    const shared = sharedView({ portfolio: { insight: { obstacles: 'hardship', share: true } } });
    assert.equal(shared.portfolio.insight.obstacles, 'hardship');
  });
});
