// Teacher & Counselor dashboard: create a room, see the live roster (real
// names decrypted only in this browser), open a student's portfolio with Zeus
// Counselor Insights, and talk strategy with Zeus.
//
// The teacher key never leaves this browser. It's kept in sessionStorage for
// this tab only, so closing the tab or pressing Sign out forgets it.

import { boot } from '../lib/layout.js';
import { h, icon, $, refreshIcons, toast, openModal, modalHeader, downloadFile, debounce, pluralize } from '../lib/dom.js';
import { loadData, COST_LABELS } from '../lib/data.js';
import { generateTeacherKey, normalizeTeacherKey, createRoomKeys, roomAuthToken, openRoom } from '../lib/room-crypto.js';
import { counselorInsights, counselorReply, SUPPORTS } from '../lib/insights.js';
import { milestoneProgress, sanitizePortfolio, sanitizeActivities, goalLabel, PATHS } from '../lib/portfolio.js';
import { statusInfo } from '../lib/applications.js';
import { renderMarkdown } from '../lib/markdown.js';
import { aiAvailable, callLabAi } from '../lib/lab-api.js';
import { copyText } from '../lib/account-ui.js';

const SESSION = 'atlas.teacher.v1';
const STATUS_LABEL = { 'on-track': 'On track', 'getting-started': 'Getting started', 'needs-support': 'Needs support' };
const STATUS_BADGE = { 'on-track': 'badge-success', 'getting-started': 'badge-info', 'needs-support': 'badge-warning' };
const TONE_BADGE = { warn: 'badge-warning', danger: 'badge-danger', info: 'badge-info' };

let seq = 0;
const fid = (n) => `t-${n}-${++seq}`;

function field(label, attrs = {}, hint) {
  const id = fid('f');
  const input = h('input', { id, class: 'input', ...attrs, 'aria-describedby': hint ? `${id}-hint` : undefined });
  return { input, el: h('div', { class: 'field' }, h('label', { class: 'label', for: id }, label), input, hint ? h('span', { class: 'hint', id: `${id}-hint` }, hint) : null) };
}

const readSession = () => { try { return JSON.parse(sessionStorage.getItem(SESSION)) ?? null; } catch { return null; } };
const writeSession = (v) => { try { if (v) sessionStorage.setItem(SESSION, JSON.stringify(v)); else sessionStorage.removeItem(SESSION); } catch { /* ignore */ } };

