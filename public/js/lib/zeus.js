// Zeus chat widget. Answers come from the local predictive engine
// (zeus-engine.js), so nothing leaves the browser. The widget adds the
// conversational feel: a short "thinking" pause, replies that type out,
// tappable follow-up suggestions, and predictive text while you type.

import { h, icon, refreshIcons, clear, toast } from './dom.js';
import { renderMarkdown } from './markdown.js';
import { createEngine } from './zeus-engine.js';
import { getChat, saveChat, clearChat, getChatState, saveChatState, getProfile, getSettings } from './store.js';

function starters(profile) {
  if (profile) {
    return ['Show my top matches', 'What should I do this year?', 'What is due soon?', 'How do I ask for a recommendation letter?'];
  }
  return ['Free summer programs for sophomores', 'Paid internships', 'Scholarships for seniors', 'What can you do?'];
}

const prefersReducedMotion = () =>
  getSettings().reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {HTMLElement} root  container element (gets the full chat UI)
 * @param {{ data: { opportunities: object[], clusters: object, byId: Map }, onOpenOpportunity?: (id: string) => void, closeButton?: HTMLElement }} options
 */
export function mountZeus(root, options) {
  const { data } = options;
  const engine = createEngine({ opportunities: data.opportunities, clusters: data.clusters });
  const ctx = { knownIds: new Set(data.byId.keys()) };
  let history = getChat();
  let state = getChatState();
  let busy = false;
  let lastSuggestions = [];

  const messages = h('div', { class: 'zeus-messages', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions', 'aria-label': 'Conversation with Zeus', tabindex: '0' });
  const input = h('input', {
    type: 'text', placeholder: 'Ask Zeus anything…', 'aria-label': 'Message Zeus', maxlength: '300', autocomplete: 'off',
    role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': 'zeus-predictions',
  });
  const predictions = h('ul', { class: 'zeus-predictions', id: 'zeus-predictions', role: 'listbox', 'aria-label': 'Suggestions', hidden: true });
  const sendBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-icon', 'aria-label': 'Send message' }, icon('arrow-up'));
  const newChatBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Start a new chat', title: 'New chat' }, icon('rotate-ccw'));
  const chips = h('div', { class: 'zeus-chips', role: 'group', 'aria-label': 'Suggested replies' });

  const form = h('form', { class: 'zeus-form' }, h('div', { class: 'zeus-field' }, input, predictions), sendBtn);
  root.classList.add('zeus-dock');
  root.replaceChildren(
    h('div', { class: 'zeus-head' },
      h('div', { class: 'zeus-avatar' }, icon('sparkles')),
      h('div', {},
        h('div', { class: 'title', text: 'Zeus, your pathway guide' }),
        h('div', { class: 'subtitle' }, h('span', { class: 'status-dot online' }), `Searches ${data.opportunities.length} opportunities · private to you`)),
      h('div', { class: 'actions' }, newChatBtn, options.closeButton ?? null)),
    messages,
    h('div', { class: 'zeus-input' },
      chips,
      form,
      h('div', { class: 'zeus-disclaimer', text: 'Zeus suggests programs from our directory. Always confirm details on the official site.' })));

  // ---- rendering ------------------------------------------------------------
  const scrollToEnd = () => { messages.scrollTop = messages.scrollHeight; };

  function welcome() {
    const profile = getProfile();
    const name = profile?.firstName ? `, ${profile.firstName}` : '';
    return h('div', { class: 'zeus-welcome' },
      h('h3', { text: `Hi${name}! I'm Zeus.` }),
      h('p', { class: 'small mb-0', text: 'Tell me what you\'re into (a subject, a grade, free or paid, online or in person) and I\'ll find opportunities that fit. I can also compare programs and help you plan.' }));
  }

  function bubble(role, content) {
    if (role === 'user') return h('div', { class: 'bubble user', text: content });
    const el = h('div', { class: 'bubble assistant' });
    el.append(renderMarkdown(content, ctx));
    return el;
  }

  function renderChips(list) {
    lastSuggestions = list;
    chips.replaceChildren(...list.map((text) => h('button', { type: 'button', class: 'chip chip-sm', onclick: () => ask(text) }, text)));
    chips.hidden = !list.length;
  }

  function renderAll() {
    clear(messages);
    if (!history.length) {
      messages.append(welcome());
      renderChips(starters(getProfile()));
    } else {
      for (const m of history) messages.append(bubble(m.role, m.content));
      renderChips(state.suggestions ?? []);
    }
    refreshIcons();
    scrollToEnd();
  }

  async function typeOut(el, text) {
    if (prefersReducedMotion()) {
      el.replaceChildren(renderMarkdown(text, ctx));
      return;
    }
    const tokens = text.split(/(\s+)/);
    const steps = Math.min(40, Math.max(8, Math.ceil(tokens.length / 6)));
    const per = Math.ceil(tokens.length / steps);
    for (let i = per; i < tokens.length + per; i += per) {
      el.replaceChildren(renderMarkdown(tokens.slice(0, i).join(''), ctx));
      scrollToEnd();
      await wait(22);
    }
  }

  // ---- asking ----------------------------------------------------------------
  async function ask(text) {
    const content = text.trim().slice(0, 300);
    if (!content || busy) return;
    busy = true;
    hidePredictions();
    sendBtn.disabled = true;
    messages.querySelector('.zeus-welcome')?.remove();
    renderChips([]);

    history.push({ role: 'user', content });
    messages.append(bubble('user', content));
    const reply = h('div', { class: 'bubble assistant' }, h('span', { class: 'typing' }, h('span', { class: 'visually-hidden' }, 'Zeus is thinking'), h('span', { 'aria-hidden': 'true' }), h('span', { 'aria-hidden': 'true' }), h('span', { 'aria-hidden': 'true' })));
    messages.append(reply);
    scrollToEnd();

    try {
      const result = engine.reply(content, { profile: getProfile(), state });
      state = { ...result.state, suggestions: result.suggestions };
      if (!prefersReducedMotion()) await wait(250 + Math.min(500, content.length * 6));
      // Hold screen-reader announcements until the reply has finished typing,
      // so it's read once instead of word by word.
      messages.setAttribute('aria-busy', 'true');
      await typeOut(reply, result.text);
      messages.setAttribute('aria-busy', 'false');
      history.push({ role: 'assistant', content: result.text });
      renderChips(result.suggestions);
    } catch (err) {
      console.error(err);
      reply.remove();
      history.pop();
      messages.append(h('div', { class: 'bubble error' }, icon('alert-circle'), h('span', { text: 'Sorry, something went wrong. Try asking another way.' })));
    } finally {
      saveChat(history);
      saveChatState(state);
      busy = false;
      messages.setAttribute('aria-busy', 'false');
      sendBtn.disabled = false;
      refreshIcons();
      scrollToEnd();
    }
  }

  // ---- predictive text ----------------------------------------------------------
  let active = -1;
  let current = [];

  function hidePredictions() {
    predictions.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
    current = [];
  }

  function showPredictions() {
    current = engine.predict(input.value, { profile: getProfile(), state, limit: 5 });
    active = -1;
    if (!current.length) return hidePredictions();
    predictions.replaceChildren(...current.map((text, i) => h('li', {
      id: `zeus-pred-${i}`, role: 'option', 'aria-selected': 'false', class: 'zeus-prediction',
      onmousedown: (e) => { e.preventDefault(); input.value = ''; ask(text); },
    }, icon('corner-down-right'), h('span', { text: text }))));
    predictions.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    refreshIcons();
  }

  function highlight(i) {
    active = (i + current.length) % current.length;
    [...predictions.children].forEach((li, idx) => li.setAttribute('aria-selected', String(idx === active)));
    input.setAttribute('aria-activedescendant', `zeus-pred-${active}`);
  }

  input.addEventListener('input', showPredictions);
  input.addEventListener('blur', () => setTimeout(hidePredictions, 120));
  input.addEventListener('keydown', (e) => {
    if (predictions.hidden || !current.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active - 1); }
    else if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); input.value = current[Math.max(active, 0)]; hidePredictions(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hidePredictions(); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); const text = current[active]; input.value = ''; ask(text); }
  });

  // ---- events ---------------------------------------------------------------------
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = '';
    ask(text);
  });
  newChatBtn.addEventListener('click', () => {
    history = [];
    state = {};
    clearChat();
    renderAll();
    toast('Started a new chat');
  });
  messages.addEventListener('click', (e) => {
    const link = e.target.closest('.opp-link');
    if (!link) return;
    e.preventDefault();
    options.onOpenOpportunity?.(link.dataset.oppId);
  });

  renderAll();

  return {
    ask,
    focus: () => input.focus(),
    get suggestions() { return lastSuggestions; },
  };
}
