// Account dialogs and panels: the new-username card with its sign-in code,
// sign in, Join a School Room, and Log Out (the "Clear Computer" rule).

import { h, icon, openModal, modalHeader, toast, refreshIcons, downloadFile } from './dom.js';
import { getAccount, getProfile } from './store.js';
import {
  accountStatus, createAccount, signIn, logOut, joinRoom, leaveRoom, newSignInCode, deleteAccount,
  hasLocalData, displayName, AccountError,
} from './account.js';

let seq = 0;
const uid = (name) => `acct-${name}-${++seq}`;

export async function copyText(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label, 'success');
  } catch {
    toast('Couldn’t copy automatically. Select the text and copy it.', 'error');
  }
}

/** A labelled input with an error slot. */
function textField({ label, hint, ...attrs }) {
  const id = uid('f');
  const hintId = hint ? `${id}-hint` : null;
  const errId = `${id}-err`;
  const input = h('input', { id, class: 'input', 'aria-describedby': [hintId, errId].filter(Boolean).join(' '), ...attrs });
  const err = h('span', { class: 'field-error', id: errId });
  const setError = (msg) => {
    err.textContent = msg ?? '';
    if (msg) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };
  return { input, setError, el: h('div', { class: 'field' }, h('label', { class: 'label', for: id }, label), input, hint ? h('span', { class: 'hint', id: hintId }, hint) : null, err) };
}

function gradeSelect(current) {
  const id = uid('grade');
  const select = h('select', { id, class: 'select' },
    h('option', { value: '' }, 'Choose your grade'),
    [9, 10, 11, 12].map((g) => h('option', { value: String(g), selected: current === g || undefined }, `${g}th grade`)));
  return { select, el: h('div', { class: 'field' }, h('label', { class: 'label', for: id }, 'Grade'), select) };
}

/** The username + sign-in code card (shown once, right after it's made). */
export function signInCodeCard(user, code) {
  const text = `Student Atlas sign-in\nUsername: ${user.username}\nSign-in code: ${code}\n\nSign in at ${location.origin}/join.html`;
  return h('div', { class: 'account-code-card' },
    h('div', { class: 'account-id' },
      h('span', { class: 'account-emoji', 'aria-hidden': 'true', text: user.emoji ?? '🧭' }),
      h('div', {},
        h('span', { class: 'small muted' }, 'Your Atlas username'),
        h('strong', { class: 'account-username', text: user.username }))),
    code ? h('div', { class: 'account-secret' },
      h('span', { class: 'small muted' }, 'Sign-in code'),
      h('strong', { class: 'mono', text: code }),
      h('div', { class: 'row mt-1' },
        h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => copyText(`${user.username} ${code}`, 'Username and code copied') }, icon('copy'), 'Copy'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => downloadFile('student-atlas-sign-in.txt', text, 'text/plain') }, icon('download'), 'Save as a file'))) : null);
}

export function showSignInCode({ user, signInCode, title = 'Your Atlas username is ready', intro } = {}) {
  return new Promise((resolve) => {
    openModal({
      labelledBy: 'code-title',
      onClose: resolve,
      build: (close) => [
        modalHeader('code-title', title, null, close),
        h('div', { class: 'modal-body stack' },
          h('p', { class: 'mb-0' }, intro ?? 'Your progress, saved opportunities, and Zeus chats now save to the cloud under this anonymous username. It says nothing about who you are.'),
          signInCodeCard(user, signInCode),
          h('div', { class: 'callout' }, icon('key-round'),
            h('span', {}, h('strong', {}, 'Save your sign-in code. '), 'You need your username and this code to sign in on another device or after you log out. If you lose it, you can make a new one while signed in, or ask your teacher.')),
          h('button', { type: 'button', class: 'btn btn-primary', autofocus: true, onclick: close }, icon('check'), 'I saved it')),
      ],
    });
  });
}

/** Sign in with username + sign-in code. Resolves to the user or null. */
export function openSignIn() {
  return new Promise((resolve) => {
    let done = null;
    openModal({
      labelledBy: 'signin-title',
      onClose: () => resolve(done),
      build: (close) => {
        const name = textField({ label: 'Atlas username', placeholder: 'e.g. CosmicZeus42', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: '60' });
        const code = textField({ label: 'Sign-in code', placeholder: 'XXXXX-XXXXX', autocomplete: 'current-password', autocapitalize: 'characters', spellcheck: 'false', maxlength: '20', hint: 'Forgot it? Your teacher can make you a new one.' });
        const keep = hasLocalData() && !getAccount()
          ? h('label', { class: 'check' }, h('input', { type: 'checkbox' }), h('span', {}, 'Also add the pathway saved in this browser to my account (only if it’s yours)'))
          : null;
        const status = h('p', { class: 'field-error', role: 'alert' });
        const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, icon('log-in'), 'Sign in');
        const form = h('form', { class: 'modal-body stack', novalidate: true },
          h('p', { class: 'muted mb-0' }, 'Use the username and sign-in code you saved when you started.'),
          name.el, code.el, keep, status, h('div', { class: 'row' }, submit));
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          name.setError(name.input.value.trim() ? null : 'Type your Atlas username.');
          code.setError(code.input.value.trim() ? null : 'Type your sign-in code.');
          if (!name.input.value.trim()) return name.input.focus();
          if (!code.input.value.trim()) return code.input.focus();
          submit.disabled = true;
          status.textContent = '';
          try {
            done = await signIn(name.input.value, code.input.value, { keepLocal: keep?.querySelector('input').checked });
            toast(`Welcome back, ${done.username}!`, 'success');
            close();
          } catch (err) {
            status.textContent = err.message;
            submit.disabled = false;
          }
        });
        setTimeout(() => name.input.focus());
        return [modalHeader('signin-title', 'Sign in to Student Atlas', null, close), form];
      },
    });
  });
}