const ago = (ms) => {
  if (!ms) return 'Never';
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

boot('teacher', async () => {
  const root = $('#teacher-root');
  const data = await loadData().catch(() => ({ byId: new Map() }));
  const { byId } = data;
  let session = null; // { code, key, auth }
  let roomState = null; // { room, students, opened }

  async function api(method, { query = '', body } = {}) {
    let res;
    try {
      res = await fetch(`/api/rooms${query}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(session?.auth ? { Authorization: `Bearer ${session.auth}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw Object.assign(new Error('Couldn’t reach Student Atlas. Check your connection.'), { status: 0 });
    }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(out.error || 'Something went wrong.'), { status: res.status, field: out.field });
    return out;
  }

  // ---- Signed out: open or create a room ------------------------------------------
  function signedOut(message) {
    $('#teacher-title').textContent = 'Classroom dashboard';
    $('#teacher-lead').hidden = false;
    const code = field('Room code', { autocapitalize: 'characters', spellcheck: 'false', autocomplete: 'off', maxlength: '20', placeholder: 'e.g. CAREER2026' });
    const key = field('Teacher key', { autocapitalize: 'characters', spellcheck: 'false', autocomplete: 'off', maxlength: '60', placeholder: 'XXXX-XXXX-XXXX-…', type: 'password' }, 'The key you saved when you created the room.');
    const err = h('p', { class: 'field-error', role: 'alert', text: message ?? '' });
    const openBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, icon('log-in'), 'Open dashboard');
    const openForm = h('form', { class: 'stack', novalidate: true }, code.el, key.el, err, h('div', {}, openBtn));
    openForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (!code.input.value.trim()) { err.textContent = 'Type your room code.'; return code.input.focus(); }
      if (!normalizeTeacherKey(key.input.value)) { err.textContent = 'That teacher key doesn’t look right. It has 32 letters and numbers.'; return key.input.focus(); }
      openBtn.disabled = true;
      try {
        session = { code: code.input.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''), key: normalizeTeacherKey(key.input.value), auth: await roomAuthToken(key.input.value) };
        await loadRoster();
        writeSession(session);
        dashboard();
      } catch (ex) {
        session = null;
        err.textContent = ex.message;
        openBtn.disabled = false;
      }
    });

    const name = field('Class name', { maxlength: '80', placeholder: 'e.g. Period 3 Career Exploration' });
    const custom = field('Room code (optional)', { autocapitalize: 'characters', spellcheck: 'false', autocomplete: 'off', maxlength: '16', placeholder: 'e.g. CAREER2026' }, '6–16 letters and numbers. Leave blank for a random code that’s harder to guess.');
    const err2 = h('p', { class: 'field-error', role: 'alert' });
    const createBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, icon('plus'), 'Create room');
    const createForm = h('form', { class: 'stack', novalidate: true }, name.el, custom.el, err2, h('div', {}, createBtn));
    createForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      err2.textContent = '';
      createBtn.disabled = true;
      try {
        const teacherKey = generateTeacherKey();
        const keys = await createRoomKeys(teacherKey);
        const out = await api('POST', { body: { action: 'create', name: name.input.value, code: custom.input.value.trim() || undefined, ...keys } });
        created(out.room, teacherKey, keys.authToken);
      } catch (ex) {
        err2.textContent = ex.message;
        createBtn.disabled = false;
        if (ex.field === 'code') custom.input.focus();
      }
    });

    root.replaceChildren(
      h('div', { class: 'teacher-start' },
        h('section', { class: 'card stack', 'aria-labelledby': 'open-h' },
          h('h2', { id: 'open-h', class: 'h3 mb-0' }, icon('layout-dashboard'), 'Open your dashboard'),
          openForm),
        h('section', { class: 'card stack', 'aria-labelledby': 'create-h' },
          h('h2', { id: 'create-h', class: 'h3 mb-0' }, icon('school'), 'Create a classroom room'),
          h('p', { class: 'small muted mb-0' }, 'You’ll get a room code to write on the board and a private teacher key that unlocks your roster.'),
          createForm)),
      privacyNote());
    refreshIcons();
  }

  function privacyNote() {
    return h('section', { class: 'card card-flat stack mt-3', 'aria-labelledby': 'privacy-h' },
      h('h2', { id: 'privacy-h', class: 'h3 mb-0' }, icon('shield-check'), 'How student data is handled'),
      h('ul', { class: 'reasons' },
        h('li', { class: 'good' }, icon('check-circle-2'), 'Students use random usernames. Their real names are encrypted in their own browser with your room’s key, so Student Atlas’s database can’t read them; only a browser with your teacher key can.'),
        h('li', { class: 'good' }, icon('check-circle-2'), 'You see what helps you advise: profile, goals, milestones, activities, saved opportunities, and application statuses. You never see students’ Zeus or mentor chats, essays, private notes, or exact family income.'),
        h('li', { class: 'warn' }, icon('info'), 'Progress data (grades, goals, and anything a student writes in My Story) is stored on Student Atlas’s servers under the student’s username. That is still student information: follow your school or district’s policies before using Student Atlas with a class, and get parent consent where your school requires it.'),
        h('li', { class: 'warn' }, icon('info'), 'Keep your teacher key safe. Anyone with your room code and key can see your roster, and if you lose the key, Student Atlas can’t recover the names.')));
  }

  // ---- Just created: show the code and key once ----------------------------------------
  function created(room, teacherKey, auth) {
    $('#teacher-title').textContent = 'Your room is ready';
    $('#teacher-lead').hidden = true;
    const keyText = `Student Atlas classroom room\nClass: ${room.name}\nRoom code: ${room.code}\nTeacher key: ${teacherKey}\n\nOpen your dashboard at ${location.origin}/teacher.html\nKeep this key private. It unlocks your roster and can't be recovered.`;
    const saved = h('input', { type: 'checkbox', id: 'saved-key' });
    const go = h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, icon('arrow-right'), 'Go to my dashboard');
    saved.addEventListener('change', () => { go.disabled = !saved.checked; });
    go.addEventListener('click', async () => {
      session = { code: room.code, key: normalizeTeacherKey(teacherKey), auth };
      writeSession(session);
      try { await loadRoster(); dashboard(); } catch (ex) { signedOut(ex.message); }
    });
    root.replaceChildren(h('div', { class: 'card stack' },
      h('div', { class: 'room-code-big' },
        h('span', { class: 'small muted' }, 'Room code: write this on the board'),
        h('strong', { class: 'mono', text: room.code }),
        h('span', { class: 'small muted', text: `Students go to ${location.host}/join.html` })),
      h('div', { class: 'account-secret' },
        h('span', { class: 'small muted' }, 'Your private teacher key'),
        h('strong', { class: 'mono', text: teacherKey }),
        h('div', { class: 'row mt-1' },
          h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => copyText(teacherKey, 'Teacher key copied') }, icon('copy'), 'Copy key'),
          h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => downloadFile(`student-atlas-${room.code}-teacher-key.txt`, keyText, 'text/plain') }, icon('download'), 'Save as a file'))),
      h('div', { class: 'callout' }, icon('key-round'), h('span', {}, h('strong', {}, 'Save this key now. '), 'It’s shown only once, it unlocks your students’ real names, and Student Atlas can’t recover it. Store it in a password manager or a secure school drive, not on the whiteboard.')),
      h('label', { class: 'check', for: 'saved-key' }, saved, h('span', {}, 'I saved my teacher key somewhere safe')),
      h('div', {}, go)));
    refreshIcons();
    root.querySelector('.account-secret button')?.focus();
  }

  // ---- Dashboard ----------------------------------------------------------------------------
  async function loadRoster() {
    const out = await api('GET', { query: `?code=${encodeURIComponent(session.code)}&view=roster` });
    const opened = await openRoom(session.key, out.room);
    const students = await Promise.all(out.students.map(async (s) => ({ ...s, name: (await opened.decryptName(s.encName)) ?? '(name unavailable)' })));
    roomState = { room: out.room, students, opened };
  }

  let filter = { q: '', show: 'all', sort: 'needs' };
  let redrawRoster = null;
  function dashboard() {
    const { room, students } = roomState;
    $('#teacher-title').textContent = room.name;
    $('#teacher-lead').hidden = true;
    document.title = `${room.name} | Student Atlas`;

    const joinLink = `${location.origin}/join.html?code=${encodeURIComponent(room.code)}`;
    const openToggle = h('input', { type: 'checkbox', checked: room.open || undefined });
    openToggle.addEventListener('change', async () => {
      try {
        const out = await api('POST', { body: { action: 'settings', code: room.code, open: openToggle.checked } });
        room.open = out.room.open;
        toast(room.open ? 'Students can join this room' : 'Joining is closed', 'success');
      } catch (ex) {
        openToggle.checked = !openToggle.checked;
        toast(ex.message, 'error');
      }
    });

    const head = h('section', { class: 'card room-head', 'aria-label': 'Room' },
      h('div', { class: 'room-code-big' },
        h('span', { class: 'small muted' }, 'Room code'),
        h('strong', { class: 'mono', text: room.code }),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => copyText(joinLink, 'Join link copied') }, icon('link'), 'Copy join link')),
      h('div', { class: 'stack-sm' },
        h('label', { class: 'switch' }, openToggle, 'Students can join'),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: refresh }, icon('refresh-cw'), 'Refresh'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: signOut }, icon('log-out'), 'Sign out'),
          h('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: deleteRoom }, icon('trash-2'), 'Delete room'))));

    const needs = students.filter((s) => s.insights.status === 'needs-support').length;
    const aid = students.filter((s) => s.insights.flags.includes('financial-aid')).length;
    const soon = students.filter((s) => s.insights.flags.includes('due-soon') || s.insights.flags.includes('overdue')).length;
    const stats = h('div', { class: 'stat-grid mt-3' },
      h('div', { class: 'stat' }, h('strong', { text: String(students.length) }), h('span', {}, 'students')),
      h('div', { class: 'stat' }, h('strong', { text: String(needs) }), h('span', {}, 'need support')),
      h('div', { class: 'stat' }, h('strong', { text: String(aid) }), h('span', {}, 'may need aid guidance')),
      h('div', { class: 'stat' }, h('strong', { text: String(soon) }), h('span', {}, 'deadline soon or missed')));

    const search = h('input', { class: 'input', type: 'search', id: 'roster-search', placeholder: 'Search by real name or username', value: filter.q });
    const show = h('select', { class: 'select', id: 'roster-show' },
      [['all', 'Everyone'], ['needs-support', 'Needs support'], ['financial-aid', 'Financial aid'], ['fafsa', 'FAFSA not done'], ['due-soon', 'Deadline soon'], ['no-apps', 'No applications']]
        .map(([v, t]) => h('option', { value: v, selected: filter.show === v || undefined }, t)));
    const sort = h('select', { class: 'select', id: 'roster-sort' },
      [['needs', 'Needs support first'], ['name', 'Name'], ['active', 'Recently active'], ['progress', 'Progress']]
        .map(([v, t]) => h('option', { value: v, selected: filter.sort === v || undefined }, t)));
    const tableWrap = h('div');
    const count = h('p', { class: 'small muted mb-0', 'aria-live': 'polite' });

    const drawTable = () => {
      const q = filter.q.toLowerCase().replace(/\s+/g, '');
      let list = students.filter((s) => !q || s.name.toLowerCase().replace(/\s+/g, '').includes(q) || s.username.toLowerCase().includes(q));
      if (filter.show === 'needs-support') list = list.filter((s) => s.insights.status === 'needs-support');
      else if (filter.show !== 'all') list = list.filter((s) => s.insights.flags.includes(filter.show));
      const rank = { 'needs-support': 0, 'getting-started': 1, 'on-track': 2 };
      list.sort(filter.sort === 'name' ? (a, b) => a.name.localeCompare(b.name)
        : filter.sort === 'active' ? (a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0)
          : filter.sort === 'progress' ? (a, b) => b.insights.score - a.insights.score
            : (a, b) => rank[a.insights.status] - rank[b.insights.status] || b.insights.flags.length - a.insights.flags.length || a.name.localeCompare(b.name));
      count.textContent = `Showing ${pluralize(list.length, 'student')} of ${students.length}.`;
      if (!students.length) {
        tableWrap.replaceChildren(h('div', { class: 'empty-state' }, icon('users'),
          h('h3', { text: 'No students yet' }),
          h('p', {}, 'Students go to ', h('strong', { text: `${location.host}/join.html` }), ' and type ', h('strong', { text: room.code }), '. Students who already use Student Atlas can join from My Pathway → Account.')));
        refreshIcons();
        return;
      }
      tableWrap.replaceChildren(h('div', { class: 'table-wrap', role: 'region', 'aria-label': 'Roster', tabindex: '0' },
        h('table', { class: 'roster' },
          h('caption', { class: 'visually-hidden' }, `Roster for ${room.name}. Select a name to open that student’s portfolio.`),
          h('thead', {}, h('tr', {}, ['Student', 'Atlas username', 'Grade', 'Status', 'Progress', 'Needs', 'Last active'].map((c) => h('th', { scope: 'col', text: c })))),
          h('tbody', {}, list.map((s) => h('tr', {},
            h('th', { scope: 'row' }, h('button', { type: 'button', class: 'opp-link', dataset: { username: s.username }, onclick: () => openStudent(s) }, s.name)),
            h('td', { class: 'mono small' }, `${s.emoji ?? ''} ${s.username}`,
              s.locked ? h('span', { class: 'badge badge-danger ml-1' }, icon('lock'), 'Locked')
                : s.pictureLocked ? h('span', { class: 'badge badge-warning ml-1', title: 'Too many wrong pictures' }, icon('lock'), 'Pictures locked') : null),
            h('td', { text: s.grade ? `${s.grade}th` : '–' }),
            h('td', {}, h('span', { class: `badge ${STATUS_BADGE[s.insights.status]}`, text: STATUS_LABEL[s.insights.status] })),
            h('td', {}, h('span', { class: 'small', text: `${s.insights.score}/100 · ${s.insights.counts.milestonesDone}/${s.insights.counts.milestonesTotal} milestones` })),
            h('td', {}, s.insights.flags.length
              ? h('div', { class: 'flag-list' }, s.insights.flags.slice(0, 3).map((f) => h('span', { class: `badge ${TONE_BADGE[SUPPORTS[f].tone]}`, text: SUPPORTS[f].label })), s.insights.flags.length > 3 ? h('span', { class: 'small muted', text: `+${s.insights.flags.length - 3}` }) : null)
              : h('span', { class: 'small muted' }, 'None')),
            h('td', { class: 'small', text: ago(s.lastActive) })))))));
      refreshIcons();
    };
    redrawRoster = drawTable;
    search.addEventListener('input', debounce(() => { filter.q = search.value; drawTable(); }, 150));
    show.addEventListener('change', () => { filter.show = show.value; drawTable(); });
    sort.addEventListener('change', () => { filter.sort = sort.value; drawTable(); });

    root.replaceChildren(head, stats,
      h('section', { class: 'card mt-3 stack', 'aria-labelledby': 'roster-h' },
        h('div', { class: 'row-between' }, h('h2', { id: 'roster-h', class: 'h3 mb-0' }, icon('users'), 'Live roster'), count),
        h('div', { class: 'roster-tools' },
          h('div', { class: 'field' }, h('label', { class: 'label', for: 'roster-search' }, 'Find a student'), search),
          h('div', { class: 'field' }, h('label', { class: 'label', for: 'roster-show' }, 'Show'), show),
          h('div', { class: 'field' }, h('label', { class: 'label', for: 'roster-sort' }, 'Sort'), sort)),
        tableWrap),
      privacyNote());
    drawTable();
    refreshIcons();
  }

  async function refresh() {
    try {
      await loadRoster();
      dashboard();
      toast('Roster updated', 'success');
    } catch (ex) {
      toast(ex.message, 'error');
    }
  }

  function signOut() {
    session = null;
    roomState = null;
    writeSession(null);
    signedOut();
    toast('Signed out of the dashboard', 'success');
  }

  async function deleteRoom() {
    const typed = prompt(`Delete ${roomState.room.name}? Students keep their accounts and data, but they leave the room and their real names are deleted. Type the room code (${roomState.room.code}) to confirm.`);
    if (!typed) return;
    if (typed.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') !== roomState.room.code) { toast('The room code didn’t match, so nothing was deleted.', 'error'); return; }
    try {
      await api('POST', { body: { action: 'delete', code: roomState.room.code } });
      session = null;
      roomState = null;
      writeSession(null);
      signedOut();
      toast('Room deleted', 'success');
    } catch (ex) {
      toast(ex.message, 'error');
    }
  }

  // ---- One student's portfolio ------------------------------------------------------------------
  async function openStudent(s) {
    let detail;
    try {
      detail = await api('GET', { query: `?code=${encodeURIComponent(session.code)}&student=${encodeURIComponent(s.username)}` });
    } catch (ex) {
      toast(ex.message, 'error');
      return;
    }
    const shared = detail.shared;
    const insights = counselorInsights(shared, { byId });
    const profile = shared.profile ?? {};
    const stats = shared.stats ?? {};
    const portfolio = sanitizePortfolio(shared.portfolio);
    const activities = sanitizeActivities(stats.activities).filter((a) => a.name);
    const progress = milestoneProgress(portfolio, { grade: insights.grade, firstGen: profile.firstGen === true });

    const kv = (k, v) => (v === undefined || v === null || v === '' ? null : h('div', {}, h('dt', { text: k }), h('dd', { text: String(v) })));
    const block = (id, title, iconName, ...children) => h('section', { class: 'portfolio-block', 'aria-labelledby': id },
      h('h3', { id, class: 'h3' }, icon(iconName), title), ...children);

    const insightsPanel = h('section', { class: 'insights-panel', 'aria-labelledby': 'ins-h' },
      h('div', { class: 'row-between' },
        h('h3', { id: 'ins-h', class: 'h3 mb-0' }, h('span', { class: 'zeus-avatar', 'aria-hidden': 'true' }, icon('sparkles')), 'Zeus Counselor Insights'),
        h('span', { class: `badge ${STATUS_BADGE[insights.status]}`, text: `${STATUS_LABEL[insights.status]} · ${insights.score}/100` })),
      h('p', { class: 'insights-summary', text: insights.summary }),
      insights.flags.length
        ? h('ul', { class: 'reasons' }, insights.flags.map((f) => h('li', { class: SUPPORTS[f].tone === 'info' ? 'good' : 'warn' }, icon(SUPPORTS[f].tone === 'info' ? 'info' : 'alert-triangle'), h('span', {}, h('strong', { text: `${SUPPORTS[f].label}: ` }), insights.detail[f]))))
        : h('p', { class: 'small muted mb-0' }, 'Nothing urgent. A quick check-in to celebrate progress goes a long way.'),
      insights.strengths.length ? h('p', { class: 'small mb-0' }, h('strong', {}, 'Going well: '), insights.strengths.join(', '), '.') : null,
      h('p', { class: 'small faint mb-0' }, 'A coaching aid from what the student shared, not an evaluation. Confirm details with the student.'));

    // Application pipeline: Thinking about it → In progress → Applied (and decisions).
    const items = Object.values(shared.tracker ?? {});
    const col = (title, statuses) => {
      const list = items.filter((i) => statuses.includes(i.status));
      return h('div', { class: 'pipeline-col' },
        h('h4', { class: 'small', text: `${title} (${list.length})` }),
        list.length ? h('ul', {}, list.map((i) => h('li', {},
          h('span', { text: i.title }),
          h('span', { class: 'small muted', text: [statusInfo(i.status).label, i.deadline ? `due ${new Date(`${i.deadline}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : null].filter(Boolean).join(' · ') }))))
          : h('p', { class: 'small muted mb-0' }, 'None'));
    };
    const pipeline = h('div', { class: 'pipeline' },
      col('Thinking about it', ['interested']),
      col('In progress', ['preparing']),
      col('Applied', ['submitted', 'interview', 'waitlisted']),
      col('Decisions', ['accepted', 'rejected', 'withdrawn']));

    const savedOpps = (shared.saved ?? []).map((id) => byId.get(id)).filter(Boolean);
    const savedList = savedOpps.length
      ? h('ul', { class: 'compact-list' }, savedOpps.slice(0, 30).map((o) => h('li', {}, h('span', { text: o.title }), h('span', { class: 'small muted', text: ` · ${COST_LABELS[o.cost] ?? o.cost}${o.needBased ? ', need-based aid' : ''}` }))))
      : h('p', { class: 'small muted mb-0' }, 'No saved opportunities yet.');

    const milestones = h('div', { class: 'milestone-columns' },
      h('div', {}, h('h4', { class: 'small', text: `Done (${progress.done})` }),
        h('ul', { class: 'compact-list' }, progress.list.filter((m) => progress.has(m.id)).map((m) => h('li', {}, icon('check'), ` ${m.text}`)),
          portfolio.milestones.custom.filter((c) => c.done).map((c) => h('li', {}, icon('check'), ` ${c.text}`)))),
      h('div', {}, h('h4', { class: 'small', text: `Still to do (${progress.total - progress.done})` }),
        h('ul', { class: 'compact-list' }, progress.list.filter((m) => !progress.has(m.id)).map((m) => h('li', { text: m.text })),
          portfolio.milestones.custom.filter((c) => !c.done).map((c) => h('li', { text: c.text })))));

    const paths = PATHS.filter((p) => (p.id === 'firstGen' ? profile.firstGen === true : portfolio.paths[p.id])).map((p) => p.label);
    const story = h('div', { class: 'stack' },
      h('dl', { class: 'kv' },
        kv('Goal after high school', goalLabel(portfolio.goal)),
        kv('Majors or careers', stats.majors),
        kv('Interests', (profile.interests ?? []).join(', ')),
        kv('Unweighted GPA', stats.gpa ?? profile.gpa),
        kv('Weighted GPA', stats.weightedGpa),
        kv('SAT', stats.sat ? `${stats.sat}${stats.satRW || stats.satMath ? ` (R&W ${stats.satRW ?? '–'}, Math ${stats.satMath ?? '–'})` : ''}` : null),
        kv('ACT', stats.act),
        kv('ASVAB', stats.asvab),
        kv('Certifications', portfolio.certifications),
        kv('Special path', paths.join(', ')),
        kv('Cost matters', profile.financialNeed === true ? 'Yes' : profile.financialNeed === false ? 'No' : null),
        kv('Aid estimate', profile.financeTier ? { low: 'Likely qualifies for low-income programs', maybe: 'May qualify for some low-income programs', middle: 'Middle income', higher: 'Higher income' }[profile.financeTier] : null)),
      activities.length ? h('div', {}, h('h4', { class: 'small' }, 'Extracurriculars'), h('ul', { class: 'compact-list' }, activities.map((a) => h('li', {},
        h('strong', { text: a.name }),
        h('span', { class: 'small muted', text: [a.role, a.years.length ? `grades ${a.years.join(', ')}` : null].filter(Boolean).map((x) => ` · ${x}`).join('') }),
        a.description ? h('div', { class: 'small', text: a.description }) : null)))) : null,
      portfolio.experiences.length ? h('div', {}, h('h4', { class: 'small' }, 'Work, internships & volunteering'), h('ul', { class: 'compact-list' }, portfolio.experiences.map((e) => h('li', {},
        h('strong', { text: e.org ?? 'Experience' }),
        h('span', { class: 'small muted', text: [e.role, e.hours].filter(Boolean).map((x) => ` · ${x}`).join('') }),
        e.accomplishment ? h('div', { class: 'small', text: e.accomplishment }) : null)))) : null,
      h('div', {}, h('h4', { class: 'small' }, 'Personal insight'),
        h('dl', { class: 'kv' },
          kv('Three words', portfolio.insight.words.filter(Boolean).join(', ')),
          kv('Proudest achievement', portfolio.insight.proudest),
          kv('Financial aid focus', portfolio.insight.aidFocus ? 'Yes' : null),
          kv('Overcoming obstacles', portfolio.insight.obstacles ?? (portfolio.insight.share ? null : 'Not shared'))),
        h('p', { class: 'small faint mb-0' }, 'Students choose whether to share their obstacles answer.')));

    // Sign-in help: one-time links, and locking an account if a student asks or it's misused.
    const signInOut = h('div', { class: 'stack-sm', 'aria-live': 'polite' });
    let signInChanged = false;
    const post = (action) => api('POST', { body: { action, code: session.code, username: s.username } });
    const lockBtn = h('button', { type: 'button', class: 'btn btn-outline btn-sm' });
    const drawLock = () => {
      lockBtn.replaceChildren(icon(s.locked ? 'lock-open' : 'lock'), s.locked ? 'Unlock account' : 'Lock account');
      refreshIcons();
    };
    lockBtn.addEventListener('click', async () => {
      const locking = !s.locked;
      if (locking && !confirm(`Lock ${s.name}’s account? They’ll be signed out everywhere and can’t sign in until you unlock it or make them a sign-in link.`)) return;
      lockBtn.disabled = true;
      try {
        const out = await post(locking ? 'lock' : 'unlock');
        s.locked = out.locked;
        if (!locking) s.pictureLocked = false;
        signInChanged = true;
        drawLock();
        signInOut.replaceChildren(h('p', { class: 'small mb-0', role: 'status', text: locking ? `${s.name}’s account is locked.` : `${s.name}’s account is unlocked. Their picture password works again.` }));
      } catch (ex) { toast(ex.message, 'error'); } finally { lockBtn.disabled = false; }
    });
    drawLock();

    const linkBtn = h('button', {
      type: 'button', class: 'btn btn-primary btn-sm',
      onclick: async () => {
        if (!confirm(`Make a one-time sign-in link for ${s.name}? It works once, for 48 hours, and replaces any earlier link.${s.locked ? ' It also unlocks their account.' : ''}`)) return;
        linkBtn.disabled = true;
        try {
          const out = await post('sign-in-link');
          s.locked = false;
          s.pictureLocked = false;
          signInChanged = true;
          drawLock();
          const { linkUrl, qrCanvas } = await import('../lib/login-pass.js');
          const url = linkUrl(out.token);
          const qr = qrCanvas(url, 5);
          const until = new Date(out.expiresAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
          signInOut.replaceChildren(h('div', { class: 'account-secret link-card' },
            h('span', { class: 'small muted', text: `One-time sign-in link for ${s.name} (${s.username})` }),
            h('div', { class: 'link-card-body' },
              h('img', { class: 'link-qr', src: qr.toDataURL('image/png'), width: '140', height: '140', alt: `QR code for ${s.name}’s sign-in link` }),
              h('div', { class: 'stack-sm' },
                h('code', { class: 'mono small link-text', text: url }),
                h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => copyText(url, 'Sign-in link copied') }, icon('copy'), 'Copy link')),
                h('span', { class: 'small muted', text: `Works once, until ${until}. Send it privately (for example in your school’s messaging), or have the student scan the QR code with their webcam on the sign-in page. They’ll pick new pictures after signing in.` })))));
          refreshIcons();
        } catch (ex) { toast(ex.message, 'error'); } finally { linkBtn.disabled = false; }
      },
    }, icon('link'), 'Make a sign-in link');

    const actions = h('section', { class: 'portfolio-block stack-sm', 'aria-labelledby': 'signin-help-h' },
      h('h3', { id: 'signin-help-h', class: 'h3' }, icon('key-round'), 'Sign-in help'),
      s.locked ? h('p', { class: 'small mb-0' }, 'This account is locked.')
        : s.pictureLocked ? h('p', { class: 'small mb-0' }, 'This student’s picture password is locked after too many wrong tries. Unlock it or make them a sign-in link.') : null,
      h('div', { class: 'row' }, linkBtn, lockBtn,
        h('button', {
          type: 'button', class: 'btn btn-danger btn-sm',
          onclick: async () => {
            if (!confirm(`Remove ${s.name} from ${roomState.room.name}? They keep their account and data.`)) return;
            try {
              await api('POST', { body: { action: 'remove', code: session.code, username: s.username } });
              modal.close();
              await refresh();
            } catch (ex) { toast(ex.message, 'error'); }
          },
        }, icon('user-minus'), 'Remove from room')),
      signInOut);

    const modal = openModal({
      labelledBy: 'student-title',
      wide: true,
      onClose: () => {
        if (!signInChanged) return;
        // Show the new lock state in the roster, then put focus back on this student's row.
        redrawRoster?.();
        setTimeout(() => [...document.querySelectorAll('.roster .opp-link')].find((b) => b.dataset.username === s.username)?.focus());
      },
      build: (close) => [
        modalHeader('student-title', s.name, `${s.emoji ?? ''} ${s.username} · ${s.grade ? `${s.grade}th grade` : 'grade not set'} · active ${ago(detail.student.lastActive).toLowerCase()}`, close),
        h('div', { class: 'modal-body stack' },
          insightsPanel,
          strategyChat(s, insights, shared),
          block('pipe-h', 'Applications', 'list-checks', pipeline),
          block('ms-h', `Milestones (${progress.done}/${progress.total})`, 'flag', milestones),
          block('saved-h', `Saved opportunities (${savedOpps.length})`, 'bookmark', savedList),
          block('story-h', 'My Story', 'book-user', story),
          actions),
      ],
    });
    refreshIcons();
  }

  // ---- Strategy chat with Zeus --------------------------------------------------------------------
  function counselorBrief(insights, shared) {
    const profile = shared.profile ?? {};
    const stats = shared.stats ?? {};
    const portfolio = sanitizePortfolio(shared.portfolio);
    const progress = milestoneProgress(portfolio, { grade: insights.grade, firstGen: profile.firstGen === true });
    const num = (v, lo, hi) => (typeof v === 'number' && v >= lo && v <= hi ? v : undefined);
    return {
      grade: insights.grade ?? undefined,
      goal: goalLabel(portfolio.goal) ?? undefined,
      summary: insights.summary.slice(0, 600),
      status: insights.status,
      flags: insights.flags.map((f) => `${SUPPORTS[f].label}: ${insights.detail[f]}`.slice(0, 300)),
      strengths: insights.strengths.map((x) => String(x).slice(0, 120)),
      interests: (profile.interests ?? []).slice(0, 10),
      careers: (profile.careerGoals ?? []).slice(0, 10),
      firstGen: profile.firstGen === true || undefined,
      financialNeed: typeof profile.financialNeed === 'boolean' ? profile.financialNeed : undefined,
      gpa: num(stats.gpa, 0, 6),
      sat: Number.isInteger(stats.sat) ? num(stats.sat, 400, 1600) : undefined,
      act: Number.isInteger(stats.act) ? num(stats.act, 1, 36) : undefined,
      activities: sanitizeActivities(stats.activities).filter((a) => a.name).slice(0, 15).map((a) => [a.name, a.role].filter(Boolean).join(', ').slice(0, 120)),
      applications: Object.values(shared.tracker ?? {}).slice(0, 40).map((i) => ({ title: String(i.title ?? '').slice(0, 140), status: statusInfo(i.status).label, deadline: i.deadline })),
      milestonesDone: progress.list.filter((m) => progress.has(m.id)).map((m) => m.text),
      milestonesOpen: progress.list.filter((m) => !progress.has(m.id)).map((m) => m.text),
    };
  }

  function strategyChat(student, insights, shared) {
    const messages = [];
    const log = h('div', { class: 'lab-chat-log strategy-log', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions', 'aria-label': `Strategy chat about ${student.name}`, tabindex: '0' });
    const input = h('textarea', { class: 'textarea', rows: '2', maxlength: '1500', 'aria-label': 'Ask Zeus for strategies', placeholder: 'e.g. How can I help them with financial aid?' });
    const send = h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, icon('send'), 'Ask Zeus');
    const chips = h('div', { class: 'lab-chips', role: 'group', 'aria-label': 'Suggested questions' });
    const form = h('form', { class: 'lab-chat-form' }, input, send);
    let busy = false;

    const bubble = (m) => h('div', { class: `bubble ${m.role}` },
      h('span', { class: 'visually-hidden', text: m.role === 'user' ? 'You: ' : 'Zeus: ' }),
      m.role === 'assistant' ? renderMarkdown(m.content) : m.content,
      m.source === 'ai' ? h('span', { class: 'lab-bubble-tag' }, icon('sparkles'), 'Claude') : null);
    const setChips = (list) => chips.replaceChildren(...list.map((q) => h('button', { type: 'button', class: 'chip chip-sm', onclick: () => ask(q) }, q)));

    async function ask(text) {
      const q = String(text ?? '').trim();
      if (!q || busy) return;
      busy = true;
      send.disabled = true;
      input.value = '';
      messages.push({ role: 'user', content: q });
      log.append(bubble({ role: 'user', content: q }));
      let answer = null;
      if (await aiAvailable()) {
        try {
          const r = await callLabAi({ task: 'counselor', messages: messages.slice(-20), student: counselorBrief(insights, shared) });
          answer = { reply: String(r.reply ?? '').slice(0, 6000), suggestions: (r.suggestions ?? []).map(String).slice(0, 3), source: 'ai' };
        } catch { /* fall back below */ }
      }
      answer ??= { ...counselorReply(q, insights), source: 'local' };
      const msg = { role: 'assistant', content: answer.reply, source: answer.source };
      messages.push(msg);
      log.append(bubble(msg));
      setChips(answer.suggestions?.length ? answer.suggestions : []);
      refreshIcons();
      log.scrollTop = log.scrollHeight;
      busy = false;
      send.disabled = false;
      input.focus();
    }
    form.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(input.value); } });
    setChips(['Brief me for a surprise 1-on-1', 'What strategies fit this student?', 'How do I help with financial aid?']);
    const note = h('p', { class: 'small faint mb-0' });
    aiAvailable().then((ai) => {
      note.textContent = ai
        ? 'Uses Claude when available. Zeus gets an anonymized brief: no name, username, chats, essays, or obstacles text.'
        : 'On-device suggestions; nothing about this student leaves your browser.';
    });

    return h('section', { class: 'strategy-chat', 'aria-labelledby': 'strat-h' },
      h('h3', { id: 'strat-h', class: 'h3' }, icon('messages-square'), 'Work with Zeus on strategies'),
      log, chips, form, note);
  }

  // ---- Start ----------------------------------------------------------------------------------------------
  const saved = readSession();
  if (saved?.code && saved?.key) {
    try {
      session = { ...saved, auth: await roomAuthToken(saved.key) };
      await loadRoster();
      dashboard();
      return;
    } catch (ex) {
      session = null;
      writeSession(null);
      signedOut(ex.status === 401 ? 'Please sign in again.' : ex.message);
      return;
    }
  }
  signedOut();
});
