// Essay Lab: drafts with autosave, prompt-aware feedback (Claude or on-device),
// an annotated view of the essay, and a version history of scores.

import { h, icon, refreshIcons, debounce, toast, clear } from '../lib/dom.js';
import { getLab, newEssay, updateEssay, recordFeedback, deleteEssay } from '../lib/lab-store.js';
import { analyzeEssay, normalizeEssayReview, ESSAY_PROMPTS, essayLabel } from '../lib/lab-engine.js';
import { callLabAi, fallbackNotice } from '../lib/lab-api.js';
import { field, scoreMeter, barRow, sourceBadge, useAi, mergedStats } from './common.js';

const countWords = (t) => (String(t).match(/[A-Za-z0-9’']+(?:-[A-Za-z0-9’']+)*/g) ?? []).length;
const promptOf = (e) => ESSAY_PROMPTS.find((p) => p.id === e.promptId) ?? ESSAY_PROMPTS.at(-1);
const limitOf = (e) => Number(e.wordLimit) || promptOf(e).limit;

export function renderEssays(root, { ai }) {
  let lab = getLab();
  let current = lab.essays[0]?.id ?? null;
  const side = h('aside', { class: 'card lab-drafts', 'aria-labelledby': 'drafts-h' });
  const main = h('div', { class: 'stack' });
  root.append(h('div', { class: 'lab-essays' }, side, main));

  function drawSide() {
    lab = getLab();
    const list = h('ul', { class: 'lab-draft-list' }, lab.essays.map((e) => h('li', {},
      h('button', {
        type: 'button', class: 'lab-draft', 'aria-current': e.id === current ? 'true' : undefined,
        onclick: () => { current = e.id; drawSide(); drawEditor(); },
      },
      h('strong', { text: e.title || 'Untitled draft' }),
      h('span', { class: 'small muted', text: `${countWords(e.text)} words${e.lastScore !== null && e.lastScore !== undefined ? ` · ${e.lastScore}/100` : ''}` })))));
    side.replaceChildren(
      h('div', { class: 'row-between' },
        h('h2', { id: 'drafts-h', class: 'h3 mb-0' }, 'Your drafts'),
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => { current = newEssay().id; drawSide(); drawEditor(true); } }, icon('plus'), 'New')),
      lab.essays.length ? list : h('p', { class: 'small muted mb-0 mt-2' }, 'No drafts yet.'));
    refreshIcons();
  }

  function drawEditor(focusTitle = false) {
    clear(main);
    lab = getLab();
    const essay = lab.essays.find((e) => e.id === current);
    if (!essay) {
      main.append(h('div', { class: 'card empty-state' },
        icon('pen-line'),
        h('h2', { class: 'h3', text: 'Start your first essay' }),
        h('p', { text: 'Paste a draft or start writing. You’ll get rubric scores, prioritized revisions, and line-by-line notes.' }),
        h('div', { class: 'row row-center' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { current = newEssay('ca7').id; drawSide(); drawEditor(true); } }, icon('plus'), 'New essay'))));
      refreshIcons();
      return;
    }

    const saved = h('span', { class: 'small faint', 'aria-live': 'polite' });
    const persist = debounce((patch) => { updateEssay(essay.id, patch); saved.textContent = 'Saved'; drawSide(); }, 500);
    const change = (patch) => { Object.assign(essay, patch); saved.textContent = 'Saving…'; persist(patch); };

    const title = h('input', { class: 'input', type: 'text', maxlength: '100', placeholder: 'e.g. Grandma’s recipe notebook', value: essay.title });
    title.addEventListener('input', () => change({ title: title.value }));

    const prompt = h('select', { class: 'select' }, ESSAY_PROMPTS.map((p) => h('option', { value: p.id, selected: p.id === essay.promptId || undefined }, p.label)));
    const customPrompt = h('textarea', { class: 'textarea lab-custom-prompt', maxlength: '1200', rows: '3', placeholder: 'Paste the exact prompt here' }, essay.promptText || '');
    const customField = field('Prompt text', customPrompt, 'Feedback checks whether your essay answers it.');
    customField.hidden = essay.promptId !== 'custom';
    const limit = h('input', { class: 'input', type: 'number', min: '25', max: '2000', step: '5', inputmode: 'numeric', value: essay.wordLimit ?? '', placeholder: String(promptOf(essay).limit) });
    prompt.addEventListener('change', () => {
      customField.hidden = prompt.value !== 'custom';
      change({ promptId: prompt.value });
      limit.placeholder = String(promptOf(essay).limit);
      updateCount();
    });
    customPrompt.addEventListener('input', () => change({ promptText: customPrompt.value }));
    limit.addEventListener('input', () => { change({ wordLimit: limit.value ? Number(limit.value) : null }); updateCount(); });

    const textarea = h('textarea', { class: 'textarea lab-essay-text', rows: '18', maxlength: '12000', spellcheck: 'true', placeholder: 'Write or paste your essay here…' }, essay.text);
    const countText = h('span', { class: 'small' });
    const countBar = h('div', { class: 'lab-count-fill' });
    const limitStatus = h('span', { class: 'visually-hidden', 'aria-live': 'polite' });
    let wasOver = false;
    function updateCount() {
      const n = countWords(textarea.value);
      const lim = limitOf(essay);
      countText.textContent = `${n} / ${lim} words`;
      countBar.style.width = `${Math.min(100, (n / lim) * 100)}%`;
      const over = n > lim;
      countBar.parentElement?.classList.toggle('over', over);
      countText.classList.toggle('lab-over', over);
      if (over !== wasOver) limitStatus.textContent = over ? `Over the ${lim}-word limit.` : 'Within the word limit.';
      wasOver = over;
    }
    textarea.addEventListener('input', () => { change({ text: textarea.value }); updateCount(); });

    const results = h('div', { class: 'stack', id: 'essay-results', tabindex: '-1' });
    const status = h('p', { class: 'lab-status small', role: 'status' });
    const gradeBtn = h('button', { type: 'button', class: 'btn btn-primary' }, icon('sparkles'), 'Get feedback');
    gradeBtn.addEventListener('click', async () => {
      const text = textarea.value.trim();
      if (countWords(text) < 40) {
        status.textContent = 'Write at least 40 words to get feedback.';
        textarea.focus();
        return;
      }
      updateEssay(essay.id, { text: textarea.value, title: title.value });
      const p = promptOf(essay);
      const opts = { promptId: essay.promptId, promptText: essay.promptText, wordLimit: limitOf(essay) };
      gradeBtn.disabled = true;
      gradeBtn.setAttribute('aria-busy', 'true');
      let feedback;
      let notice = '';
      try {
        if (await useAi(ai)) {
          status.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), ' Claude is reading your essay. This can take up to a minute…');
          try {
            const result = await callLabAi({
              task: 'essay', essay: text, wordLimit: limitOf(essay),
              prompt: essay.promptId === 'custom' ? (essay.promptText || 'Open prompt') : p.label.replace(/^[^:]+:\s*/, ''),
              grade: Number(mergedStats().grade) || null,
            });
            feedback = normalizeEssayReview(result, text, { wordLimit: limitOf(essay) });
          } catch (err) {
            notice = fallbackNotice(err);
          }
        }
        feedback ??= analyzeEssay(text, opts);
        recordFeedback(essay.id, feedback, text);
        status.textContent = `${notice ? `${notice} ` : ''}Feedback ready: ${feedback.overall} out of 100, ${feedback.label}.`;
        drawSide();
        drawResults(getLab().essays.find((e) => e.id === essay.id), feedback, text);
        results.focus();
      } finally {
        gradeBtn.disabled = false;
        gradeBtn.removeAttribute('aria-busy');
      }
    });

    const del = h('button', {
      type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => {
        if (!confirm(`Delete “${essay.title || 'Untitled draft'}” and its feedback history?`)) return;
        deleteEssay(essay.id);
        current = getLab().essays[0]?.id ?? null;
        toast('Draft deleted');
        drawSide();
        drawEditor();
      },
    }, icon('trash-2'), 'Delete draft');

    main.append(
      h('section', { class: 'card stack', 'aria-labelledby': 'editor-h' },
        h('div', { class: 'row-between' }, h('h2', { id: 'editor-h', class: 'h3 mb-0' }, 'Draft'), saved),
        h('div', { class: 'form-grid' }, field('Title (just for you)', title), field('Prompt', prompt), field('Word limit', limit, 'Leave blank to use the prompt’s usual limit')),
        customField,
        h('div', { class: 'field' },
          h('label', { class: 'label', for: 'essay-text' }, 'Your essay'),
          Object.assign(textarea, { id: 'essay-text' }),
          h('div', { class: 'lab-count' }, h('div', { class: 'lab-count-track', 'aria-hidden': 'true' }, countBar), countText, limitStatus)),
        h('div', { class: 'row' }, gradeBtn, del),
        status,
        h('p', { class: 'small faint mb-0' }, ai
          ? 'Feedback comes from Claude if you allow it, or from an on-device writing check. Either way, the essay is yours: use the notes to revise in your own words.'
          : 'Feedback comes from an on-device writing check that measures things like reflection, detail, clichés, and clarity. Ask a teacher or counselor to read your final draft too.')),
      results);
    updateCount();
    const last = essay.versions.at(-1);
    if (last?.feedback) drawResults(essay, last.feedback, last.text);
    refreshIcons();
    if (focusTitle) title.focus();

    function drawResults(e, fb, text) {
      results.replaceChildren(feedbackView(fb, text), historyView(e, (v) => drawResults(e, v.feedback, v.text)));
      refreshIcons();
    }
  }

  drawSide();
  drawEditor();
}

