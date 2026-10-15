import { boot } from '../lib/layout.js';
import { h, icon, $, clear, refreshIcons, toast, pluralize, externalLink } from '../lib/dom.js';
import { loadData } from '../lib/data.js';
import { showOpportunity, setClusterMeta } from '../lib/cards.js';
import { getTracker, getSaved, saveTrackerItem, onStoreChange } from '../lib/store.js';
import { STATUS_GROUPS, statusInfo, calendarItems, relativeDay, daysUntil, toDateKey, parseDateKey } from '../lib/applications.js';
import { openTrackEditor, statusBadge, statusSelect } from '../lib/tracker-ui.js';
import { mountCalendar, downloadICS } from '../lib/calendar-view.js';
import { shareList } from '../lib/share.js';

const TABS = [
  { id: 'applications', label: 'Applications', icon: 'list-checks' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar-days' },
];
const SORTS = { deadline: 'Deadline', updated: 'Recently updated', title: 'A to Z' };
const shortDate = (key) => parseDateKey(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

boot('tracker', async () => {
  const data = await loadData();
  setClusterMeta(data.clusters);
  const { byId } = data;
  const root = $('#tracker-root');
  let activeTab = TABS.some((t) => t.id === location.hash.slice(1)) ? location.hash.slice(1) : 'applications';
  let group = 'all';
  let sort = 'deadline';
  let calendar = null;

  const items = () => Object.values(getTracker());
  const openItem = (item) => openTrackEditor({ opp: item.oppId ? byId.get(item.oppId) : null, item });
  const track = (oppId) => { const opp = byId.get(oppId); if (opp) openTrackEditor({ opp }); };

  // ---- header actions ---------------------------------------------------------
  const sendList = () => {
    const list = items();
    if (!list.length) return toast('Track an application first, then you can send your list.', 'error');
    shareList(list.map((i) => {
      const opp = i.oppId ? byId.get(i.oppId) : null;
      const dates = [i.deadline ? `Deadline ${i.deadline}` : null, i.submittedOn ? `applied ${i.submittedOn}` : null, i.decisionOn ? `decision ${i.decisionOn}` : null].filter(Boolean).join(', ');
      return { id: i.oppId, title: i.title, organization: i.organization, url: i.url, deadline: opp?.deadline, status: statusInfo(i.status).label, dates };
    }), { heading: 'Send my applications', detailsLabel: 'Include my status and dates (good for a parent or counselor)' });
  };
  $('#tracker-actions').append(
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openTrackEditor({}) }, icon('plus'), 'Add your own'),
    h('button', { type: 'button', class: 'btn btn-outline', onclick: sendList }, icon('share-2'), 'Send my list'),
    h('button', {
      type: 'button', class: 'btn btn-outline',
      onclick: () => downloadICS(calendarItems({ tracker: getTracker(), saved: getSaved(), byId }).dated, byId),
    }, icon('calendar-plus'), 'Export calendar'));

  // ---- applications tab ---------------------------------------------------------
  function upcomingCard() {
    const todayKey = toDateKey(new Date());
    const { dated } = calendarItems({ tracker: getTracker(), byId });
    const soon = dated.filter((i) => i.kind !== 'submitted' && ((i.date >= todayKey && daysUntil(i.date) <= 30) || (i.kind === 'deadline' && i.source === 'planning' && i.date < todayKey)));
    return h('section', { class: 'card card-flat', 'aria-labelledby': 'soon-title' },
      h('div', { class: 'row-between' },
        h('h2', { class: 'h3 mb-0', id: 'soon-title' }, 'Next 30 days'),
        h('a', { class: 'btn btn-ghost btn-sm', href: '#calendar', onclick: (e) => { e.preventDefault(); selectTab('calendar'); } }, 'Open calendar', icon('arrow-right'))),
      soon.length
        ? h('ul', { class: 'soon-list' }, soon.map((i) => {
          const days = daysUntil(i.date);
          return h('li', {},
            h('span', { class: `date-chip${days < 0 ? ' overdue' : days <= 7 ? ' near' : ''}` },
              shortDate(i.date)),
            h('span', { class: 'soon-main' },
              h('button', { type: 'button', class: 'opp-link', onclick: () => openItem(getTracker()[i.itemId]) }, i.opportunity),
              h('span', { class: 'small muted', text: ` ${i.label}${i.time ? ` at ${i.time}` : ''} · ${days < 0 ? 'past due' : relativeDay(i.date).toLowerCase()}` })));
        }))
        : h('p', { class: 'muted small mb-0 mt-1' }, 'Nothing due in the next 30 days. Add exact deadlines to your applications to see them here.'));
  }

  function trackCard(item) {
    const opp = item.oppId ? byId.get(item.oppId) : null;
    const done = item.tasks.filter((t) => t.done).length;
    const nextEvent = [...item.events].filter((e) => daysUntil(e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date))[0];
    const titleId = `track-${item.id}`;
    let deadline = null;
    if (item.deadline) {
      const d = daysUntil(item.deadline);
      const late = d < 0 && statusInfo(item.status).group === 'planning';
      deadline = h('span', { class: late ? 'text-danger' : undefined }, icon('flag'), `Due ${shortDate(item.deadline)} (${late ? 'past due' : relativeDay(item.deadline).toLowerCase()})`);
    } else if (opp) deadline = h('span', {}, icon('calendar-clock'), `Usually: ${opp.deadline}`);

    return h('article', { class: 'track-card', 'aria-labelledby': titleId, dataset: { group: statusInfo(item.status).group, cluster: opp?.cluster ?? '' } },
      h('div', { class: 'track-card-head' },
        h('div', {},
          h('h3', { id: titleId }, h('button', { type: 'button', onclick: () => openItem(item), 'aria-label': `Edit ${item.title}` }, item.title)),
          item.organization ? h('p', { class: 'opp-org', text: item.organization }) : null),
        statusBadge(item.status)),
      h('div', { class: 'opp-facts' },
        deadline,
        item.submittedOn ? h('span', {}, icon('send'), `Applied ${shortDate(item.submittedOn)}`) : null,
        item.decisionOn ? h('span', {}, icon('mail-open'), `Decision expected ${shortDate(item.decisionOn)}`) : null,
        nextEvent ? h('span', {}, icon('calendar'), `${nextEvent.title}: ${shortDate(nextEvent.date)}${nextEvent.time ? ` at ${nextEvent.time}` : ''}`) : null),
      item.tasks.length ? h('div', { class: 'track-progress' },
        h('label', { class: 'small muted', for: `${titleId}-progress` }, `${done} of ${pluralize(item.tasks.length, 'step')} done`),
        h('progress', { id: `${titleId}-progress`, max: String(item.tasks.length), value: String(done) })) : null,
      h('div', { class: 'track-card-actions' },
        h('div', { class: 'track-status' },
          h('label', { class: 'visually-hidden', for: `${titleId}-status` }, `Status for ${item.title}`),
          statusSelect(item.status, {
            id: `${titleId}-status`,
            onChange: (status) => {
              const today = toDateKey(new Date());
              const patch = { status };
              if (status === 'submitted' && !item.submittedOn) patch.submittedOn = today;
              saveTrackerItem(item.id, { ...item, ...patch });
              // Moving into Applied gets its own celebration (celebrate.js).
              if (status !== 'submitted' || item.status === 'submitted') toast(`${item.title}: ${statusInfo(status).label}`, 'success');
            },
          })),
        h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => openItem(item) }, icon('pencil'), 'Edit'),
        opp ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => showOpportunity(opp) }, 'Details')
          : item.url ? externalLink(item.url, [icon('external-link'), 'Site'], 'btn btn-ghost btn-sm') : null));
  }

  function applicationsTab() {
    const all = items();
    const counts = Object.fromEntries(STATUS_GROUPS.map((g) => [g.id, all.filter((i) => statusInfo(i.status).group === g.id).length]));
    const applied = all.filter((i) => ['applied', 'decided'].includes(statusInfo(i.status).group) && i.status !== 'withdrawn').length;
    const accepted = all.filter((i) => i.status === 'accepted').length;
    const dueSoon = all.filter((i) => i.deadline && statusInfo(i.status).group === 'planning' && daysUntil(i.deadline) >= 0 && daysUntil(i.deadline) <= 30).length;

    const savedUntracked = getSaved().filter((id) => !getTracker()[id]).map((id) => byId.get(id)).filter(Boolean);
    const shown = all
      .filter((i) => group === 'all' || statusInfo(i.status).group === group)
      .sort(sort === 'title' ? (a, b) => a.title.localeCompare(b.title)
        : sort === 'updated' ? (a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
          : (a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.title.localeCompare(b.title));

    const groupChip = (id, label, n) => h('button', {
      type: 'button', class: 'chip', id: `group-${id}`, 'aria-pressed': String(group === id),
      onclick: () => { group = id; rerender(); },
    }, `${label} (${n})`);

    return [
      h('div', { class: 'stat-grid' },
        h('div', { class: 'stat' }, h('strong', { text: String(all.length) }), h('span', {}, 'tracking')),
        h('div', { class: 'stat' }, h('strong', { text: String(applied) }), h('span', {}, 'applied')),
        h('div', { class: 'stat' }, h('strong', { text: String(dueSoon) }), h('span', {}, 'due in 30 days')),
        h('div', { class: 'stat' }, h('strong', { text: String(accepted) }), h('span', {}, 'accepted'))),
      h('div', { class: 'mt-3' }, upcomingCard()),
      h('div', { class: 'row-between mt-4 mb-2' },
        h('div', { class: 'chip-group', role: 'group', 'aria-label': 'Show applications' },
          groupChip('all', 'All', all.length), STATUS_GROUPS.map((g) => groupChip(g.id, g.label, counts[g.id]))),
        h('div', { class: 'row' },
          h('label', { class: 'small muted', for: 'track-sort' }, 'Sort'),
          h('select', { class: 'select select-sm', id: 'track-sort', onchange: (e) => { sort = e.target.value; rerender(); } },
            Object.entries(SORTS).map(([v, l]) => h('option', { value: v, selected: v === sort || undefined }, l))))),
      shown.length
        ? h('div', { class: 'track-grid' }, shown.map(trackCard))
        : h('div', { class: 'empty-state' }, icon('list-checks'),
          h('h3', { text: all.length ? 'Nothing in this group' : 'Start tracking your applications' }),
          h('p', { text: 'Open any opportunity and choose “Track application”, start from a bookmark below, or add something that isn’t in the directory.' }),
          h('div', { class: 'row row-center' },
            h('a', { class: 'btn btn-primary', href: '/dashboard.html' }, icon('search'), 'Browse opportunities'),
            h('button', { type: 'button', class: 'btn btn-outline', onclick: () => openTrackEditor({}) }, icon('plus'), 'Add your own'))),
      savedUntracked.length ? h('section', { class: 'card card-flat mt-4', 'aria-labelledby': 'from-saved' },
        h('h2', { class: 'h3', id: 'from-saved' }, 'From your bookmarks'),
        h('p', { class: 'muted small' }, 'Start tracking a bookmark to add exact dates, steps, and notes.'),
        savedUntracked.map((o) => h('div', { class: 'saved-item' },
          h('div', {},
            h('button', { type: 'button', class: 'opp-link', onclick: () => showOpportunity(o) }, o.title),
            h('div', { class: 'small muted', text: `${o.organization} · Usually ${o.deadline}` })),
          h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => openTrackEditor({ opp: o }), 'aria-label': `Track ${o.title}` }, icon('list-plus'), 'Track')))) : null,
    ];
  }

  // ---- tabs ------------------------------------------------------------------------
  const panel = h('div', { role: 'tabpanel', id: 'tab-panel', tabindex: '-1' });
  const tabButtons = TABS.map((t) => h('button', {
    type: 'button', class: 'tab', role: 'tab', id: `tab-${t.id}`, 'aria-controls': 'tab-panel',
    onclick: () => selectTab(t.id),
  }, icon(t.icon), t.label));
  const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Tracker views' }, tabButtons);
  tablist.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex((t) => t.id === activeTab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id;
    selectTab(next);
    $(`#tab-${next}`).focus();
  });

  function selectTab(id) {
    activeTab = id;
    history.replaceState(null, '', `#${id}`);
    for (const b of tabButtons) {
      const on = b.id === `tab-${id}`;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    panel.setAttribute('aria-labelledby', `tab-${id}`);
    clear(panel);
    calendar = null;
    if (id === 'calendar') {
      const host = h('div');
      panel.append(host);
      calendar = mountCalendar(host, { byId, onOpen: (item) => (item.itemId ? openItem(getTracker()[item.itemId]) : showOpportunity(byId.get(item.oppId))), onTrack: track });
    } else {
      panel.append(...applicationsTab());
    }
    refreshIcons();
  }

  /** Re-renders the current tab, keeping keyboard focus on the same control. */
  function rerender() {
    const focusedId = document.activeElement?.id;
    if (calendar) calendar.refresh();
    else selectTab(activeTab);
    if (focusedId && !document.activeElement?.id) document.getElementById(focusedId)?.focus();
  }

  clear(root);
  root.append(tablist, panel);
  selectTab(activeTab);
  onStoreChange((what) => {
    if (what === 'tracker' || what === 'saved') rerender();
  });
  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (TABS.some((t) => t.id === id) && id !== activeTab) selectTab(id);
  });
});
