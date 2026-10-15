// College Lab data: stats, transcript, essay drafts, and the mentor chat.
// Stored only in this browser (localStorage), next to the rest of the
// student's Student Atlas data. Deleting "all my data" also clears it.

const KEY = 'atlas.lab.v1';
const MAX_ESSAYS = 30;
const MAX_VERSIONS = 12;
const MAX_CHAT = 60;

const EMPTY = () => ({
  stats: { activities: [], awards: [], colleges: [] },
  transcript: null,
  essays: [],
  chat: [],
  aiConsent: null, // null = not asked yet, true/false = the student's choice
});

const listeners = new Set();
export function onLabChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let cache = null;
export function getLab() {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : null;
    cache = data && typeof data === 'object' ? { ...EMPTY(), ...data, stats: { ...EMPTY().stats, ...(data.stats ?? {}) } } : EMPTY();
  } catch {
    cache = EMPTY();
  }
  return cache;
}

export function saveLab(mutate, what = 'lab') {
  const lab = getLab();
  mutate(lab);
  lab.essays = lab.essays.slice(0, MAX_ESSAYS);
  lab.chat = lab.chat.slice(-MAX_CHAT);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(lab));
  } catch {
    /* storage full or blocked: keep working in memory */
  }
  for (const fn of listeners) fn(what);
  return lab;
}

export function clearLab() {
  cache = EMPTY();
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
  for (const fn of listeners) fn('all');
}

window.addEventListener('storage', (e) => {
  if (e.key === KEY) {
    cache = null;
    for (const fn of listeners) fn('all');
  }
});

// ---- Essays ----------------------------------------------------------------
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function newEssay(promptId = 'ca7') {
  const essay = { id: uid(), title: '', promptId, promptText: '', wordLimit: null, text: '', versions: [], lastScore: null, updatedAt: new Date().toISOString() };
  saveLab((lab) => { lab.essays.unshift(essay); }, 'essays');
  return essay;
}

export function updateEssay(id, patch) {
  saveLab((lab) => {
    const e = lab.essays.find((x) => x.id === id);
    if (e) Object.assign(e, patch, { updatedAt: new Date().toISOString() });
  }, 'essay-edit');
}

/** Saves feedback as a new version snapshot. */
export function recordFeedback(id, feedback, text) {
  saveLab((lab) => {
    const e = lab.essays.find((x) => x.id === id);
    if (!e) return;
    e.versions.push({ at: new Date().toISOString(), text, wordCount: feedback.wordCount, score: feedback.overall, source: feedback.source, feedback });
    e.versions = e.versions.slice(-MAX_VERSIONS);
    e.lastScore = feedback.overall;
  }, 'essays');
}

export function deleteEssay(id) {
  saveLab((lab) => { lab.essays = lab.essays.filter((x) => x.id !== id); }, 'essays');
}
