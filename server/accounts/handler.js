// Anonymous student accounts, cloud sync, and classroom rooms, written against
// the web-standard Request/Response so the same code runs as Vercel functions
// (api/account.js, api/rooms.js) and inside the local Express server.
//
// Students
//   GET  /api/account                 who am I? (?data=1 adds the synced data)
//   POST /api/account {action}        create | login | login-pass | login-link | logout
//                                     | sync | set-picture | new-pass | new-code
//                                     | join | leave | delete
// Teachers
//   GET  /api/rooms?code=X            public room info (name, open, public key)
//   GET  /api/rooms?code=X&view=roster          roster + summaries   (teacher auth)
//   GET  /api/rooms?code=X&student=<username>   one student's portfolio (teacher auth)
//   POST /api/rooms {action}          create | settings | remove | lock | unlock
//                                     | sign-in-link | delete
//
// What is stored (Supabase Postgres, see supabase/migrations; accounts and
// rooms expire after about 13 months without activity):
//   accounts      random username; hashes of the picture password, the Login
//                 Pass, and the (optional, backup) sign-in code; a teacher lock;
//                 and the student's synced data (profile, saved list, tracker,
//                 My Story, Zeus chat, College Lab)
//   sessions      session token hash -> account (the cookie holds the token)
//   login_links   one-time sign-in links a teacher makes, by token hash
//   rooms         a room: name, open/closed, public key, the private key encrypted
//                 with the teacher key, and a hash of the teacher's auth token
//   room_members  account -> room, with the real name *encrypted in the student's
//                 browser* with the room's public key, plus grade
// The server never sees a real name or the teacher key in readable form.
//
// Ways a student signs in
//   picture password  username + three pictures in order (public/js/lib/pictures.js).
//                     Only 8,000 combinations, so wrong tries lock it: a 15-minute
//                     pause after every 5, and after 10 it stops working until the
//                     student signs in another way or a teacher unlocks them.
//   Login Pass        a QR code image holding a long random secret; uploading it
//                     or showing it to the webcam signs in. A new pass replaces
//                     the old one.
//   sign-in link      made by a teacher for a student in their room; works once,
//                     for 48 hours.
//   sign-in code      the older typed code; still works, and students can make one
//                     as a backup.

import crypto from 'node:crypto';
import { randomUsername, normalizeUsername, randomSignInCode, normalizeSignInCode, randomRoomCode, normalizeRoomCode } from './names.js';
import { counselorInsights } from '../../public/js/lib/insights.js';
import { isPictureSequence } from '../../public/js/lib/pictures.js';
import { financeTier } from '../../public/js/lib/finance.js';

const P = 'atlas:ac:';
const SESSION_SECONDS = 180 * 24 * 60 * 60;
const COOKIE = 'atlas_session';
const MAX_SYNC_BYTES = 400 * 1024;
const MAX_SMALL_BYTES = 8 * 1024;
const MAX_ROOM_MEMBERS = 500;
const SYNC_KEYS = ['profile', 'saved', 'tracker', 'chat', 'portfolio', 'lab'];
const PICTURE_LOCK_EVERY = 5; // wrong picture tries before a pause
const PICTURE_LOCK_SECONDS = 15 * 60;
const PICTURE_MAX_FAILS = 10; // then only another sign-in or a teacher unlock re-enables it
const LINK_SECONDS = 48 * 60 * 60;
const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;

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
const scrypt = (password, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, 32, (err, key) => (err ? reject(err) : resolve(key.toString('hex'))));
});
const cleanToken = (v) => (typeof v === 'string' && TOKEN.test(v.trim()) ? v.trim() : null);
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
 * @param {Function|Promise<Function>|null} opts.db  `rpc(fn, args)` for the database (server/db), or null when storage isn't configured
 * @param {object} [opts.env]
 * @param {Map<string, object>} [opts.byId] opportunities by id (for counselor summaries)
 * @param {() => number} [opts.now]
 */
