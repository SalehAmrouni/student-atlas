// Sending opportunities to someone else: a friend, a parent, or a counselor.
// Everything happens on the student's device: a link they copy, their own
// email or messages app, or the phone's share sheet. Nothing goes through us.

import { h, icon, openModal, modalHeader, toast } from './dom.js';

const MAX_LIST_IDS = 60;
const MAX_MAILTO_BODY = 1800;

export const opportunityLink = (id) => `${window.location.origin}/dashboard.html?open=${encodeURIComponent(id)}`;
export const listLink = (ids) => `${window.location.origin}/dashboard.html?ids=${ids.slice(0, MAX_LIST_IDS).map(encodeURIComponent).join(',')}`;

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or clipboard access denied: fall back to a selection copy.
    const area = h('textarea', { class: 'visually-hidden', readonly: true });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

function clampBody(body, url) {
  if (body.length <= MAX_MAILTO_BODY) return body;
  return `${body.slice(0, MAX_MAILTO_BODY).replace(/\n[^\n]*$/, '')}\n\n…see the full list: ${url}`;
}

/**
 * Opens the share dialog.
 * content(details) returns { subject, body } for the email and message apps;
 * `details` is the state of the optional "include my status and dates" box.
 */
function openShareDialog({ heading, subtitle, url, content, detailsLabel }) {
  let details = false;
  const titleId = 'share-title';
  const link = () => url;

  const mail = h('a', { class: 'btn btn-outline share-option' }, icon('mail'), 'Email');
  const sms = h('a', { class: 'btn btn-outline share-option' }, icon('message-square'), 'Text message');
  const paint = () => {
    const { subject, body } = content(details);
    const text = clampBody(body, link());
    mail.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    sms.href = `sms:?&body=${encodeURIComponent(`${subject}: ${link()}`)}`;
    preview.textContent = text;
  };
  const preview = h('pre', { class: 'share-preview', tabindex: '0', 'aria-label': 'Message preview' });

  const native = typeof navigator.share === 'function'
    ? h('button', {
      type: 'button', class: 'btn btn-primary share-option',
      onclick: async () => {
        const { subject, body } = content(details);
        try {
          await navigator.share({ title: subject, text: body, url: link() });
        } catch (err) {
          if (err?.name !== 'AbortError') toast('Your device could not open the share menu. Try copying the link instead.', 'error');
        }
      },
    }, icon('share-2'), 'Share with an app')
    : null;

  openModal({
    labelledBy: titleId,
    build: (close) => {
      const input = h('input', { class: 'input', id: 'share-link', readonly: true, value: link(), onfocus: (e) => e.target.select() });
      const copyBtn = h('button', {
        type: 'button', class: 'btn btn-primary',
        onclick: async () => toast((await copyText(link())) ? 'Link copied' : 'Could not copy. Select the link and copy it yourself.', 'success'),
      }, icon('copy'), 'Copy link');
      paint();
      return [
        modalHeader(titleId, heading, subtitle, close),
        h('div', { class: 'modal-body stack' },
          h('div', { class: 'field' },
            h('label', { class: 'label', for: 'share-link' }, 'Link'),
            h('div', { class: 'share-link-row' }, input, copyBtn),
            h('span', { class: 'hint' }, 'Anyone with the link sees the same opportunities. Your profile and notes are never included.')),
          h('div', { class: 'share-options', role: 'group', 'aria-label': 'Send with' }, native, mail, sms),
          detailsLabel ? h('label', { class: 'check' },
            h('input', { type: 'checkbox', onchange: (e) => { details = e.target.checked; paint(); } }),
            h('span', {}, detailsLabel)) : null,
          h('details', { class: 'share-details' }, h('summary', {}, 'Preview the message'), preview)),
      ];
    },
  });
}

export function shareOpportunity(opp) {
  const url = opportunityLink(opp.id);
  openShareDialog({
    heading: 'Send this opportunity',
    subtitle: opp.title,
    url,
    content: () => ({
      subject: `Opportunity: ${opp.title}`,
      body: `I found this on Student Atlas and thought of you:\n\n${opp.title} (${opp.organization})\nTypical deadline: ${opp.deadline}\nOfficial site: ${opp.url}\n\nMore details: ${url}`,
    }),
  });
}

/**
 * Shares several opportunities at once (a saved list or tracked applications).
 * items: [{ id?, title, organization?, deadline?, url?, status?, dates? }]
 * Only directory opportunities (with an id) go in the link; custom entries
 * still appear in the email text.
 */
export function shareList(items, { heading = 'Send my list', detailsLabel } = {}) {
  const ids = items.map((i) => i.id).filter(Boolean);
  const url = ids.length ? listLink(ids) : `${window.location.origin}/dashboard.html`;
  openShareDialog({
    heading,
    subtitle: `${items.length} ${items.length === 1 ? 'opportunity' : 'opportunities'}`,
    url,
    detailsLabel,
    content: (details) => ({
      subject: `My Student Atlas list (${items.length})`,
      body: [
        'Here are the opportunities I’m looking at:',
        '',
        ...items.map((i, n) => [
          `${n + 1}. ${i.title}${i.organization ? ` (${i.organization})` : ''}`,
          details && i.status ? `   Status: ${i.status}` : null,
          details && i.dates ? `   ${i.dates}` : null,
          !details && i.deadline ? `   Typical deadline: ${i.deadline}` : null,
          i.url ? `   ${i.url}` : null,
        ].filter(Boolean).join('\n')),
        '',
        ids.length ? `See them all on Student Atlas: ${url}` : '',
      ].join('\n').trim(),
    }),
  });
}
