// Student reviews: star summaries on cards, and the review list, form, and
// reporting inside the opportunity dialog. Reviews are public and stored by
// the /api/reviews function; when it isn't configured the UI says so.

import { h, icon, openModal, modalHeader, refreshIcons, toast, pluralize } from './dom.js';
import { getReviewMarks, markReview } from './store.js';

const API = '/api/reviews';
const ROLES = ['Student', 'Parent or guardian', 'Teacher or counselor', 'Other'];
const EXPERIENCES = ['Participated', 'Applied', 'Researched it'];
const REPORT_REASONS = ['Spam or advertising', 'Rude or hateful', 'Personal information', 'False or misleading', 'Other'];
const LIMITS = { titleMax: 80, bodyMin: 20, bodyMax: 1000, nameMax: 40 };

async function api(url, options) {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', ...(options?.body ? { 'Content-Type': 'application/json' } : {}) }, ...options });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  } catch {
    return { status: 0, ok: false, data: { error: 'You seem to be offline. Please try again.' } };
  }
}

let summaries;
function loadSummaries() {
  summaries ??= api(API).then((r) => (r.ok && r.data.enabled ? r.data.summaries ?? {} : {}));
  return summaries;
}

/** Visual stars; pair with text for screen readers. */
export function stars(rating, cls = '') {
  return h('span', { class: `stars ${cls}`, 'aria-hidden': 'true' },
    [1, 2, 3, 4, 5].map((n) => h('span', { class: `star${n <= Math.round(rating) ? ' on' : ''}` }, icon('star'))));
}

const ratingText = (avg, count) => `Rated ${avg.toFixed(1)} out of 5 from ${pluralize(count, 'review')}`;

/** Small "★ 4.5 (3)" badge for cards; stays hidden until there are reviews. */
export function ratingBadge(oppId) {
  const el = h('span', { class: 'badge rating-badge', hidden: true });
  loadSummaries().then((all) => {
    const s = all[oppId];
    if (!s?.count) return;
    el.replaceChildren(
      h('span', { 'aria-hidden': 'true' }, icon('star'), `${s.average.toFixed(1)} (${s.count})`),
      h('span', { class: 'visually-hidden', text: ratingText(s.average, s.count) }));
    el.hidden = false;
    refreshIcons();
  });
  return el;
}

