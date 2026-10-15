// Application tracker model: statuses, validation, and the calendar feed built
// from tracked applications and bookmarks. Pure (no DOM or storage), so it is
// shared by the tracker page, the calendar, and the tests.

export const STATUSES = [
  { id: 'interested', label: 'Interested', group: 'planning', icon: 'star' },
  { id: 'preparing', label: 'Working on it', group: 'planning', icon: 'pencil-line' },
  { id: 'submitted', label: 'Applied', group: 'applied', icon: 'send' },
  { id: 'interview', label: 'Interview or next round', group: 'applied', icon: 'messages-square' },
  { id: 'waitlisted', label: 'Waitlisted', group: 'applied', icon: 'hourglass' },
  { id: 'accepted', label: 'Accepted', group: 'decided', icon: 'party-popper' },
  { id: 'rejected', label: 'Not selected', group: 'decided', icon: 'circle-slash' },
  { id: 'withdrawn', label: 'Not applying', group: 'decided', icon: 'archive' },
];
export const STATUS_IDS = STATUSES.map((s) => s.id);
export const statusInfo = (id) => STATUSES.find((s) => s.id === id) ?? STATUSES[0];

export const STATUS_GROUPS = [
  { id: 'planning', label: 'Planning' },
  { id: 'applied', label: 'Applied' },
  { id: 'decided', label: 'Decisions' },
];

export const COMMON_TASKS = ['Read the eligibility rules', 'Draft my essay or short answers', 'Ask for a recommendation letter', 'Request my transcript', 'Submit the application'];

const MAX_ITEMS = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidDate(v) {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
const date = (v) => (isValidDate(v) ? v : undefined);
const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const url = (v) => {
  const s = str(v, 400);
  return s && /^https?:\/\//i.test(s) ? s : undefined;
};

export function newId(prefix = 'x') {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

function sanitizeItem(raw, id) {
  if (!raw || typeof raw !== 'object' || !ID_RE.test(id)) return null;
  const title = str(raw.title, 140);
  if (!title) return null;
  return {
    id,
    oppId: typeof raw.oppId === 'string' && ID_RE.test(raw.oppId) ? raw.oppId : undefined,
    title,
    organization: str(raw.organization, 120),
    url: url(raw.url),
    status: STATUS_IDS.includes(raw.status) ? raw.status : 'interested',
    deadline: date(raw.deadline),
    submittedOn: date(raw.submittedOn),
    decisionOn: date(raw.decisionOn),
    notes: str(raw.notes, 2000),
    tasks: (Array.isArray(raw.tasks) ? raw.tasks : [])
      .filter((t) => t && str(t.text, 140))
      .slice(0, 30)
      .map((t) => ({ id: str(t.id, 40) ?? newId('t'), text: str(t.text, 140), done: t.done === true })),
    events: (Array.isArray(raw.events) ? raw.events : [])
      .filter((e) => e && str(e.title, 120) && isValidDate(e.date))
      .slice(0, 30)
      .map((e) => ({ id: str(e.id, 40) ?? newId('e'), title: str(e.title, 120), date: e.date, time: TIME_RE.test(e.time) ? e.time : undefined })),
    createdAt: str(raw.createdAt, 40),
    updatedAt: str(raw.updatedAt, 40),
  };
}

/** Validates everything read back from storage; drops anything malformed. */
export function sanitizeTracker(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, item] of Object.entries(raw).slice(0, MAX_ITEMS)) {
    const clean = sanitizeItem(item, id);
    if (clean) out[id] = clean;
  }
  return out;
}

/** A new tracker entry for a directory opportunity. */
export function itemFromOpportunity(opp, status = 'interested') {
  // Start from this cycle's exact deadline when the weekly checker found one on the official site.
  return { id: opp.id, oppId: opp.id, title: opp.title, organization: opp.organization, url: opp.url, status, deadline: date(opp.nextDeadline), tasks: [], events: [], createdAt: new Date().toISOString() };
}

// ---- Dates -------------------------------------------------------------------
export const pad = (n) => String(n).padStart(2, '0');
export const toDateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
/** Whole days from today to a YYYY-MM-DD date (negative when it has passed). */
export function daysUntil(key, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((parseDateKey(key) - today) / 86_400_000);
}
export function relativeDay(key, now = new Date()) {
  const d = daysUntil(key, now);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d < 0) return `${-d} days ago`;
  if (d < 14) return `In ${d} days`;
  if (d < 60) return `In ${Math.round(d / 7)} weeks`;
  return `In ${Math.round(d / 30)} months`;
}

