import { boot } from '../lib/layout.js';
import { h, icon, $, clear, refreshIcons, pluralize } from '../lib/dom.js';
import { loadData } from '../lib/data.js';
import { stars } from '../lib/reviews.js';

// Moderation tools for reviews. The token is checked by /api/reviews-admin
// and kept in sessionStorage so it's forgotten when the tab closes.

const TOKEN_KEY = 'atlas.modtoken';
const readToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; } };
const writeToken = (t) => { try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } };

boot('moderate', async () => {
  const data = await loadData();
  let token = readToken();

  async function admin(method, body) {
    try {
      const res = await fetch('/api/reviews-admin', {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
    } catch {
      return { ok: false, status: 0, data: { error: 'Network error. Please try again.' } };
    }
  }

  function reviewRow(r, oppId, { onDone }) {
    const opp = data.byId.get(oppId);
    const status = h('p', { class: 'small mb-0', role: 'status' });
    const act = (action, label) => h('button', {
      type: 'button',
      class: `btn btn-sm ${action === 'remove' ? 'btn-danger' : 'btn-primary'}`,
      onclick: async (e) => {
        e.currentTarget.disabled = true;
        const res = await admin('POST', { action, reviewId: r.id });
        if (res.ok) onDone(row, action);
        else { status.textContent = res.data.error || 'That didn’t work.'; e.currentTarget.disabled = false; }
      },
    }, icon(action === 'remove' ? 'trash-2' : 'check'), label);
    const row = h('li', { class: 'review' },
      h('div', { class: 'row' }, stars(r.rating), h('span', { class: 'visually-hidden', text: `${r.rating} out of 5 stars` }),
        h('strong', { text: opp ? opp.title : oppId })),
      r.title ? h('h3', { class: 'mb-0 small', text: r.title }) : null,
      h('p', { class: 'review-body', text: r.body }),
      h('p', { class: 'small muted mb-0', text: [r.name, r.role, r.experience, new Date(r.createdAt).toLocaleString()].join(' · ') }),
      r.flags?.length ? h('div', { class: 'chip-group' }, r.flags.map((f) => h('span', { class: 'badge badge-warning', text: f === 'reported' ? `reported ${pluralize(r.reports, 'time')}` : f }))) : null,
      r.reportReasons?.length ? h('p', { class: 'small mb-0', text: `Report reasons: ${r.reportReasons.join(', ')}` }) : null,
      h('div', { class: 'row' }, r.flags ? act('approve', 'Approve') : null, act('remove', 'Remove')),
      status);
    return row;
  }

  async function loadQueue() {
    const list = clear($('#queue'));
    $('#queue-status').textContent = 'Loading…';
    const res = await admin('GET');
    if (!res.ok) {
      $('#queue-section').hidden = true;
      $('#published-section').hidden = true;
      $('#token-status').textContent = res.data.error || 'Could not load the queue.';
      if (res.status === 401) { writeToken(''); token = ''; $('#forget').hidden = true; }
      return;
    }
    $('#token-status').textContent = '';
    $('#queue-section').hidden = false;
    $('#published-section').hidden = false;
    $('#forget').hidden = false;
    const update = () => { $('#queue-status').textContent = list.children.length ? pluralize(list.children.length, 'review') + ' waiting.' : 'Nothing waiting. Nice.'; };
    list.append(...res.data.pending.map((r) => reviewRow(r, r.opportunityId, { onDone: (row, action) => { row.remove(); update(); $('#queue-status').textContent += ` Review ${action === 'remove' ? 'removed' : 'approved'}.`; } })));
    update();
    refreshIcons();
  }

  async function loadPublished(oppId) {
    const list = clear($('#published'));
    if (!oppId) { $('#published-status').textContent = ''; return; }
    $('#published-status').textContent = 'Loading…';
    const reviews = [];
    let offset = 0;
    while (offset !== null && reviews.length < 200) {
      const res = await fetch(`/api/reviews?${new URLSearchParams({ id: oppId, offset: String(offset) })}`).then((r) => r.json()).catch(() => null);
      if (!res?.enabled) break;
      reviews.push(...res.reviews);
      offset = res.nextOffset;
    }
    $('#published-status').textContent = pluralize(reviews.length, 'published review');
    list.append(...reviews.map((r) => reviewRow(r, oppId, { onDone: (row) => { row.remove(); $('#published-status').textContent = 'Review removed. It may take a minute to disappear for everyone.'; } })));
    refreshIcons();
  }

  $('#opp-select').append(...[...data.opportunities].sort((a, b) => a.title.localeCompare(b.title)).map((o) => h('option', { value: o.id }, o.title)));
  $('#opp-select').addEventListener('change', (e) => loadPublished(e.target.value));
  $('#refresh').addEventListener('click', loadQueue);
  $('#forget').addEventListener('click', () => {
    writeToken('');
    token = '';
    $('#token').value = '';
    $('#forget').hidden = true;
    $('#queue-section').hidden = true;
    $('#published-section').hidden = true;
    $('#token').focus();
  });
  $('#token-form').addEventListener('submit', (e) => {
    e.preventDefault();
    token = $('#token').value.trim();
    if (!token) { $('#token-status').textContent = 'Enter the moderator token.'; return; }
    writeToken(token);
    loadQueue();
  });

  if (token) { $('#token').value = token; loadQueue(); }
});