function formatDate(ms) {
  try {
    return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

// ---- Summary ----------------------------------------------------------------
function fill(fraction) {
  const el = h('span', { class: 'bar-fill' });
  el.style.width = `${Math.round(fraction * 100)}%`;
  return el;
}

function summaryView(summary) {
  if (!summary.count) {
    return h('p', { class: 'muted mb-0', text: 'No reviews yet. If you’ve applied or taken part, your review helps other students decide.' });
  }
  const max = Math.max(...summary.distribution, 1);
  return h('div', { class: 'reviews-summary' },
    h('div', { class: 'reviews-score' },
      h('strong', { 'aria-hidden': 'true', text: summary.average.toFixed(1) }),
      stars(summary.average),
      h('span', { class: 'small muted', 'aria-hidden': 'true', text: pluralize(summary.count, 'review') }),
      h('span', { class: 'visually-hidden', text: ratingText(summary.average, summary.count) })),
    h('ul', { class: 'reviews-bars', 'aria-label': 'Ratings breakdown' },
      [5, 4, 3, 2, 1].map((star) => {
        const n = summary.distribution[star - 1];
        return h('li', {},
          h('span', { class: 'small', 'aria-hidden': 'true', text: `${star}` }),
          h('span', { class: 'bar-track', 'aria-hidden': 'true' }, fill(n / max)),
          h('span', { class: 'small muted', 'aria-hidden': 'true', text: String(n) }),
          h('span', { class: 'visually-hidden', text: `${pluralize(star, 'star')}: ${pluralize(n, 'review')}` }));
      })));
}

// ---- One review ----------------------------------------------------------------
function reviewItem(review, { own = false } = {}) {
  const reported = getReviewMarks().reported.includes(review.id);
  const reportBtn = own ? null : h('button', {
    type: 'button',
    class: 'btn btn-ghost btn-sm',
    disabled: reported,
    'aria-label': reported ? 'You reported this review' : `Report review by ${review.name}`,
    onclick: () => reportReview(review, reportBtn),
  }, icon('flag'), reported ? 'Reported' : 'Report');

  return h('li', { class: 'review' },
    h('div', { class: 'row-between' },
      h('div', { class: 'row' },
        stars(review.rating),
        h('span', { class: 'visually-hidden', text: `${pluralize(review.rating, 'star')} out of 5` }),
        review.title ? h('h4', { class: 'mb-0', text: review.title }) : null),
      reportBtn),
    h('p', { class: 'review-body', text: review.body }),
    h('p', { class: 'small muted mb-0' },
      [review.name, review.role, review.experience, formatDate(review.createdAt)].filter(Boolean).join(' · '),
      own ? h('span', { class: 'badge badge-success review-own' }, 'Your review') : null));
}

function reportReview(review, button) {
  const titleId = `report-title-${review.id}`;
  openModal({
    labelledBy: titleId,
    build: (close) => {
      const status = h('div', { role: 'alert' });
      const form = h('form', { class: 'modal-body', novalidate: true },
        h('fieldset', {},
          h('legend', {}, 'What’s wrong with this review?'),
          h('div', { class: 'stack' }, REPORT_REASONS.map((reason, i) => h('label', { class: 'check' },
            h('input', { type: 'radio', name: 'reason', value: reason, checked: i === 0, autofocus: i === 0 }),
            h('span', { text: reason }))))),
        h('p', { class: 'small muted mt-2', text: 'Reports are anonymous. Reviews that several people report are hidden until a moderator checks them.' }),
        status,
        h('div', { class: 'row mt-2' },
          h('button', { type: 'submit', class: 'btn btn-primary' }, icon('flag'), 'Send report'),
          h('button', { type: 'button', class: 'btn btn-ghost', onclick: close }, 'Cancel')));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        const res = await api(API, { method: 'POST', body: JSON.stringify({ action: 'report', reviewId: review.id, reason: form.elements.namedItem('reason').value }) });
        if (!res.ok) {
          submit.disabled = false;
          status.replaceChildren(h('p', { class: 'field-error', text: res.data.error || 'Could not send the report. Please try again.' }));
          return;
        }
        markReview('reported', review.id);
        close();
        button.disabled = true;
        button.setAttribute('aria-label', 'You reported this review');
        button.replaceChildren(icon('flag'), 'Reported');
        refreshIcons();
        toast('Thanks. A moderator will take a look.', 'success');
      });
      return [modalHeader(titleId, 'Report review', null, close), form];
    },
  });
}

// ---- Form -------------------------------------------------------------------------
function field(id, labelText, control, hintText, required = false) {
  const hintId = hintText ? `${id}-hint` : null;
  if (hintId) control.setAttribute('aria-describedby', hintId);
  return h('div', { class: 'field' },
    h('label', { class: 'label', for: id }, labelText, required ? ' *' : null),
    control,
    hintText ? h('span', { class: 'hint', id: hintId, text: hintText }) : null);
}