/** The next time a typical deadline month comes around, as YYYY-MM. */
export function nextMonthKey(month, now = new Date()) {
  const year = now.getFullYear() + (month < now.getMonth() + 1 ? 1 : 0);
  return `${year}-${pad(month)}`;
}

// ---- Calendar feed -------------------------------------------------------------
export const SOURCE_LABELS = { applied: 'Applied', planning: 'Planning to apply', saved: 'Bookmarked' };
const OFFICIAL_DEADLINE = 'Deadline (from the official site)';
export const KIND_LABELS = { deadline: 'Deadline', event: 'Event', decision: 'Decision expected', submitted: 'Submitted', estimate: 'Typical deadline' };

/**
 * Everything that belongs on the calendar.
 *  - dated: exact dates the student entered (deadlines, events, decision dates)
 *  - estimates: month-level "usually due" hints for bookmarks and tracked
 *    applications that don't have an exact deadline yet
 */
export function calendarItems({ tracker = {}, saved = [], byId = new Map(), now = new Date() } = {}) {
  const dated = [];
  const estimates = [];
  const todayKey = toDateKey(now);
  for (const item of Object.values(tracker)) {
    const group = statusInfo(item.status).group;
    const source = group === 'planning' ? 'planning' : 'applied';
    const base = { itemId: item.id, oppId: item.oppId, source, opportunity: item.title, status: item.status };
    if (item.deadline && item.status !== 'withdrawn') dated.push({ ...base, uid: `${item.id}-deadline`, kind: 'deadline', label: KIND_LABELS.deadline, date: item.deadline, title: `Deadline: ${item.title}` });
    if (item.submittedOn) dated.push({ ...base, uid: `${item.id}-submitted`, kind: 'submitted', label: KIND_LABELS.submitted, date: item.submittedOn, title: `Applied: ${item.title}` });
    if (item.decisionOn) dated.push({ ...base, uid: `${item.id}-decision`, kind: 'decision', label: KIND_LABELS.decision, date: item.decisionOn, title: `Decision expected: ${item.title}` });
    for (const e of item.events) dated.push({ ...base, uid: `${item.id}-${e.id}`, kind: 'event', label: e.title, date: e.date, time: e.time, title: `${e.title}: ${item.title}` });
    const opp = item.oppId ? byId.get(item.oppId) : null;
    if (!item.deadline && group === 'planning' && opp?.nextDeadline && opp.nextDeadline >= todayKey) {
      dated.push({ ...base, uid: `${item.id}-deadline`, kind: 'deadline', label: OFFICIAL_DEADLINE, date: opp.nextDeadline, title: `Deadline: ${item.title}` });
    } else if (!item.deadline && group === 'planning' && opp?.deadlineMonth) {
      estimates.push({ ...base, uid: `${item.id}-estimate`, kind: 'estimate', label: KIND_LABELS.estimate, month: nextMonthKey(opp.deadlineMonth, now), title: opp.title, note: opp.deadline });
    }
  }
  for (const id of saved) {
    if (tracker[id]) continue;
    const opp = byId.get(id);
    if (opp?.nextDeadline && opp.nextDeadline >= todayKey) {
      dated.push({ itemId: null, oppId: id, source: 'saved', opportunity: opp.title, uid: `${id}-deadline`, kind: 'deadline', label: OFFICIAL_DEADLINE, date: opp.nextDeadline, title: `Deadline: ${opp.title}` });
      continue;
    }
    if (!opp?.deadlineMonth) continue;
    estimates.push({ itemId: null, oppId: id, source: 'saved', opportunity: opp.title, uid: `${id}-estimate`, kind: 'estimate', label: KIND_LABELS.estimate, month: nextMonthKey(opp.deadlineMonth, now), title: opp.title, note: opp.deadline });
  }
  const order = (a, b) => (a.date ?? a.month).localeCompare(b.date ?? b.month) || (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title);
  return { dated: dated.sort(order), estimates: estimates.sort(order) };
}
