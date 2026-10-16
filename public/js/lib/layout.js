// Shared site chrome: header with navigation, accessibility menu, footer.

import { h, icon, refreshIcons, $, toast } from './dom.js';
import { getSettings, saveSettings, getProfile, getAccount, onStoreChange } from './store.js';
import { startSync, accountStatus } from './account.js';
import { confettiOnApplied } from './celebrate.js';

// No Home link: the Student Atlas logo goes to the homepage.
const NAV = [
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

  // Toggle buttons in a labelled group: one is pressed at a time. (role="radio"
  // would promise arrow-key navigation these buttons don't implement.)
  // `hints` add hidden words after the visible text, so the accessible name
  // still starts with what's on screen (WCAG 2.5.3 Label in Name).
  const choiceGroup = (label, key, options, hints = {}) => h('div', { class: 'segmented', role: 'group', 'aria-label': label },
    options.map(([value, text]) =>
      h('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(s[key] === value),
        onclick: (e) => {
          update({ [key]: value });
          for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
        },
      }, text, hints[value] ? h('span', { class: 'visually-hidden' }, ` ${hints[value]}`) : null)));
  const sizeGroup = choiceGroup('Text size', 'textSize', [['md', 'A'], ['lg', 'A+'], ['xl', 'A++']],
    { md: '(default size)', lg: '(large)', xl: '(extra large)' });
  const themeGroup = choiceGroup('Color theme', 'theme', [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]);

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
    h('button', { class: 'btn btn-outline btn-block', type: 'button', onclick: readAloud }, icon('volume-2'), 'Read this page aloud'),
    h('p', { class: 'small mt-2 mb-0' }, h('a', { href: '/references.html#accessibility' }, 'Accessibility statement and feedback')));
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
  const navCta = h('a', { class: 'nav-extra', href: '/?wizard=1' }, 'Find my pathway');
  // Signed-in students land on My Pathway, so the logo adds ?home=1 to reach the homepage on purpose.
  const homeHref = () => (getAccount() ? '/?home=1' : '/');
  const navLinks = NAV.map((item) => h('a', { href: item.href, 'aria-current': item.page === activePage ? 'page' : undefined }, item.label));
  const nav = h('nav', { class: 'nav', id: 'site-nav', 'aria-label': 'Main' }, navLinks, navCta);

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
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (menuEl) { closeMenu(); a11yBtn.focus(); }
    if (nav.classList.contains('open')) { setNavOpen(false); menuToggle.focus(); }
  });
  document.addEventListener('click', (e) => {
    if (menuEl && !menuEl.contains(e.target) && !a11yBtn.contains(e.target)) closeMenu();
    if (nav.classList.contains('open') && !nav.contains(e.target) && !menuToggle.contains(e.target)) setNavOpen(false);
  });

  const themeBtn = h('button', { class: 'btn btn-ghost btn-icon theme-toggle', type: 'button', 'aria-label': 'Dark mode', 'aria-pressed': String(effectiveTheme() === 'dark') }, icon(effectiveTheme() === 'dark' ? 'sun' : 'moon'));
  themeBtn.addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    applySettings(saveSettings({ theme: next }));
    themeBtn.replaceChildren(icon(next === 'dark' ? 'sun' : 'moon'));
    themeBtn.setAttribute('aria-pressed', String(next === 'dark'));
    refreshIcons();
  });

  const menuToggle = h('button', { class: 'btn btn-ghost btn-icon menu-toggle', type: 'button', 'aria-label': 'Open menu', 'aria-expanded': 'false', 'aria-controls': 'site-nav' }, icon('menu'));
  const setNavOpen = (open) => {
    nav.classList.toggle('open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menuToggle.replaceChildren(icon(open ? 'x' : 'menu'));
    refreshIcons();
  };
  menuToggle.addEventListener('click', () => setNavOpen(!nav.classList.contains('open')));
  // Close the drawer if the window grows past the mobile breakpoint.
  window.matchMedia('(max-width: 1200px)').addEventListener('change', (e) => { if (!e.matches) setNavOpen(false); });

  const ctaLabel = h('span', { class: 'btn-label' });
  const ctaIcon = h('span', { class: 'cta-icon', 'aria-hidden': 'true' });
  const cta = h('a', { class: 'btn btn-primary btn-sm header-cta', href: '/profile.html' }, ctaIcon, ctaLabel);
  // The "Clear Computer" rule: a Log Out button that's always visible for signed-in students.
  const logoutBtn = h('button', { type: 'button', class: 'btn btn-outline btn-sm header-logout', 'aria-label': 'Log out' }, icon('log-out'), h('span', { class: 'btn-label' }, 'Log out'));
  const signInLink = h('a', { class: 'btn btn-outline btn-sm header-logout', href: '/signin.html', 'aria-label': 'Sign in' }, icon('log-in'), h('span', { class: 'btn-label' }, 'Sign in'));
  logoutBtn.addEventListener('click', async () => (await import('./account-ui.js')).confirmLogOut());
  const setCta = () => {
    const p = getProfile();
    const account = getAccount();
    ctaLabel.textContent = account ? account.username : p ? (p.firstName ? `Hi, ${p.firstName}` : 'My Pathway') : 'Find my pathway';
    ctaIcon.replaceChildren(account?.emoji ? document.createTextNode(account.emoji) : icon('compass'));
    cta.setAttribute('aria-label', account ? `My Pathway, signed in as ${account.username}` : ctaLabel.textContent); // the label text is hidden on small screens
    cta.href = p || account ? '/profile.html' : '/?wizard=1';
    navCta.hidden = !!(p || account);
    logoutBtn.hidden = !account;
    signInLink.hidden = !!account || activePage === 'signin';
    brand.href = homeHref();
    refreshIcons();
  };
  onStoreChange((what) => { if (what === 'profile' || what === 'account') setCta(); });

  const brand = h('a', { class: 'brand', href: '/', 'aria-label': 'Student Atlas home' },
    h('span', { class: 'brand-mark' }, icon('compass')), 'Student Atlas');
  const header = h('header', { class: 'site-header' },
    h('div', { class: 'container' },
      brand,
      nav,
      h('div', { class: 'header-actions' }, themeBtn, a11yBtn, cta, logoutBtn, signInLink, menuToggle)));
  setCta();

  const skip = h('a', { class: 'skip-link', href: '#main' }, 'Skip to main content');
  document.body.prepend(skip, header);

  // Footer
  const year = new Date().getFullYear();
  const footer = h('footer', { class: 'site-footer' },
    h('div', { class: 'container' },
      h('div', {},
        h('a', { class: 'brand', href: homeHref() }, h('span', { class: 'brand-mark' }, icon('compass')), 'Student Atlas'),
        h('p', { class: 'muted small mt-2' }, 'A free, personalized map of opportunities for high school students: research, internships, competitions, scholarships, service, and more.'),
        h('p', { class: 'faint small mb-0' }, 'Program details change every year. Always confirm dates and eligibility on the official website.')),
      h('div', {},
        h('h2', { class: 'footer-heading' }, 'Explore'),
        h('ul', {},
          h('li', {}, h('a', { href: '/dashboard.html' }, 'Opportunity directory')),
          h('li', {}, h('a', { href: '/?wizard=1' }, 'Pathway Wizard')),
          h('li', {}, h('a', { href: '/profile.html' }, 'My Pathway')),
          h('li', {}, h('a', { href: '/tracker.html' }, 'Application tracker')),
          h('li', {}, h('a', { href: '/tracker.html#calendar' }, 'Calendar')),
          h('li', {}, h('a', { href: '/college-lab.html' }, 'College Lab')))),
      h('div', {},
        h('h2', { class: 'footer-heading' }, 'Project'),
        h('ul', {},
          h('li', {}, h('a', { href: '/signin.html' }, 'Sign in')),
          h('li', {}, h('a', { href: '/join.html' }, 'Join a class')),
          h('li', {}, h('a', { href: '/teacher.html' }, 'For teachers & counselors')),
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

// Pages that need an Atlas account. Everyone can use the homepage, About, and
// the opportunity directory; signed-out visitors to these go to sign in (or
// start the wizard) and come back here afterwards.
const NEEDS_ACCOUNT = new Set(['profile', 'tracker', 'lab', 'submit']);

/** False (and on the way to the sign-in page) when this page needs an account the visitor doesn't have. */
async function passGate(page) {
  const root = document.documentElement;
  if (!NEEDS_ACCOUNT.has(page) || getAccount()) {
    root.classList.remove('gate-checking');
    return true;
  }
  root.classList.add('gate-checking');
  const status = await accountStatus();
  // Without accounts (not set up, or offline) everything stays in this browser, so let them in.
  if (status.enabled && !status.signedIn) {
    const next = location.pathname + location.search + location.hash;
    location.replace(`/signin.html?next=${encodeURIComponent(next)}`);
    return false;
  }
  root.classList.remove('gate-checking');
  return true;
}

/** Mounts a page module once the DOM is ready. */
export function boot(page, init) {
  if (document.documentElement.classList.contains('redirecting')) return; // see home-redirect.js
  const run = async () => {
    if (!(await passGate(page))) return;
    renderLayout(page);
    confettiOnApplied();
    startSync().catch(() => {});
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
