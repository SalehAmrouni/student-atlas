// The picture password pad: a grid of pictures to tap (or pick with the
// keyboard) in order. Used to set a picture password and to sign in with one.
//
// Accessibility
//   - Each picture is a real button named by its word ("Rocket"); the emoji is
//     decoration, so screen readers say the word and it matches what's on screen.
//   - One tab stop for the whole grid (roving tabindex); arrow keys, Home and
//     End move around it, Enter or Space picks, Backspace undoes.
//   - A status line announces each pick. When signing in, picks are hidden as
//     dots (like a password) unless the student presses "Show pictures".

import { h, icon, refreshIcons } from './dom.js';
import { PICTURES, PICTURE_LENGTH } from './pictures.js';

let seq = 0;

/**
 * @param {object} opts
 * @param {string} opts.label         the group's visible label
 * @param {boolean} [opts.hidden]     show picks as dots until "Show pictures" is pressed
 * @param {(picks: number[]) => void} [opts.onChange]
 * @param {(picks: number[]) => void} [opts.onComplete] called once all pictures are picked
 */
export function picturePad({ label, hidden = false, onChange, onComplete } = {}) {
  const id = `pics-${++seq}`;
  let picks = [];
  let reveal = !hidden;

  const status = h('p', { class: 'picture-status small', role: 'status', 'aria-live': 'polite', id: `${id}-status` });
  const slots = h('div', { class: 'picture-slots', 'aria-hidden': 'true' });
  const buttons = PICTURES.map((p, i) => h('button', {
    type: 'button', class: 'picture-option', tabindex: i === 0 ? '0' : '-1', dataset: { index: String(i) },
  }, h('span', { class: 'picture-emoji', 'aria-hidden': 'true', text: p.emoji }), h('span', { class: 'picture-name', text: p.name })));
  const grid = h('div', { class: 'picture-grid', role: 'group', 'aria-labelledby': `${id}-label`, 'aria-describedby': `${id}-help` }, buttons);

  const undoBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, icon('undo-2'), 'Undo');
  const clearBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, icon('rotate-ccw'), 'Start over');
  const revealBtn = hidden
    ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-pressed': 'false' }, icon('eye'), 'Show pictures')
    : null;

  const describe = (i) => PICTURES[i].name;
  function draw(announce) {
    slots.replaceChildren(...Array.from({ length: PICTURE_LENGTH }, (_, n) => {
      const pick = picks[n];
      const filled = pick !== undefined;
      return h('span', { class: `picture-slot${filled ? ' filled' : ''}${n === picks.length ? ' next' : ''}` },
        h('span', { class: 'picture-slot-num', text: String(n + 1) }),
        filled ? (reveal ? h('span', { class: 'picture-emoji', text: PICTURES[pick].emoji }) : h('span', { class: 'picture-dot' })) : null);
    }));
    const done = picks.length === PICTURE_LENGTH;
    for (const b of buttons) b.setAttribute('aria-disabled', String(done));
    grid.classList.toggle('full', done);
    undoBtn.disabled = !picks.length;
    clearBtn.disabled = !picks.length;
    if (announce !== undefined) status.textContent = announce;
  }

  function pick(i) {
    if (picks.length >= PICTURE_LENGTH) {
      draw(`You’ve picked all ${PICTURE_LENGTH}. Use Undo to change one.`);
      return;
    }
    picks.push(i);
    const n = picks.length;
    const done = n === PICTURE_LENGTH;
    draw(`Picked ${n} of ${PICTURE_LENGTH}${reveal ? `: ${describe(i)}` : ''}.${done ? ' All done.' : ''}`);
    onChange?.([...picks]);
    if (done) onComplete?.([...picks]);
  }
  function undo() {
    if (!picks.length) return;
    picks.pop();
    draw(`Removed the last picture. ${picks.length} of ${PICTURE_LENGTH} picked.`);
    onChange?.([...picks]);
  }

  // Roving focus: the grid wraps to however many columns fit, so count them.
  const columns = () => {
    const top = buttons[0].offsetTop;
    const n = buttons.findIndex((b) => b.offsetTop !== top);
    return n > 0 ? n : buttons.length;
  };
  const focusAt = (i) => {
    const next = Math.max(0, Math.min(buttons.length - 1, i));
    for (const b of buttons) b.tabIndex = -1;
    buttons[next].tabIndex = 0;
    buttons[next].focus();
  };
  grid.addEventListener('keydown', (e) => {
    const current = buttons.indexOf(document.activeElement);
    if (current === -1) return;
    const cols = columns();
    const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
    if (e.key in moves) {
      const target = current + moves[e.key];
      if (target >= 0 && target < buttons.length) focusAt(target);
    } else if (e.key === 'Home') {
      focusAt(0);
    } else if (e.key === 'End') {
      focusAt(buttons.length - 1);
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      undo();
    } else {
      return;
    }
    e.preventDefault();
  });
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('.picture-option');
    if (!b) return;
    for (const other of buttons) other.tabIndex = -1;
    b.tabIndex = 0;
    pick(Number(b.dataset.index));
  });
  undoBtn.addEventListener('click', undo);
  clearBtn.addEventListener('click', () => {
    picks = [];
    draw(`Cleared. Pick ${PICTURE_LENGTH} pictures.`);
    onChange?.([]);
    focusAt(0);
  });
  revealBtn?.addEventListener('click', () => {
    reveal = !reveal;
    revealBtn.setAttribute('aria-pressed', String(reveal));
    revealBtn.replaceChildren(icon(reveal ? 'eye-off' : 'eye'), reveal ? 'Hide pictures' : 'Show pictures');
    refreshIcons();
    draw(reveal && picks.length ? `Your pictures: ${picks.map(describe).join(', ')}.` : '');
  });

  const el = h('div', { class: 'picture-pad' },
    h('div', { class: 'picture-head' },
      h('span', { class: 'label', id: `${id}-label`, text: label }),
      slots),
    h('p', { class: 'hint mb-0', id: `${id}-help` }, `Pick ${PICTURE_LENGTH} pictures in order. Arrow keys move, Enter picks, Backspace undoes.`),
    grid,
    status,
    h('div', { class: 'row picture-actions' }, undoBtn, clearBtn, revealBtn));
  draw();

  return {
    el,
    value: () => [...picks],
    complete: () => picks.length === PICTURE_LENGTH,
    reset(message = '') {
      picks = [];
      draw(message);
    },
    focus: () => focusAt(Math.max(0, buttons.findIndex((b) => b.tabIndex === 0))),
  };
}

/** The pictures as words, for showing a student the password they just chose. */
export const pictureWords = (picks) => picks.map((i) => `${PICTURES[i].emoji} ${PICTURES[i].name}`);
