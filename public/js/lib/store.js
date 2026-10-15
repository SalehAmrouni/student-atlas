// Client-side persistence. Everything a student enters (profile, saved list,
// My Story, settings, Zeus conversations) is kept in this browser. When the
// student has an Atlas account, account.js also backs these keys up to the
// cloud; without one, nothing leaves the browser.

import { INCOME_BAND_IDS } from './finance.js';
import { sanitizeTracker } from './applications.js';
import { sanitizePortfolio, emptyPortfolio } from './portfolio.js';

const KEYS = {
  profile: 'atlas.profile.v2',
  saved: 'atlas.saved.v2',
  settings: 'atlas.settings.v2',
  chat: 'atlas.chat.v2',
  chatState: 'atlas.chatstate.v2',
  reviews: 'atlas.reviews.v1',
  tracker: 'atlas.tracker.v1',
  lab: 'atlas.lab.v1', // College Lab (see lab-store.js)
  portfolio: 'atlas.portfolio.v1', // My Story + milestone checklist
  account: 'atlas.account.v1', // signed-in Atlas username (see account.js)
  sync: 'atlas.sync.v1', // cloud sync bookkeeping (see account.js)
};
export const STORAGE_KEYS = KEYS;

function read(key, fallback, storage = window.localStorage) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value, storage = window.localStorage) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function readKey(key, fallback, storage) {
  return read(key, fallback, storage);
}
export function writeKey(key, value, storage) {
  return write(key, value, storage);
}

function remove(key, storage = window.localStorage) {
  try { storage.removeItem(key); } catch { /* ignore */ }
}

const listeners = new Set();
export function onStoreChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emit(what) {
  for (const fn of listeners) fn(what);
}

// Sync across tabs.
window.addEventListener('storage', (e) => {
  if (e.key === KEYS.saved) emit('saved');
  if (e.key === KEYS.profile) emit('profile');
  if (e.key === KEYS.tracker) emit('tracker');
  if (e.key === KEYS.portfolio) emit('portfolio');
  if (e.key === KEYS.account) emit('account');
});

// ---- Profile ----------------------------------------------------------------
export const CLUSTER_KEYS = ['STEM', 'Health', 'Business', 'Arts', 'Civics', 'Humanitarian', 'Scholarships'];

export function getProfile() {
  const p = read(KEYS.profile, null);
  return p && typeof p === 'object' ? sanitizeProfile(p) : null;
}

export function saveProfile(profile) {
  const now = new Date().toISOString();
  const existing = getProfile();
  const clean = sanitizeProfile({ ...profile, createdAt: existing?.createdAt ?? now, updatedAt: now });
  write(KEYS.profile, clean);
  emit('profile');
  return clean;
}

export function clearProfile() {
  remove(KEYS.profile);
  emit('profile');
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const strList = (v, max, len) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => x.trim().slice(0, len)).filter(Boolean).slice(0, max) : []);

export function sanitizeProfile(p) {
  return {
    firstName: str(p.firstName, 40) || undefined,
    grade: num(p.grade, 9, 12),
    gpa: num(p.gpa, 0, 5),
    serviceHours: num(p.serviceHours, 0, 5000),
    interests: strList(p.interests, 7, 20).filter((c) => CLUSTER_KEYS.includes(c)),
    careerGoals: strList(p.careerGoals, 8, 60),
    lookingFor: strList(p.lookingFor, 11, 30),
    financialNeed: bool(p.financialNeed),
    // Optional, banded family finance details (never an exact income).
    householdSize: Number.isInteger(p.householdSize) ? num(p.householdSize, 1, 8) : undefined,
    incomeBand: INCOME_BAND_IDS.includes(p.incomeBand) ? p.incomeBand : undefined,
    benefits: bool(p.benefits),
    firstGen: bool(p.firstGen),
    formatPreference: ['any', 'In-person', 'Virtual'].includes(p.formatPreference) ? p.formatPreference : 'any',
    state: str(p.state, 40) || undefined,
    goals: str(p.goals, 400) || undefined,
    createdAt: str(p.createdAt, 40),
    updatedAt: str(p.updatedAt, 40),
  };
}

// ---- Saved opportunities ------------------------------------------------------
export function getSaved() {
  const s = read(KEYS.saved, []);
  return Array.isArray(s) ? s.filter((x) => typeof x === 'string').slice(0, 500) : [];
}
export function isSaved(id) {
  return getSaved().includes(id);
}
export function toggleSaved(id) {
  const saved = getSaved();
  const i = saved.indexOf(id);
  if (i === -1) saved.unshift(id);
  else saved.splice(i, 1);
  write(KEYS.saved, saved);
  emit('saved');
  return i === -1;
}
export function clearSaved() {
  write(KEYS.saved, []);
  emit('saved');
}

