// Anonymous student accounts, cloud sync, and classroom rooms, written against
// the web-standard Request/Response so the same code runs as Vercel functions
// (api/account.js, api/rooms.js) and inside the local Express server.
//
// Students
//   GET  /api/account                 who am I? (?data=1 adds the synced data)
//   POST /api/account {action}        create | login | logout | sync | new-code
//                                     | join | leave | delete
// Teachers
//   GET  /api/rooms?code=X            public room info (name, open, public key)
//   GET  /api/rooms?code=X&view=roster          roster + summaries   (teacher auth)
//   GET  /api/rooms?code=X&student=<username>   one student's portfolio (teacher auth)
//   POST /api/rooms {action}          create | settings | remove | reset-code | delete
//
// What is stored (keys share the `atlas:ac:` prefix and expire after about
// 13 months without activity):
//   u:<id>        the account: random username, a hash of the sign-in code, room code
//   un:<name>     username -> id
//   d:<id>        the student's synced data (profile, saved list, tracker, My Story,
//                 Zeus chat, College Lab)
//   s:<hash>      session token hash -> id (the cookie holds the token)
//   r:<CODE>      a room: name, open/closed, public key, the private key encrypted
//                 with the teacher key, and a hash of the teacher's auth token
//   rm:<CODE>     room members: id -> real name *encrypted in the student's browser*
//                 with the room's public key, plus grade
// The server never sees a real name or the teacher key in readable form.

import crypto from 'node:crypto';
import { randomUsername, normalizeUsername, randomSignInCode, normalizeSignInCode, randomRoomCode, normalizeRoomCode } from './names.js';
import { counselorInsights } from '../../public/js/lib/insights.js';
import { financeTier } from '../../public/js/lib/finance.js';

const P = 'atlas:ac:';
const KEEP_SECONDS = 400 * 24 * 60 * 60; // data expires after ~13 months of inactivity
const SESSION_SECONDS = 180 * 24 * 60 * 60;
const COOKIE = 'atlas_session';
const MAX_SYNC_BYTES = 400 * 1024;
const MAX_SMALL_BYTES = 8 * 1024;
const MAX_ROOM_MEMBERS = 500;
const SYNC_KEYS = ['profile', 'saved', 'tracker', 'chat', 'portfolio', 'lab'];

// A whole school often shares one public IP, so per-IP limits leave room for a
// full class; per-username limits stop guessing at one account.
const RATE = {
  create: { max: 300, seconds: 60 * 60 },
  loginFail: { max: 60, seconds: 15 * 60 },
  userFail: { max: 10, seconds: 60 * 60 },
  join: { max: 300, seconds: 60 * 60 },
  lookup: { max: 600, seconds: 10 * 60 },
  roomCreate: { max: 10, seconds: 24 * 60 * 60 },
  teacherFail: { max: 10, seconds: 15 * 60 },
  sync: { max: 240, seconds: 60 * 60 },
};

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const safeEqualHex = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length
  && crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const isB64 = (s, min, max) => typeof s === 'string' && s.length >= min && s.length <= max && B64.test(s);
const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, max) : '');

function json(status, body, headers = {}) {
  const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) v.forEach((x) => h.append(k, x));
    else h.set(k, v);
  }
  return new Response(JSON.stringify(body), { status, headers: h });
}

function clientIp(request) {
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function sameOrigin(request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readJson(request, maxBytes) {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) return { error: json(415, { error: 'Send JSON.' }) };
  const text = await request.text();
  if (Buffer.byteLength(text) > maxBytes) return { error: json(413, { error: 'That’s too much data to save at once.' }) };
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? { body, size: Buffer.byteLength(text) } : { error: json(400, { error: 'Invalid request.' }) };
  } catch {
    return { error: json(400, { error: 'Invalid request.' }) };
  }
}

