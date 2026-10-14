import { boot } from '../lib/layout.js';
import { h, icon, $, clear, refreshIcons, toast, pluralize, externalLink } from '../lib/dom.js';
import { loadData, monthsUntilDeadline, deadlineHint } from '../lib/data.js';
import { opportunityCard, showOpportunity, setClusterMeta, clusterLabel } from '../lib/cards.js';
import { getProfile, getSaved, toggleSaved, clearSaved, exportAllData, deleteAllData, onStoreChange } from '../lib/store.js';
import { scoreOpportunity, clusterAffinity } from '../lib/match.js';
import { openWizard } from '../lib/wizard.js';

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'layout-dashboard' },
  { id: 'saved', label: 'Saved', icon: 'bookmark' },
  { id: 'deadlines', label: 'Deadlines', icon: 'calendar-clock' },
  { id: 'privacy', label: 'Data & privacy', icon: 'shield-check' },
];

boot('profile', async () => {
  const data = await loadData();
  setClusterMeta(data.clusters);
  const opps = data.opportunities;
  const root = $('#profile-root');
  let activeTab = TABS.some((t) => t.id === location.hash.slice(1)) ? location.hash.slice(1) : 'overview';

  const rebuild = () => openWizard({ onComplete: render });

  function profileCard(profile) {
    const initial = (profile.firstName?.[0] ?? 'S').toUpperCase();
    const row = (k, v) => (v === undefined || v === '' ? null : h('div', {}, h('dt', { text: k }), h('dd', { text: v })));
    return h('aside', { class: 'card' },
      h('div', { class: 'row' },
        h('div', { class: 'avatar', 'aria-hidden': 'true', text: initial }),
        h('div', {},
          h('h2', { class: 'mb-0', text: profile.firstName || 'Student' }),
          h('p', { class: 'muted small mb-0', text: profile.grade ? `${profile.grade}th grade${profile.state ? ` · ${profile.state}` : ''}` : 'Grade not set' }))),
      h('dl', { class: 'kv' },
        row('Interests', profile.interests.map(clusterLabel).join(', ') || 'Not set'),
        row('Career directions', profile.careerGoals.join(', ') || undefined),
        row('Looking for', profile.lookingFor.join(', ') || undefined),
        row('GPA', profile.gpa !== undefined ? profile.gpa.toFixed(2) : undefined),
        row('Volunteer hours', profile.serviceHours !== undefined ? String(profile.serviceHours) : undefined),
        row('Format', { any: 'In person or online', 'In-person': 'In person', Virtual: 'Online' }[profile.formatPreference]),
        row('Cost matters', profile.financialNeed === undefined ? undefined : profile.financialNeed ? 'Yes' : 'No')),
      profile.goals ? h('p', { class: 'small muted mt-2 mb-0' }, h('strong', {}, 'Your goal: '), profile.goals) : null,
      h('div', { class: 'row mt-3' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: rebuild }, icon('pencil'), 'Edit profile'),
        h('a', { class: 'btn btn-ghost', href: '/dashboard.html?welcome=1' }, icon('sparkles'), 'Ask Zeus for a plan')));
  }

  function overview(profile, scored) {
    const eligible = scored.filter((s) => s.m.eligible);
    const strong = eligible.filter((s) => s.m.score >= 75);
    const affinity = clusterAffinity(opps, profile);
    const saved = getSaved();
    const top = eligible.sort((a, b) => b.m.score - a.m.score).slice(0, 6);

    const bars = h('div', { class: 'bars' }, affinity.map((a) => {
      const fill = h('div', { class: 'bar-fill', dataset: { cluster: a.cluster } });
      requestAnimationFrame(() => { fill.style.width = `${a.average}%`; });
      return h('div', { class: 'bar-row', dataset: { cluster: a.cluster } },
        h('span', { text: clusterLabel(a.cluster) }),
        h('div', { class: 'bar-track', role: 'img', 'aria-label': `${clusterLabel(a.cluster)}: average fit ${a.average}%, ${a.eligible} of ${a.total} open to you` }, fill),
        h('strong', { class: 'small', text: `${a.average}%` }));
    }));

    return [
      h('div', { class: 'stat-grid' },
        h('div', { class: 'stat' }, h('strong', { text: String(eligible.length) }), h('span', {}, 'opportunities open to you')),
        h('div', { class: 'stat' }, h('strong', { text: String(strong.length) }), h('span', {}, 'strong matches (75%+)')),
        h('div', { class: 'stat' }, h('strong', { text: String(saved.length) }), h('span', {}, 'saved')),
        h('div', { class: 'stat' }, h('strong', { text: String(opps.length) }), h('span', {}, 'in the directory'))),
      h('div', { class: 'card card-flat mt-3' },
        h('h3', {}, 'Fit by interest area'),
        h('p', { class: 'muted small' }, 'Average match score across each area, based on your profile.'),
        bars),
      h('div', { class: 'row-between mt-4 mb-2' },
        h('h3', { class: 'mb-0' }, 'Your top matches'),
        h('a', { class: 'btn btn-ghost btn-sm', href: '/dashboard.html' }, 'See all', icon('arrow-right'))),
      top.length
        ? h('div', { class: 'results-grid' }, top.map(({ o }) => opportunityCard(o, { profile })))
        : h('div', { class: 'empty-state' }, 'No eligible matches yet. Try adding more interests.'),
    ];
  }

  function savedTab() {
    const ids = getSaved();
    const items = ids.map((id) => data.byId.get(id)).filter(Boolean);
    if (!items.length) {
      return h('div', { class: 'empty-state' }, icon('bookmark'), h('h3', { text: 'Nothing saved yet' }),
        h('p', { text: 'Tap the bookmark on any opportunity to keep it here.' }),
        h('a', { class: 'btn btn-primary', href: '/dashboard.html' }, 'Browse opportunities'));
    }
    return h('div', { class: 'card card-flat' },
      h('div', { class: 'row-between' },
        h('p', { class: 'muted mb-0', text: pluralize(items.length, 'saved opportunity', 'saved opportunities') }),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { if (confirm('Remove all saved opportunities?')) { clearSaved(); toast('Cleared saved list'); } } }, icon('trash-2'), 'Clear all')),
      items.map((o) => h('div', { class: 'saved-item', dataset: { cluster: o.cluster } },
        h('div', {},
          h('button', { type: 'button', class: 'opp-link', onclick: () => showOpportunity(o) }, o.title),
          h('div', { class: 'small muted', text: `${o.organization} · ${o.deadline}` })),
        h('div', { class: 'row' },
          h('span', { class: 'badge badge-cluster', dataset: { cluster: o.cluster } }, clusterLabel(o.cluster)),
          externalLink(o.url, [icon('external-link'), 'Site'], 'btn btn-outline btn-sm'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': `Remove ${o.title}`, onclick: () => toggleSaved(o.id) }, icon('x'))))));
  }

  function deadlinesTab(profile, scored) {
    const saved = new Set(getSaved());
    const pool = scored.filter(({ o, m }) => saved.has(o.id) || (m?.eligible && m.score >= 60));
    const upcoming = pool
      .map(({ o }) => ({ o, months: monthsUntilDeadline(o) }))
      .filter((x) => x.months !== null && x.months <= 6)
      .sort((a, b) => a.months - b.months || a.o.title.localeCompare(b.o.title));
    return h('div', { class: 'card card-flat' },
      h('h3', {}, 'Coming up in the next 6 months'),
      h('p', { class: 'muted small' }, 'Your saved opportunities and strong matches, ordered by their typical deadline month. Always check the official site for exact dates.'),
      upcoming.length
        ? upcoming.map(({ o }) => h('div', { class: 'saved-item' },
          h('div', {},
            h('button', { type: 'button', class: 'opp-link', onclick: () => showOpportunity(o) }, o.title),
            h('div', { class: 'small muted', text: o.deadline })),
          h('div', { class: 'row' },
            saved.has(o.id) ? h('span', { class: 'badge badge-success' }, 'Saved') : null,
            h('span', { class: 'badge badge-info', text: deadlineHint(o) ?? 'Later this year' }))))
        : h('p', { class: 'muted' }, 'No typical deadlines in the next six months. Save a few opportunities to track them here.'));
  }

  function privacyTab() {
    const download = () => {
      const blob = new Blob([JSON.stringify(exportAllData(), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: 'student-atlas-data.json' });
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('Downloaded your data', 'success');
    };
    const wipe = () => {
      if (!confirm('Delete your profile, saved opportunities, chat, and settings from this browser? This cannot be undone.')) return;
      deleteAllData();
      toast('All of your data was deleted from this browser', 'success');
      render();
    };
    return h('div', { class: 'card card-flat stack' },
      h('h3', {}, 'Your data stays with you'),
      h('ul', { class: 'reasons' },
        h('li', { class: 'good' }, icon('check-circle-2'), 'No account or password: your profile and saved list live only in this browser (localStorage).'),
        h('li', { class: 'good' }, icon('check-circle-2'), 'Zeus runs entirely in your browser. Your questions and profile are never sent anywhere.'),
        h('li', { class: 'good' }, icon('check-circle-2'), 'Chat history is kept only for this browser tab and clears when you close it.'),
        h('li', { class: 'good' }, icon('check-circle-2'), 'No ads, no tracking, no third-party analytics.')),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-outline', onclick: download }, icon('download'), 'Download my data'),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: wipe }, icon('trash-2'), 'Delete all my data')),
      h('p', { class: 'small faint mb-0' }, 'Read the full ', h('a', { href: '/references.html#privacy' }, 'privacy summary'), '.'));
  }

  function render() {
    const profile = getProfile();
    clear(root);
    $('#page-title').textContent = profile?.firstName ? `${profile.firstName}'s pathway` : 'Your pathway';

    if (!profile) {
      root.append(h('div', { class: 'card text-center section-tight' },
        h('div', { class: 'zeus-avatar zeus-avatar-lg', 'aria-hidden': 'true' }, icon('compass')),
        h('h2', { text: 'Let’s build your pathway' }),
        h('p', { class: 'muted', text: 'Answer a few quick questions and Student Atlas will rank every opportunity for you, track deadlines, and give Zeus the context it needs to help.' }),
        h('div', { class: 'row row-center mt-2' },
          h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: rebuild }, icon('sparkles'), 'Start the Pathway Wizard'))),
        h('div', { class: 'mt-3' }, privacyTab()));
      refreshIcons();
      return;
    }

    const scored = opps.map((o) => ({ o, m: scoreOpportunity(o, profile) }));
    const panel = h('div', { role: 'tabpanel', id: 'tab-panel', tabindex: '0' });
    const tabButtons = TABS.map((t) => h('button', {
      type: 'button', class: 'tab', role: 'tab', id: `tab-${t.id}`, 'aria-selected': String(t.id === activeTab), 'aria-controls': 'tab-panel',
      tabindex: t.id === activeTab ? '0' : '-1',
      onclick: () => selectTab(t.id),
    }, icon(t.icon), t.label));
    const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Pathway sections' }, tabButtons);
    tablist.addEventListener('keydown', (e) => {
      const i = TABS.findIndex((t) => t.id === activeTab);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id;
        selectTab(next);
        $(`#tab-${next}`).focus();
      }
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
      panel.replaceChildren(...[].concat(
        id === 'overview' ? overview(profile, scored)
          : id === 'saved' ? savedTab()
            : id === 'deadlines' ? deadlinesTab(profile, scored)
              : privacyTab()));
      refreshIcons();
    }

    root.append(h('div', { class: 'profile-layout' }, profileCard(profile), h('section', {}, tablist, panel)));
    selectTab(activeTab);
  }

  onStoreChange(() => render());
  render();
});
