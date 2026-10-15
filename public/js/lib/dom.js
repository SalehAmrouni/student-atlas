// Small DOM toolkit. Everything is built with createElement/textContent so
// user-provided strings are never parsed as HTML.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Lucide icon placeholder; call refreshIcons() after inserting into the DOM. */
export function icon(name, cls) {
  return h('i', { 'data-lucide': name, class: cls, 'aria-hidden': 'true' });
}

let iconFrame = 0;
export function refreshIcons() {
  if (iconFrame) return;
  iconFrame = requestAnimationFrame(() => {
    iconFrame = 0;
    window.lucide?.createIcons({ attrs: { 'aria-hidden': 'true' } });
  });
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Only allow http(s) links to leave the site. */
export function safeExternalUrl(url) {
  try {
    const u = new URL(url, window.location.origin);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

export function externalLink(url, children, cls) {
  const href = safeExternalUrl(url);
  if (!href) return h('span', { class: cls }, children);
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: cls }, children);
}

// ---- Toasts ---------------------------------------------------------------
let toastRegion;
export function toast(message, type = 'info') {
  if (!toastRegion) {
    toastRegion = h('div', { class: 'toast-region', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastRegion);
  }
  const iconName = type === 'success' ? 'check-circle-2' : type === 'error' ? 'alert-circle' : 'info';
  const el = h('div', { class: `toast ${type}` }, icon(iconName), h('span', { text: message }));
  toastRegion.append(el);
  refreshIcons();
  setTimeout(() => el.remove(), 3800);
}

// ---- Modals ---------------------------------------------------------------
const openModals = [];

/**
 * Opens an accessible modal dialog. `build(close)` returns the dialog contents.
 * Focus is trapped inside, Escape and backdrop clicks close it, and focus
 * returns to the previously focused element afterwards.
 */
export function openModal({ labelledBy, wide = false, build, onClose }) {
  const previouslyFocused = document.activeElement;
  const backdrop = h('div', { class: 'modal-backdrop' });
  const dialog = h('div', { class: `modal${wide ? ' modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledBy, tabindex: '-1' });
  backdrop.append(dialog);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    openModals.splice(openModals.indexOf(close), 1);
    if (!openModals.length) document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
  };

  const onKey = (e) => {
    if (openModals.at(-1) !== close) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const focusables = $$('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])', dialog)
        .filter((el) => el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey, true);
  append(dialog, [build(close)]);
  document.body.append(backdrop);
  document.body.style.overflow = 'hidden';
  openModals.push(close);
  refreshIcons();
  const autofocus = dialog.querySelector('[autofocus]');
  (autofocus || dialog).focus();
  return { close, dialog };
}

export function modalHeader(id, title, subtitle, close) {
  return h('div', { class: 'modal-header' },
    h('div', {},
      h('h2', { id, class: 'mb-0', text: title }),
      subtitle ? h('p', { class: 'muted small mb-0 mt-1', text: subtitle }) : null),
    h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x')));
}

/** Saves generated text (JSON, .ics) as a file download. */
export function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function pluralize(n, word, plural = `${word}s`) {
  return `${n} ${n === 1 ? word : plural}`;
}
