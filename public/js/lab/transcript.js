// Transcript: paste or upload a transcript, get every course parsed into an
// editable table, GPA math (unweighted, weighted, core), trends, and insights.

import { h, icon, refreshIcons, toast } from '../lib/dom.js';
import { getLab, saveLab } from '../lib/lab-store.js';
import { parseTranscript, computeGpa, transcriptInsights, gradePoints, detectLevel, detectSubject, LEVELS, SUBJECTS } from '../lib/lab-engine.js';
import { callLabAi, fallbackNotice } from '../lib/lab-api.js';
import { field, sourceBadge, useAi, mergedStats } from './common.js';

const SAMPLE = `Grade 9 (2023–2024)
English 9 Honors        A    A-   1.0
Algebra I               B+   B    1.0
Biology                 A         1.0
World History           A-        1.0
Spanish I               B         1.0
Grade 10 (2024–2025)
English 10 Honors       A         1.0
Geometry                B+        1.0
AP World History        A-        1.0
Chemistry Honors        B+        1.0
Spanish II              A         1.0
Grade 11 (2025–2026)
AP English Language     93        1.0
AP Calculus AB          88        1.0
AP Chemistry            B         1.0
US History (Dual Enrollment)  A   1.0`;

export function renderTranscript(root, { ai, go }) {
  const lab = getLab();
  const input = h('textarea', { class: 'textarea lab-transcript-input', rows: '10', maxlength: '20000', spellcheck: 'false', placeholder: 'Paste your transcript here. One course per line works best, e.g.\nAP Biology    A-    1.0' });
  const file = h('input', { type: 'file', accept: '.txt,.csv,.tsv,text/plain,text/csv', class: 'visually-hidden', id: 'transcript-file' });
  const status = h('p', { class: 'lab-status small', role: 'status' });
  const results = h('div', { class: 'stack', tabindex: '-1' });
  const digestBtn = h('button', { type: 'button', class: 'btn btn-primary' }, icon('wand-2'), 'Digest transcript');

  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > 200_000) { status.textContent = 'That file is too large. Paste the course list instead.'; return; }
    input.value = (await f.text()).slice(0, 20000);
    status.textContent = `Loaded ${f.name}. Press “Digest transcript”.`;
    file.value = '';
  });

  digestBtn.addEventListener('click', async () => {
    const text = input.value.trim();
    if (text.length < 20) { status.textContent = 'Paste your transcript first (or try the sample).'; input.focus(); return; }
    digestBtn.disabled = true;
    digestBtn.setAttribute('aria-busy', 'true');
    let notice = '';
    let transcript = null;
    try {
      if (await useAi(ai)) {
        status.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), ' Claude is reading your transcript…');
        try {
          const r = await callLabAi({ task: 'transcript', transcript: text });
          const courses = (r.courses ?? []).map((c) => normalizeCourse(c)).filter(Boolean);
          if (courses.length) transcript = { source: 'ai', courses, summary: String(r.summary ?? ''), strengths: (r.strengths ?? []).map(String), concerns: (r.concerns ?? []).map(String) };
          else notice = 'Claude didn’t find courses, so here is the on-device reading.';
        } catch (err) {
          notice = fallbackNotice(err);
        }
      }
      if (!transcript) {
        const parsed = parseTranscript(text);
        transcript = { source: 'local', courses: parsed.courses, skipped: parsed.skipped };
      }
      transcript.updatedAt = new Date().toISOString();
      saveLab((l) => { l.transcript = transcript; }, 'transcript');
      status.textContent = transcript.courses.length
        ? `${notice ? `${notice} ` : ''}Found ${transcript.courses.length} courses.`
        : 'No courses found. Try one course per line with its grade, like “Biology  A-”.';
      draw();
      results.focus();
    } finally {
      digestBtn.disabled = false;
      digestBtn.removeAttribute('aria-busy');
    }
  });

  function draw() {
    const t = getLab().transcript;
    results.replaceChildren();
    if (!t?.courses) return;
    results.append(summaryView(t), courseTable(t, draw), h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn btn-outline', onclick: () => go('mentor') }, icon('messages-square'), 'Ask the mentor about my transcript'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => {
        if (!confirm('Remove your saved transcript from this browser?')) return;
        saveLab((l) => { l.transcript = null; }, 'transcript');
        toast('Transcript removed');
        draw();
      } }, icon('trash-2'), 'Remove transcript')));
    refreshIcons();
  }

  root.append(
    h('section', { class: 'card stack', 'aria-labelledby': 'tx-h' },
      h('h2', { id: 'tx-h', class: 'h3 mb-0' }, icon('file-text'), 'Digest your transcript'),
      h('p', { class: 'muted mb-0' }, 'Paste your unofficial transcript (from your school portal) or upload a .txt or .csv file. You’ll get your GPA three ways, your trend by year, and plain-language takeaways. Remove your name, student ID, and birth date first.'),
      field('Transcript text', input),
      h('div', { class: 'row' },
        digestBtn,
        h('label', { class: 'btn btn-outline', for: 'transcript-file' }, icon('upload'), 'Upload file'), file,
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { input.value = SAMPLE; status.textContent = 'Sample transcript loaded.'; input.focus(); } }, 'Try a sample')),
      status),
    results);
  if (lab.transcript?.courses) draw();
}

