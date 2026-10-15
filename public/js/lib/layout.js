// Shared site chrome: header with navigation, accessibility menu, footer.

import { h, icon, refreshIcons, $, toast } from './dom.js';
import { getSettings, saveSettings, getProfile, onStoreChange } from './store.js';

const NAV = [
  { href: '/', label: 'Home', page: 'home' },
  { href: '/dashboard.html', label: 'Explore', page: 'explore' },
  { href: '/profile.html', label: 'My Pathway', page: 'profile' },
  { href: '/tracker.html', label: 'Applications', page: 'tracker' },
  { href: '/college-lab.html', label: 'College Lab', page: 'lab' },
  { href: '/submission.html', label: 'Suggest a Resource', page: 'submit' },
  { href: '/references.html', label: 'About', page: 'about' },
];

export function applySettings(s = getSettings()) {
  const root = document.documentElement;
  if (s.theme === 'light' || s.theme === 'dark') root.setAttribute('data-theme', s.theme);
  else root.removeAttribute('data-theme');
  root.classList.toggle('text-lg', s.textSize === 'lg');
  root.classList.toggle('text-xl', s.textSize === 'xl');
  root.classList.toggle('high-contrast', !!s.highContrast);
  root.classList.toggle('readable-font', !!s.readableFont);
  root.classList.toggle('cvd-palette', !!s.cvdPalette);
  root.classList.toggle('reduce-motion', !!s.reduceMotion);
}

function effectiveTheme() {
  const t = getSettings().theme;
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function buildA11yMenu(close) {
  const s = getSettings();
  const update = (patch) => applySettings(saveSettings(patch));

  const sizeGroup = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Text size' },
    [['md', 'A'], ['lg', 'A+'], ['xl', 'A++']].map(([value, label]) =>
      h('button', {
        type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(s.textSize === value),
        'aria-label': { md: 'Default text size', lg: 'Large text', xl: 'Extra large text' }[value],
        onclick: (e) => {
          update({ textSize: value });
          for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-checked', String(b === e.currentTarget));
        },
      }, label)));

  const themeGroup = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Color theme' },
    [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([value, label]) =>
      h('button', {
        type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(s.theme === value),
        onclick: (e) => {
          update({ theme: value });
          for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-checked', String(b === e.currentTarget));
        },
      }, label)));

  const toggle = (key, label) => h('label', { class: 'switch' },
    h('input', { type: 'checkbox', checked: s[key] || undefined, onchange: (e) => update({ [key]: e.target.checked }) }),
    label);

  return h('div', { class: 'card a11y-menu', id: 'a11y-menu', role: 'dialog', 'aria-label': 'Accessibility and display settings' },
    h('div', { class: 'row-between' },
      h('h3', { class: 'mb-0' }, icon('accessibility'), 'Accessibility'),
      h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-label': 'Close accessibility settings', onclick: close }, icon('x'))),
    h('div', { class: 'field mt-2' }, h('span', { class: 'label' }, 'Text size'), sizeGroup),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Theme'), themeGroup),
    h('div', { class: 'switches' },
      toggle('highContrast', 'High contrast'),
      toggle('readableFont', 'Readable font & spacing'),
      toggle('cvdPalette', 'Color-blind friendly colors'),
      toggle('reduceMotion', 'Reduce motion')),
    h('hr', { class: 'divider' }),
    h('button', { class: 'btn btn-outline btn-block', type: 'button', onclick: readAloud }, icon('volume-2'), 'Read this page aloud'));
}

let speaking = false;
function readAloud() {
  if (!('speechSynthesis' in window)) {
    toast('Read aloud is not supported in this browser.', 'error');
    return;
  }
  if (speaking) {
    window.speechSynthesis.cancel();
    speaking = false;
    return;
  }
  const main = document.getElementById('main');
  const text = (main?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30000);
  const utter = new SpeechSynthesisUtterance(text);
  utter.onend = () => { speaking = false; };
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
  speaking = true;
  toast('Reading aloud. Press the button again to stop.');
}