function feedbackView(fb, text) {
  return h('section', { class: 'card stack lab-feedback', 'aria-labelledby': 'fb-h' },
    h('div', { class: 'row-between' },
      h('div', {},
        h('h2', { id: 'fb-h', class: 'h3 mb-0' }, 'Feedback'),
        h('div', { class: 'row mt-1' }, h('span', { class: 'badge badge-success', text: fb.label || essayLabel(fb.overall) }), sourceBadge(fb.source))),
      scoreMeter(fb.overall, 'Essay score')),
    fb.summary ? h('p', { class: 'mb-0', text: fb.summary }) : null,
    h('div', { class: 'lab-bars' }, fb.rubric.map((r) => barRow(r.label, r.score, 5, r.comment))),
    fb.strengths.length ? h('div', {}, h('h3', { class: 'h4' }, 'What’s working'),
      h('ul', { class: 'reasons' }, fb.strengths.map((s) => h('li', { class: 'good' }, icon('check-circle-2'), h('span', { text: s }))))) : null,
    fb.revisions.length ? h('div', {}, h('h3', { class: 'h4' }, 'Revise next (most impact first)'),
      h('ol', { class: 'lab-revisions' }, fb.revisions.map((r) => h('li', {}, h('strong', { text: r.title }), h('span', { class: 'muted', text: ` ${r.detail}` }))))) : null,
    fb.comments.length ? annotated(text, fb.comments) : null,
    fb.stats?.readingGrade ? h('p', { class: 'small faint mb-0', text: `${fb.stats.sentences} sentences · ${fb.stats.paragraphs} paragraphs${fb.stats.avgSentenceLength ? ` · ${fb.stats.avgSentenceLength} words per sentence on average` : ''} · reading level about grade ${Math.max(1, Math.round(fb.stats.readingGrade))}` }) : null);
}

