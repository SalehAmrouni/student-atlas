// Opportunity card + detail dialog, shared by every page that lists programs.

import { h, icon, openModal, modalHeader, externalLink, toast, refreshIcons } from './dom.js';
import { isSaved, toggleSaved, getProfile } from './store.js';
import { scoreOpportunity, matchClass } from './match.js';
import { COST_LABELS, gradeLabel, deadlineHint, deadlineStatus, formatDate } from './data.js';
import { shareOpportunity } from './share.js';
import { trackButton } from './tracker-ui.js';
import { ratingBadge, reviewsSection } from './reviews.js';

let clusterMeta = {};
export function setClusterMeta(clusters) {
  clusterMeta = clusters ?? {};
}
export const clusterLabel = (key) => clusterMeta[key]?.label ?? key;

function saveButton(opp, { compact = true } = {}) {
  const btn = h('button', { type: 'button', class: `btn ${compact ? 'btn-ghost btn-icon btn-sm' : 'btn-outline'} save-btn` });
  const paint = () => {
    const saved = isSaved(opp.id);
    btn.setAttribute('aria-pressed', String(saved));
    btn.setAttribute('aria-label', saved ? `Remove ${opp.title} from saved` : `Save ${opp.title}`);
    btn.replaceChildren(icon(saved ? 'bookmark-check' : 'bookmark'), compact ? '' : (saved ? 'Saved' : 'Save'));
    refreshIcons();
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const nowSaved = toggleSaved(opp.id);
    toast(nowSaved ? 'Saved to My Pathway' : 'Removed from saved', nowSaved ? 'success' : 'info');
    paint();
  });
  paint();
  return btn;
}

function shareButton(opp, { compact = true } = {}) {
  return h('button', {
    type: 'button', class: `btn ${compact ? 'btn-ghost btn-icon btn-sm' : 'btn-ghost'}`, 'aria-label': `Send ${opp.title} to someone`,
    onclick: (e) => { e.stopPropagation(); shareOpportunity(opp); },
  }, icon('share-2'), compact ? '' : 'Send');
}

export function matchBadge(match) {
  if (!match) return null;
  if (!match.eligible) return h('span', { class: 'badge badge-warning' }, icon('alert-triangle'), 'Check eligibility');
  return h('span', { class: `badge match-pill ${matchClass(match.score)}`, title: 'How well this fits your profile' }, `${match.score}% match`);
}

/** "Deadline passed" / "Applications closed" badge, or null while the opportunity is open. */
export function expiredBadge(opp) {
  const status = deadlineStatus(opp);
  if (!status || status.state === 'open') return null;
  return h('span', { class: 'badge badge-warning' }, icon('calendar-x'), status.state === 'closed' ? 'Applications closed' : 'Deadline passed');
}

export function opportunityCard(opp, { profile = getProfile(), onAsk } = {}) {
  const match = scoreOpportunity(opp, profile);
  const hint = deadlineHint(opp);
  const open = () => showOpportunity(opp, { onAsk });

  return h('article', { class: 'opp-card', dataset: { cluster: opp.cluster } },
    h('div', { class: 'opp-card-top' },
      h('div', { class: 'opp-meta' },
        h('span', { class: 'badge badge-cluster', dataset: { cluster: opp.cluster } }, clusterLabel(opp.cluster)),
        h('span', { class: 'badge' }, opp.type),
        expiredBadge(opp),
        matchBadge(match),
        ratingBadge(opp.id)),
      h('div', { class: 'opp-card-tools' }, shareButton(opp), saveButton(opp))),
    h('div', {},
      h('h3', {}, h('button', { type: 'button', onclick: open }, opp.title)),
      h('p', { class: 'opp-org', text: opp.organization })),
    h('p', { class: 'opp-desc', text: opp.description }),
    h('div', { class: 'opp-facts' },
      h('span', {}, icon('wallet'), opp.costNote || COST_LABELS[opp.cost]),
      h('span', {}, icon('map-pin'), `${opp.format} · ${opp.location}`),
      h('span', {}, icon('graduation-cap'), gradeLabel(opp.grades)),
      h('span', {}, icon('calendar-clock'), hint ? `${hint} (${opp.deadline})` : opp.deadline)),
    h('div', { class: 'opp-card-actions' },
      h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: open }, 'Details'),
      externalLink(opp.url, [icon('external-link'), 'Official site'], 'btn btn-primary btn-sm')));
}

