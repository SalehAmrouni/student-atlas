// College Lab: a second side of Student Atlas for the application itself.
// Tabs: Overview (stats + plan), Essays, Transcript, Mentor, Privacy & AI.

import { boot } from '../lib/layout.js';
import { h, icon, $, refreshIcons } from '../lib/dom.js';
import { aiAvailable } from '../lib/lab-api.js';
import { getLab, onLabChange } from '../lib/lab-store.js';
import { renderOverview } from '../lab/overview.js';
import { renderEssays } from '../lab/essays.js';
import { renderTranscript } from '../lab/transcript.js';
import { renderMentor } from '../lab/mentor.js';
import { renderPrivacy } from '../lab/privacy.js';

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'layout-dashboard', render: renderOverview },
  { id: 'essays', label: 'Essays', icon: 'pen-line', render: renderEssays },
  { id: 'transcript', label: 'Transcript', icon: 'file-text', render: renderTranscript },
  { id: 'mentor', label: 'Mentor', icon: 'messages-square', render: renderMentor },
  { id: 'privacy', label: 'Privacy & AI', icon: 'shield-check', render: renderPrivacy },
];

boot('lab', async () => {
  const tabsRoot = $('#lab-tabs');
  const panel = h('div', { role: 'tabpanel', id: 'lab-tabpanel', tabindex: '-1', class: 'lab-tabpanel' });
  $('#lab-panel').replaceWith(panel);
  const fromHash = () => {
    const id = location.hash.slice(1).split('/')[0];
    return TABS.some((t) => t.id === id) ? id : 'overview';
  };
  let active = fromHash();
  let cleanup = null;
  const ai = await aiAvailable();

  // Hero status line
  const meta = $('#lab-hero-meta');
  meta.replaceChildren(
    h('span', { class: `lab-pill ${ai ? 'on' : ''}` }, icon(ai ? 'sparkles' : 'cpu'), ai ? 'AI feedback available (Claude)' : 'On-device feedback'),
    h('span', { class: 'lab-pill' }, icon('lock'), 'Your work stays in this browser'));

  const buttons = TABS.map((t) => h('button', {
    type: 'button', role: 'tab', class: 'lab-tab', id: `lab-tab-${t.id}`, 'aria-controls': 'lab-tabpanel',
    onclick: () => select(t.id, { focusPanel: false }),
  }, icon(t.icon), h('span', {}, t.label)));
  const tablist = h('div', { class: 'lab-tabs', role: 'tablist', 'aria-label': 'College Lab sections' }, buttons);
  tablist.addEventListener('keydown', (e) => {
    const i = TABS.findIndex((t) => t.id === active);
    let next = null;
    if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length].id;
    else if (e.key === 'ArrowLeft') next = TABS[(i + TABS.length - 1) % TABS.length].id;
    else if (e.key === 'Home') next = TABS[0].id;
    else if (e.key === 'End') next = TABS.at(-1).id;
    if (next) {
      e.preventDefault();
      select(next);
      $(`#lab-tab-${next}`).focus();
    }
  });
  tabsRoot.replaceWith(h('nav', { class: 'lab-tabs-wrap', 'aria-label': 'College Lab' }, tablist));

  function select(id, { pushHash = true } = {}) {
    active = id;
    if (pushHash && location.hash.slice(1) !== id) history.replaceState(null, '', `#${id}`);
    for (const b of buttons) {
      const on = b.id === `lab-tab-${id}`;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    panel.setAttribute('aria-labelledby', `lab-tab-${id}`);
    cleanup?.();
    cleanup = null;
    panel.replaceChildren();
    const tab = TABS.find((t) => t.id === id);
    cleanup = tab.render(panel, { ai, go: (to) => select(to) }) ?? null;
    document.title = `${tab.label} · College Lab | Student Atlas`;
    refreshIcons();
  }

  window.addEventListener('hashchange', () => {
    const id = fromHash();
    if (id !== active) select(id, { pushHash: false });
  });
  // Other tabs (or "delete all my data") changed lab data: refresh the overview's numbers.
  onLabChange((what) => { if (what === 'all') select(active, { pushHash: false }); });
  getLab();
  select(active, { pushHash: false });
});
