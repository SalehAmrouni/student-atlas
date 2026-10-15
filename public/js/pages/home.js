import { boot } from '../lib/layout.js';
import { h, $, clear, refreshIcons } from '../lib/dom.js';
import { loadData, monthsUntilDeadline } from '../lib/data.js';
import { opportunityCard, setClusterMeta } from '../lib/cards.js';
import { openWizard } from '../lib/wizard.js';
import { getProfile } from '../lib/store.js';
import { scoreOpportunity } from '../lib/match.js';
import { createCarousel } from '../lib/carousel.js';

boot('home', async () => {
  const startWizard = () => openWizard({ onComplete: () => { window.location.href = '/dashboard.html?welcome=1'; } });
  $('#start-wizard').addEventListener('click', startWizard);
  $('#start-wizard-2').addEventListener('click', startWizard);
  if (new URLSearchParams(window.location.search).get('wizard') === '1') {
    history.replaceState(null, '', '/');
    startWizard();
  }

  const data = await loadData();
  setClusterMeta(data.clusters);
  const opps = data.opportunities;

  $('#stat-total').textContent = String(opps.length);
  $('#stat-free').textContent = String(opps.filter((o) => o.cost === 'Free' || o.cost === 'Stipend' || o.cost === 'Award' || o.financialAid || o.needBased).length);

  const tiles = $('#cluster-tiles');
  clear(tiles);
  for (const [key, meta] of Object.entries(data.clusters)) {
    const count = opps.filter((o) => o.cluster === key).length;
    tiles.append(h('a', { class: 'cluster-tile', href: `/dashboard.html?cluster=${encodeURIComponent(key)}`, dataset: { cluster: key } },
      h('span', { class: 'dot' }),
      h('strong', { text: meta.label }),
      h('span', { text: `${count} opportunities · ${meta.description}` })));
  }

  // Personalize the spotlight when the student has a profile.
  const profile = getProfile();
  const ranked = profile
    ? opps
      .map((o) => ({ o, m: scoreOpportunity(o, profile) }))
      .filter(({ m }) => m.eligible)
      .sort((a, b) => b.m.score - a.m.score)
      .map(({ o }) => o)
    : opps;
  let featured;
  if (profile) {
    featured = ranked.slice(0, 12);
    $('#featured-title').textContent = profile.firstName ? `Top matches for ${profile.firstName}` : 'Your top matches';
    $('#featured-subtitle').textContent = 'Based on your Pathway profile. Open any card to see why it fits.';
  } else {
    featured = opps.filter((o) => o.featured).slice(0, 12);
  }
  mountCarousel('featured', featured);

  // Deadlines that usually fall this month or next.
  const soon = ranked
    .filter((o) => { const m = monthsUntilDeadline(o); return m !== null && m <= 2; })
    .sort((a, b) => monthsUntilDeadline(a) - monthsUntilDeadline(b))
    .slice(0, 12);
  if (soon.length) {
    if (profile) $('#soon-subtitle').textContent = 'Programs you are eligible for that usually close soon.';
    mountCarousel('soon', soon);
    $('#soon-section').hidden = false;
  }
  refreshIcons();

  function mountCarousel(name, list) {
    const { root, controls } = createCarousel({
      labelledBy: `${name}-title`,
      slides: list.map((o) => opportunityCard(o, { profile })),
    });
    clear($(`#${name}-carousel`)).append(root);
    $(`#${name}-controls`).prepend(controls);
  }
});