/**
 * The Join a School Room form. Works for brand-new students (Path B: makes an
 * account first) and for existing ones (the bridge: their data stays put).
 * Calls onJoined({ user, signInCode }).
 */
export function joinForm({ onJoined, initialCode = '' } = {}) {
  const existing = getAccount();
  const code = textField({ label: 'Room code', placeholder: 'e.g. CAREER2026', autocapitalize: 'characters', spellcheck: 'false', autocomplete: 'off', maxlength: '20', value: initialCode, hint: 'Your teacher or counselor will give you this.' });
  const name = textField({ label: 'Your real name', placeholder: 'e.g. Timmy Rivera', autocomplete: 'name', maxlength: '60', hint: 'Only your teacher can see this. It’s locked (encrypted) in your browser before it’s sent.' });
  const grade = gradeSelect(getProfile()?.grade);
  const status = h('p', { class: 'field-error', role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, icon('school'), existing ? 'Join room' : 'Join my class');
  const form = h('form', { class: 'stack', novalidate: true },
    existing
      ? h('div', { class: 'callout' }, icon('shield-check'), h('span', {}, 'You’ll stay ', h('strong', { text: displayName(existing) }), '. Everything you’ve saved stays exactly as it is; your teacher will be able to see your progress.'))
      : null,
    h('div', { class: 'form-grid' }, code.el, name.el), grade.el, status, h('div', { class: 'row' }, submit));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const c = code.input.value.trim();
    const n = name.input.value.trim();
    code.setError(c.replace(/[^a-z0-9]/gi, '').length >= 6 ? null : 'Type the room code from your teacher.');
    name.setError(n ? null : 'Type your real name so your teacher knows it’s you.');
    if (code.input.getAttribute('aria-invalid')) return code.input.focus();
    if (!n) return name.input.focus();
    submit.disabled = true;
    status.textContent = '';
    try {
      let created = null;
      if (!getAccount()) {
        const keepLocal = hasLocalData() && confirm('This browser already has a saved pathway. Add it to your new account? Choose Cancel if it isn’t yours.');
        created = await createAccount({ keepLocal });
        if (!created) throw new AccountError('Classroom rooms aren’t turned on for this site yet.', 503);
      }
      const user = await joinRoom(c, n, grade.select.value ? Number(grade.select.value) : null);
      toast(`You joined ${user.room?.name ?? 'the room'}!`, 'success');
      onJoined?.({ user, signInCode: created?.signInCode ?? null });
    } catch (err) {
      status.textContent = err.message;
      submit.disabled = false;
      if (err.status === 404) code.input.focus();
    }
  });
  return form;
}

export function openJoinRoom({ onJoined } = {}) {
  openModal({
    labelledBy: 'join-title',
    build: (close) => [
      modalHeader('join-title', 'Join a School Room', 'Connect your account to your teacher or counselor.', close),
      h('div', { class: 'modal-body' }, joinForm({ onJoined: (r) => { close(); onJoined?.(r); } })),
    ],
  });
  setTimeout(() => document.querySelector('.modal input')?.focus());
}

/** Log Out: confirm, then end the session and wipe this browser. */
export function confirmLogOut() {
  const user = getAccount();
  openModal({
    labelledBy: 'logout-title',
    build: (close) => [
      modalHeader('logout-title', 'Log out and clear this computer?', null, close),
      h('div', { class: 'modal-body stack' },
        h('p', { class: 'mb-0' }, 'Your work is saved to ', h('strong', { text: displayName(user) }), '. Logging out removes everything from this browser so the next person gets a clean slate.'),
        h('div', { class: 'callout' }, icon('key-round'), h('span', {}, 'To sign back in you’ll need your username and sign-in code. Don’t have the code? Make a new one in My Pathway → Account before you log out.')),
        h('div', { class: 'row' },
          h('button', {
            type: 'button', class: 'btn btn-primary', autofocus: true,
            onclick: async (e) => {
              e.currentTarget.disabled = true;
              await logOut();
              location.replace('/?home=1&loggedout=1');
            },
          }, icon('log-out'), 'Log out and clear'),
          h('a', { class: 'btn btn-ghost', href: '/profile.html#account', onclick: close }, 'Get my sign-in code first'))),
    ],
  });
}

