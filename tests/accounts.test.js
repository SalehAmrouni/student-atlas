import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { createAccountHandlers, sharedView } = await import('../server/accounts/handler.js');
const { freshDatabase } = await import('./helpers/db.js');
const { normalizeUsername } = await import('../server/accounts/names.js');
const crypto = await import('../public/js/lib/room-crypto.js');

async function setup() {
  const { rpc, db } = await freshDatabase();
  const { account, rooms } = createAccountHandlers({ db: rpc, env: {} });
  const call = (handler, path) => async (method, { body, query = '', cookie, auth, ip = '1.1.1.1' } = {}) => {
    const headers = { 'x-real-ip': ip, host: 'atlas.test' };
    if (body) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    if (auth) headers.authorization = `Bearer ${auth}`;
    const res = await handler(new Request(`https://atlas.test${path}${query}`, { method, headers, body: body ? JSON.stringify(body) : undefined }));
    const setCookie = res.headers.get('set-cookie');
    return { status: res.status, data: await res.json(), cookie: setCookie ? setCookie.split(';')[0] : null, setCookie };
  };
  return { rpc, db, acct: call(account, '/api/account'), room: call(rooms, '/api/rooms') };
}

async function newStudent(s, data) {
  const r = await s.acct('POST', { body: { action: 'create', data } });
  assert.equal(r.status, 201);
  // New accounts have no typed code; make the backup one so tests can sign in with it.
  const code = await s.acct('POST', { cookie: r.cookie, body: { action: 'new-code' } });
  return { ...r.data, signInCode: code.data.signInCode, cookie: r.cookie };
}

async function newRoom(s, code) {
  const teacherKey = crypto.generateTeacherKey();
  const keys = await crypto.createRoomKeys(teacherKey);
  const r = await s.room('POST', { body: { action: 'create', code, name: 'Period 3 Careers', ...keys } });
  return { status: r.status, data: r.data, teacherKey, auth: keys.authToken, keys };
}

describe('anonymous accounts', () => {
  test('creates a random username with a secure, HttpOnly session cookie', async () => {
    const s = await setup();
    const r = await s.acct('POST', { body: { action: 'create' } });
    assert.equal(r.status, 201);
    assert.match(r.data.user.username, /^[A-Z][a-z]+[A-Z][a-z]+\d{2,4}$/);
    assert.equal(r.data.signInCode, undefined, 'no typed code to remember');
    assert.equal(r.data.user.hasPicture, false);
    assert.equal(r.data.user.hasPass, false);
    assert.match(r.setCookie, /HttpOnly/);
    assert.match(r.setCookie, /Secure/);
    assert.match(r.setCookie, /SameSite=Lax/);
    const me = await s.acct('GET', { cookie: r.cookie });
    assert.equal(me.data.signedIn, true);
    assert.equal(me.data.user.username, r.data.user.username);
    assert.equal((await s.acct('GET')).data.signedIn, false);
  });

  test('migrates local data on creation and syncs with version checks', async () => {
    const s = await setup();
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
    const s = await setup();
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
    const s = await setup();
    const st = await newStudent(s);
    const r = await s.acct('POST', { cookie: st.cookie, body: { action: 'new-code' } });
    assert.notEqual(r.data.signInCode, st.signInCode);
    assert.equal((await s.acct('POST', { body: { action: 'login', username: st.user.username, code: st.signInCode } })).status, 401);
    assert.equal((await s.acct('POST', { body: { action: 'login', username: st.user.username, code: r.data.signInCode } })).status, 200);
  });

  test('log out ends the session and clears the cookie', async () => {
    const s = await setup();
    const st = await newStudent(s);
    const r = await s.acct('POST', { cookie: st.cookie, body: { action: 'logout' } });
    assert.match(r.setCookie, /Max-Age=0/);
    assert.equal((await s.acct('GET', { cookie: st.cookie })).data.signedIn, false);
  });

  test('deleting an account removes the data and frees the username', async () => {
    const s = await setup();
    const st = await newStudent(s, { saved: ['x'] });
    assert.equal((await s.acct('POST', { cookie: st.cookie, body: { action: 'delete' } })).status, 200);
    assert.equal(await s.rpc('atlas_get_account', { p_username_key: normalizeUsername(st.user.username) }), null);
    assert.equal((await s.db.query('select count(*)::int as n from atlas.accounts')).rows[0].n, 0);
    assert.equal((await s.acct('POST', { body: { action: 'login', username: st.user.username, code: st.signInCode } })).status, 401);
  });

  test('rejects cross-site posts and non-JSON bodies', async () => {
    const s = await setup();
    const { account } = createAccountHandlers({ db: s.rpc });
    const cross = await account(new Request('https://atlas.test/api/account', { method: 'POST', headers: { origin: 'https://evil.test', host: 'atlas.test', 'content-type': 'application/json' }, body: '{"action":"create"}' }));
    assert.equal(cross.status, 403);
    const form = await account(new Request('https://atlas.test/api/account', { method: 'POST', headers: { host: 'atlas.test', 'content-type': 'text/plain' }, body: 'action=create' }));
    assert.equal(form.status, 415);
  });

  test('reports accounts as off when no storage is configured', async () => {
    const { account } = createAccountHandlers({ db: null });
    const r = await account(new Request('https://atlas.test/api/account'));
    assert.deepEqual(await r.json(), { enabled: false, signedIn: false });
  });
});

