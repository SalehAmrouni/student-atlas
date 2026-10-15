// Accessible carousel (WAI-ARIA APG carousel pattern) built on a CSS
// scroll-snap track, so touch users swipe natively, keyboard users Tab
// through the cards (each one scrolls into view), and the Previous/Next
// buttons page through whatever fits on screen. It never auto-advances.

import { h, icon, refreshIcons, debounce } from './dom.js';
import { getSettings } from './store.js';

let uid = 0;

const reducedMotion = () =>
  getSettings().reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {{ labelledBy: string, itemsLabel?: string, slides: HTMLElement[] }} options
 * @returns {{ root: HTMLElement, controls: HTMLElement }} `root` is the
 *   carousel region; `controls` (buttons + position) can be placed anywhere,
 *   for example next to the section heading.
 */
export function createCarousel({ labelledBy, itemsLabel = 'opportunities', slides }) {
  const id = `carousel-${++uid}`;
  const total = slides.length;

  const track = h('div', { class: 'carousel-track', id: `${id}-track` },
    slides.map((slide, i) => h('div', {
      class: 'carousel-slide', role: 'group', 'aria-roledescription': 'slide', 'aria-label': `${i + 1} of ${total}`,
    }, slide)));

  const status = h('span', { class: 'carousel-status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const button = (dir, label, iconName) => h('button', {
    type: 'button', class: 'btn btn-outline btn-icon', 'aria-controls': track.id, 'aria-label': label,
    onclick: (e) => {
      if (e.currentTarget.getAttribute('aria-disabled') === 'true') return;
      track.scrollBy({ left: dir * track.clientWidth, behavior: reducedMotion() ? 'auto' : 'smooth' });
    },
  }, icon(iconName));
  // aria-disabled (not disabled) so focus isn't dropped when an end is reached.
  const prev = button(-1, `Previous ${itemsLabel}`, 'chevron-left');
  const next = button(1, `Next ${itemsLabel}`, 'chevron-right');

  const root = h('div', { class: 'carousel', role: 'region', 'aria-roledescription': 'carousel', 'aria-labelledby': labelledBy }, track);
  const controls = h('div', { class: 'carousel-controls' }, status, prev, next);

  function paint() {
    const first = track.firstElementChild;
    if (!first) return;
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    const step = first.getBoundingClientRect().width + gap;
    const perPage = Math.max(1, Math.round((track.clientWidth + gap) / step));
    const start = Math.min(total - 1, Math.round(track.scrollLeft / step));
    const end = Math.min(total, start + perPage);
    status.textContent = total <= perPage ? `${total} of ${total}` : `${start + 1}${end > start + 1 ? `–${end}` : ''} of ${total}`;
    const atStart = track.scrollLeft <= 1;
    const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
    prev.setAttribute('aria-disabled', String(atStart));
    next.setAttribute('aria-disabled', String(atEnd));
    controls.hidden = total <= perPage && atStart && atEnd;
  }

  track.addEventListener('scroll', debounce(paint, 80), { passive: true });
  new ResizeObserver(debounce(paint, 80)).observe(track);
  requestAnimationFrame(paint);
  refreshIcons();
  return { root, controls };
}