/** The Account section of My Pathway. */
export function accountPanel({ rerender }) {
  const user = getAccount();
  const wrap = h('div', { class: 'stack' });

  if (!user) {
    const start = h('button', { type: 'button', class: 'btn btn-primary' }, icon('sparkles'), 'Save my pathway to the cloud');
    start.addEventListener('click', async () => {
      start.disabled = true;
      try {
        const r = await createAccount();
        if (!r) { toast('Cloud saving isn’t turned on for this site yet. Your pathway stays in this browser.', 'error'); return; }
        await showSignInCode(r);
        rerender();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        start.disabled = false;
      }
    });
    wrap.append(h('div', { class: 'card card-flat stack' },
      h('h3', { class: 'mb-0' }, 'You’re not signed in'),
      h('p', { class: 'muted mb-0' }, 'Get a random, anonymous Atlas username to back up your pathway and use it on any device. No email or password needed.'),
      h('div', { class: 'row' }, start,
        h('button', { type: 'button', class: 'btn btn-outline', onclick: async () => { if (await openSignIn()) location.reload(); } }, icon('log-in'), 'I have a username'),
        h('a', { class: 'btn btn-ghost', href: '/join.html' }, icon('school'), 'Join a class')),
    ));
    accountStatus().then((s) => {
      if (!s.enabled) {
        start.disabled = true;
        wrap.prepend(h('p', { class: 'small muted' }, 'Cloud saving isn’t turned on for this copy of Student Atlas, so everything stays in this browser.'));
      }
    });
    return wrap;
  }

  const codeSlot = h('div');
  const makeCode = h('button', { type: 'button', class: 'btn btn-outline btn-sm' }, icon('key-round'), 'Make a new sign-in code');
  makeCode.addEventListener('click', async () => {
    if (!confirm('Make a new sign-in code? Your old code will stop working.')) return;
    makeCode.disabled = true;
    try {
      const code = await newSignInCode();
      codeSlot.replaceChildren(signInCodeCard(user, code), h('p', { class: 'small muted mt-1 mb-0' }, 'Write this down or save the file. It won’t be shown again.'));
      refreshIcons();
      codeSlot.querySelector('button')?.focus();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      makeCode.disabled = false;
    }
  });

  const room = user.room;
  const roomCard = h('div', { class: 'card card-flat stack' },
    h('h3', { class: 'mb-0' }, icon('school'), 'School room'),
    room
      ? [
        h('p', { class: 'mb-0' }, 'You’re in ', h('strong', { text: room.name }), ` (room code ${room.code}). Your teacher or counselor can see your profile, My Story, milestones, saved opportunities, and application statuses. They can’t see your Zeus or mentor chats, essays, private notes, or your Overcoming obstacles answer unless you choose to share it.`),
        h('div', { class: 'row' },
          h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm',
            onclick: async () => {
              if (!confirm(`Leave ${room.name}? Your teacher will no longer see your progress. Your data stays in your account.`)) return;
              try { await leaveRoom(); toast('You left the room', 'success'); rerender(); } catch (err) { toast(err.message, 'error'); }
            },
          }, icon('door-open'), 'Leave room')),
      ]
      : [
        h('p', { class: 'muted mb-0' }, 'Did a teacher or counselor give you a room code? Join their room and keep everything you’ve already saved.'),
        h('div', {}, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openJoinRoom({ onJoined: () => rerender() }) }, icon('school'), 'Join a School Room')),
      ]);

  wrap.append(
    h('div', { class: 'card card-flat stack' },
      h('h3', { class: 'mb-0' }, 'Your account'),
      signInCodeCard(user, null),
      h('p', { class: 'small muted mb-0' }, 'Your progress saves automatically. Your username is random and anonymous; there’s no email or password.'),
      h('div', { class: 'row' }, makeCode,
        h('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: confirmLogOut }, icon('log-out'), 'Log out')),
      codeSlot),
    roomCard,
    h('div', { class: 'card card-flat stack' },
      h('h3', { class: 'mb-0' }, 'Delete my account'),
      h('p', { class: 'small muted mb-0' }, 'Permanently deletes your account and everything saved in it, removes you from any school room, and clears this browser.'),
      h('div', {}, h('button', {
        type: 'button', class: 'btn btn-danger btn-sm',
        onclick: async () => {
          if (!confirm(`Delete ${user.username} and everything saved in it? This can’t be undone.`)) return;
          try { await deleteAccount(); location.replace('/?home=1'); } catch (err) { toast(err.message, 'error'); }
        },
      }, icon('trash-2'), 'Delete my account'))));
  return wrap;
}