export function createAccountHandlers({ db, env = {}, byId = new Map(), now = () => Date.now() }) {
  // Keep this chain as it was with Redis: sign-in codes are hashed with it.
  const salt = env.ACCOUNTS_SALT || env.REVIEWS_SALT || env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || 'student-atlas';
  const visitor = (request) => sha256(`${salt}:ip:${clientIp(request)}`).slice(0, 32);
  const codeHash = (id, code) => sha256(`${salt}:code:${id}:${code}`);
  // Few possible picture passwords, so a slow hash, keyed by the server's salt.
  const pictureHash = (id, seq) => scrypt(`${id}:${seq.join('.')}`, `${salt}:picture`);
  const passHash = (token) => sha256(`${salt}:pass:${token}`);
  const linkHash = (token) => sha256(`${salt}:link:${token}`);
  const rpc = async (fn, args) => (await db)(fn, args);

  async function hit(bucket, rule) {
    return (await rpc('atlas_hit', { p_bucket: `ac:${bucket}`, p_seconds: rule.seconds })) > rule.max;
  }
  const peek = (...buckets) => rpc('atlas_peek', { p_buckets: buckets.map((b) => `ac:${b}`) });
  const tooMany = (rule) => json(429, { error: 'Too many tries. Please wait a bit and try again.' }, { 'Retry-After': String(rule.seconds) });

  async function currentUser(request) {
    const token = readCookie(request, COOKIE);
    if (!token || token.length > 100) return null;
    const user = await rpc('atlas_session_account', { p_token_hash: sha256(token) });
    return user ? { user, token } : null;
  }

  const roomInfo = (code) => (code ? rpc('atlas_get_room', { p_code: code }) : null);
  const getAccount = (id) => rpc('atlas_get_account', { p_id: id });
  const getStored = (id) => rpc('atlas_get_data', { p_id: id });

  const publicUser = (user) => ({
    username: user.username,
    emoji: user.emoji,
    createdAt: user.createdAt,
    room: user.room && user.roomName ? { code: user.room, name: user.roomName } : null,
    hasPicture: Boolean(user.pictureHash),
    hasPass: Boolean(user.hasPass),
  });
  const pictureLocked = (user) => user.pictureFails >= PICTURE_MAX_FAILS || (user.pictureLockedUntil ?? 0) > now();
  const lockedAccount = () => json(423, { error: 'This account is locked. Ask your teacher to unlock it or to make you a sign-in link.', locked: true });

  async function startSession(request, id) {
    const token = crypto.randomBytes(32).toString('base64url');
    await rpc('atlas_create_session', { p_token_hash: sha256(token), p_account_id: id, p_seconds: SESSION_SECONDS });
    return sessionCookie(request, token);
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
    // No typed code to begin with: students sign in with pictures or a Login
    // Pass, and can make a backup code later. This hash matches no code.
    const hash = codeHash(id, crypto.randomBytes(16).toString('hex'));
    const data = cleanSyncData(body.data) ?? {};
    const at = now();
    let name = null;
    for (let i = 0; i < 12 && !name; i += 1) {
      const candidate = randomUsername(i < 6 ? 2 : i < 10 ? 3 : 4);
      const created = await rpc('atlas_create_account', {
        p_id: id, p_username: candidate.username, p_username_key: normalizeUsername(candidate.username), p_emoji: candidate.emoji,
        p_code_hash: hash, p_created_at: at, p_data: data,
      });
      if (created) name = candidate;
    }
    if (!name) return json(503, { error: 'Couldn’t make a username right now. Please try again.' });
    const cookie = await startSession(request, id);
    return json(201, { user: publicUser({ username: name.username, emoji: name.emoji, createdAt: at }), version: 1 }, { 'Set-Cookie': cookie });
  }

  /** Starts a session for a student who proved who they are, and returns their data. */
  async function finishSignIn(request, user, extra = {}) {
    await rpc('atlas_signed_in', { p_id: user.id });
    const cookie = await startSession(request, user.id);
    const stored = await getStored(user.id);
    return json(200, { user: publicUser(user), version: stored?.version ?? 0, data: stored?.data ?? {}, ...extra }, { 'Set-Cookie': cookie });
  }

  function pictureLockedResponse(user) {
    if (user.pictureFails >= PICTURE_MAX_FAILS) {
      return json(423, { error: 'Your picture password is locked after too many wrong tries. Sign in with your Login Pass, or ask your teacher to unlock you.', pictureLocked: true });
    }
    const minutes = Math.max(1, Math.ceil((user.pictureLockedUntil - now()) / 60000));
    return json(429, { error: `Too many wrong pictures. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or sign in with your Login Pass.`, pictureLocked: true }, { 'Retry-After': String(minutes * 60) });
  }

  // Username plus either the picture password ({picture: [i, j, k]}) or the sign-in code ({code}).
  async function login(request, body) {
    const ipBucket = `lf:${visitor(request)}`;
    const uname = normalizeUsername(body.username);
    const withPicture = body.picture !== undefined;
    const code = withPicture ? null : normalizeSignInCode(body.code);
    const fail = async (user) => {
      await hit(ipBucket, RATE.loginFail);
      if (uname) await hit(`uf:${uname}`, RATE.userFail);
      if (user) {
        const after = await rpc('atlas_picture_fail', { p_id: user.id, p_lock_every: PICTURE_LOCK_EVERY, p_lock_seconds: PICTURE_LOCK_SECONDS });
        const next = { pictureFails: after.fails, pictureLockedUntil: after.lockedUntil };
        if (pictureLocked(next)) return pictureLockedResponse(next);
        const left = PICTURE_LOCK_EVERY - (after.fails % PICTURE_LOCK_EVERY);
        return json(401, { error: `That username and those pictures don’t match. ${left === 1 ? 'One more wrong try pauses' : `${left} more wrong tries pause`} picture sign-in for this username.` });
      }
      return json(401, { error: withPicture ? 'That username and those pictures don’t match. Check both and try again.' : 'That username and sign-in code don’t match. Check both and try again.' });
    };
    // Check the limits without counting this attempt yet.
    const [ipCount, userCount] = await peek(ipBucket, `uf:${uname ?? '-'}`);
    if (ipCount >= RATE.loginFail.max) return tooMany(RATE.loginFail);
    if (userCount >= RATE.userFail.max) return tooMany(RATE.userFail);
    if (!uname || (withPicture ? !isPictureSequence(body.picture) : !code)) return fail();
    const user = await rpc('atlas_get_account', { p_username_key: uname });
    if (!user) return fail();
    if (withPicture) {
      if (pictureLocked(user)) return pictureLockedResponse(user);
      if (!user.pictureHash) return fail();
      if (!safeEqualHex(user.pictureHash, await pictureHash(user.id, body.picture))) return fail(user);
    } else if (!safeEqualHex(user.codeHash, codeHash(user.id, code))) {
      return fail();
    }
    if (user.locked) return lockedAccount();
    return finishSignIn(request, user);
  }

  // The Login Pass, or a teacher's one-time sign-in link: a long random secret, no username needed.
  async function loginWithToken(request, body, kind) {
    const ipBucket = `lf:${visitor(request)}`;
    const [ipCount] = await peek(ipBucket);
    if (ipCount >= RATE.loginFail.max) return tooMany(RATE.loginFail);
    const token = cleanToken(kind === 'pass' ? body.pass : body.token);
    let user = null;
    if (token) {
      user = kind === 'pass'
        ? await rpc('atlas_account_by_pass', { p_hash: passHash(token) })
        : await rpc('atlas_use_login_link', { p_token_hash: linkHash(token) });
    }
    if (!user) {
      await hit(ipBucket, RATE.loginFail);
      return json(401, {
        error: kind === 'pass'
          ? 'That Login Pass doesn’t work. It may be an older one: downloading a new pass replaces the old one.'
          : 'That sign-in link has expired or was already used. Ask your teacher for a new one.',
      });
    }
    if (user.locked) return lockedAccount();
    return finishSignIn(request, user, kind === 'link' ? { fromLink: true } : {});
  }

  async function setPicture(body, me) {
    if (!isPictureSequence(body.picture)) return json(422, { error: 'Pick three pictures.' });
    await rpc('atlas_set_picture', { p_id: me.user.id, p_hash: await pictureHash(me.user.id, body.picture) });
    return json(200, { user: publicUser(await getAccount(me.user.id)) });
  }

  async function newPass(me) {
    const pass = crypto.randomBytes(24).toString('base64url');
    await rpc('atlas_set_pass', { p_id: me.user.id, p_hash: passHash(pass) });
    return json(200, { pass, user: publicUser(await getAccount(me.user.id)) });
  }

  async function sync(request, body, me) {
    if (await hit(`sy:${me.user.id}`, RATE.sync)) return tooMany(RATE.sync);
    const data = cleanSyncData(body.data);
    if (!data) return json(400, { error: 'Invalid data.' });
    const remove = (Array.isArray(body.remove) ? body.remove : []).filter((key) => SYNC_KEYS.includes(key));
    const baseVersion = Number.isSafeInteger(body.baseVersion) ? body.baseVersion : -1;
    const at = now();
    const result = await rpc('atlas_sync_data', { p_id: me.user.id, p_base_version: baseVersion, p_data: data, p_remove: remove, p_at: at });
    if (!result.ok) return json(409, { error: 'Your data changed on another device.', version: result.version, data: result.data });
    return json(200, { version: result.version, updatedAt: at });
  }

  async function newCode(me) {
    const signInCode = randomSignInCode();
    await rpc('atlas_set_code', { p_id: me.user.id, p_code_hash: codeHash(me.user.id, normalizeSignInCode(signInCode)) });
    return json(200, { signInCode });
  }

  async function join(request, body, me) {
    if (await hit(`j:${visitor(request)}`, RATE.join)) return tooMany(RATE.join);
    const code = normalizeRoomCode(body.code);
    const room = await roomInfo(code);
    if (!room) return json(404, { error: 'We couldn’t find a room with that code. Check it with your teacher.' });
    if (!room.open) return json(403, { error: 'That room isn’t taking new students right now. Ask your teacher to open it.' });
    if (!isB64(body.encryptedName, 40, 1024)) return json(422, { error: 'Please type your name.' });
    const grade = [9, 10, 11, 12].includes(body.grade) ? body.grade : null;
    const status = await rpc('atlas_join_room', {
      p_code: code, p_account_id: me.user.id, p_enc_name: body.encryptedName, p_grade: grade, p_joined_at: now(), p_max: MAX_ROOM_MEMBERS,
    });
    if (status === 'full') return json(403, { error: 'That room is full.' });
    return json(200, { user: publicUser(await getAccount(me.user.id)) });
  }

  async function account(request) {
    if (!db) {
      return request.method === 'GET' ? json(200, { enabled: false, signedIn: false }) : json(503, { enabled: false, error: 'Accounts aren’t turned on for this site yet.' });
    }
    try {
      if (request.method === 'GET') {
        const me = await currentUser(request);
        if (!me) return json(200, { enabled: true, signedIn: false });
        const out = { enabled: true, signedIn: true, user: publicUser(me.user) };
        if (new URL(request.url).searchParams.get('data') === '1') {
          const stored = await getStored(me.user.id);
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
      if (body.action === 'login-pass') return await loginWithToken(request, body, 'pass');
      if (body.action === 'login-link') return await loginWithToken(request, body, 'link');
      const me = await currentUser(request);
      if (body.action === 'logout') {
        if (me) await rpc('atlas_delete_session', { p_token_hash: sha256(me.token) });
        return json(200, { ok: true }, { 'Set-Cookie': clearCookie(request) });
      }
      if (!me) return json(401, { error: 'You’re signed out. Sign in again to keep saving.' }, { 'Set-Cookie': clearCookie(request) });
      if (body.action === 'sync') return await sync(request, body, me);
      if (body.action === 'new-code') return await newCode(me);
      if (body.action === 'set-picture') return await setPicture(body, me);
      if (body.action === 'new-pass') return await newPass(me);
      if (body.action === 'join') return await join(request, body, me);
      if (body.action === 'leave') {
        await rpc('atlas_leave_room', { p_account_id: me.user.id });
        return json(200, { user: publicUser({ ...me.user, room: null }) });
      }
      if (body.action === 'delete') {
        // Sessions and room membership go with the account.
        await rpc('atlas_delete_account', { p_id: me.user.id });
        return json(200, { ok: true }, { 'Set-Cookie': clearCookie(request) });
      }
      return json(400, { error: 'Unknown action.' });
    } catch (err) {
      console.error('account:', err?.message ?? err);
      return json(500, { error: 'Something went wrong. Please try again later.' });
    }
  }

  // ---- Teachers ----------------------------------------------------------------
  async function teacherRoom(request, code) {
    const fails = `tf:${visitor(request)}`;
    const [count] = await peek(fails);
    if (count >= RATE.teacherFail.max) return { error: tooMany(RATE.teacherFail) };
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const room = await roomInfo(code);
    if (!room || !/^[0-9a-f]{64}$/.test(token) || !safeEqualHex(room.authHash, sha256(token))) {
      await hit(fails, RATE.teacherFail);
      return { error: json(401, { error: 'That room code and teacher key don’t match.' }, { 'WWW-Authenticate': 'Bearer' }) };
    }
    await rpc('atlas_touch_room', { p_code: code });
    return { room };
  }

  /** Students in a room as [{ user, member, stored }], with only the data a teacher may see. */
  const roomStudents = (code, username) => rpc('atlas_room_students', { p_code: code, p_username_key: username ?? null });

  const publicRoom = (room) => ({ code: room.code, name: room.name, open: room.open, createdAt: room.createdAt });

  async function roster(code, room) {
    const students = (await roomStudents(code)).map(({ member, user, stored }) => {
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
        locked: Boolean(user.locked),
        pictureLocked: pictureLocked(user),
        insights: { score: insights.score, status: insights.status, summary: insights.summary, flags: insights.flags, counts: insights.counts, goal: insights.goal, nextDeadline: insights.nextDeadline },
      };
    });
    return json(200, { room: { ...publicRoom(room), publicKey: room.publicKey, wrappedKey: room.wrappedKey, wrapIv: room.wrapIv }, students });
  }

  async function memberByUsername(code, username) {
    const uname = normalizeUsername(username);
    if (!uname) return null;
    const [found] = await roomStudents(code, uname);
    return found ?? null;
  }

  async function createRoom(request, body) {
    if (await hit(`rc:${visitor(request)}`, RATE.roomCreate)) return tooMany(RATE.roomCreate);
    if (!/^[0-9a-f]{64}$/.test(body.authToken ?? '') || !isB64(body.publicKey, 200, 800) || !isB64(body.wrappedKey, 400, 3000) || !isB64(body.wrapIv, 16, 16)) {
      return json(422, { error: 'Invalid room keys.' });
    }
    const requested = body.code ? normalizeRoomCode(body.code) : null;
    if (body.code && !requested) return json(422, { error: 'Room codes use 6 to 16 letters and numbers.', field: 'code' });
    const name = cleanText(body.name, 80) || 'My class';
    const createdAt = now();
    for (let i = 0; i < 8; i += 1) {
      const code = requested ?? randomRoomCode();
      const created = await rpc('atlas_create_room', {
        p_code: code, p_name: name, p_auth_hash: sha256(body.authToken), p_public_key: body.publicKey, p_wrapped_key: body.wrappedKey, p_wrap_iv: body.wrapIv, p_created_at: createdAt,
      });
      if (created) return json(201, { room: publicRoom({ code, name, open: true, createdAt }) });
      if (requested) return json(409, { error: 'That room code is taken. Try another one.', field: 'code' });
    }
    return json(503, { error: 'Couldn’t make a room right now. Please try again.' });
  }

  async function rooms(request) {
    if (!db) return json(503, { enabled: false, error: 'Classroom rooms aren’t turned on for this site yet.' });
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
        const next = await rpc('atlas_update_room', {
          p_code: code, p_name: cleanText(body.name, 80) || room.name, p_open: typeof body.open === 'boolean' ? body.open : room.open,
        });
        return json(200, { room: publicRoom(next) });
      }
      if (['remove', 'lock', 'unlock', 'sign-in-link'].includes(body.action)) {
        const found = await memberByUsername(code, body.username);
        if (!found) return json(404, { error: 'That student isn’t in this room.' });
        const id = found.user.id;
        if (body.action === 'remove') {
          await rpc('atlas_leave_room', { p_account_id: id, p_code: code });
          return json(200, { ok: true });
        }
        if (body.action === 'lock' || body.action === 'unlock') {
          // Locking signs the student out everywhere; unlocking also lifts a picture lockout.
          await rpc('atlas_set_locked', { p_id: id, p_locked: body.action === 'lock' });
          return json(200, { username: found.user.username, locked: body.action === 'lock' });
        }
        // A one-time link the teacher hands to the student. Making one unlocks the account.
        const token = crypto.randomBytes(24).toString('base64url');
        await rpc('atlas_set_locked', { p_id: id, p_locked: false });
        await rpc('atlas_create_login_link', { p_token_hash: linkHash(token), p_account_id: id, p_seconds: LINK_SECONDS });
        return json(200, { username: found.user.username, token, expiresAt: now() + LINK_SECONDS * 1000 });
      }
      if (body.action === 'delete') {
        // Students keep their accounts; they just leave the room.
        await rpc('atlas_delete_room', { p_code: code });
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