function reviewForm(opp, { onDone }) {
  const p = `rv-${opp.id}`;
  const openedAt = Date.now();
  const status = h('div', { role: 'alert' });

  const starLabels = [];
  const chosen = h('span', { class: 'small muted', 'aria-hidden': 'true' });
  const paintStars = (value) => {
    starLabels.forEach((l, i) => l.classList.toggle('on', i < value));
    chosen.textContent = `${pluralize(value, 'star')}`;
  };
  const starInputs = h('div', { class: 'star-input' }, [1, 2, 3, 4, 5].map((n) => {
    const input = h('input', { type: 'radio', name: 'rating', value: n, id: `${p}-star-${n}`, class: 'visually-hidden', onchange: () => paintStars(n) });
    const label = h('label', { for: input.id, class: 'star' }, icon('star'), h('span', { class: 'visually-hidden', text: pluralize(n, 'star') }));
    starLabels.push(label);
    return [input, label];
  }), chosen);

  const select = (name, options) => h('select', { class: 'select', id: `${p}-${name}`, name },
    h('option', { value: '' }, 'Choose one'), options.map((o) => h('option', { value: o }, o)));

  const body = h('textarea', { class: 'textarea', id: `${p}-body`, name: 'body', maxlength: LIMITS.bodyMax, required: true });
  const counter = h('span', { class: 'hint', 'aria-live': 'polite', text: `0 / ${LIMITS.bodyMax}` });
  body.addEventListener('input', () => { counter.textContent = `${body.value.length} / ${LIMITS.bodyMax}`; });

  const form = h('form', { class: 'review-form surface', novalidate: true },
    h('fieldset', { class: 'field' },
      h('legend', { class: 'label', id: `${p}-rating-label` }, 'Your rating *'),
      starInputs),
    h('div', { class: 'form-grid mt-2' },
      field(`${p}-experience`, 'Your experience', select('experience', EXPERIENCES), null, true),
      field(`${p}-role`, 'You are a', select('role', ROLES), null, true)),
    h('div', { class: 'mt-2' }, field(`${p}-title`, 'Headline', h('input', { class: 'input', id: `${p}-title`, name: 'title', maxlength: LIMITS.titleMax, autocomplete: 'off' }), 'Optional. Sum it up in a few words.')),
    h('div', { class: 'field' },
      h('label', { class: 'label', for: body.id }, 'Your review *'),
      body,
      h('span', { class: 'hint', id: `${p}-body-hint`, text: 'What was it like? Was it worth it? Tips for applying? Be honest and kind.' }),
      counter),
    field(`${p}-name`, 'Display name', h('input', { class: 'input', id: `${p}-name`, name: 'name', maxlength: LIMITS.nameMax, autocomplete: 'off' }), 'Optional. Use a first name or nickname, or leave it blank to post as Anonymous.'),
    h('div', { class: 'honeypot', 'aria-hidden': 'true' },
      h('label', { for: `${p}-website` }, 'Website'),
      h('input', { type: 'text', id: `${p}-website`, name: 'website', tabindex: '-1', autocomplete: 'off' })),
    h('div', { class: 'field' },
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', name: 'agree', id: `${p}-agree` }),
        h('span', { text: 'My review is honest and respectful, and it doesn’t include personal information like emails, phone numbers, social handles, or links.' }))),
    status,
    h('div', { class: 'row mt-2' },
      h('button', { type: 'submit', class: 'btn btn-primary' }, icon('send'), 'Post review'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => onDone(null) }, 'Cancel')));
  body.setAttribute('aria-describedby', `${p}-body-hint`);

  const el = (name) => form.elements.namedItem(name);
  const clearErrors = () => {
    status.replaceChildren();
    for (const node of form.querySelectorAll('.field-error')) node.remove();
    for (const node of form.querySelectorAll('[aria-invalid]')) {
      node.removeAttribute('aria-invalid');
      node.setAttribute('aria-describedby', (node.getAttribute('aria-describedby') ?? '').replace(/\S+-error\b/g, '').trim());
    }
  };
  const showError = (name, message) => {
    const target = name === 'rating' ? form.querySelector('.star-input') : el(name);
    if (!target) return;
    const msg = h('span', { class: 'field-error', id: `${p}-${name}-error`, text: message });
    const focusable = name === 'rating' ? form.querySelector('input[name="rating"]') : target;
    focusable.setAttribute('aria-invalid', 'true');
    focusable.setAttribute('aria-describedby', `${focusable.getAttribute('aria-describedby') ?? ''} ${msg.id}`.trim());
    (target.closest('.field') ?? target.parentElement).append(msg);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    const payload = {
      action: 'create',
      opportunityId: opp.id,
      rating: Number(form.querySelector('input[name="rating"]:checked')?.value ?? 0),
      experience: el('experience').value,
      role: el('role').value,
      title: el('title').value.trim(),
      body: body.value.trim(),
      name: el('name').value.trim(),
      agree: el('agree').checked,
      website: el('website').value,
      elapsedMs: Date.now() - openedAt,
    };
    const errors = {};
    if (!payload.rating) errors.rating = 'Choose a rating from 1 to 5 stars.';
    if (!payload.experience) errors.experience = 'Tell us about your experience with it.';
    if (!payload.role) errors.role = 'Tell us how you know this opportunity.';
    if (payload.body.length < LIMITS.bodyMin) errors.body = `Please write at least ${LIMITS.bodyMin} characters.`;
    if (!payload.agree) errors.agree = 'Please confirm your review follows the guidelines.';

    let res = null;
    if (!Object.keys(errors).length) {
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      res = await api(API, { method: 'POST', body: JSON.stringify(payload) });
      submit.disabled = false;
      if (res.status === 422) Object.assign(errors, res.data.errors);
    }
    if (Object.keys(errors).length) {
      for (const [name, message] of Object.entries(errors)) showError(name, message);
      status.append(h('p', { class: 'field-error', text: 'Please fix the highlighted fields.' }));
      form.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    if (res.status === 409) {
      markReview('reviewed', opp.id);
      onDone({ already: true });
      return;
    }
    if (!res.ok) {
      status.append(h('p', { class: 'field-error', text: res.data.error || 'Could not post your review. Please try again.' }));
      return;
    }
    markReview('reviewed', opp.id);
    onDone(res.data);
  });

  return form;
}