export function showOpportunity(opp, { onAsk } = {}) {
  const profile = getProfile();
  const match = scoreOpportunity(opp, profile);
  const titleId = `opp-title-${opp.id}`;
  const status = deadlineStatus(opp);

  const item = (iconName, k, v) => h('div', { class: 'detail-item' }, h('div', { class: 'k' }, icon(iconName), k), h('div', { class: 'v', text: v }));

  openModal({
    labelledBy: titleId,
    build: (close) => [
      modalHeader(titleId, opp.title, opp.organization, close),
      h('div', { class: 'modal-body' },
        h('div', { class: 'opp-meta' },
          h('span', { class: 'badge badge-cluster', dataset: { cluster: opp.cluster } }, clusterLabel(opp.cluster)),
          h('span', { class: 'badge' }, opp.type),
          opp.needBased ? h('span', { class: 'badge badge-success' }, 'Designed for students with financial need') : null,
          expiredBadge(opp),
          matchBadge(match)),
        h('p', { class: 'mt-2', text: opp.description }),
        h('div', { class: 'detail-grid' },
          item('wallet', 'Cost', opp.costNote || COST_LABELS[opp.cost]),
          item('graduation-cap', 'Who can apply', gradeLabel(opp.grades) + (opp.minGPA ? ` · ${opp.minGPA.toFixed(1)}+ GPA` : '')),
          item('calendar-clock', 'Typical deadline', opp.deadline),
          status ? item(status.state === 'open' ? 'calendar-check' : 'calendar-x', 'This cycle', status.label) : null,
          item('map-pin', 'Where', `${opp.format} · ${opp.location}`),
          item('sun', 'When', opp.season),
          item('hand-coins', 'Financial aid', opp.financialAid || opp.needBased || opp.cost === 'Free' ? 'Free or aid available' : 'Not listed')),
        match ? h('div', { class: 'surface' },
          h('h4', {}, 'How this fits you'),
          h('ul', { class: 'reasons' },
            match.reasons.map((r) => h('li', { class: 'good' }, icon('check-circle-2'), r)),
            match.warnings.map((w) => h('li', { class: 'warn' }, icon('alert-triangle'), w)),
            !match.reasons.length && !match.warnings.length ? h('li', {}, 'Add more to your profile for a better fit estimate.') : null))
          : h('div', { class: 'callout' }, icon('sparkles'), h('span', {}, 'Build your profile with the Pathway Wizard to see how well this fits you. ', h('a', { href: '/?wizard=1' }, 'Start the wizard'))),
        opp.tags.length ? h('div', { class: 'chip-group mt-2' }, opp.tags.map((t) => h('span', { class: 'badge', text: `#${t}` }))) : null,
        opp.linkStatus === 'broken'
          ? h('div', { class: 'callout mt-2' }, icon('alert-triangle'), h('span', { text: 'The official page for this opportunity could not be found on our last check. It may have moved; search the organization\'s site for its new page.' }))
          : null,
        h('div', { class: 'callout mt-2' }, icon('info'), h('span', {
          text: `Dates, costs, and rules change each year. Confirm everything on the official website before applying.${opp.lastChecked ? ` We last checked the official site on ${formatDate(opp.lastChecked)}.` : ''}`,
        })),
        reviewsSection(opp)),
      h('div', { class: 'modal-footer' },
        onAsk ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { close(); onAsk(opp); } }, icon('sparkles'), 'Ask Zeus about this') : null,
        shareButton(opp, { compact: false }),
        saveButton(opp, { compact: false }),
        trackButton(opp),
        externalLink(opp.url, [icon('external-link'), 'Visit official site'], 'btn btn-primary')),
    ],
  });
}
