// Privacy & AI: the AI choice, what is shared and when, and data controls.

import { h, icon, toast } from '../lib/dom.js';
import { getLab, saveLab, clearLab } from '../lib/lab-store.js';

export function renderPrivacy(root, { ai }) {
  const lab = getLab();
  const toggle = h('input', { type: 'checkbox', checked: lab.aiConsent === true || undefined, disabled: !ai || undefined });
  toggle.addEventListener('change', () => {
    saveLab((l) => { l.aiConsent = toggle.checked; }, 'consent');
    toast(toggle.checked ? 'AI feedback turned on' : 'Using on-device feedback only', 'success');
  });

  const download = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), collegeLab: getLab() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: 'college-lab-data.json' });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Downloaded your College Lab data', 'success');
  };

  root.append(h('div', { class: 'lab-privacy stack' },
    h('section', { class: 'card stack', 'aria-labelledby': 'ai-h' },
      h('h2', { id: 'ai-h', class: 'h3 mb-0' }, icon('sparkles'), 'AI feedback'),
      ai
        ? h('p', { class: 'mb-0' }, 'When this is on, the essay, transcript text, or mentor question you submit (with the stats you entered) is sent to Claude, an AI model made by Anthropic, to generate feedback. Student Atlas does not store or log it. When it’s off, everything runs on your device.')
        : h('p', { class: 'mb-0' }, 'AI feedback isn’t set up on this copy of Student Atlas, so every feature uses the on-device engine and nothing you write leaves this browser.'),
      h('label', { class: 'switch' }, toggle, 'Use AI feedback (Claude)'),
      h('ul', { class: 'reasons' },
        h('li', { class: 'good' }, icon('check-circle-2'), 'Only what you submit is sent, only when you press a button.'),
        h('li', { class: 'good' }, icon('check-circle-2'), 'Remove your name, student ID, address, and birth date from transcripts before pasting.'),
        h('li', { class: 'warn' }, icon('info'), 'Students under 13 should keep AI feedback off.'))),
    h('section', { class: 'card stack', 'aria-labelledby': 'data-h' },
      h('h2', { id: 'data-h', class: 'h3 mb-0' }, icon('database'), 'Your College Lab data'),
      h('p', { class: 'mb-0' }, `Saved in this browser only: ${lab.essays.length} essay draft${lab.essays.length === 1 ? '' : 's'}, ${lab.transcript?.courses?.length ?? 0} transcript courses, and ${lab.chat.length} mentor messages.`),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-outline', onclick: download }, icon('download'), 'Download my College Lab data'),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: () => {
          if (!confirm('Delete all College Lab data (stats, essays, transcript, and mentor chat) from this browser? This cannot be undone.')) return;
          clearLab();
          toast('College Lab data deleted', 'success');
        } }, icon('trash-2'), 'Delete College Lab data')),
      h('p', { class: 'small faint mb-0' }, 'See the full ', h('a', { href: '/references.html#privacy' }, 'privacy summary'), '.'))));
}
