// Sign in: a picture password (username + three pictures), a Login Pass
// (upload the QR picture or show it to the webcam), or the older typed
// sign-in code. Also opens a Login Pass or a teacher's one-time link from the
// address (#pass=… or #link=…), then goes back to ?next=.

import { boot } from '../lib/layout.js';
import { h, icon, $, refreshIcons, toast } from '../lib/dom.js';
import { getAccount } from '../lib/store.js';
import { accountStatus, signIn, hasLocalData, displayName, safeNext } from '../lib/account.js';
import { textField, setupSignIn, confirmLogOut } from '../lib/account-ui.js';
import { picturePad } from '../lib/picture-pad.js';
import { PICTURE_LENGTH } from '../lib/pictures.js';

const TABS = [
  { id: 'pictures', label: 'Pictures', icon: 'grid-3x3' },
  { id: 'pass', label: 'Login Pass', icon: 'qr-code' },
  { id: 'code', label: 'Sign-in code', icon: 'key-round' },
];

boot('signin', async () => {
  const root = $('#signin-root');
  const params = new URLSearchParams(location.search);
  const next = safeNext(params.get('next'));
  // Read a pass or link from the address, then take it out so it isn't left in history.
  const { readSecret } = await import('../lib/login-pass.js');
  const fromHash = readSecret(location.hash);
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);

  const status = await accountStatus();
  if (!status.enabled) {
    root.append(h('div', { class: 'card stack' },
      h('p', { class: 'mb-0' }, status.offline ? 'We couldn’t reach Student Atlas. Check your connection and try again.' : 'Sign-in isn’t turned on for this copy of Student Atlas. Everything saves in this browser instead.'),
      h('div', {}, h('a', { class: 'btn btn-primary', href: next }, 'Continue'))));
    return;
  }

  const account = getAccount();
  if (account && !fromHash) {
    $('#signin-title').textContent = 'You’re already signed in';
    $('#signin-lead').textContent = `You’re signed in as ${displayName(account)}.`;
    root.append(h('div', { class: 'card stack' },
      h('p', { class: 'mb-0' }, 'To sign in as someone else, log out first. Logging out clears this computer.'),
      h('div', { class: 'row' },
        h('a', { class: 'btn btn-primary', href: next }, icon('arrow-right'), 'Continue'),
        h('button', { type: 'button', class: 'btn btn-outline', onclick: confirmLogOut }, icon('log-out'), 'Log out'))));
    refreshIcons();
    return;
  }

  // Only offer to merge when the data here isn't someone else's account.
  const keep = hasLocalData() && !account
    ? h('label', { class: 'check' }, h('input', { type: 'checkbox' }), h('span', {}, 'Also add the pathway saved in this browser to my account (only if it’s yours)'))
    : null;

  async function finish(credentials, statusEl, button) {
    if (button) button.disabled = true;
    statusEl.textContent = '';
    try {
      const { user, fromLink } = await signIn(credentials, { keepLocal: keep?.querySelector('input').checked });
      toast(`Welcome back, ${user.username}!`, 'success');
      if (fromLink) {
        // A teacher's link usually means the old pictures or pass were lost.
        await setupSignIn({ user, steps: ['picture'], title: 'Welcome back! Pick new pictures', intro: 'Your teacher’s link worked once and is now used up. Pick a new picture password so you can sign in yourself next time. You can also get a new Login Pass in My Pathway → Account.' });
      }
      location.replace(next);
      return true;
    } catch (err) {
      statusEl.textContent = err.message;
      if (button) button.disabled = false;
      return false;
    }
  }

  // ---- Opened from a Login Pass QR code or a teacher's link ----------------------------
  if (fromHash) {
    const msg = h('p', { class: 'mb-0', role: 'status' }, fromHash.token ? 'Opening your sign-in link…' : 'Signing you in with your Login Pass…');
    const err = h('p', { class: 'field-error', role: 'alert' });
    const card = h('div', { class: 'card stack' }, msg, err);
    root.append(card);
    if (account) {
      // Someone else's data is on this computer: don't mix it in.
      msg.textContent = `This computer is signed in as ${displayName(account)}. Log out first, then open the link again.`;
      card.append(h('div', {}, h('button', { type: 'button', class: 'btn btn-primary', onclick: confirmLogOut }, icon('log-out'), 'Log out')));
      refreshIcons();
      return;
    }
    if (await finish(fromHash, err)) return;
    msg.textContent = 'That didn’t work. You can sign in another way below.';
  }

  // ---- Tabs ----------------------------------------------------------------------------
  const panel = h('div', { class: 'tab-panel', role: 'tabpanel', id: 'signin-panel', tabindex: '0' });
  let active = 'pictures';
  const tabs = TABS.map((t) => h('button', {
    type: 'button', class: 'tab', role: 'tab', id: `signin-tab-${t.id}`, 'aria-controls': 'signin-panel',
    onclick: () => select(t.id),
  }, icon(t.icon), t.label));
  const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'How do you want to sign in?' }, tabs);
  tablist.addEventListener('keydown', (e) => {
    const i = TABS.findIndex((t) => t.id === active);
    let target = null;
    if (e.key === 'ArrowRight') target = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') target = (i + TABS.length - 1) % TABS.length;
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = TABS.length - 1;
    if (target === null) return;
    e.preventDefault();
    select(TABS[target].id);
    tabs[target].focus();
  });

  let stopCamera = null;
  function select(id) {
    stopCamera?.();
    active = id;
    tabs.forEach((t, i) => {
      const on = TABS[i].id === id;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', `signin-tab-${id}`);
    panel.replaceChildren(id === 'pictures' ? picturesPanel() : id === 'pass' ? passPanel() : codePanel());
    refreshIcons();
  }

  const usernameField = () => textField({ label: 'Atlas username', placeholder: 'e.g. CosmicZeus42', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: '60' });

  function picturesPanel() {
    const name = usernameField();
    const err = h('p', { class: 'field-error', role: 'alert' });
    const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, icon('log-in'), 'Sign in');
    const pad = picturePad({ label: 'Your pictures', hidden: true, onComplete: () => submit.focus() });
    const form = h('form', { class: 'stack', novalidate: true }, name.el, pad.el, err, h('div', { class: 'row' }, submit),
      h('p', { class: 'small muted mb-0' }, 'Forgot your pictures? Use your Login Pass, or ask your teacher for a sign-in link.'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      name.setError(name.input.value.trim() ? null : 'Type your Atlas username.');
      if (!name.input.value.trim()) return name.input.focus();
      if (!pad.complete()) {
        err.textContent = `Pick all ${PICTURE_LENGTH} pictures.`;
        return pad.focus();
      }
      if (!(await finish({ username: name.input.value, picture: pad.value() }, err, submit))) pad.reset();
    });
    return form;
  }

  function passPanel() {
    const err = h('p', { class: 'field-error', role: 'alert' });
    const note = h('p', { class: 'small mb-0', role: 'status' });
    const file = h('input', { type: 'file', hidden: true, accept: 'image/*,.png,.jpg,.jpeg,.txt', 'aria-label': 'Login Pass file' });
    const upload = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => file.click() }, icon('upload'), 'Upload my Login Pass');
    file.addEventListener('change', async () => {
      const chosen = file.files?.[0];
      file.value = '';
      if (!chosen) return;
      err.textContent = '';
      note.textContent = 'Reading your Login Pass…';
      try {
        const { readPassFile } = await import('../lib/login-pass.js');
        const secret = await readPassFile(chosen);
        if (!secret) {
          note.textContent = '';
          err.textContent = 'We couldn’t find a Login Pass in that file. Choose the QR code picture you downloaded from Student Atlas.';
          return;
        }
        note.textContent = 'Signing you in…';
        if (!(await finish(secret, err))) note.textContent = '';
      } catch (ex) {
        note.textContent = '';
        err.textContent = ex.message;
      }
    });

    const video = h('video', { class: 'scan-video', 'aria-label': 'Webcam view. Hold your Login Pass up so the QR code fills the box.', hidden: true });
    const scanBtn = h('button', { type: 'button', class: 'btn btn-outline' }, icon('camera'), 'Scan with my webcam');
    const stopBtn = h('button', { type: 'button', class: 'btn btn-ghost', hidden: true }, icon('square'), 'Stop camera');
    const stopScan = () => { stopCamera?.(); };
    scanBtn.addEventListener('click', async () => {
      const { scanCamera, cameraSupported } = await import('../lib/login-pass.js');
      if (!cameraSupported()) { err.textContent = 'This browser can’t use a camera here. Upload your Login Pass instead.'; return; }
      err.textContent = '';
      const scan = scanCamera(video);
      stopCamera = () => { scan.stop(); };
      video.hidden = false;
      scanBtn.hidden = true;
      stopBtn.hidden = false;
      stopBtn.focus();
      note.textContent = 'Camera on. Hold your Login Pass up to the camera.';
      let secret = null;
      try {
        secret = await scan.done;
      } catch (ex) {
        err.textContent = ex.message;
      }
      stopCamera = null;
      video.hidden = true;
      scanBtn.hidden = false;
      stopBtn.hidden = true;
      note.textContent = secret ? 'Found your Login Pass. Signing you in…' : '';
      if (secret && !(await finish(secret, err))) note.textContent = '';
      if (!secret) scanBtn.focus();
    });
    stopBtn.addEventListener('click', stopScan);

    return h('div', { class: 'stack' },
      h('p', { class: 'mb-0' }, 'Your Login Pass is the QR code picture you downloaded when you set up your account.'),
      h('div', { class: 'row' }, upload, scanBtn, stopBtn), file,
      h('div', { class: 'scan-frame' }, video),
      note, err,
      h('p', { class: 'small muted mb-0' }, 'On a phone, you can also open your phone’s camera and point it at the pass.'));
  }

  function codePanel() {
    const name = usernameField();
    const code = textField({ label: 'Sign-in code', placeholder: 'XXXXX-XXXXX', autocomplete: 'current-password', autocapitalize: 'characters', spellcheck: 'false', maxlength: '20' });
    const err = h('p', { class: 'field-error', role: 'alert' });
    const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, icon('log-in'), 'Sign in');
    const form = h('form', { class: 'stack', novalidate: true },
      h('p', { class: 'small muted mb-0' }, 'For accounts made before picture passwords, or a backup code you made in My Pathway.'),
      name.el, code.el, err, h('div', { class: 'row' }, submit));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      name.setError(name.input.value.trim() ? null : 'Type your Atlas username.');
      code.setError(code.input.value.trim() ? null : 'Type your sign-in code.');
      if (!name.input.value.trim()) return name.input.focus();
      if (!code.input.value.trim()) return code.input.focus();
      await finish({ username: name.input.value, code: code.input.value }, err, submit);
    });
    return form;
  }

  const wizardHref = `/?wizard=1&next=${encodeURIComponent(next)}`;
  root.append(
    h('section', { class: 'card stack', 'aria-labelledby': 'signin-h' },
      h('h2', { id: 'signin-h', class: 'h3 mb-0' }, 'I have an Atlas username'),
      tablist, panel, keep),
    h('section', { class: 'card stack mt-3', 'aria-labelledby': 'new-h' },
      h('h2', { id: 'new-h', class: 'h3 mb-0' }, icon('sparkles'), 'New to Student Atlas?'),
      h('p', { class: 'muted mb-0' }, 'Answer a few quick questions and get a random, anonymous username. No email needed.'),
      h('div', { class: 'row' },
        h('a', { class: 'btn btn-primary', href: wizardHref }, icon('compass'), 'Start the Pathway Wizard'),
        h('a', { class: 'btn btn-ghost', href: '/join.html' }, icon('school'), 'I have a class room code'))));
  select('pictures');
  setTimeout(() => panel.querySelector('input')?.focus());
});