function normalizeCourse(c) {
  if (!c?.name || typeof c.name !== 'string') return null;
  const grades = String(c.grade ?? '').split('/').map((g) => g.trim()).filter(Boolean);
  const pts = grades.map(gradePoints).filter((p) => p !== null);
  const name = c.name.slice(0, 80);
  return {
    name,
    year: c.year ? String(c.year).slice(0, 20) : null,
    level: LEVELS.includes(c.level) ? c.level : detectLevel(name),
    subject: detectSubject(name),
    grade: grades.join(' / ') || '—',
    points: pts.length ? Math.round((pts.reduce((a, b) => a + b, 0) / pts.length) * 100) / 100 : null,
    credits: Number(c.credits) > 0 && Number(c.credits) <= 3 ? Number(c.credits) : 1,
  };
}

function summaryView(t) {
  const g = computeGpa(t.courses);
  const local = transcriptInsights(t.courses, { grade: Number(mergedStats().grade) || undefined });
  const strengths = t.source === 'ai' && t.strengths?.length ? t.strengths : local.strengths;
  const concerns = t.source === 'ai' && t.concerns?.length ? t.concerns : local.concerns;
  const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : '–');
  const maxGpa = 4;
  return h('section', { class: 'card stack', 'aria-labelledby': 'txs-h' },
    h('div', { class: 'row-between' }, h('h2', { id: 'txs-h', class: 'h3 mb-0' }, 'Your transcript at a glance'), sourceBadge(t.source)),
    h('div', { class: 'stat-grid' },
      h('div', { class: 'stat' }, h('strong', { text: fmt(g.unweighted) }), h('span', {}, 'Unweighted GPA')),
      h('div', { class: 'stat' }, h('strong', { text: fmt(g.weighted) }), h('span', {}, 'Weighted GPA (+1 AP/IB/DE, +0.5 honors)')),
      h('div', { class: 'stat' }, h('strong', { text: fmt(g.core) }), h('span', {}, 'Core GPA (English, math, science, social studies, language)')),
      h('div', { class: 'stat' }, h('strong', { text: String(g.rigor.ap + g.rigor.ib + g.rigor.dual) }), h('span', {}, `AP/IB/dual courses · ${g.rigor.honors} honors`))),
    t.summary ? h('p', { class: 'mb-0', text: t.summary }) : null,
    g.byYear.length > 1 ? h('div', {},
      h('h3', { class: 'h4' }, 'GPA by year'),
      h('div', { class: 'lab-year-chart', role: 'list' }, g.byYear.map((y) => {
        const fill = h('div', { class: 'lab-year-fill' });
        requestAnimationFrame(() => { fill.style.height = `${Math.max(4, ((y.gpa ?? 0) / maxGpa) * 100)}%`; });
        return h('div', { class: 'lab-year', role: 'listitem', 'aria-label': `${y.year}: ${fmt(y.gpa)} GPA across ${y.count} courses` },
          h('strong', { class: 'small', text: fmt(y.gpa), 'aria-hidden': 'true' }),
          h('div', { class: 'lab-year-track', 'aria-hidden': 'true' }, fill),
          h('span', { class: 'small muted', text: y.year, 'aria-hidden': 'true' }));
      }))) : null,
    g.bySubject.length ? h('div', {},
      h('h3', { class: 'h4' }, 'By subject'),
      h('ul', { class: 'lab-subjects' }, g.bySubject.map((s) => h('li', {}, h('span', { text: s.subject }), h('strong', { text: `${fmt(s.gpa)} · ${s.count} course${s.count === 1 ? '' : 's'}` }))))) : null,
    h('div', { class: 'lab-two' },
      strengths.length ? h('div', {}, h('h3', { class: 'h4' }, 'Strengths'), h('ul', { class: 'reasons' }, strengths.map((s) => h('li', { class: 'good' }, icon('check-circle-2'), h('span', { text: s }))))) : null,
      concerns.length ? h('div', {}, h('h3', { class: 'h4' }, 'Worth working on'), h('ul', { class: 'reasons' }, concerns.map((s) => h('li', { class: 'warn' }, icon('alert-triangle'), h('span', { text: s }))))) : null),
    h('p', { class: 'small faint mb-0' }, 'Schools calculate GPA differently. Use your school’s official GPA on applications; these numbers help you see patterns.'));
}

