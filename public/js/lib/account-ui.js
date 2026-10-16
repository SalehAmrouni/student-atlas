// Account dialogs and panels: setting up a picture password and Login Pass,
// Join a School Room, the Account section of My Pathway, and Log Out (the
// "Clear Computer" rule). Signing in has its own page (pages/signin.js).

import { h, icon, openModal, modalHeader, toast, refreshIcons, downloadFile } from './dom.js';
import { getAccount, getProfile } from './store.js';
import {
  accountStatus, createAccount, logOut, joinRoom, leaveRoom, newSignInCode, deleteAccount,
  setPicturePassword, newLoginPass, hasLocalData, displayName, AccountError,
} from './account.js';
import { picturePad, pictureWords } from './picture-pad.js';
import { PICTURE_LENGTH } from './pictures.js';

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
export function textField({ label, hint, ...attrs }) {
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

/**
 * Sets up how a student signs in: a picture password (pick, then repeat), then
 * a Login Pass to download. `steps` picks which parts to run. Resolves when
 * the dialog closes, to true if every step finished.
 */
export function setupSignIn({ user = getAccount(), steps = ['picture', 'pass'], title, intro } = {}) {
  return new Promise((resolve) => {
    let finished = false;
    openModal({
      labelledBy: 'setup-title',
      onClose: () => resolve(finished),
      build: (close) => {
        const heading = h('h2', { id: 'setup-title', class: 'mb-0', tabindex: '-1' });
        const stepNote = h('p', { class: 'muted small mb-0 mt-1' });
        const body = h('div', { class: 'modal-body stack' });
        const header = h('div', { class: 'modal-header' },
          h('div', {}, heading, stepNote),
          h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x')));
        const total = steps.includes('picture') ? steps.length + 1 : steps.length;
        let shown = 0;
        const show = (text, ...children) => {
          shown += 1;
          heading.textContent = text;
          stepNote.textContent = total > 1 ? `Step ${Math.min(shown, total)} of ${total}` : '';
          body.replaceChildren(...children.flat().filter(Boolean));
          refreshIcons();
        };
        const queue = [...steps];
        const next = () => {
          const step = queue.shift();
          if (step === 'picture') return choosePicture();
          if (step === 'pass') return savePass();
          finished = true;
          return close();
        };

        function choosePicture() {
          const status = h('p', { class: 'field-error', role: 'alert' });
          const go = h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, 'Next', icon('arrow-right'));
          const pad = picturePad({
            label: 'Your picture password',
            onChange: (picks) => { go.disabled = picks.length !== PICTURE_LENGTH; },
            onComplete: () => go.focus(),
          });
          go.addEventListener('click', () => confirmPicture(pad.value()));
          show(title ?? 'Pick your picture password',
            h('p', { class: 'mb-0' }, intro ?? 'Instead of typing a password, you’ll sign in with your username and three pictures in the order you pick them. Choose ones you’ll remember but others won’t guess.'),
            user ? signInCodeCard(user, null) : null,
            pad.el, status, h('div', { class: 'row' }, go));
          setTimeout(() => pad.focus());
        }

        function confirmPicture(first) {
          const status = h('p', { class: 'field-error', role: 'alert' });
          const save = h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, icon('check'), 'Save my pictures');
          const back = h('button', { type: 'button', class: 'btn btn-ghost' }, icon('arrow-left'), 'Pick different pictures');
          const pad = picturePad({
            label: 'Your picture password, again',
            onChange: (picks) => { save.disabled = picks.length !== PICTURE_LENGTH; },
            onComplete: () => save.focus(),
          });
          back.addEventListener('click', () => { shown -= 2; choosePicture(); });
          save.addEventListener('click', async () => {
            if (pad.value().join() !== first.join()) {
              pad.reset();
              status.textContent = 'Those pictures didn’t match. Pick the same three, in the same order.';
              pad.focus();
              return;
            }
            save.disabled = true;
            try {
              user = await setPicturePassword(first);
              toast('Picture password saved', 'success');
              next();
            } catch (err) {
              status.textContent = err.message;
              save.disabled = false;
            }
          });
          show('Pick them once more',
            h('p', { class: 'mb-0' }, 'Pick the same three pictures in the same order so we know you’ve got them.'),
            h('div', { class: 'callout' }, icon('lightbulb'), h('span', {}, 'You picked ', h('strong', { text: pictureWords(first).join(', then ') }), '. Say them to yourself as a little story to remember them.')),
            pad.el, status, h('div', { class: 'row' }, save, back));
          setTimeout(() => pad.focus());
        }

        async function savePass() {
          const status = h('p', { class: 'field-error', role: 'alert' });
          const slot = h('div', { class: 'pass-preview' }, h('p', { class: 'muted mb-0', role: 'status' }, 'Making your Login Pass…'));
          const done = h('button', { type: 'button', class: 'btn btn-ghost', onclick: next }, 'Done');
          show('Save your Login Pass',
            h('p', { class: 'mb-0' }, 'Your Login Pass is a QR code picture. To sign in later, upload it or hold it up to your webcam. No typing at all.'),
            slot, status,
            h('div', { class: 'callout' }, icon('shield-check'), h('span', {}, h('strong', {}, 'Keep it private. '), 'Save it to your school Google Drive or your own device, not a shared folder. Anyone with the pass can open your account. Making a new pass turns the old one off.')),
            h('div', { class: 'row' }, done));
          try {
            const [{ passCard, downloadCanvas }, secret] = await Promise.all([import('./login-pass.js'), newLoginPass()]);
            user = getAccount() ?? user;
            const card = passCard(user, secret);
            const download = h('button', { type: 'button', class: 'btn btn-primary' }, icon('download'), 'Download Login Pass');
            download.addEventListener('click', async () => {
              await downloadCanvas(card, `student-atlas-login-pass-${user.username}.png`);
              toast('Login Pass downloaded', 'success');
              done.textContent = 'I saved it';
              done.className = 'btn btn-primary';
              done.focus();
            });
            slot.replaceChildren(
              h('img', { class: 'pass-image', src: card.toDataURL('image/png'), width: String(card.width), height: String(card.height), alt: `Login Pass for ${user.username}: a QR code that signs you in` }),
              h('div', { class: 'row' }, download));
            refreshIcons();
            download.focus();
          } catch (err) {
            slot.replaceChildren();
            status.textContent = err.message || 'Couldn’t make a Login Pass right now. You can make one later in My Pathway → Account.';
          }
        }

        setTimeout(next);
        return [header, body];
      },
    });
  });
}