describe('classroom rooms', () => {
  test('a student joins with an encrypted real name the server cannot read', async () => {
    const s = await setup();
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
    const tables = ['accounts', 'sessions', 'rooms', 'room_members', 'rate_limits'];
    const everything = JSON.stringify(await Promise.all(tables.map(async (t) => (await s.db.query(`select * from atlas.${t}`)).rows)));
    assert.match(everything, /CAREER2026/);
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
    const s = await setup();
    const room = await newRoom(s, 'ROOMONE1');
    assert.equal((await s.room('GET', { query: '?code=ROOMONE1&view=roster' })).status, 401);
    assert.equal((await s.room('GET', { query: '?code=ROOMONE1&view=roster', auth: 'a'.repeat(64) })).status, 401);
    const other = await newRoom(s, 'ROOMTWO2');
    assert.equal((await s.room('GET', { query: '?code=ROOMONE1&view=roster', auth: other.auth })).status, 401);
    assert.equal((await s.room('GET', { query: '?code=ROOMONE1&view=roster', auth: room.auth })).status, 200);
  });

  test('joining a school later keeps existing data (the bridge)', async () => {
    const s = await setup();
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

  test('teachers can close a room, remove a student, and delete the room', async () => {
    const s = await setup();
    const room = await newRoom(s, 'CLOSEME1');
    const st = await newStudent(s);
    const enc = await crypto.encryptName(room.keys.publicKey, 'Sam');
    await s.acct('POST', { cookie: st.cookie, body: { action: 'join', code: 'CLOSEME1', encryptedName: enc, grade: 10 } });

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
    const s = await setup();
    assert.equal((await newRoom(s, 'SAMECODE')).status, 201);
    assert.equal((await newRoom(s, 'samecode')).status, 409);
    assert.equal((await newRoom(s, 'ab')).status, 422);
    assert.match((await newRoom(s)).data.room.code, /^[A-Z2-9]{8}$/);
  });
});

describe('easier sign-in', () => {
  const PIC = [14, 0, 9];
  const pictureLogin = (s, st, picture, ip = '1.1.1.1') => s.acct('POST', { ip, body: { action: 'login', username: st.user.username, picture } });

  async function joinedStudent(s, code) {
    const room = await newRoom(s, code);
    const st = await newStudent(s);
    const encryptedName = await crypto.encryptName(room.keys.publicKey, 'Sam');
    await s.acct('POST', { cookie: st.cookie, body: { action: 'join', code, encryptedName, grade: 10 } });
    return { room, st };
  }

  test('a picture password signs in with the username and three pictures in order', async () => {
    const s = await setup();
    const st = await newStudent(s, { saved: ['x'] });
    assert.equal((await pictureLogin(s, st, PIC)).status, 401, 'no picture password yet');
    assert.equal((await s.acct('POST', { cookie: st.cookie, body: { action: 'set-picture', picture: [1, 2] } })).status, 422);
    assert.equal((await s.acct('POST', { cookie: st.cookie, body: { action: 'set-picture', picture: [1, 2, 20] } })).status, 422);
    const set = await s.acct('POST', { cookie: st.cookie, body: { action: 'set-picture', picture: PIC } });
    assert.equal(set.status, 200);
    assert.equal(set.data.user.hasPicture, true);

    const ok = await pictureLogin(s, st, PIC);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.data.data.saved, ['x']);
    assert.ok(ok.cookie);
    assert.equal((await pictureLogin(s, st, [9, 0, 14])).status, 401, 'order matters');
    // Only a slow hash of the pictures is stored.
    const row = (await s.db.query('select picture_hash from atlas.accounts')).rows[0];
    assert.match(row.picture_hash, /^[0-9a-f]{64}$/);
  });

  test('wrong pictures pause sign-in, then lock it until another sign-in or a teacher unlocks', async () => {
    const s = await setup();
    const { room, st } = await joinedStudent(s, 'PICLOCK1');
    await s.acct('POST', { cookie: st.cookie, body: { action: 'set-picture', picture: PIC } });
    for (let i = 0; i < 4; i += 1) assert.equal((await pictureLogin(s, st, [0, 0, i], `7.7.7.${i}`)).status, 401);
    const paused = await pictureLogin(s, st, [0, 0, 5], '7.7.7.5');
    assert.equal(paused.status, 429);
    assert.equal(paused.data.pictureLocked, true);
    // The right pictures don't work during the pause either, from any IP.
    assert.equal((await pictureLogin(s, st, PIC, '6.6.6.6')).status, 429);

    // Five more wrong tries after the pause lock picture sign-in for good.
    await s.db.exec(`update atlas.accounts set picture_locked_until = now() - interval '1 second'`);
    await s.db.exec('truncate atlas.rate_limits');
    for (let i = 0; i < 4; i += 1) assert.equal((await pictureLogin(s, st, [1, 1, i], `5.5.5.${i}`)).status, 401);
    const locked = await pictureLogin(s, st, [1, 1, 9], '5.5.5.9');
    assert.equal(locked.status, 423);
    await s.db.exec(`update atlas.accounts set picture_locked_until = null`);
    await s.db.exec('truncate atlas.rate_limits');
    assert.equal((await pictureLogin(s, st, PIC)).status, 423, 'still locked after the pause would have ended');
    assert.equal((await s.room('GET', { query: '?code=PICLOCK1&view=roster', auth: room.auth })).data.students[0].pictureLocked, true);

    // A teacher unlock lets the pictures work again.
    assert.equal((await s.room('POST', { auth: room.auth, body: { action: 'unlock', code: 'PICLOCK1', username: st.user.username } })).status, 200);
    assert.equal((await pictureLogin(s, st, PIC)).status, 200);
  });

  test('a Login Pass signs in without a username, and a new pass replaces the old one', async () => {
    const s = await setup();
    const st = await newStudent(s, { saved: ['y'] });
    const first = await s.acct('POST', { cookie: st.cookie, body: { action: 'new-pass' } });
    assert.equal(first.status, 200);
    assert.match(first.data.pass, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(first.data.user.hasPass, true);
    const r = await s.acct('POST', { body: { action: 'login-pass', pass: first.data.pass } });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.username, st.user.username);
    assert.deepEqual(r.data.data.saved, ['y']);

    const second = await s.acct('POST', { cookie: st.cookie, body: { action: 'new-pass' } });
    assert.equal((await s.acct('POST', { body: { action: 'login-pass', pass: first.data.pass } })).status, 401);
    assert.equal((await s.acct('POST', { body: { action: 'login-pass', pass: second.data.pass } })).status, 200);
    assert.equal((await s.acct('POST', { body: { action: 'login-pass', pass: 'not a pass' } })).status, 401);
    // The database only has a hash of the pass.
    assert.doesNotMatch(JSON.stringify((await s.db.query('select * from atlas.accounts')).rows), new RegExp(second.data.pass));
  });

  test('a Login Pass also clears a picture lockout', async () => {
    const s = await setup();
    const st = await newStudent(s);
    await s.acct('POST', { cookie: st.cookie, body: { action: 'set-picture', picture: PIC } });
    const { pass } = (await s.acct('POST', { cookie: st.cookie, body: { action: 'new-pass' } })).data;
    await s.db.exec('update atlas.accounts set picture_fails = 10');
    assert.equal((await pictureLogin(s, st, PIC)).status, 423);
    assert.equal((await s.acct('POST', { body: { action: 'login-pass', pass } })).status, 200);
    assert.equal((await pictureLogin(s, st, PIC)).status, 200);
  });

  test('teachers lock and unlock students, and make one-time sign-in links', async () => {
    const s = await setup();
    const { room, st } = await joinedStudent(s, 'LOCKME01');
    const { pass } = (await s.acct('POST', { cookie: st.cookie, body: { action: 'new-pass' } })).data;
    const lock = await s.room('POST', { auth: room.auth, body: { action: 'lock', code: 'LOCKME01', username: st.user.username } });
    assert.equal(lock.status, 200);
    assert.equal(lock.data.locked, true);
    // Locked: signed out everywhere, and no way in.
    assert.equal((await s.acct('GET', { cookie: st.cookie })).data.signedIn, false);
    assert.equal((await s.acct('POST', { body: { action: 'login-pass', pass } })).status, 423);
    assert.equal((await s.acct('POST', { body: { action: 'login', username: st.user.username, code: st.signInCode } })).status, 423);
    assert.equal((await s.room('GET', { query: '?code=LOCKME01&view=roster', auth: room.auth })).data.students[0].locked, true);

    // A sign-in link unlocks the account and works once.
    const link = await s.room('POST', { auth: room.auth, body: { action: 'sign-in-link', code: 'LOCKME01', username: st.user.username } });
    assert.equal(link.status, 200);
    assert.match(link.data.token, /^[A-Za-z0-9_-]{32}$/);
    const used = await s.acct('POST', { body: { action: 'login-link', token: link.data.token } });
    assert.equal(used.status, 200);
    assert.equal(used.data.fromLink, true);
    assert.equal(used.data.user.username, st.user.username);
    assert.equal((await s.acct('POST', { body: { action: 'login-link', token: link.data.token } })).status, 401, 'one use only');
    assert.equal((await s.acct('POST', { body: { action: 'login-pass', pass } })).status, 200, 'unlocked');

    // A newer link replaces an older one, and links expire.
    const a = (await s.room('POST', { auth: room.auth, body: { action: 'sign-in-link', code: 'LOCKME01', username: st.user.username } })).data.token;
    const b = (await s.room('POST', { auth: room.auth, body: { action: 'sign-in-link', code: 'LOCKME01', username: st.user.username } })).data.token;
    assert.equal((await s.acct('POST', { body: { action: 'login-link', token: a } })).status, 401);
    await s.db.exec(`update atlas.login_links set expires_at = now() - interval '1 second'`);
    assert.equal((await s.acct('POST', { body: { action: 'login-link', token: b } })).status, 401);

    // Only the room's teacher, and only for students in the room.
    const other = await newRoom(s, 'OTHER001');
    assert.equal((await s.room('POST', { auth: other.auth, body: { action: 'lock', code: 'LOCKME01', username: st.user.username } })).status, 401);
    assert.equal((await s.room('POST', { auth: other.auth, body: { action: 'lock', code: 'OTHER001', username: st.user.username } })).status, 404);
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
