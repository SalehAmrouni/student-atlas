import { boot } from '../lib/layout.js';
import { h, $, clear, externalLink } from '../lib/dom.js';
import { loadData } from '../lib/data.js';

boot('about', async () => {
  const data = await loadData();
  $('#count-text').textContent = String(data.opportunities.length);

  const root = clear($('#sources-list'));
  for (const [key, meta] of Object.entries(data.clusters)) {
    const items = data.opportunities
      .filter((o) => o.cluster === key)
      .sort((a, b) => a.organization.localeCompare(b.organization) || a.title.localeCompare(b.title));
    if (!items.length) continue;
    root.append(
      h('h3', { class: 'mt-3', text: `${meta.label} (${items.length})` }),
      h('ul', { class: 'source-list' }, items.map((o) => h('li', {},
        h('span', { text: `${o.organization}. "${o.title}." ` }),
        externalLink(o.url, new URL(o.url).hostname.replace(/^www\./, ''))))));
  }

  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
});