/** Essay text with numbered highlights, plus the matching numbered notes. */
function annotated(text, comments) {
  const spans = [];
  for (const c of comments) {
    const q = c.quote.trim();
    if (!q) continue;
    let from = 0;
    let at = -1;
    while ((at = text.indexOf(q, from)) !== -1) {
      if (!spans.some((s) => at < s.end && at + q.length > s.start)) break;
      from = at + 1;
    }
    if (at === -1) continue;
    spans.push({ start: at, end: at + q.length, comment: c });
  }
  spans.sort((a, b) => a.start - b.start);
  spans.forEach((s, i) => { s.n = i + 1; });

  const body = h('div', { class: 'lab-annotated' });
  let pos = 0;
  for (const s of spans) {
    if (s.start > pos) body.append(text.slice(pos, s.start));
    body.append(h('mark', { id: `note-ref-${s.n}` }, text.slice(s.start, s.end), h('sup', {}, h('a', { href: `#note-${s.n}`, 'aria-label': `Note ${s.n}` }, String(s.n)))));
    pos = s.end;
  }
  body.append(text.slice(pos));
  const notes = h('ol', { class: 'lab-notes' }, spans.map((s) => h('li', { id: `note-${s.n}` },
    h('q', { text: s.comment.quote.length > 90 ? `${s.comment.quote.slice(0, 90)}…` : s.comment.quote }),
    h('span', { text: ` ${s.comment.note} ` }),
    h('a', { href: `#note-ref-${s.n}`, class: 'small' }, 'Back to text'))));
  return h('details', { class: 'lab-annotations', open: true },
    h('summary', {}, h('strong', { text: `Line-by-line notes (${spans.length})` })),
    body, notes);
}

function historyView(essay, onShow) {
  if (!essay?.versions?.length) return null;
  const versions = essay.versions.map((v, i) => ({ ...v, n: i + 1 })).reverse();
  return h('section', { class: 'card', 'aria-labelledby': 'hist-h' },
    h('h2', { id: 'hist-h', class: 'h3' }, icon('history'), 'Version history'),
    h('ol', { class: 'lab-history', reversed: true }, versions.map((v, i) => {
      const prev = versions[i + 1];
      const delta = prev ? v.score - prev.score : null;
      return h('li', {},
        h('div', {},
          h('strong', { text: `Version ${v.n}: ${v.score}/100` }),
          delta ? h('span', { class: `small ${delta > 0 ? 'lab-up' : 'lab-down'}`, text: ` ${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}` }) : null,
          h('div', { class: 'small muted', text: `${new Date(v.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · ${v.wordCount} words · ${v.source === 'ai' ? 'Claude' : 'on-device'}` })),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => onShow(v) }, 'View'));
    })),
    h('p', { class: 'small faint mb-0' }, 'Scores from Claude and the on-device check use different methods, so compare versions graded the same way.'));
}