/** Where to sign in, coming back to `next` (this page by default) afterwards. */
export const signInHref = (next = location.pathname + location.search + location.hash) => `/signin.html?next=${encodeURIComponent(next)}`;

/**
 * The Join a School Room form. Works for brand-new students (Path B: makes an
 * account first) and for existing ones (the bridge: their data stays put).
 * Calls onJoined({ user, created }).
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
      onJoined?.({ user, created: Boolean(created?.created) });
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
        user?.hasPicture || user?.hasPass
          ? h('div', { class: 'callout' }, icon('key-round'), h('span', {}, `To sign back in, use your ${[user.hasPicture ? 'picture password' : null, user.hasPass ? 'Login Pass' : null].filter(Boolean).join(' or ')}.`))
          : h('div', { class: 'callout callout-warn' }, icon('alert-triangle'), h('span', {}, h('strong', {}, 'You haven’t set up a way to sign back in. '), 'Set a picture password or download a Login Pass first, or you’ll need your teacher to let you back in.')),
        h('div', { class: 'row' },
          h('button', {
            type: 'button', class: user?.hasPicture || user?.hasPass ? 'btn btn-primary' : 'btn btn-outline', autofocus: user?.hasPicture || user?.hasPass || undefined,
            onclick: async (e) => {
              e.currentTarget.disabled = true;
              await logOut();
              location.replace('/?home=1&loggedout=1');
            },
          }, icon('log-out'), 'Log out and clear'),
          user?.hasPicture || user?.hasPass
            ? null
            : h('button', { type: 'button', class: 'btn btn-primary', autofocus: true, onclick: () => { close(); setupSignIn(); } }, icon('shield-check'), 'Set up sign-in first'))),
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
        await setupSignIn({ user: r.user, title: 'Your Atlas username is ready', intro: 'Your pathway now saves to the cloud under this anonymous username. Next, pick three pictures in order: that’s how you’ll sign back in. No password to type.' });
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
        h('a', { class: 'btn btn-outline', href: signInHref('/profile.html#account') }, icon('log-in'), 'I have a username'),
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
  const makeCode = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, icon('key-round'), 'Make a backup sign-in code');
  makeCode.addEventListener('click', async () => {
    if (!confirm('Make a backup sign-in code? Any older code stops working.')) return;
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

  const after = async (promise) => { if (await promise) rerender(); };
  const method = (iconName, title, isSet, text, button) => h('li', { class: 'signin-method' },
    h('span', { class: 'signin-method-icon' }, icon(iconName)),
    h('div', { class: 'stack-sm' },
      h('div', { class: 'row' }, h('strong', { text: title }),
        h('span', { class: `badge ${isSet ? 'badge-success' : 'badge-warning'}`, text: isSet ? 'Set up' : 'Not set up' })),
      h('span', { class: 'small muted', text }),
      h('div', {}, button)));
  wrap.append(
    h('div', { class: 'card card-flat stack' },
      h('h3', { class: 'mb-0' }, 'Your account'),
      signInCodeCard(user, null),
      h('p', { class: 'small muted mb-0' }, 'Your progress saves automatically. Your username is random and anonymous; there’s no email or password.'),
      h('h4', { class: 'h3 mb-0 mt-1' }, 'How you sign in'),
      h('ul', { class: 'signin-methods' },
        method('grid-3x3', 'Picture password', user.hasPicture, 'Your username plus three pictures in order.',
          h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => after(setupSignIn({ steps: ['picture'], title: user.hasPicture ? 'Pick new pictures' : undefined })) },
            icon('grid-3x3'), user.hasPicture ? 'Change my pictures' : 'Set my pictures')),
        method('qr-code', 'Login Pass', user.hasPass, 'A QR code picture you upload or show to your webcam.',
          h('button', {
            type: 'button', class: 'btn btn-outline btn-sm',
            onclick: () => {
              if (user.hasPass && !confirm('Make a new Login Pass? Your old pass will stop working.')) return;
              after(setupSignIn({ steps: ['pass'] }));
            },
          }, icon('download'), user.hasPass ? 'Make a new Login Pass' : 'Get my Login Pass'))),
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
