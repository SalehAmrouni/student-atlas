import { boot } from '../lib/layout.js';
import { h, icon, $, $$, clear, refreshIcons } from '../lib/dom.js';
import { loadData } from '../lib/data.js';
import { SUGGESTIONS } from '../config.js';

// The site is static, so suggestions are handed off to a pre-filled GitHub
// issue (and optionally an email) for the team to review.

boot('submit', async () => {
  const form = $('#submit-form');
  const status = $('#form-status');
  const field = (name) => form.elements.namedItem(name);

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
    consent: field('consent').checked,
  });

  const validate = (body) => {
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
    if (!body.consent) errors.push(['consent', 'Please confirm the information is accurate.']);
    return errors;
  };

  const clusterLabel = (k) => data.clusters[k]?.label ?? k;

  function toMarkdown(b) {
    return [
      `**Program:** ${b.title}`,
      `**Organization:** ${b.organization}`,
      `**Website:** ${b.url}`,
      `**Interest area:** ${clusterLabel(b.cluster)}`,
      `**Type:** ${b.type}`,
      `**Grades:** ${b.grades.join(', ')}`,
      b.cost ? `**Cost:** ${b.cost}` : null,
      b.deadline ? `**Typical deadline:** ${b.deadline}` : null,
      `**Suggested by:** ${b.submitterRole}`,
      '',
      '**Description**',
      b.description,
    ].filter((line) => line !== null).join('\n');
  }

  function showSendOptions(b) {
    const title = `Resource suggestion: ${b.title}`;
    const body = toMarkdown(b);
    const options = clear($('#send-options'));

    if (SUGGESTIONS.githubRepo) {
      const url = `https://github.com/${SUGGESTIONS.githubRepo}/issues/new?${new URLSearchParams({ title, body })}`;
      options.append(h('a', { class: 'btn btn-primary', href: url, target: '_blank', rel: 'noopener noreferrer' }, icon('message-square-plus'), 'Open on GitHub'));
    }
    if (SUGGESTIONS.email) {
      const mailto = `mailto:${SUGGESTIONS.email}?${new URLSearchParams({ subject: title, body }).toString().replace(/\+/g, '%20')}`;
      options.append(h('a', { class: 'btn btn-outline', href: mailto }, icon('mail'), 'Send by email'));
    }
    options.append(h('button', {
      type: 'button', class: 'btn btn-outline',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(`${title}\n\n${body}`);
          $('#copy-status').textContent = 'Copied! Paste it wherever your team collects suggestions.';
        } catch {
          $('#copy-status').textContent = 'Copy failed. Select the text in your browser instead.';
        }
      },
    }, icon('copy'), 'Copy details'));
    refreshIcons();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors();
    const body = collect();
    const errors = validate(body);
    if (errors.length) {
      errors.forEach(([f, m]) => fieldError(f, m));
      status.append(h('div', { class: 'bubble error' }, icon('alert-circle'), h('span', { text: 'Please fix the highlighted fields.' })));
      refreshIcons();
      form.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    showSendOptions(body);
    form.hidden = true;
    $('#success').hidden = false;
    $('#success').focus();
  });

  $('#submit-another').addEventListener('click', () => {
    form.reset();
    $('#desc-count').textContent = '0';
    $('#copy-status').textContent = '';
    $('#success').hidden = true;
    form.hidden = false;
    field('title').focus();
  });
});
