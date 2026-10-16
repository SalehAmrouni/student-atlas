// Atlas accounts in the browser: anonymous usernames, sign in and out, joining
// a school room, and cloud sync.
//
// The session lives in an HttpOnly cookie the page can't read; this module
// keeps only the username in localStorage (store.js `account`) so pages know
// who is signed in without waiting for the network. Sync is "last device
// wins" per section (profile, saved, tracker, chat, My Story, College Lab),
// with version checks so a stale tab never silently overwrites newer data.

import {
  STORAGE_KEYS as K, readKey, writeKey, emit, getAccount, setAccount, onStoreChange,
  getProfile, getSaved, getTracker, getChat, getPortfolio, deleteAllData,
} from './store.js';
import { getLab, replaceLab, onLabChange, clearLab } from './lab-store.js';
import { encryptName } from './room-crypto.js';

const API = '/api/account';
const SECTIONS = ['profile', 'saved', 'tracker', 'chat', 'portfolio', 'lab'];
const MAX_BYTES = 380 * 1024;

export class AccountError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function call(method, body, { query = '', keepalive = false } = {}) {
  let res;
  try {
    res = await fetch(`${API}${query}`, {
      method,
      credentials: 'same-origin',
      keepalive,
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new AccountError('Couldn’t reach Student Atlas. Check your connection and try again.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 409) throw new AccountError(data.error || 'Something went wrong. Please try again.', res.status);
  return { status: res.status, data };
}

// ---- Status ----------------------------------------------------------------------
let statusPromise = null;
/** { enabled, signedIn, user } from the server (cached for this page). */
export function accountStatus() {
  statusPromise ??= call('GET').then((r) => r.data).catch(() => ({ enabled: false, signedIn: false, offline: true }));
  return statusPromise;
}
export const signedIn = () => Boolean(getAccount());

// ---- Snapshot of this browser's data ----------------------------------------------
function labSnapshot() {
  const lab = structuredClone(getLab());
  // Keep the newest few feedback versions per essay so a backup stays small.
  lab.essays = (lab.essays ?? []).map((e) => ({ ...e, versions: (e.versions ?? []).slice(-3) }));
  if (JSON.stringify(lab).length > MAX_BYTES / 2) lab.essays = lab.essays.map((e) => ({ ...e, versions: [] }));
  return lab;
}

export function localSnapshot() {
  return {
    profile: readKey(K.profile, null),
    saved: getSaved(),
    tracker: getTracker(),
    chat: getChat(),
    portfolio: getPortfolio(),
    lab: labSnapshot(),
  };
}

/** True when this browser holds anything worth keeping. */
export function hasLocalData() {
  const lab = getLab();
  return Boolean(getProfile() || getSaved().length || Object.keys(getTracker()).length || getPortfolio().milestones.done.length
    || lab.essays?.length || lab.transcript || lab.stats?.gpa || lab.stats?.activities?.length);
}

let applying = false;
function applySections(data, skip = new Set()) {
  applying = true;
  try {
    for (const key of SECTIONS) {
      if (skip.has(key) || !(key in (data ?? {}))) continue;
      const value = data[key];
      if (key === 'lab') replaceLab(value);
      else if (key === 'chat') writeKey(K.chat, Array.isArray(value) ? value : []);
      else if (value === null) { try { localStorage.removeItem(K[key]); } catch { /* ignore */ } }
      else writeKey(K[key], value);
      if (key !== 'lab') emit(key);
    }
  } finally {
    applying = false;
  }
}

// ---- Sync state --------------------------------------------------------------------
const syncState = () => ({ version: 0, dirty: [], ...readKey(K.sync, {}) });
const saveSyncState = (s) => writeKey(K.sync, { version: s.version, dirty: [...new Set(s.dirty)] });

let editsInFlight = null; // sections edited while a push is on its way
function markDirty(section) {
  if (applying || !getAccount()) return;
  editsInFlight?.add(section);
  const s = syncState();
  if (!s.dirty.includes(section)) s.dirty.push(section);
  saveSyncState(s);
  schedulePush();
}

let pushTimer = null;
let pushing = null;
function schedulePush(delay = 1200) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { push().catch(() => {}); }, delay);
}

const statusListeners = new Set();
export function onSyncStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}
function setStatus(status) {
  for (const fn of statusListeners) fn(status);
}

/** Sends dirty sections to the account. Resolves when done (or skipped). */
export async function push({ keepalive = false } = {}) {
  if (pushing) return pushing;
  const run = async () => {
    editsInFlight = new Set();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const s = syncState();
      if (!getAccount() || !s.dirty.length) return;
      const snap = localSnapshot();
      const data = Object.fromEntries(s.dirty.map((k) => [k, snap[k]]));
      setStatus('saving');
      const r = await call('POST', { action: 'sync', baseVersion: s.version, data }, { keepalive });
      if (r.status === 409) {
        // Another device saved first: take its sections we haven't changed, then retry ours.
        applySections(r.data.data, new Set(s.dirty));
        saveSyncState({ version: r.data.version, dirty: s.dirty });
        continue;
      }
      const latest = syncState();
      saveSyncState({ version: r.data.version, dirty: latest.dirty.filter((k) => !s.dirty.includes(k) || editsInFlight.has(k)) });
      setStatus('saved');
      return;
    }
  };
  pushing = run().catch((err) => {
    setStatus(err.status === 401 ? 'signed-out' : 'offline');
    if (err.status === 401) setAccount(null);
    throw err;
  }).finally(() => { pushing = null; editsInFlight = null; });
  return pushing;
}