function readCookie(request, name) {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function isHttps(request) {
  return new URL(request.url).protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
}
function sessionCookie(request, token, maxAge = SESSION_SECONDS) {
  return [`${COOKIE}=${token}`, 'Path=/', `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Lax', isHttps(request) ? 'Secure' : null].filter(Boolean).join('; ');
}
const clearCookie = (request) => sessionCookie(request, '', 0);

/** The part of a student's data a teacher can see (never chats, essays, or private notes). */
export function sharedView(data, lastActive) {
  const d = data && typeof data === 'object' ? data : {};
  const rawProfile = d.profile && typeof d.profile === 'object' ? d.profile : {};
  const { goals: _goals, incomeBand: _band, householdSize: _size, benefits: _benefits, ...profile } = rawProfile;
  const tier = financeTier(rawProfile);
  if (tier) profile.financeTier = tier;
  const tracker = {};
  if (d.tracker && typeof d.tracker === 'object') {
    for (const [id, item] of Object.entries(d.tracker).slice(0, 200)) {
      if (item && typeof item === 'object') {
        const { notes: _notes, ...rest } = item;
        tracker[id] = rest;
      }
    }
  }
  const portfolio = d.portfolio && typeof d.portfolio === 'object' ? structuredClone(d.portfolio) : {};
  if (portfolio.insight && typeof portfolio.insight === 'object' && portfolio.insight.share !== true) delete portfolio.insight.obstacles;
  const stats = d.lab?.stats && typeof d.lab.stats === 'object' ? d.lab.stats : {};
  return {
    profile,
    saved: Array.isArray(d.saved) ? d.saved.slice(0, 500) : [],
    tracker,
    portfolio,
    stats,
    lastActive: lastActive ?? null,
  };
}

/**
 * @param {object} opts
 * @param {object|null} opts.kv        a key-value store (server/kv.js), or null when storage isn't configured
 * @param {object} [opts.env]
 * @param {Map<string, object>} [opts.byId] opportunities by id (for counselor summaries)
 * @param {() => number} [opts.now]
 */
export function createAccountHandlers({ kv, env = {}, byId = new Map(), now = () => Date.now() }) {
  const salt = env.ACCOUNTS_SALT || env.REVIEWS_SALT || env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || 'student-atlas';
  const visitor = (request) => sha256(`${salt}:ip:${clientIp(request)}`).slice(0, 32);
  const codeHash = (id, code) => sha256(`${salt}:code:${id}:${code}`);

  async function hit(bucket, rule) {
    const key = `${P}rl:${bucket}`;
    const [count, ttl] = await kv.pipeline([['INCR', key], ['TTL', key]]);
    if (ttl < 0) await kv.cmd('EXPIRE', key, rule.seconds);
    return count > rule.max;
  }
  const tooMany = (rule) => json(429, { error: 'Too many tries. Please wait a bit and try again.' }, { 'Retry-After': String(rule.seconds) });

  const getJson = async (key) => {
    const raw = await kv.cmd('GET', key);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  };
  const setJson = (key, value) => kv.cmd('SET', `${key}`, JSON.stringify(value), 'EX', KEEP_SECONDS);

  async function currentUser(request) {
    const token = readCookie(request, COOKIE);
    if (!token || token.length > 100) return null;
    const id = await kv.cmd('GET', `${P}s:${sha256(token)}`);
    if (!id) return null;
    const user = await getJson(`${P}u:${id}`);
    return user ? { user, token } : null;
  }

  async function roomInfo(code) {
    return code ? getJson(`${P}r:${code}`) : null;
  }

  async function publicUser(user) {
    let room = null;
    if (user.room) {
      const r = await roomInfo(user.room);
      room = r ? { code: r.code, name: r.name } : null;
    }
    return { username: user.username, emoji: user.emoji, createdAt: user.createdAt, room };
  }

  async function startSession(request, id) {
    const token = crypto.randomBytes(32).toString('base64url');
    await kv.cmd('SET', `${P}s:${sha256(token)}`, id, 'EX', SESSION_SECONDS);
    return sessionCookie(request, token);
  }

  async function touch(user) {
    await kv.pipeline([
      ['EXPIRE', `${P}u:${user.id}`, KEEP_SECONDS],
      ['EXPIRE', `${P}un:${normalizeUsername(user.username)}`, KEEP_SECONDS],
      ['EXPIRE', `${P}d:${user.id}`, KEEP_SECONDS],
    ]);
  }

  function cleanSyncData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const out = {};
    for (const key of SYNC_KEYS) if (data[key] !== undefined) out[key] = data[key];
    return out;
  }

  // ---- Students ----------------------------------------------------------------
  async function create(request, body) {
    if (await hit(`c:${visitor(request)}`, RATE.create)) return tooMany(RATE.create);
    const id = crypto.randomBytes(12).toString('hex');
    let name = null;
    for (let i = 0; i < 12 && !name; i += 1) {
      const candidate = randomUsername(i < 6 ? 2 : i < 10 ? 3 : 4);
      if ((await kv.cmd('SET', `${P}un:${normalizeUsername(candidate.username)}`, id, 'NX', 'EX', KEEP_SECONDS)) === 'OK') name = candidate;
    }
    if (!name) return json(503, { error: 'Couldn’t make a username right now. Please try again.' });
    const signInCode = randomSignInCode();
    const at = now();
    const user = { id, username: name.username, emoji: name.emoji, codeHash: codeHash(id, normalizeSignInCode(signInCode)), createdAt: at, lastActive: at, room: null };
    const data = cleanSyncData(body.data) ?? {};
    await setJson(`${P}u:${id}`, user);
    await setJson(`${P}d:${id}`, { version: 1, updatedAt: at, data });
    const cookie = await startSession(request, id);
    return json(201, { user: await publicUser(user), signInCode, version: 1 }, { 'Set-Cookie': cookie });
  }

  async function login(request, body) {
    const ipBucket = `lf:${visitor(request)}`;
    const uname = normalizeUsername(body.username);
    const code = normalizeSignInCode(body.code);
    const fail = async () => {
      await hit(ipBucket, RATE.loginFail);
      if (uname) await hit(`uf:${uname}`, RATE.userFail);
      return json(401, { error: 'That username and sign-in code don’t match. Check both and try again.' });
    };
    // Check the limits without counting this attempt yet.
    const [ipCount, userCount] = await kv.cmd('MGET', `${P}rl:${ipBucket}`, `${P}rl:uf:${uname ?? '-'}`);
    if (Number(ipCount) >= RATE.loginFail.max) return tooMany(RATE.loginFail);
    if (Number(userCount) >= RATE.userFail.max) return tooMany(RATE.userFail);
    if (!uname || !code) return fail();
    const id = await kv.cmd('GET', `${P}un:${uname}`);
    const user = id ? await getJson(`${P}u:${id}`) : null;
    if (!user || !safeEqualHex(user.codeHash, codeHash(user.id, code))) return fail();
    await touch(user);
    const cookie = await startSession(request, user.id);
    const stored = await getJson(`${P}d:${user.id}`);
    return json(200, { user: await publicUser(user), version: stored?.version ?? 0, data: stored?.data ?? {} }, { 'Set-Cookie': cookie });
  }

  async function sync(request, body, me) {
    if (await hit(`sy:${me.user.id}`, RATE.sync)) return tooMany(RATE.sync);
    const data = cleanSyncData(body.data);
    if (!data) return json(400, { error: 'Invalid data.' });
    const stored = (await getJson(`${P}d:${me.user.id}`)) ?? { version: 0, data: {} };
    if (Number(body.baseVersion) !== stored.version) {
      return json(409, { error: 'Your data changed on another device.', version: stored.version, data: stored.data });
    }
    const at = now();
    const next = { version: stored.version + 1, updatedAt: at, data: { ...stored.data, ...data } };
    for (const key of body.remove ?? []) if (SYNC_KEYS.includes(key)) delete next.data[key];
    await setJson(`${P}d:${me.user.id}`, next);
    await setJson(`${P}u:${me.user.id}`, { ...me.user, lastActive: at });
    await touch(me.user);
    return json(200, { version: next.version, updatedAt: at });
  }

  async function newCode(me) {
    const signInCode = randomSignInCode();
    await setJson(`${P}u:${me.user.id}`, { ...me.user, codeHash: codeHash(me.user.id, normalizeSignInCode(signInCode)) });
    return json(200, { signInCode });
  }

  async function leaveRoom(user) {
    if (!user.room) return;
    await kv.cmd('HDEL', `${P}rm:${user.room}`, user.id);
  }

  async function join(request, body, me) {
    if (await hit(`j:${visitor(request)}`, RATE.join)) return tooMany(RATE.join);
    const code = normalizeRoomCode(body.code);
    const room = await roomInfo(code);
    if (!room) return json(404, { error: 'We couldn’t find a room with that code. Check it with your teacher.' });
    if (!room.open) return json(403, { error: 'That room isn’t taking new students right now. Ask your teacher to open it.' });
    if (!isB64(body.encryptedName, 40, 1024)) return json(422, { error: 'Please type your name.' });
    const grade = [9, 10, 11, 12].includes(body.grade) ? body.grade : null;
    const members = Number(await kv.cmd('HLEN', `${P}rm:${code}`));
    const already = await kv.cmd('HGET', `${P}rm:${code}`, me.user.id);
    if (!already && members >= MAX_ROOM_MEMBERS) return json(403, { error: 'That room is full.' });
    if (me.user.room && me.user.room !== code) await leaveRoom(me.user);
    await kv.cmd('HSET', `${P}rm:${code}`, me.user.id, JSON.stringify({ encName: body.encryptedName, grade, joinedAt: now() }));
    await kv.cmd('EXPIRE', `${P}rm:${code}`, KEEP_SECONDS);
    const user = { ...me.user, room: code };
    await setJson(`${P}u:${user.id}`, user);
    return json(200, { user: await publicUser(user) });
  }

  async function deleteAccount(request, me) {
    await leaveRoom(me.user);
    await kv.cmd('DEL', `${P}u:${me.user.id}`, `${P}d:${me.user.id}`, `${P}un:${normalizeUsername(me.user.username)}`, `${P}s:${sha256(me.token)}`);
    return json(200, { ok: true }, { 'Set-Cookie': clearCookie(request) });
  }

  async function account(request) {
    if (!kv) {
      return request.method === 'GET' ? json(200, { enabled: false, signedIn: false }) : json(503, { enabled: false, error: 'Accounts aren’t turned on for this site yet.' });
    }
    try {
      if (request.method === 'GET') {
        const me = await currentUser(request);
        if (!me) return json(200, { enabled: true, signedIn: false });
        const out = { enabled: true, signedIn: true, user: await publicUser(me.user) };
        if (new URL(request.url).searchParams.get('data') === '1') {
          const stored = await getJson(`${P}d:${me.user.id}`);
          Object.assign(out, { version: stored?.version ?? 0, updatedAt: stored?.updatedAt ?? null, data: stored?.data ?? {} });
        }
        return json(200, out);
      }
      if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' }, { Allow: 'GET, POST' });
      if (!sameOrigin(request)) return json(403, { error: 'Forbidden.' });
      const { body, error } = await readJson(request, MAX_SYNC_BYTES);
      if (error) return error;
      if (body.action === 'create') return await create(request, body);
      if (body.action === 'login') return await login(request, body);
      const me = await currentUser(request);
      if (body.action === 'logout') {
        if (me) await kv.cmd('DEL', `${P}s:${sha256(me.token)}`);
        return json(200, { ok: true }, { 'Set-Cookie': clearCookie(request) });
      }
      if (!me) return json(401, { error: 'You’re signed out. Sign in again to keep saving.' }, { 'Set-Cookie': clearCookie(request) });
      if (body.action === 'sync') return await sync(request, body, me);
      if (body.action === 'new-code') return await newCode(me);
      if (body.action === 'join') return await join(request, body, me);
      if (body.action === 'leave') {
        await leaveRoom(me.user);
        const user = { ...me.user, room: null };
        await setJson(`${P}u:${user.id}`, user);
        return json(200, { user: await publicUser(user) });
      }
      if (body.action === 'delete') return await deleteAccount(request, me);
      return json(400, { error: 'Unknown action.' });
    } catch (err) {
      console.error('account:', err?.message ?? err);
      return json(500, { error: 'Something went wrong. Please try again later.' });
    }
  }

  // ---- Teachers ----------------------------------------------------------------
  async function teacherRoom(request, code) {
    const fails = `tf:${visitor(request)}`;
    const count = Number(await kv.cmd('GET', `${P}rl:${fails}`));
    if (count >= RATE.teacherFail.max) return { error: tooMany(RATE.teacherFail) };
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const room = await roomInfo(code);
    if (!room || !/^[0-9a-f]{64}$/.test(token) || !safeEqualHex(room.authHash, sha256(token))) {
      await hit(fails, RATE.teacherFail);
      return { error: json(401, { error: 'That room code and teacher key don’t match.' }, { 'WWW-Authenticate': 'Bearer' }) };
    }
    await kv.pipeline([['EXPIRE', `${P}r:${code}`, KEEP_SECONDS], ['EXPIRE', `${P}rm:${code}`, KEEP_SECONDS]]);
    return { room };
  }

  async function members(code) {
    const flat = (await kv.cmd('HGETALL', `${P}rm:${code}`)) ?? [];
    const out = [];
    for (let i = 0; i < flat.length; i += 2) {
      try { out.push({ id: flat[i], ...JSON.parse(flat[i + 1]) }); } catch { /* skip */ }
    }
    return out;
  }

  async function loadStudents(list) {
    if (!list.length) return [];
    const keys = list.flatMap((m) => [`${P}u:${m.id}`, `${P}d:${m.id}`]);
    const raws = await kv.cmd('MGET', ...keys);
    const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
    return list.map((m, i) => ({ member: m, user: parse(raws[2 * i]), stored: parse(raws[2 * i + 1]) }))
      .filter((s) => s.user && s.user.room);
  }

  const publicRoom = (room) => ({ code: room.code, name: room.name, open: room.open, createdAt: room.createdAt });

  async function roster(code, room) {
    const students = (await loadStudents(await members(code))).filter((s) => s.user.room === code).map(({ member, user, stored }) => {
      const shared = sharedView(stored?.data, user.lastActive);
      if (!shared.profile.grade && member.grade) shared.profile.grade = member.grade;
      const insights = counselorInsights(shared, { byId, now: new Date(now()) });
      return {
        username: user.username,
        emoji: user.emoji,
        encName: member.encName,
        grade: member.grade ?? insights.grade,
        joinedAt: member.joinedAt,
        lastActive: user.lastActive ?? null,
        insights: { score: insights.score, status: insights.status, summary: insights.summary, flags: insights.flags, counts: insights.counts, goal: insights.goal, nextDeadline: insights.nextDeadline },
      };
    });
    return json(200, { room: { ...publicRoom(room), publicKey: room.publicKey, wrappedKey: room.wrappedKey, wrapIv: room.wrapIv }, students });
  }

  async function memberByUsername(code, username) {
    const uname = normalizeUsername(username);
    const id = uname ? await kv.cmd('GET', `${P}un:${uname}`) : null;
    if (!id) return null;
    const raw = await kv.cmd('HGET', `${P}rm:${code}`, id);
    if (!raw) return null;
    const [{ user, stored, member } = {}] = await loadStudents([{ id, ...JSON.parse(raw) }]);
    return user?.room === code ? { user, stored, member } : null;
  }

  async function createRoom(request, body) {
    if (await hit(`rc:${visitor(request)}`, RATE.roomCreate)) return tooMany(RATE.roomCreate);
    if (!/^[0-9a-f]{64}$/.test(body.authToken ?? '') || !isB64(body.publicKey, 200, 800) || !isB64(body.wrappedKey, 400, 3000) || !isB64(body.wrapIv, 16, 16)) {
      return json(422, { error: 'Invalid room keys.' });
    }
    const requested = body.code ? normalizeRoomCode(body.code) : null;
    if (body.code && !requested) return json(422, { error: 'Room codes use 6 to 16 letters and numbers.', field: 'code' });
    const name = cleanText(body.name, 80) || 'My class';
    const room = { name, createdAt: now(), open: true, authHash: sha256(body.authToken), publicKey: body.publicKey, wrappedKey: body.wrappedKey, wrapIv: body.wrapIv };
    for (let i = 0; i < 8; i += 1) {
      const code = requested ?? randomRoomCode();
      if ((await kv.cmd('SET', `${P}r:${code}`, JSON.stringify({ ...room, code }), 'NX', 'EX', KEEP_SECONDS)) === 'OK') {
        return json(201, { room: publicRoom({ ...room, code }) });
      }
      if (requested) return json(409, { error: 'That room code is taken. Try another one.', field: 'code' });
    }
    return json(503, { error: 'Couldn’t make a room right now. Please try again.' });
  }

  async function rooms(request) {
    if (!kv) return json(503, { enabled: false, error: 'Classroom rooms aren’t turned on for this site yet.' });
    try {
      const url = new URL(request.url);
      if (request.method === 'GET') {
        const code = normalizeRoomCode(url.searchParams.get('code'));
        if (url.searchParams.get('view') === 'roster' || url.searchParams.has('student')) {
          const { room, error } = await teacherRoom(request, code);
          if (error) return error;
          if (url.searchParams.get('view') === 'roster') return await roster(code, room);
          const found = await memberByUsername(code, url.searchParams.get('student'));
          if (!found) return json(404, { error: 'That student isn’t in this room.' });
          const shared = sharedView(found.stored?.data, found.user.lastActive);
          if (!shared.profile.grade && found.member.grade) shared.profile.grade = found.member.grade;
          return json(200, {
            student: { username: found.user.username, emoji: found.user.emoji, encName: found.member.encName, grade: found.member.grade, joinedAt: found.member.joinedAt, lastActive: found.user.lastActive ?? null },
            shared,
          });
        }
        if (await hit(`lk:${visitor(request)}`, RATE.lookup)) return tooMany(RATE.lookup);
        const room = await roomInfo(code);
        if (!room) return json(404, { error: 'We couldn’t find a room with that code.' });
        return json(200, { room: { code: room.code, name: room.name, open: room.open, publicKey: room.open ? room.publicKey : undefined } });
      }
      if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' }, { Allow: 'GET, POST' });
      if (!sameOrigin(request)) return json(403, { error: 'Forbidden.' });
      const { body, error } = await readJson(request, MAX_SMALL_BYTES);
      if (error) return error;
      if (body.action === 'create') return await createRoom(request, body);

      const code = normalizeRoomCode(body.code);
      const auth = await teacherRoom(request, code);
      if (auth.error) return auth.error;
      const { room } = auth;
      if (body.action === 'settings') {
        const next = { ...room, open: typeof body.open === 'boolean' ? body.open : room.open, name: cleanText(body.name, 80) || room.name };
        await setJson(`${P}r:${code}`, next);
        return json(200, { room: publicRoom(next) });
      }
      if (body.action === 'remove' || body.action === 'reset-code') {
        const found = await memberByUsername(code, body.username);
        if (!found) return json(404, { error: 'That student isn’t in this room.' });
        if (body.action === 'remove') {
          await kv.cmd('HDEL', `${P}rm:${code}`, found.user.id);
          await setJson(`${P}u:${found.user.id}`, { ...found.user, room: null });
          return json(200, { ok: true });
        }
        const signInCode = randomSignInCode();
        await setJson(`${P}u:${found.user.id}`, { ...found.user, codeHash: codeHash(found.user.id, normalizeSignInCode(signInCode)) });
        return json(200, { username: found.user.username, signInCode });
      }
      if (body.action === 'delete') {
        for (const { user } of await loadStudents(await members(code))) {
          if (user.room === code) await setJson(`${P}u:${user.id}`, { ...user, room: null });
        }
        await kv.cmd('DEL', `${P}r:${code}`, `${P}rm:${code}`);
        return json(200, { ok: true });
      }
      return json(400, { error: 'Unknown action.' });
    } catch (err) {
      console.error('rooms:', err?.message ?? err);
      return json(500, { error: 'Something went wrong. Please try again later.' });
    }
  }

  return { account, rooms };
}