function courseTable(t, redraw) {
  const save = (mutate) => {
    saveLab((l) => { mutate(l.transcript.courses); }, 'transcript');
    redraw();
  };
  const caption = h('caption', { class: 'visually-hidden' }, 'Your courses. Edit any cell to fix the parsing.');
  const rows = t.courses.map((c, i) => {
    const n = `${c.name}`;
    const name = h('input', { class: 'input input-sm', value: c.name, maxlength: '80', 'aria-label': `Course name, row ${i + 1}` });
    name.addEventListener('change', () => save((cs) => { cs[i].name = name.value.trim() || cs[i].name; cs[i].subject = detectSubject(cs[i].name); }));
    const year = h('input', { class: 'input input-sm', value: c.year ?? '', maxlength: '20', 'aria-label': `Year for ${n}` });
    year.addEventListener('change', () => save((cs) => { cs[i].year = year.value.trim() || null; }));
    const level = h('select', { class: 'select input-sm', 'aria-label': `Level for ${n}` }, LEVELS.map((l) => h('option', { value: l, selected: l === c.level || undefined }, l)));
    level.addEventListener('change', () => save((cs) => { cs[i].level = level.value; }));
    const subject = h('select', { class: 'select input-sm', 'aria-label': `Subject for ${n}` }, SUBJECTS.map((s) => h('option', { value: s, selected: s === c.subject || undefined }, s)));
    subject.addEventListener('change', () => save((cs) => { cs[i].subject = subject.value; }));
    const grade = h('input', { class: 'input input-sm', value: c.grade, maxlength: '20', 'aria-label': `Grade for ${n}` });
    grade.addEventListener('change', () => save((cs) => {
      const gs = grade.value.split('/').map((x) => x.trim()).filter(Boolean);
      const pts = gs.map(gradePoints).filter((p) => p !== null);
      cs[i].grade = gs.join(' / ');
      cs[i].points = pts.length ? Math.round((pts.reduce((a, b) => a + b, 0) / pts.length) * 100) / 100 : null;
    }));
    const credits = h('input', { class: 'input input-sm', type: 'number', min: '0.25', max: '3', step: '0.25', value: c.credits, 'aria-label': `Credits for ${n}` });
    credits.addEventListener('change', () => save((cs) => { cs[i].credits = Math.min(3, Math.max(0.25, Number(credits.value) || 1)); }));
    return h('tr', {},
      h('td', { 'data-label': 'Course' }, name),
      h('td', { 'data-label': 'Year' }, year),
      h('td', { 'data-label': 'Level' }, level),
      h('td', { 'data-label': 'Subject' }, subject),
      h('td', { 'data-label': 'Grade' }, grade),
      h('td', { 'data-label': 'Points', class: 'num', text: c.points === null ? 'n/a' : c.points.toFixed(2) }),
      h('td', { 'data-label': 'Credits' }, credits),
      h('td', { class: 'lab-row-actions' }, h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': `Remove ${n}`, onclick: () => save((cs) => cs.splice(i, 1)) }, icon('x'))));
  });
  const add = h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => {
    save((cs) => cs.push({ name: 'New course', year: t.courses.at(-1)?.year ?? null, level: 'Standard', subject: 'Other', grade: 'A', points: 4, credits: 1 }));
  } }, icon('plus'), 'Add a course');
  return h('section', { class: 'card stack', 'aria-labelledby': 'courses-h' },
    h('div', { class: 'row-between' },
      h('h2', { id: 'courses-h', class: 'h3 mb-0' }, `Courses (${t.courses.length})`),
      h('span', { class: 'small muted' }, 'Fix anything that was read wrong. GPA updates instantly.')),
    h('div', { class: 'lab-table-wrap' },
      h('table', { class: 'lab-table' }, caption,
        h('thead', {}, h('tr', {}, ['Course', 'Year', 'Level', 'Subject', 'Grade', 'Points', 'Credits'].map((c) => h('th', { scope: 'col', text: c })), h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Actions')))),
        h('tbody', {}, rows))),
    add);
}
