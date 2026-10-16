// Join your class (Path B) and sign in. A brand-new student types the room
// code and their real name and gets a random Atlas username; a student who
// already has one joins without losing anything (the bridge).

import { boot } from '../lib/layout.js';
import { h, icon, $, refreshIcons } from '../lib/dom.js';
import { getAccount, getProfile } from '../lib/store.js';
import { accountStatus, displayName } from '../lib/account.js';
import { joinForm, signInCodeCard, setupSignIn, signInHref } from '../lib/account-ui.js';
import { openWizard } from '../lib/wizard.js';

boot('join', async () => {
  const root = $('#join-root');
  const params = new URLSearchParams(location.search);
  const initialCode = params.get('code') ?? '';
  const status = await accountStatus();

  function joined({ user }) {
    $('#join-title').textContent = 'You’re in!';
    $('#join-lead').textContent = `You joined ${user.room?.name ?? 'your class'}. Your teacher can now see your progress.`;
    const needsSetup = () => { const a = getAccount(); return !a?.hasPicture && !a?.hasPass; };
    const setupNote = h('div', { class: 'callout' }, icon('key-round'), h('span', {}, h('strong', {}, 'Pick your picture password. '), 'You’ll sign back in with your username and three pictures, or a Login Pass you download. If you forget, your teacher can make you a sign-in link.'));
    const setupBtn = h('button', { type: 'button', class: 'btn btn-outline' }, icon('grid-3x3'), 'Set up how I sign in');
    const next = getProfile()
      ? h('a', { class: 'btn btn-primary', href: '/profile.html' }, icon('compass'), 'Go to My Pathway')
      : h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openWizard({ onComplete: () => { location.href = '/profile.html'; } }) }, icon('sparkles'), 'Build my pathway');
    const refreshSetup = () => { setupNote.hidden = !needsSetup(); setupBtn.hidden = !needsSetup(); };
    setupBtn.addEventListener('click', async () => { await setupSignIn({ user }); refreshSetup(); next.focus(); });
    root.replaceChildren(h('div', { class: 'card stack' },
      signInCodeCard(user, null),
      setupNote,
      h('div', { class: 'row' }, setupBtn, next, h('a', { class: 'btn btn-ghost', href: '/profile.html' }, 'Skip for now'))));
    refreshSetup();
    refreshIcons();
    if (needsSetup()) setupSignIn({ user, title: 'You’re in! Now pick your picture password' }).then(() => { refreshSetup(); next.focus(); });
    else next.focus();
  }

  if (!status.enabled) {
    root.append(h('div', { class: 'card stack' },
      h('p', { class: 'mb-0' }, status.offline ? 'We couldn’t reach Student Atlas. Check your connection and try again.' : 'Classroom rooms and sign-in aren’t turned on for this copy of Student Atlas yet. You can still use everything; your pathway saves in this browser.'),
      h('div', {}, h('a', { class: 'btn btn-primary', href: '/?wizard=1' }, icon('compass'), 'Start the Pathway Wizard'))));
    return;
  }

  const account = getAccount();
  if (account?.room) {
    $('#join-title').textContent = 'You’re already in a class';
    $('#join-lead').textContent = `You’re signed in as ${displayName(account)} in ${account.room.name}. Joining a different room moves you there.`;
  } else if (account) {
    $('#join-title').textContent = 'Join a School Room';
    $('#join-lead').textContent = `You’re signed in as ${displayName(account)}. Join your teacher’s room and keep everything you’ve saved.`;
  }

  root.append(h('section', { class: 'card stack', 'aria-labelledby': 'join-form-h' },
    h('h2', { id: 'join-form-h', class: 'h3 mb-0' }, icon('school'), account ? 'Room code' : 'Join with a room code'),
    joinForm({ onJoined: joined, initialCode })));

  if (!account) {
    root.append(h('section', { class: 'card stack mt-3', id: 'sign-in', 'aria-labelledby': 'signin-h' },
      h('h2', { id: 'signin-h', class: 'h3 mb-0' }, icon('log-in'), 'Already have an Atlas username?'),
      h('p', { class: 'muted mb-0' }, 'Sign in with your pictures or your Login Pass to pick up where you left off.'),
      h('div', {}, h('a', { class: 'btn btn-outline', href: signInHref('/profile.html') }, icon('log-in'), 'Sign in')),
      h('p', { class: 'small muted mb-0' }, 'New here and not in a class? ', h('a', { href: '/?wizard=1' }, 'Start the Pathway Wizard'), ' instead.')));
    if (location.hash === '#sign-in') setTimeout(() => $('#sign-in a.btn')?.focus());
  }
  refreshIcons();
});
