// Shared College Lab UI helpers.

import { h, icon, openModal, modalHeader } from '../lib/dom.js';
import { getLab, saveLab } from '../lib/lab-store.js';
import { getProfile } from '../lib/store.js';

let fieldSeq = 0;
export const fid = (name) => `lab-${name}-${++fieldSeq}`;

/** Labeled form field; `control` gets the generated id. */
export function field(label, control, hint) {
  const id = control.id || fid('f');
  control.id = id;
  const hintId = hint ? `${id}-hint` : null;
  if (hintId) control.setAttribute('aria-describedby', hintId);
  return h('div', { class: 'field' },
    h('label', { class: 'label', for: id }, label),
    control,
    hint ? h('span', { class: 'hint', id: hintId }, hint) : null);
}

/** Score out of 100 as a labelled meter. */
export function scoreMeter(score, label = 'Score') {
  const value = Number.isFinite(score) ? score : 0;
  const tone = value >= 75 ? 'high' : value >= 55 ? 'mid' : 'low';
  return h('div', { class: `lab-meter ${tone}`, role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(value), 'aria-label': `${label}: ${value} out of 100` },
    h('strong', { text: Number.isFinite(score) ? String(score) : '–' }),
    h('span', { text: '/100' }));
}

/** Horizontal bar for 0–5 or 0–100 values with text equivalent. */
export function barRow(label, value, max, detail) {
  const pct = value === null || value === undefined ? 0 : Math.round((value / max) * 100);
  const fill = h('div', { class: 'lab-bar-fill' });
  requestAnimationFrame(() => { fill.style.width = `${pct}%`; });
  return h('div', { class: 'lab-bar-row' },
    h('div', { class: 'lab-bar-label' }, h('span', { text: label }), h('strong', { text: value === null || value === undefined ? '–' : `${value}/${max}` })),
    h('div', { class: 'lab-bar-track', role: 'img', 'aria-label': `${label}: ${value ?? 'not scored'}${value === null || value === undefined ? '' : ` out of ${max}`}` }, fill),
    detail ? h('p', { class: 'small muted mb-0', text: detail }) : null);
}

export function sourceBadge(source) {
  return source === 'ai'
    ? h('span', { class: 'badge badge-ai' }, icon('sparkles'), 'Claude feedback')
    : h('span', { class: 'badge badge-info' }, icon('cpu'), 'On-device check');
}

/**
 * Decides whether to send work to the AI endpoint. Asks once (and remembers),
 * because essays and transcripts are personal and the student should choose.
 */
export function useAi(ai) {
  if (!ai) return Promise.resolve(false);
  const choice = getLab().aiConsent;
  if (choice === true || choice === false) return Promise.resolve(choice);
  return new Promise((resolve) => {
    let decided = false;
    const decide = (yes, close) => {
      decided = true;
      saveLab((lab) => { lab.aiConsent = yes; }, 'consent');
      close();
      resolve(yes);
    };
    openModal({
      labelledBy: 'ai-consent-title',
      onClose: () => { if (!decided) resolve(false); },
      build: (close) => [
        modalHeader('ai-consent-title', 'Use AI feedback?', 'You can change this anytime in Privacy & AI.', close),
        h('div', { class: 'modal-body stack' },
        h('p', {}, 'College Lab can send what you submit (an essay, transcript text, or your mentor question with your stats) to Claude, an AI model made by Anthropic, for more detailed feedback.'),
        h('ul', { class: 'reasons' },
          h('li', { class: 'good' }, icon('check-circle-2'), 'Student Atlas does not store or log what you send.'),
          h('li', { class: 'good' }, icon('check-circle-2'), 'Leave out your full name, student ID, and address.'),
          h('li', { class: 'warn' }, icon('info'), 'If you are under 13, or your school or family prefers it, choose on-device feedback.')),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn btn-primary', autofocus: true, onclick: () => decide(true, close) }, icon('sparkles'), 'Use AI feedback'),
          h('button', { type: 'button', class: 'btn btn-outline', onclick: () => decide(false, close) }, icon('cpu'), 'Keep it on my device')))],
    });
  });
}

/** The student's lab stats merged with the main Student Atlas profile. */
export function mergedStats() {
  const lab = getLab();
  const p = getProfile();
  const s = lab.stats;
  return {
    ...s,
    firstName: p?.firstName,
    grade: s.grade ?? p?.grade ?? null,
    gpa: s.gpa ?? p?.gpa ?? null,
    financialNeed: p?.financialNeed,
    interests: p?.interests,
  };
}

/** Compact stats for the mentor prompt (no free text beyond what the student typed). */
export function mentorStats(transcriptSummary) {
  const s = mergedStats();
  const lab = getLab();
  const num = (v, lo = 0, hi = 10000, int = false) => {
    const n = Number(v);
    if (v === null || v === undefined || v === '' || !Number.isFinite(n) || n < lo || n > hi) return null;
    return int ? Math.round(n) : n;
  };
  return {
    firstName: s.firstName,
    grade: num(s.grade, 6, 13, true),
    gpa: num(s.gpa, 0, 5),
    weightedGpa: num(s.weightedGpa, 0, 6),
    sat: num(s.sat, 400, 1600, true),
    act: num(s.act, 1, 36, true),
    majors: s.majors?.slice(0, 200) || undefined,
    financialNeed: s.financialNeed,
    interests: s.interests,
    activities: (s.activities ?? []).filter((a) => a.name).slice(0, 15).map((a) => ({ name: a.name.slice(0, 80), role: a.role?.slice(0, 80) || undefined, hoursPerWeek: num(a.hoursPerWeek, 0, 80), weeksPerYear: num(a.weeksPerYear, 0, 52), leadership: !!a.leadership })),
    awards: (s.awards ?? []).filter((a) => a.name).slice(0, 10).map((a) => ({ name: a.name.slice(0, 100), level: a.level })),
    colleges: (s.colleges ?? []).filter((c) => c.name).slice(0, 30).map((c) => ({ name: c.name.slice(0, 100), category: c.category, plan: c.plan, deadline: c.deadline || undefined })),
    transcriptSummary: transcriptSummary?.slice(0, 2000),
    essaySummary: lab.essays.filter((e) => e.lastScore).slice(0, 5).map((e) => `${e.title || 'Untitled'}: ${e.lastScore}/100`).join('; ') || undefined,
  };
}
