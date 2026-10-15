import { boot } from '../lib/layout.js';
import { h, icon, $, clear, refreshIcons, debounce, pluralize } from '../lib/dom.js';
import { loadData, monthsUntilDeadline, isExpired } from '../lib/data.js';
import { opportunityCard, showOpportunity, setClusterMeta, clusterLabel } from '../lib/cards.js';
import { getProfile, getSaved, isSaved, toggleSaved, getChat, onStoreChange } from '../lib/store.js';
import { scoreOpportunity } from '../lib/match.js';
import { mountZeus } from '../lib/zeus.js';
import { openWizard } from '../lib/wizard.js';

const PAGE_SIZE = 24;
const BOOL_KEYS = ['affordable', 'soon', 'eligible', 'saved'];

boot('explore', async () => {
  const data = await loadData();
  setClusterMeta(data.clusters);
  const opps = data.opportunities;
  let profile = getProfile();
  let visible = PAGE_SIZE;

  // ---- state <-> URL ---------------------------------------------------------
  const params = new URLSearchParams(window.location.search);
  const state = {
    q: params.get('q') ?? '',
    cluster: data.clusters[params.get('cluster')] ? params.get('cluster') : '',
    type: data.types.includes(params.get('type')) ? params.get('type') : '',
    grade: ['9', '10', '11', '12'].includes(params.get('grade')) ? params.get('grade') : '',
    cost: params.get('cost') ?? '',
    format: params.get('format') ?? '',
    sort: ['match', 'deadline', 'title'].includes(params.get('sort')) ? params.get('sort') : 'match',
  };
  for (const k of BOOL_KEYS) state[k] = params.get(k) === '1';
  // A list someone shared (?ids=a,b,c) and a single shared opportunity (?open=id).
  state.ids = (params.get('ids') ?? '').split(',').filter((id) => data.byId.has(id)).slice(0, 60);
  const openId = data.byId.has(params.get('open')) ? params.get('open') : null;
  const welcome = params.get('welcome') === '1';

  const syncUrl = () => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(state)) {
      if (BOOL_KEYS.includes(k)) { if (v) p.set(k, '1'); }
      else if (k === 'ids') { if (v.length) p.set(k, v.join(',')); }
      else if (v && !(k === 'sort' && v === 'match')) p.set(k, v);
    }
    const qs = p.toString();
    history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  };

  // ---- controls ----------------------------------------------------------------
  const chips = $('#cluster-chips');
  const chipFor = (key, label) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(state.cluster === key), dataset: { value: key },
    onclick: () => { state.cluster = key; paintChips(); update(); },
  }, label);
  chips.append(chipFor('', 'All'), ...Object.entries(data.clusters).map(([k, m]) => chipFor(k, m.label)));
  const paintChips = () => { for (const c of chips.children) c.setAttribute('aria-pressed', String(c.dataset.value === state.cluster)); };

  const typeSelect = $('#f-type');
  typeSelect.append(...data.types.map((t) => h('option', { value: t }, t)));

  const bind = (id, key) => {
    const el = $(id);
    el.value = state[key];
    el.addEventListener('change', () => { state[key] = el.value; update(); });
  };
  bind('#f-type', 'type');
  bind('#f-grade', 'grade');
  bind('#f-cost', 'cost');
  bind('#f-format', 'format');
  bind('#sort', 'sort');
  for (const k of BOOL_KEYS) {
    const el = $(`#f-${k}`);
    el.checked = state[k];
    el.addEventListener('change', () => { state[k] = el.checked; update(); });
  }
  const search = $('#search');
  search.value = state.q;
  search.addEventListener('input', debounce(() => { state.q = search.value.trim(); update(); }, 200));

  $('#reset-filters').addEventListener('click', () => {
    Object.assign(state, { q: '', cluster: '', type: '', grade: '', cost: '', format: '', sort: 'match', affordable: false, soon: false, eligible: false, saved: false, ids: [] });
    renderShared();
    search.value = '';
    for (const id of ['#f-type', '#f-grade', '#f-cost', '#f-format']) $(id).value = '';
    $('#sort').value = 'match';
    for (const k of BOOL_KEYS) $(`#f-${k}`).checked = false;
    paintChips();
    update();
  });

  // Mobile filter drawer
  const filters = $('#filters');
  const openBtn = $('#open-filters');
  openBtn.addEventListener('click', () => { filters.classList.add('open'); openBtn.setAttribute('aria-expanded', 'true'); filters.querySelector('button, select')?.focus(); });
  $('#close-filters').addEventListener('click', () => { filters.classList.remove('open'); openBtn.setAttribute('aria-expanded', 'false'); openBtn.focus(); });

  // ---- profile nudge -----------------------------------------------------------
  const startWizard = () => openWizard({ onComplete: () => { profile = getProfile(); renderNudge(); update(); greetAfterWizard(); } });
  function renderNudge() {
    const box = clear($('#profile-nudge'));
    const eligibleToggle = $('#f-eligible');
    eligibleToggle.disabled = !profile;
    if (!profile) {
      state.eligible = false;
      eligibleToggle.checked = false;
      box.append(h('div', { class: 'profile-nudge' },
        h('div', {}, h('strong', {}, 'Get personalized matches'), h('div', { class: 'small muted' }, 'Answer a few questions and every opportunity will show how well it fits you.')),
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: startWizard }, icon('compass'), 'Build my profile')));
    } else {
      const interests = profile.interests.map(clusterLabel).join(', ') || 'everything';
      box.append(h('div', { class: 'profile-nudge' },
        h('div', { class: 'small' }, h('strong', {}, 'Personalized for you: '), `${profile.grade ? `${profile.grade}th grader · ` : ''}interested in ${interests}${profile.financialNeed ? ' · cost matters' : ''}`),
        h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: startWizard }, icon('pencil'), 'Edit')));
    }
    refreshIcons();
  }

  // ---- shared list banner -----------------------------------------------------
  const sharedBox = h('div', { id: 'shared-list' });
  $('#profile-nudge').before(sharedBox);
  function renderShared() {
    clear(sharedBox);
    if (!state.ids.length) return;
    const unsaved = () => state.ids.filter((id) => !isSaved(id));
    const saveAll = h('button', {
      type: 'button', class: 'btn btn-primary btn-sm',
      onclick: () => {
        for (const id of unsaved()) toggleSaved(id);
        saveAll.disabled = true;
        saveAll.replaceChildren(icon('bookmark-check'), 'All saved');
        refreshIcons();
      },
    }, icon('bookmark-plus'), 'Save all');
    if (!unsaved().length) { saveAll.disabled = true; saveAll.replaceChildren(icon('bookmark-check'), 'All saved'); }
    sharedBox.append(h('div', { class: 'profile-nudge shared-nudge', role: 'region', 'aria-label': 'Shared list' },
      h('div', {}, h('strong', {}, icon('share-2'), ` ${pluralize(state.ids.length, 'opportunity', 'opportunities')} shared with you`),
        h('div', { class: 'small muted' }, 'Someone sent you this list. Save the ones you like to track them.')),
      h('div', { class: 'row' }, saveAll,
        h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => { state.ids = []; renderShared(); update(); } }, 'Show everything'))));
    refreshIcons();
  }

  // ---- filtering ---------------------------------------------------------------
  function filtered() {
    const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const saved = state.saved ? new Set(getSaved()) : null;
    const grade = state.grade ? Number(state.grade) : null;
    const rows = [];
    const only = state.ids.length ? new Set(state.ids) : null;
    for (const o of opps) {
      if (only && !only.has(o.id)) continue;
      if (state.cluster && o.cluster !== state.cluster) continue;
      if (state.type && o.type !== state.type) continue;
      if (grade && !o.grades.includes(grade)) continue;
      if (state.cost && o.cost !== state.cost) continue;
      if (state.format && o.format !== state.format) continue;
      if (state.affordable && !(o.cost === 'Free' || o.cost === 'Stipend' || o.cost === 'Award' || o.financialAid || o.needBased)) continue;
      if (state.soon) { const m = monthsUntilDeadline(o); if (m === null || m > 3 || isExpired(o)) continue; }
      if (saved && !saved.has(o.id)) continue;
      let textScore = 0;
      if (words.length) {
        const hay = `${o.title} ${o.organization} ${o.description} ${o.tags.join(' ')} ${o.type} ${o.location}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) continue;
        textScore = words.reduce((s, w) => s + (o.title.toLowerCase().includes(w) ? 2 : 1), 0);
      }
      const match = scoreOpportunity(o, profile);
      if (state.eligible && match && !match.eligible) continue;
      rows.push({ o, match, textScore });
    }
    const byTitle = (a, b) => a.o.title.localeCompare(b.o.title);
    if (state.sort === 'title') rows.sort(byTitle);
    else if (state.sort === 'deadline') rows.sort((a, b) => (monthsUntilDeadline(a.o) ?? 99) - (monthsUntilDeadline(b.o) ?? 99) || byTitle(a, b));
    else rows.sort((a, b) => b.textScore - a.textScore || (b.match?.eligible ?? 0) - (a.match?.eligible ?? 0) || (b.match?.score ?? 0) - (a.match?.score ?? 0) || Number(b.o.featured) - Number(a.o.featured) || byTitle(a, b));
    return rows;
  }

  function update({ keepPage = false } = {}) {
    if (!keepPage) visible = PAGE_SIZE;
    syncUrl();
    const rows = filtered();
    const results = clear($('#results'));
    $('#result-count').textContent = `${pluralize(rows.length, 'opportunity', 'opportunities')} found`;
    if (!rows.length) {
      results.append(h('div', { class: 'empty-state' },
        icon('search-x'),
        h('h3', { text: 'No matches yet' }),
        h('p', { text: 'Try removing a filter or searching a broader term. You can also ask Zeus for ideas.' })));
    } else {
      results.append(...rows.slice(0, visible).map(({ o }) => opportunityCard(o, { profile, onAsk })));
    }
    $('#load-more').hidden = rows.length <= visible;
    refreshIcons();
  }
  $('#load-more').addEventListener('click', () => { visible += PAGE_SIZE; update({ keepPage: true }); });
  onStoreChange((what) => {
    if (what === 'profile') { profile = getProfile(); renderNudge(); }
    if (what === 'profile' || (what === 'saved' && state.saved)) update({ keepPage: true });
  });

  // ---- Zeus ------------------------------------------------------------------------
  const dock = $('#zeus');
  const fab = $('#chat-fab');
  const closeDock = h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm dock-close', 'aria-label': 'Close chat' }, icon('x'));
  const toggleDock = (open) => {
    dock.classList.toggle('open', open);
    fab.setAttribute('aria-expanded', String(open));
    if (open) zeus.focus();
  };
  closeDock.addEventListener('click', () => { toggleDock(false); fab.focus(); });
  fab.addEventListener('click', () => toggleDock(!dock.classList.contains('open')));

  const zeus = mountZeus(dock, {
    data,
    closeButton: closeDock,
    onOpenOpportunity: (id) => { const o = data.byId.get(id); if (o) showOpportunity(o, { onAsk }); },
  });

  function onAsk(opp) {
    toggleDock(true);
    zeus.ask(`Tell me about ${opp.title}`);
  }

  function greetAfterWizard() {
    toggleDock(window.matchMedia('(max-width: 1280px)').matches);
    zeus.ask('I just finished the Pathway Wizard. What should my plan be?');
  }

  renderNudge();
  renderShared();
  paintChips();
  update();
  if (openId) showOpportunity(data.byId.get(openId), { onAsk });

  // update() already rewrote the URL without ?welcome=1, so a refresh won't re-trigger this.
  if (welcome && profile && !getChat().length) greetAfterWizard();
});