// ---- Reviews this browser wrote or reported (to avoid duplicates) -------------
export function getReviewMarks() {
  const m = read(KEYS.reviews, {});
  const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(-500) : []);
  return { reviewed: ids(m?.reviewed), reported: ids(m?.reported) };
}
export function markReview(kind, id) {
  const marks = getReviewMarks();
  if (!marks[kind].includes(id)) marks[kind].push(id);
  write(KEYS.reviews, marks);
}

// ---- Application tracker -------------------------------------------------------
export function getTracker() {
  return sanitizeTracker(read(KEYS.tracker, {}));
}
/** Replaces one tracked application (pass null to stop tracking it). */
export function saveTrackerItem(id, item) {
  const tracker = getTracker();
  const wasApplied = tracker[id]?.status === 'submitted';
  if (item) tracker[id] = { ...item, id, updatedAt: new Date().toISOString() };
  else delete tracker[id];
  write(KEYS.tracker, sanitizeTracker(tracker));
  emit('tracker');
  // Moving an application into "Applied" is worth celebrating (see confetti.js).
  if (item?.status === 'submitted' && !wasApplied) window.dispatchEvent(new CustomEvent('atlas:applied', { detail: { title: item.title } }));
  return getTracker()[id] ?? null;
}
export function clearTracker() {
  remove(KEYS.tracker);
  emit('tracker');
}

// ---- My Story portfolio and milestones ---------------------------------------
export function getPortfolio() {
  const p = read(KEYS.portfolio, null);
  return p ? sanitizePortfolio(p) : emptyPortfolio();
}
/** Applies `mutate(portfolio)` and saves the result. */
export function updatePortfolio(mutate) {
  const p = getPortfolio();
  mutate(p);
  const clean = sanitizePortfolio(p);
  write(KEYS.portfolio, clean);
  emit('portfolio');
  return clean;
}

// ---- Account marker (the signed-in username, never a password) -----------------
export function getAccount() {
  const a = read(KEYS.account, null);
  return a && typeof a.username === 'string' ? a : null;
}
export function setAccount(account) {
  if (account) write(KEYS.account, { username: account.username, emoji: account.emoji, createdAt: account.createdAt, room: account.room ?? null });
  else remove(KEYS.account);
  emit('account');
}

// ---- Settings -----------------------------------------------------------------
export const DEFAULT_SETTINGS = { theme: 'system', textSize: 'md', highContrast: false, readableFont: false, cvdPalette: false, reduceMotion: false };
export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}
export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  write(KEYS.settings, next);
  return next;
}

// ---- Chat history ---------------------------------------------------------------
// Without an account the chat is kept only for this tab. With one, it's saved
// in this browser and backed up to the account (Log Out clears it).
const chatStorage = () => (getAccount() ? window.localStorage : window.sessionStorage);
export function getChat() {
  const c = read(KEYS.chat, [], chatStorage());
  return Array.isArray(c) ? c.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') : [];
}
export function saveChat(messages) {
  write(KEYS.chat, messages.slice(-40), chatStorage());
  emit('chat');
}
export function clearChat() {
  remove(KEYS.chat, window.sessionStorage);
  remove(KEYS.chat);
  remove(KEYS.chatState, window.sessionStorage);
  emit('chat');
}
/** Zeus's conversation memory (last results, filters, facts the student shared). */
export function getChatState() {
  const s = read(KEYS.chatState, {}, window.sessionStorage);
  return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
}
export function saveChatState(state) {
  write(KEYS.chatState, state, window.sessionStorage);
}

// ---- Everything ---------------------------------------------------------------
export function exportAllData() {
  return {
    exportedAt: new Date().toISOString(),
    profile: getProfile(),
    savedOpportunities: getSaved(),
    applications: Object.values(getTracker()),
    myStory: getPortfolio(),
    account: getAccount() ? { username: getAccount().username, room: getAccount().room?.name ?? null } : null,
    settings: getSettings(),
    collegeLab: read(KEYS.lab, null),
  };
}
export function deleteAllData() {
  for (const key of Object.values(KEYS)) {
    remove(key);
    remove(key, window.sessionStorage);
  }
  // Anything else Student Atlas kept in this browser (older versions, the teacher dashboard).
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      for (const key of Object.keys(storage)) if (key.startsWith('atlas.')) storage.removeItem(key);
    } catch { /* ignore */ }
  }
  for (const what of ['profile', 'saved', 'tracker', 'portfolio', 'chat', 'account', 'lab']) emit(what);
}