/** On page load: pull newer data from the account, then push anything pending. */
export async function startSync() {
  onStoreChange((what) => { if (SECTIONS.includes(what)) markDirty(what); });
  onLabChange(() => markDirty('lab'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && syncState().dirty.length) push({ keepalive: true }).catch(() => {});
  });
  if (!getAccount()) return;

  const status = await accountStatus();
  if (status.offline || !status.enabled) return;
  if (!status.signedIn) {
    // The session ended (expired, or logged out on this device elsewhere). Keep the data, drop the marker.
    setAccount(null);
    setStatus('signed-out');
    return;
  }
  setAccount(status.user);
  const r = await call('GET', null, { query: '?data=1' }).catch(() => null);
  if (!r) return;
  const s = syncState();
  if (r.data.version > s.version) {
    applySections(r.data.data, new Set(s.dirty));
    saveSyncState({ version: r.data.version, dirty: s.dirty });
  }
  if (syncState().dirty.length) await push().catch(() => {});
}

// ---- Account actions ------------------------------------------------------------------
function becomeSignedIn(user, version, dirty = []) {
  const chat = getChat(); // move this tab's chat into the account
  setAccount(user);
  if (chat.length) writeKey(K.chat, chat);
  saveSyncState({ version, dirty });
  statusPromise = Promise.resolve({ enabled: true, signedIn: true, user });
}

/**
 * Creates an anonymous account (Path A), carrying over what's in this browser.
 * Returns { user, created } or null when accounts aren't available.
 */
export async function createAccount({ keepLocal = true } = {}) {
  const status = await accountStatus();
  if (!status.enabled) return null;
  if (status.signedIn) {
    if (!getAccount()) becomeSignedIn(status.user, syncState().version);
    return { user: status.user, created: false };
  }
  const data = keepLocal ? localSnapshot() : {};
  const r = await call('POST', { action: 'create', data });
  if (!keepLocal) deleteAllData();
  becomeSignedIn(r.data.user, r.data.version);
  return { user: r.data.user, created: true };
}

/** Makes sure the student has an account; never throws. */
export async function ensureAccount() {
  if (getAccount()) return { user: getAccount(), created: false };
  try {
    return await createAccount();
  } catch {
    return null;
  }
}

