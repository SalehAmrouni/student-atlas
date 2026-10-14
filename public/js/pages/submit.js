import { boot } from '../lib/layout.js';
import { h, icon, $, $$, clear, refreshIcons } from '../lib/dom.js';
import { loadData } from '../lib/data.js';

boot('submit', async () => {
  const form = $('#submit-form');
  const status = $('#form-status');
  const button = $('#submit-btn');

  const data = await loadData();
  $('#cluster').append(...Object.entries(data.clusters).map(([k, m]) => h('option', { value: k }, m.label)));
  $('#type').append(...data.types.map((t) => h('option', { value: t }, t)));

  const desc = $('#description');
  desc.addEventListener('input', () => { $('#desc-count').textContent = String(desc.value.length); });

  const clearErrors = () => {
    clear(status);
    for (const el of $$('[aria-invalid="true"]', form)) el.removeAttribute('aria-invalid');
    for (const el of $$('.field-error', form)) el.remove();
  };

  const fieldError = (name, message) => {
    const input = field(name);
    const el = input instanceof RadioNodeList ? input[0] : input;
    if (!el) return;
    el.setAttribute('aria-invalid', 'true');
    const msg = h('span', { class: 'field-error', id: `${name}-error`, text: message });
    el.setAttribute('aria-describedby', msg.id);
    (el.closest('.field') ?? el.parentElement).append(msg);
  };

  const field = (name) => form.elements.namedItem(name);

  const collect = () => ({
    title: field('title').value.trim(),
    organization: field('organization').value.trim(),
    url: field('url').value.trim(),
    description: field('description').value.trim(),
    cluster: field('cluster').value,
    type: field('type').value,
    cost: field('cost').value.trim(),
    deadline: field('deadline').value.trim(),
    grades: $$('input[name="grades"]:checked', form).map((c) => Number(c.value)),
    submitterRole: field('submitterRole').value,
    contactEmail: field('contactEmail').value.trim(),
    consent: field('consent').checked,
    website2: field('website2').value,
  });

  const validateLocally = (body) => {
    const errors = [];
    if (body.title.length < 3) errors.push(['title', 'Enter the program name.']);
    if (body.organization.length < 2) errors.push(['organization', 'Enter the organization.']);
    try {
      const u = new URL(body.url);
      if (!/^https?:$/.test(u.protocol)) throw new Error();
    } catch { errors.push(['url', 'Enter a full web address starting with https://']); }
    if (body.description.length < 30) errors.push(['description', 'Please write at least 30 characters.']);
    if (!body.cluster) errors.push(['cluster', 'Choose an interest area.']);
    if (!body.type) errors.push(['type', 'Choose a type.']);
    if (!body.grades.length) errors.push(['grades', 'Choose at least one grade.']);
    if (!body.submitterRole) errors.push(['submitterRole', 'Tell us your connection to this resource.']);
    if (body.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contactEmail)) errors.push(['contactEmail', 'Enter a valid email or leave this blank.']);
    if (!body.consent) errors.push(['consent', 'Please confirm the information is accurate.']);
    return errors;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    const body = collect();
    const errors = validateLocally(body);
    if (errors.length) {
      errors.forEach(([f, m]) => fieldError(f, m));
      status.append(h('div', { class: 'bubble error' }, icon('alert-circle'), h('span', { text: 'Please fix the highlighted fields.' })));
      refreshIcons();
      form.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }

    button.disabled = true;
    button.replaceChildren(icon('loader-2', 'spin'), 'Submitting…');
    refreshIcons();
    try {
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        for (const f of json.fields ?? []) fieldError(f.field.split('.')[0], f.message);
        throw new Error(json.error || 'Something went wrong. Please try again.');
      }
      form.reset();
      $('#desc-count').textContent = '0';
      form.hidden = true;
      $('#success').hidden = false;
      $('#success').focus();
    } catch (err) {
      status.append(h('div', { class: 'bubble error' }, icon('alert-circle'), h('span', { text: err.message })));
    } finally {
      button.disabled = false;
      button.replaceChildren(icon('send'), 'Submit for review');
      refreshIcons();
    }
  });

  $('#submit-another').addEventListener('click', () => {
    $('#success').hidden = true;
    form.hidden = false;
    field('title').focus();
  });
});
