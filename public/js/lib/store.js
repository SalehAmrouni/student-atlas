// Client-side persistence. Everything a student enters (profile, saved list,
// settings, Zeus conversations) stays in this browser and is never sent to
// the server.

import { INCOME_BAND_IDS } from './finance.js';
import { sanitizeTracker } from './applications.js';

const KEYS = {
  profile: 'atlas.profile.v2',
  saved: 'atlas.saved.v2',
  settings: 'atlas.settings.v2',
  chat: 'atlas.chat.v2',
  chatState: 'atlas.chatstate.v2',
  tracker: 'atlas.tracker.v1',
  lab: 'atlas.lab.v1', // College Lab (see lab-store.js)
};

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

function remove(key, storage = window.localStorage) {
  try { storage.removeItem(key); } catch { /* ignore */ }
}

const listeners = new Set();
export function onStoreChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(what) {
  for (const fn of listeners) fn(what);
}

// Sync across tabs.
window.addEventListener('storage', (e) => {
  if (e.key === KEYS.saved) emit('saved');
  if (e.key === KEYS.profile) emit('profile');
  if (e.key === KEYS.tracker) emit('tracker');
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

// ---- Application tracker -------------------------------------------------------
export function getTracker() {
  return sanitizeTracker(read(KEYS.tracker, {}));
}
/** Replaces one tracked application (pass null to stop tracking it). */
export function saveTrackerItem(id, item) {
  const tracker = getTracker();
  if (item) tracker[id] = { ...item, id, updatedAt: new Date().toISOString() };
  else delete tracker[id];
  write(KEYS.tracker, sanitizeTracker(tracker));
  emit('tracker');
  return getTracker()[id] ?? null;
}
export function clearTracker() {
  remove(KEYS.tracker);
  emit('tracker');
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

// ---- Chat history (per tab, cleared when the tab closes) -----------------------
export function getChat() {
  const c = read(KEYS.chat, [], window.sessionStorage);
  return Array.isArray(c) ? c.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') : [];
}
export function saveChat(messages) {
  write(KEYS.chat, messages.slice(-40), window.sessionStorage);
}
export function clearChat() {
  remove(KEYS.chat, window.sessionStorage);
  remove(KEYS.chatState, window.sessionStorage);
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
    settings: getSettings(),
    collegeLab: read(KEYS.lab, null),
  };
}
export function deleteAllData() {
  for (const key of Object.values(KEYS)) {
    remove(key);
    remove(key, window.sessionStorage);
  }
  emit('profile');
  emit('saved');
  emit('tracker');
  emit('lab');
}