export function renderLayout(activePage) {
  applySettings();

  // Header
  const nav = h('nav', { class: 'nav', id: 'site-nav', 'aria-label': 'Main' },
    NAV.map((item) => h('a', { href: item.href, 'aria-current': item.page === activePage ? 'page' : undefined }, item.label)));

  let menuEl = null;
  const a11yBtn = h('button', {
    class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Accessibility settings', 'aria-expanded': 'false', 'aria-controls': 'a11y-menu',
  }, icon('accessibility'));
  const closeMenu = () => {
    menuEl?.remove();
    menuEl = null;
    a11yBtn.setAttribute('aria-expanded', 'false');
  };
  a11yBtn.addEventListener('click', () => {
    if (menuEl) return closeMenu();
    menuEl = buildA11yMenu(() => { closeMenu(); a11yBtn.focus(); });
    header.append(menuEl);
    a11yBtn.setAttribute('aria-expanded', 'true');
    refreshIcons();
    menuEl.querySelector('button, input')?.focus();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuEl) { closeMenu(); a11yBtn.focus(); } });
  document.addEventListener('click', (e) => { if (menuEl && !menuEl.contains(e.target) && !a11yBtn.contains(e.target)) closeMenu(); });

  const themeBtn = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Toggle dark mode' }, icon(effectiveTheme() === 'dark' ? 'sun' : 'moon'));
  themeBtn.addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    applySettings(saveSettings({ theme: next }));
    themeBtn.replaceChildren(icon(next === 'dark' ? 'sun' : 'moon'));
    refreshIcons();
  });

  const menuToggle = h('button', { class: 'btn btn-ghost btn-icon menu-toggle', type: 'button', 'aria-label': 'Open menu', 'aria-expanded': 'false', 'aria-controls': 'site-nav' }, icon('menu'));
  menuToggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(open));
  });

  const ctaLabel = h('span', { class: 'btn-label' });
  const cta = h('a', { class: 'btn btn-primary btn-sm', href: '/profile.html' }, icon('compass'), ctaLabel);
  const setCta = () => {
    const p = getProfile();
    ctaLabel.textContent = p ? (p.firstName ? `Hi, ${p.firstName}` : 'My Pathway') : 'Find my pathway';
    cta.setAttribute('aria-label', ctaLabel.textContent); // the label text is hidden on small screens
    cta.href = p ? '/profile.html' : '/?wizard=1';
  };
  setCta();
  onStoreChange((what) => { if (what === 'profile') setCta(); });

  const header = h('header', { class: 'site-header' },
    h('div', { class: 'container' },
      h('a', { class: 'brand', href: '/', 'aria-label': 'Student Atlas home' },
        h('span', { class: 'brand-mark' }, icon('compass')), 'Student Atlas'),
      nav,
      h('div', { class: 'header-actions' }, themeBtn, a11yBtn, cta, menuToggle)));

  const skip = h('a', { class: 'skip-link', href: '#main' }, 'Skip to main content');
  document.body.prepend(skip, header);

  // Footer
  const year = new Date().getFullYear();
  const footer = h('footer', { class: 'site-footer' },
    h('div', { class: 'container' },
      h('div', {},
        h('a', { class: 'brand', href: '/' }, h('span', { class: 'brand-mark' }, icon('compass')), 'Student Atlas'),
        h('p', { class: 'muted small mt-2' }, 'A free, personalized map of opportunities for high school students: research, internships, competitions, scholarships, service, and more.'),
        h('p', { class: 'faint small mb-0' }, 'Program details change every year. Always confirm dates and eligibility on the official website.')),
      h('div', {},
        h('h4', {}, 'Explore'),
        h('ul', {},
          h('li', {}, h('a', { href: '/dashboard.html' }, 'Opportunity directory')),
          h('li', {}, h('a', { href: '/?wizard=1' }, 'Pathway Wizard')),
          h('li', {}, h('a', { href: '/profile.html' }, 'My Pathway')),
          h('li', {}, h('a', { href: '/tracker.html' }, 'Application tracker')),
          h('li', {}, h('a', { href: '/tracker.html#calendar' }, 'Calendar')),
          h('li', {}, h('a', { href: '/college-lab.html' }, 'College Lab')))),
      h('div', {},
        h('h4', {}, 'Project'),
        h('ul', {},
          h('li', {}, h('a', { href: '/submission.html' }, 'Suggest a resource')),
          h('li', {}, h('a', { href: '/references.html' }, 'About & sources')),
          h('li', {}, h('a', { href: '/references.html#privacy' }, 'Privacy'))))),
    h('div', { class: 'footer-bottom' },
      h('div', { class: 'container row-between small faint' },
        h('span', {}, `© ${year} Student Atlas`),
        h('span', {}, 'Built for students, by students.'))));
  document.body.append(footer);

  refreshIcons();
}

/** Mounts a page module once the DOM is ready. */
export function boot(page, init) {
  const run = async () => {
    renderLayout(page);
    try {
      await init();
    } catch (err) {
      console.error(err);
      const main = $('#main');
      main?.prepend(h('div', { class: 'container mt-3' },
        h('div', { class: 'bubble error' }, icon('alert-circle'), h('span', { text: 'Something went wrong loading this page. Please refresh to try again.' }))));
    }
    refreshIcons();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
}