/**
 * Signs in on this device with one of: { username, picture: [i, j, k] },
 * { username, code }, { pass } (Login Pass), or { token } (a teacher's link).
 * `keepLocal`: add this browser's data to the account (true) or replace it
 * with the account's data (false). Resolves to { user, fromLink }.
 */
export async function signIn(credentials, { keepLocal = false } = {}) {
  const local = keepLocal ? localSnapshot() : null;
  const body = credentials.pass ? { action: 'login-pass', pass: credentials.pass }
    : credentials.token ? { action: 'login-link', token: credentials.token }
      : { action: 'login', username: credentials.username, ...(credentials.picture ? { picture: credentials.picture } : { code: credentials.code }) };
  const r = await call('POST', body);
  if (!keepLocal) deleteAllData();
  applySections(r.data.data);
  if (local) {
    // Merge: union saved lists and tracker, keep the account's profile unless it has none.
    const merged = {
      saved: [...new Set([...(r.data.data.saved ?? []), ...local.saved])],
      tracker: { ...local.tracker, ...(r.data.data.tracker ?? {}) },
    };
    if (!r.data.data.profile && local.profile) merged.profile = local.profile;
    applySections(merged);
    becomeSignedIn(r.data.user, r.data.version, Object.keys(merged));
    schedulePush(0);
  } else {
    becomeSignedIn(r.data.user, r.data.version);
  }
  return { user: r.data.user, fromLink: Boolean(r.data.fromLink) };
}

/** Sets (or changes) the picture password. */
export async function setPicturePassword(picture) {
  const r = await call('POST', { action: 'set-picture', picture });
  setAccount(r.data.user);
  return r.data.user;
}

/** Makes a new Login Pass secret; any older pass stops working. */
export async function newLoginPass() {
  const r = await call('POST', { action: 'new-pass' });
  setAccount(r.data.user);
  return r.data.pass;
}

/** The Clear Computer rule: end the session and wipe everything from this browser. */
export async function logOut() {
  clearTimeout(pushTimer);
  try { await push(); } catch { /* still log out */ }
  try { await call('POST', { action: 'logout' }); } catch { /* still wipe the device */ }
  deleteAllData();
  clearLab();
  statusPromise = null;
}

export async function newSignInCode() {
  return (await call('POST', { action: 'new-code' })).data.signInCode;
}

export async function deleteAccount() {
  await call('POST', { action: 'delete' });
  deleteAllData();
  clearLab();
  statusPromise = null;
}

/** Looks up a room before joining (name and whether it's open). */
export async function findRoom(code) {
  let res;
  try {
    res = await fetch(`/api/rooms?code=${encodeURIComponent(code)}`, { headers: { Accept: 'application/json' } });
  } catch {
    throw new AccountError('Couldn’t reach Student Atlas. Check your connection and try again.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AccountError(data.error || 'We couldn’t find a room with that code.', res.status);
  return data.room;
}

/**
 * Joins a school room. The real name is encrypted in this browser so only
 * the teacher can read it. Existing data stays exactly as it is.
 */
export async function joinRoom(code, realName, grade) {
  const room = await findRoom(code);
  if (!room.open || !room.publicKey) throw new AccountError('That room isn’t taking new students right now. Ask your teacher to open it.', 403);
  const encryptedName = await encryptName(room.publicKey, realName);
  const r = await call('POST', { action: 'join', code: room.code, encryptedName, grade: grade || undefined });
  setAccount(r.data.user);
  return r.data.user;
}

export async function leaveRoom() {
  const r = await call('POST', { action: 'leave' });
  setAccount(r.data.user);
  return r.data.user;
}

export const displayName = (user) => (user ? `${user.emoji ? `${user.emoji} ` : ''}${user.username}` : '');

/** A same-site path to go back to after signing in (never another site). */
export function safeNext(value, fallback = '/profile.html') {
  const s = String(value ?? '');
  return /^\/(?![/\\])/.test(s) && !/[\u0000-\u001f]/.test(s) ? s : fallback;
}
