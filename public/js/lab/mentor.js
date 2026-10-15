// Mentor: a counselor-style chat that knows the student's stats, transcript,
// and essay scores. Uses Claude when allowed, otherwise the on-device mentor.

import { h, icon, refreshIcons } from '../lib/dom.js';
import { renderMarkdown } from '../lib/markdown.js';
import { getLab, saveLab } from '../lib/lab-store.js';
import { mentorReply, computeGpa, transcriptInsights, CRISIS, CRISIS_REPLY } from '../lib/lab-engine.js';
import { callLabAi } from '../lib/lab-api.js';
import { getProfile } from '../lib/store.js';
import { useAi, mergedStats, mentorStats } from './common.js';

const STARTERS = ['Review my stats', 'What should I do this year?', 'Break down my transcript', 'Help with my essay', 'How can I pay for college?', 'Is my college list balanced?'];

function transcriptSummary(t) {
  if (!t?.courses?.length) return undefined;
  const g = computeGpa(t.courses);
  const ins = transcriptInsights(t.courses, {});
  const years = g.byYear.map((y) => `${y.year}: ${y.gpa?.toFixed(2)}`).join(', ');
  return [
    `${g.courseCount} courses; unweighted ${g.unweighted?.toFixed(2)}, weighted ${g.weighted?.toFixed(2)}, core ${g.core?.toFixed(2)}.`,
    `Rigor: ${g.rigor.ap} AP, ${g.rigor.ib} IB, ${g.rigor.dual} dual enrollment, ${g.rigor.honors} honors.`,
    years ? `By year: ${years}.` : '',
    `Subjects: ${g.bySubject.map((s) => `${s.subject} ${s.gpa?.toFixed(2) ?? 'n/a'}`).join(', ')}.`,
    t.summary || '',
    ins.concerns.length ? `Concerns: ${ins.concerns.join(' ')}` : '',
  ].filter(Boolean).join(' ');
}

export function renderMentor(root, { ai }) {
  const log = h('div', { class: 'lab-chat-log', tabindex: '0', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions', 'aria-label': 'Conversation with your mentor' });
  const chips = h('div', { class: 'lab-chips', role: 'group', 'aria-label': 'Suggested questions' });
  const input = h('textarea', { class: 'textarea lab-chat-input', rows: '2', maxlength: '2000', placeholder: 'Ask about your stats, classes, essays, college list, or paying for college…', 'aria-label': 'Message your mentor' });
  const send = h('button', { type: 'submit', class: 'btn btn-primary', 'aria-label': 'Send message' }, icon('send'), h('span', { class: 'btn-label' }, 'Send'));
  const form = h('form', { class: 'lab-chat-form' }, input, send);
  let busy = false;

  const bubble = (m) => {
    const el = h('div', { class: `bubble ${m.role}` });
    if (m.role === 'assistant') {
      el.append(h('span', { class: 'visually-hidden', text: 'Mentor: ' }), renderMarkdown(m.content));
      if (m.source === 'ai') el.append(h('span', { class: 'lab-bubble-tag' }, icon('sparkles'), 'Claude'));
    } else {
      el.append(h('span', { class: 'visually-hidden', text: 'You: ' }), m.content);
    }
    return el;
  };

  function setChips(list) {
    chips.replaceChildren(...list.map((s) => h('button', { type: 'button', class: 'chip chip-sm', onclick: () => ask(s) }, s)));
  }

  function drawAll() {
    const chat = getLab().chat;
    const p = getProfile();
    log.replaceChildren(
      h('div', { class: 'lab-chat-welcome' },
        h('div', { class: 'zeus-avatar', 'aria-hidden': 'true' }, icon('graduation-cap')),
        h('div', {},
          h('h2', { class: 'h3 mb-0', text: `Hi${p?.firstName ? ` ${p.firstName}` : ''}, I’m your College Lab mentor` }),
          h('p', { class: 'small muted mb-0', text: 'I use your stats, transcript, and essay scores to give advice that fits you. I can’t predict admissions decisions, and your school counselor is still a great person to talk to.' }))),
      ...chat.map(bubble));
    setChips(chat.length ? ['What should I do this year?', 'Review my stats', 'How can I pay for college?'] : STARTERS);
    refreshIcons();
    log.scrollTop = log.scrollHeight;
  }

  async function ask(text) {
    const q = String(text ?? '').trim();
    if (!q || busy) return;
    busy = true;
    send.disabled = true;
    input.value = '';
    saveLab((l) => { l.chat.push({ role: 'user', content: q.slice(0, 2000) }); }, 'chat');
    log.append(bubble({ role: 'user', content: q }));
    const typing = h('div', { class: 'bubble assistant typing-bubble' }, h('span', { class: 'visually-hidden', text: 'Mentor is typing' }), h('span', { class: 'typing', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')));
    log.append(typing);
    log.scrollTop = log.scrollHeight;

    const lab = getLab();
    let answer = null;
    let notice = '';
    try {
      if (!CRISIS.test(q) && await useAi(ai)) {
        try {
          const r = await callLabAi({
            task: 'mentor',
            messages: lab.chat.slice(-20).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) })),
            stats: mentorStats(transcriptSummary(lab.transcript)),
          });
          answer = { reply: String(r.reply ?? '').slice(0, 6000), suggestions: (r.suggestions ?? []).map(String).slice(0, 3), source: 'ai' };
        } catch (err) {
          notice = err?.code === 'rate_limited' ? 'AI answers are busy right now, so this one comes from the on-device mentor.' : 'Couldn’t reach AI answers, so this one comes from the on-device mentor.';
        }
      }
      if (!answer) {
        const local = CRISIS.test(q) ? { reply: CRISIS_REPLY, suggestions: [] } : mentorReply(q, { stats: mergedStats(), transcript: lab.transcript, essays: lab.essays, profile: getProfile() });
        answer = { ...local, source: 'local' };
      }
      typing.remove();
      if (notice) log.append(h('div', { class: 'bubble notice', text: notice }));
      const msg = { role: 'assistant', content: answer.reply || 'I’m not sure about that one. Try asking about your stats, classes, essays, or college list.', source: answer.source };
      saveLab((l) => { l.chat.push(msg); }, 'chat');
      log.append(bubble(msg));
      setChips(answer.suggestions?.length ? answer.suggestions : ['What should I do this year?', 'Review my stats']);
      refreshIcons();
      log.scrollTop = log.scrollHeight;
    } finally {
      busy = false;
      send.disabled = false;
      input.focus();
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(input.value); }
  });

  const clearBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => {
    if (!confirm('Clear your conversation with the mentor?')) return;
    saveLab((l) => { l.chat = []; }, 'chat');
    drawAll();
    input.focus();
  } }, icon('rotate-ccw'), 'New conversation');

  root.append(h('section', { class: 'card lab-chat', 'aria-labelledby': 'mentor-h' },
    h('div', { class: 'row-between lab-chat-head' },
      h('h2', { id: 'mentor-h', class: 'h3 mb-0' }, icon('messages-square'), 'Mentor'),
      clearBtn),
    log,
    h('div', { class: 'lab-chat-input-wrap' }, chips, form,
      h('p', { class: 'small faint mb-0', text: 'Press Enter to send, Shift+Enter for a new line. Confirm dates and policies on official college sites.' }))));
  drawAll();
}