// ---- Section in the opportunity dialog -------------------------------------
export function reviewsSection(opp) {
  const headingId = `reviews-${opp.id}`;
  const summaryEl = h('div', { class: 'muted', text: 'Loading reviews…' });
  const list = h('ul', { class: 'review-list' });
  const live = h('p', { class: 'small mb-0', role: 'status' });
  const more = h('button', { type: 'button', class: 'btn btn-outline btn-sm', hidden: true }, 'Show more reviews');
  const writeBtn = h('button', { type: 'button', class: 'btn btn-outline btn-sm', hidden: true, 'aria-expanded': 'false' }, icon('pencil'), 'Write a review');
  const formSlot = h('div');
  const section = h('section', { class: 'reviews mt-2', 'aria-labelledby': headingId },
    h('div', { class: 'row-between' }, h('h3', { id: headingId, class: 'mb-0' }, 'Student reviews'), writeBtn),
    summaryEl, formSlot, live, list, more);

  let summary = null;
  let nextOffset = 0;

  const setWriteState = () => {
    const done = getReviewMarks().reviewed.includes(opp.id);
    writeBtn.hidden = false;
    writeBtn.disabled = done;
    writeBtn.replaceChildren(icon(done ? 'check' : 'pencil'), done ? 'You reviewed this' : 'Write a review');
    refreshIcons();
  };

  async function loadPage() {
    more.disabled = true;
    const res = await api(`${API}?${new URLSearchParams({ id: opp.id, offset: String(nextOffset) })}`);
    more.disabled = false;
    if (!res.ok || !res.data.enabled) {
      summaryEl.replaceChildren(h('p', { class: 'muted mb-0', text: res.ok
        ? 'Reviews aren’t turned on for this site yet.'
        : 'Reviews couldn’t load right now. Please try again later.' }));
      return;
    }
    if (nextOffset === 0) {
      summary = res.data.summary;
      summaryEl.replaceChildren(summaryView(summary));
      setWriteState();
    }
    list.append(...res.data.reviews.map((r) => reviewItem(r)));
    nextOffset = res.data.nextOffset;
    more.hidden = nextOffset === null;
    refreshIcons();
  }

  writeBtn.addEventListener('click', () => {
    if (formSlot.firstChild) return;
    writeBtn.setAttribute('aria-expanded', 'true');
    live.textContent = '';
    const form = reviewForm(opp, {
      onDone: (result) => {
        form.remove();
        writeBtn.setAttribute('aria-expanded', 'false');
        setWriteState();
        if (!result) { writeBtn.focus(); return; }
        if (result.already) live.textContent = 'You’ve already reviewed this opportunity.';
        else if (result.status === 'published') {
          summary.distribution[result.review.rating - 1] += 1;
          summary.count += 1;
          summary.average = Math.round((summary.distribution.reduce((a, n, i) => a + n * (i + 1), 0) / summary.count) * 10) / 10;
          summaryEl.replaceChildren(summaryView(summary));
          list.prepend(reviewItem(result.review, { own: true }));
          live.textContent = 'Thanks! Your review is posted.';
        } else {
          live.textContent = 'Thanks! Your review will appear after a moderator checks it.';
        }
        refreshIcons();
        live.setAttribute('tabindex', '-1');
        live.focus();
      },
    });
    formSlot.append(form);
    refreshIcons();
    form.querySelector('input[name="rating"]').focus();
  });
  more.addEventListener('click', loadPage);

  loadPage();
  return section;
}
