// Calendar of applied, planned, and bookmarked opportunities: a month grid
// (keyboard navigable, with a day panel) and an agenda list that works better
// on phones and with screen readers. Exports to .ics.

import { h, icon, clear, refreshIcons, toast, downloadFile, pluralize } from './dom.js';
import { getTracker, getSaved } from './store.js';
import { calendarItems, toDateKey, parseDateKey, relativeDay, daysUntil, statusInfo, SOURCE_LABELS, KIND_LABELS } from './applications.js';
import { buildICS } from './ics.js';
import { opportunityLink } from './share.js';

const KIND_ICONS = { deadline: 'flag', event: 'calendar', decision: 'mail-open', submitted: 'send', estimate: 'calendar-range' };
const SOURCE_ICONS = { applied: 'send', planning: 'pencil-line', saved: 'bookmark' };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const fmt = (d, opts) => d.toLocaleDateString(undefined, opts);
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthTitle = (d) => fmt(d, { month: 'long', year: 'numeric' });
const longDay = (key) => fmt(parseDateKey(key), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

/** Turns calendar items into .ics events. */
export function icsEvents(items, byId) {
  return items.filter((i) => i.date).map((i) => {
    const opp = i.oppId ? byId.get(i.oppId) : null;
    const status = i.status ? `Status: ${statusInfo(i.status).label}. ` : '';
    return {
      uid: i.uid,
      date: i.date,
      time: i.time,
      title: i.title,
      description: `${KIND_LABELS[i.kind]}. ${status}Confirm dates on the official site.${opp ? ` ${opportunityLink(opp.id)}` : ''}`,
      url: opp?.url,
      remindDaysBefore: i.kind === 'deadline' ? 3 : i.kind === 'event' ? 1 : 0,
    };
  });
}

export function downloadICS(items, byId, filename = 'student-atlas-calendar.ics') {
  const events = icsEvents(items, byId);
  if (!events.length) {
    toast('Add an exact deadline or event first, then export it.', 'error');
    return false;
  }
  downloadFile(filename, buildICS(events, { name: 'Student Atlas' }), 'text/calendar');
  toast(`Downloaded ${pluralize(events.length, 'calendar event')}. Open the file to add it to your calendar.`, 'success');
  return true;
}

/**
 * Renders the calendar into `root`. Returns { refresh } so the page can
 * re-render it when the tracker or bookmarks change.
 * onOpen(item) opens the item (tracker editor or opportunity details).
 * onTrack(oppId) starts tracking a bookmarked opportunity.
 */
export function mountCalendar(root, { byId, onOpen, onTrack }) {
  const today = new Date();
  const state = {
    month: new Date(today.getFullYear(), today.getMonth(), 1),
    selected: toDateKey(today),
    mode: window.matchMedia('(max-width: 640px)').matches ? 'list' : 'month',
    show: { applied: true, planning: true, saved: true },
    focusSelected: false,
  };

  const visible = (items) => items.filter((i) => state.show[i.source]);
  const data = () => {
    const { dated, estimates } = calendarItems({ tracker: getTracker(), saved: getSaved(), byId });
    return { dated: visible(dated), estimates: visible(estimates) };
  };

  // ---- item rows ----------------------------------------------------------------
  function itemRow(item) {
    const when = item.date
      ? [item.time ? new Date(`${item.date}T${item.time}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : null, relativeDay(item.date)].filter(Boolean).join(' · ')
      : `Usually: ${item.note}`;
    const overdue = item.date && item.kind === 'deadline' && item.source === 'planning' && daysUntil(item.date) < 0;
    return h('li', { class: 'cal-item', dataset: { source: item.source } },
      h('span', { class: 'cal-item-icon', 'aria-hidden': 'true' }, icon(KIND_ICONS[item.kind])),
      h('div', { class: 'cal-item-main' },
        h('strong', { text: item.opportunity }),
        h('div', { class: 'small' }, h('span', { class: 'cal-label', text: item.label }), h('span', { class: 'muted', text: ` · ${when}` })),
        h('div', { class: 'small' },
          h('span', { class: 'cal-source', dataset: { source: item.source } }, icon(SOURCE_ICONS[item.source]), SOURCE_LABELS[item.source]),
          overdue ? h('span', { class: 'badge badge-danger ms-1' }, 'Past due') : null)),
      h('div', { class: 'cal-item-actions' },
        item.kind === 'estimate' && !item.itemId
          ? h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => onTrack(item.oppId), 'aria-label': `Track ${item.opportunity} and set the exact deadline` }, icon('list-plus'), 'Track')
          : h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => onOpen(item), 'aria-label': `Open ${item.opportunity}` }, 'Open'),
        item.date ? h('button', {
          type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': `Add ${item.title} to my calendar app`,
          onclick: () => downloadICS([item], byId, `${item.uid}.ics`),
        }, icon('calendar-plus')) : null));
  }
  const itemList = (items) => h('ul', { class: 'cal-list' }, items.map(itemRow));

  // ---- month grid ------------------------------------------------------------------
  function grid(dated) {
    const byDay = new Map();
    for (const i of dated) byDay.set(i.date, [...(byDay.get(i.date) ?? []), i]);
    const first = state.month;
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const todayKey = toDateKey(today);
    if (!state.selected.startsWith(monthKey(first))) state.selected = toDateKey(first);

    const cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(h('td', { class: 'cal-empty' }));
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(first.getFullYear(), first.getMonth(), d);
      const key = toDateKey(date);
      const items = byDay.get(key) ?? [];
      const selected = key === state.selected;
      const btn = h('button', {
        type: 'button', class: 'cal-day', tabindex: selected ? '0' : '-1', dataset: { date: key },
        'aria-pressed': String(selected),
        'aria-label': `${fmt(date, { weekday: 'long', month: 'long', day: 'numeric' })}${key === todayKey ? ', today' : ''}${items.length ? `, ${pluralize(items.length, 'item')}` : ''}`,
        onclick: () => { state.selected = key; state.focusSelected = true; render(); },
      },
      h('span', { class: 'cal-num', 'aria-hidden': 'true', text: String(d) }),
      items.length ? h('span', { class: 'cal-pills', 'aria-hidden': 'true' },
        items.slice(0, 2).map((i) => h('span', { class: 'cal-pill', dataset: { source: i.source }, text: i.opportunity })),
        items.length > 2 ? h('span', { class: 'cal-more', text: `+${items.length - 2}` }) : null) : null);
      cells.push(h('td', { class: `${key === todayKey ? 'cal-today' : ''}${items.length ? ' has-items' : ''}`.trim() || undefined }, btn));
    }
    while (cells.length % 7) cells.push(h('td', { class: 'cal-empty' }));
    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(h('tr', {}, cells.slice(i, i + 7)));

    const table = h('table', { class: 'cal-grid' },
      h('caption', { class: 'visually-hidden', text: `${monthTitle(first)}. Use the arrow keys to move between days.` }),
      h('thead', {}, h('tr', {}, WEEKDAYS.map((w) => h('th', { scope: 'col', abbr: w }, h('span', { 'aria-hidden': 'true', text: w.slice(0, 3) }), h('span', { class: 'visually-hidden', text: w }))))),
      h('tbody', {}, rows));

    table.addEventListener('keydown', (e) => {
      const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      let next;
      const cur = parseDateKey(state.selected);
      if (moves[e.key]) next = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + moves[e.key]);
      else if (e.key === 'Home') next = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - cur.getDay());
      else if (e.key === 'End') next = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + (6 - cur.getDay()));
      else if (e.key === 'PageUp' || e.key === 'PageDown') next = new Date(cur.getFullYear(), cur.getMonth() + (e.key === 'PageUp' ? -1 : 1), 1);
      if (!next) return;
      e.preventDefault();
      state.selected = toDateKey(next);
      state.month = new Date(next.getFullYear(), next.getMonth(), 1);
      state.focusSelected = true;
      render();
    });
    return table;
  }

  // ---- toolbar -----------------------------------------------------------------------
  function toolbar() {
    const shift = (n) => {
      state.month = new Date(state.month.getFullYear(), state.month.getMonth() + n, 1);
      render();
    };
    const modeBtn = (mode, label, iconName) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(state.mode === mode),
      onclick: () => { state.mode = mode; render(); },
    }, icon(iconName), label);
    const showChip = (source) => h('button', {
      type: 'button', class: 'chip cal-filter', dataset: { source }, 'aria-pressed': String(state.show[source]),
      onclick: () => { state.show[source] = !state.show[source]; render(); },
    }, icon(SOURCE_ICONS[source]), SOURCE_LABELS[source]);

    const month = state.mode === 'month';
    return h('div', { class: 'cal-toolbar' },
      h('div', { class: 'cal-nav' },
        month ? h('button', { type: 'button', class: 'btn btn-outline btn-icon btn-sm', 'aria-label': 'Previous month', onclick: () => shift(-1) }, icon('chevron-left')) : null,
        h('h2', { class: 'cal-title', id: 'cal-title', 'aria-live': 'polite', text: month ? monthTitle(state.month) : 'Coming up' }),
        month ? h('button', { type: 'button', class: 'btn btn-outline btn-icon btn-sm', 'aria-label': 'Next month', onclick: () => shift(1) }, icon('chevron-right')) : null,
        month ? h('button', {
          type: 'button', class: 'btn btn-ghost btn-sm',
          onclick: () => { state.month = new Date(today.getFullYear(), today.getMonth(), 1); state.selected = toDateKey(today); render(); },
        }, 'Today') : null),
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Calendar view' }, modeBtn('month', 'Month', 'calendar-days'), modeBtn('list', 'List', 'list')),
      h('div', { class: 'chip-group', role: 'group', 'aria-label': 'Show on the calendar' }, ['applied', 'planning', 'saved'].map(showChip)));
  }

  // ---- views -----------------------------------------------------------------------------
  function monthView({ dated, estimates }) {
    const dayItems = dated.filter((i) => i.date === state.selected);
    const monthEstimates = estimates.filter((i) => i.month === monthKey(state.month));
    return h('div', { class: 'cal-layout' },
      h('div', { class: 'cal-grid-wrap' }, grid(dated)),
      h('div', { class: 'cal-side' },
        h('section', { class: 'card card-flat', 'aria-labelledby': 'cal-day-title' },
          h('h3', { id: 'cal-day-title', text: longDay(state.selected) }),
          dayItems.length ? itemList(dayItems) : h('p', { class: 'muted small mb-0' }, 'Nothing on this day.')),
        h('section', { class: 'card card-flat mt-2', 'aria-labelledby': 'cal-est-title' },
          h('h3', { id: 'cal-est-title' }, `Usually due in ${fmt(state.month, { month: 'long' })}`),
          h('p', { class: 'small muted' }, 'Estimates from each program’s typical deadline. Track one to set the exact date.'),
          monthEstimates.length ? itemList(monthEstimates) : h('p', { class: 'muted small mb-0' }, 'No typical deadlines this month for your bookmarks.'))));
  }

  function listView({ dated, estimates }) {
    const todayKey = toDateKey(today);
    const upcoming = dated.filter((i) => i.date >= todayKey || (i.kind === 'deadline' && i.source === 'planning'));
    const months = new Map();
    for (const i of upcoming) {
      const k = i.date < todayKey ? 'overdue' : i.date.slice(0, 7);
      months.set(k, [...(months.get(k) ?? []), i]);
    }
    for (const i of estimates) months.set(i.month, [...(months.get(i.month) ?? []), i]);
    if (!months.size) {
      return h('div', { class: 'empty-state' }, icon('calendar-x'), h('h3', { text: 'Nothing coming up' }),
        h('p', { text: 'Track an application and add its deadline, or bookmark opportunities to see their typical deadlines here.' }));
    }
    const keys = [...months.keys()].sort((a, b) => (a === 'overdue' ? -1 : b === 'overdue' ? 1 : a.localeCompare(b)));
    return h('div', { class: 'cal-agenda' }, keys.map((k) => {
      const items = months.get(k);
      const title = k === 'overdue' ? 'Past due' : monthTitle(new Date(Number(k.slice(0, 4)), Number(k.slice(5)) - 1, 1));
      const id = `agenda-${k}`;
      return h('section', { class: 'cal-month', 'aria-labelledby': id },
        h('h3', { id, text: title }),
        itemList(items.filter((i) => i.date)),
        items.some((i) => !i.date) ? [h('h4', { class: 'small muted mt-1' }, 'Usually due this month (estimate)'), itemList(items.filter((i) => !i.date))] : null);
    }));
  }

  function render() {
    const d = data();
    clear(root);
    root.append(toolbar(), state.mode === 'month' ? monthView(d) : listView(d));
    refreshIcons();
    if (state.focusSelected) {
      state.focusSelected = false;
      root.querySelector(`.cal-day[data-date="${state.selected}"]`)?.focus();
    }
  }

  render();
  return { refresh: render, exportAll: () => downloadICS(calendarItems({ tracker: getTracker(), saved: getSaved(), byId }).dated, byId) };
}
