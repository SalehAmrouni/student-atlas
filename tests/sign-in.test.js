// Student sign-in in a real browser: the picture password (with the keyboard),
// the Login Pass picture, pages that need an account, and the nav.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Browser checks need Chromium for Playwright (`npx playwright install chromium`);
// without it they're skipped.
let browser = null;
try {
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
} catch { /* no browser available */ }

describe('student sign-in in the browser', { skip: !browser && 'Chromium for Playwright is not installed' }, () => {
  let server;
  let base;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-pass-'));

  before(async () => {
    const { createApp } = await import('../server/index.js');
    server = createApp({ env: {} }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await browser?.close();
    server?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** Picks pictures by name with the keyboard only: arrows to move, Enter to pick. */
  async function pickWithKeyboard(page, names) {
    const grid = page.locator('.modal .picture-grid, #signin-root .picture-grid').last();
    const labels = await grid.locator('.picture-name').allTextContents();
    await grid.locator('.picture-option[tabindex="0"]').focus();
    let at = labels.indexOf(await grid.locator('.picture-option[tabindex="0"] .picture-name').textContent());
    for (const name of names) {
      const target = labels.indexOf(name);
      while (at < target) { await page.keyboard.press('ArrowRight'); at += 1; }
      while (at > target) { await page.keyboard.press('ArrowLeft'); at -= 1; }
      await page.keyboard.press('Enter');
    }
  }

  async function newStudentWithPictures(page) {
    await page.goto(`${base}/?wizard=1`);
    await page.waitForSelector('.modal');
    await page.getByRole('button', { name: '10th' }).click();
    await page.locator('.modal-footer .btn-primary').click();
    await page.locator('.option-grid .option').first().click();
    // Click Next through the optional steps until the sign-in setup opens.
    while (!(await page.locator('#setup-title').count())) {
      await page.locator('.modal-footer .btn-primary, #setup-title').first().waitFor();
      if (await page.locator('#setup-title').count()) break;
      await page.locator('.modal-footer .btn-primary').click();
    }
    await page.waitForSelector('#setup-title:has-text("picture password")');
    const username = await page.locator('.modal .account-username').textContent();
    await pickWithKeyboard(page, ['Rocket', 'Dog', 'Pizza']);
    assert.match(await page.locator('.modal .picture-status').textContent(), /Picked 3 of 3: Pizza\. All done\./);
    await page.keyboard.press('Enter'); // focus moved to Next
    await page.waitForSelector('text=Pick them once more');
    await pickWithKeyboard(page, ['Rocket', 'Dog', 'Pizza']);
    await page.keyboard.press('Enter'); // Save my pictures
    await page.waitForSelector('text=Save your Login Pass');
    await page.waitForSelector('.pass-image');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Login Pass' }).click();
    const file = path.join(tmp, `${username}.png`);
    await (await download).saveAs(file);
    await page.getByRole('button', { name: 'I saved it' }).click();
    await page.waitForURL(/dashboard/);
    return { username, file };
  }

  async function logOut(page) {
    await page.locator('.header-logout').first().click();
    await page.getByRole('button', { name: 'Log out and clear' }).click();
    await page.waitForURL(/loggedout|home=1/);
  }

  test('a new student sets a picture password and Login Pass, then signs back in both ways', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    try {
      const { username, file } = await newStudentWithPictures(page);
      await logOut(page);

      // Pages that need an account send signed-out visitors to sign in, then back.
      await page.goto(`${base}/tracker.html#calendar`);
      await page.waitForURL(/\/signin(\.html)?\?next=%2Ftracker\.html%23calendar/);
      await page.getByRole('textbox', { name: 'Atlas username' }).fill(username.toLowerCase());
      await pickWithKeyboard(page, ['Dog', 'Rocket', 'Pizza']); // wrong order
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForSelector('text=those pictures don’t match');
      await pickWithKeyboard(page, ['Rocket', 'Dog', 'Pizza']);
      // Picks are hidden like a password until "Show pictures".
      assert.equal(await page.locator('#signin-root .picture-slot .picture-emoji').count(), 0);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL((url) => /^\/tracker(\.html)?$/.test(url.pathname) && url.hash === '#calendar');
      await logOut(page);

      // Upload the Login Pass picture.
      await page.goto(`${base}/signin.html?next=/profile.html`);
      await page.getByRole('tab', { name: 'Login Pass' }).click();
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Upload my Login Pass' }).click();
      await (await chooser).setFiles(file);
      await page.waitForURL((url) => /^\/profile(\.html)?$/.test(url.pathname));
      assert.match(await page.locator('.header-cta').getAttribute('aria-label'), new RegExp(username));
    } finally {
      await context.close();
    }
  });

  test('a teacher locks a student, then makes a sign-in link that lets them pick new pictures', async () => {
    const crypto = await import('../public/js/lib/room-crypto.js');
    // A student in a room, made through the API.
    const post = async (url, body, cookie, auth) => {
      const res = await fetch(`${base}${url}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
        body: JSON.stringify(body),
      });
      return { res, data: await res.json() };
    };
    const created = await post('/api/account', { action: 'create', data: { profile: { grade: 11, interests: ['STEM'] } } });
    const cookie = created.res.headers.get('set-cookie').split(';')[0];
    const { username } = created.data.user;
    const teacherKey = crypto.generateTeacherKey();
    const keys = await crypto.createRoomKeys(teacherKey);
    await post('/api/rooms', { action: 'create', code: 'LINKTEST', name: 'Homeroom', ...keys });
    await post('/api/account', { action: 'join', code: 'LINKTEST', encryptedName: await crypto.encryptName(keys.publicKey, 'Riley Student'), grade: 11 }, cookie);

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      // The teacher opens the dashboard and the student's portfolio.
      await page.goto(`${base}/teacher.html`);
      await page.getByRole('textbox', { name: 'Room code', exact: true }).first().fill('LINKTEST');
      await page.getByLabel('Teacher key').fill(teacherKey);
      await page.getByRole('button', { name: 'Open dashboard' }).click();
      await page.getByRole('button', { name: 'Riley Student' }).click();
      page.once('dialog', (d) => d.accept());
      await page.getByRole('button', { name: 'Lock account' }).click();
      await page.getByRole('button', { name: 'Unlock account' }).waitFor();
      page.once('dialog', (d) => d.accept());
      await page.getByRole('button', { name: 'Make a sign-in link' }).click();
      const link = await page.locator('.link-text').textContent();
      assert.match(link, /\/signin\.html#link=[A-Za-z0-9_-]{32}$/);
      assert.ok(await page.getByRole('img', { name: /QR code for Riley Student/ }).isVisible());
      await page.getByRole('button', { name: 'Lock account' }).waitFor(); // making a link unlocked them
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Riley Student' }).waitFor();
      await page.waitForFunction(() => document.activeElement?.textContent === 'Riley Student'); // focus returns to the row
      assert.ok(await page.getByText('Locked', { exact: true }).count() === 0, 'the roster shows them unlocked');

      // The student opens the link on another computer.
      const student = await context.browser().newPage();
      await student.goto(link.replace(/^https?:\/\/[^/]+/, base));
      await student.waitForSelector('#setup-title:has-text("Welcome back")');
      assert.ok(!(await student.url()).includes('#link='), 'the secret is taken out of the address');
      await pickWithKeyboard(student, ['Moon', 'Star', 'Fire']);
      await student.keyboard.press('Enter');
      await pickWithKeyboard(student, ['Moon', 'Star', 'Fire']);
      await student.keyboard.press('Enter');
      await student.waitForURL((url) => /^\/profile(\.html)?$/.test(url.pathname));
      assert.match(await student.locator('.header-cta').getAttribute('aria-label'), new RegExp(username));
      await student.close();

      // The link only worked once.
      const again = await post('/api/account', { action: 'login-link', token: link.split('#link=')[1] });
      assert.equal(again.res.status, 401);
    } finally {
      await context.close();
    }
  });

  test('the nav has no Home link, the logo goes home, and open pages stay open', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/dashboard.html`);
      await page.waitForSelector('#site-nav');
      const links = await page.locator('#site-nav a').allTextContents();
      assert.ok(!links.includes('Home'), `nav: ${links.join(', ')}`);
      assert.equal(await page.locator('.site-header .brand').getAttribute('href'), '/');
      assert.match(page.url(), /dashboard/, 'browsing needs no account');
      await page.goto(`${base}/references.html`);
      assert.match(page.url(), /references/);
      await page.goto(`${base}/college-lab.html`);
      await page.waitForURL(/signin/);
      await page.getByRole('link', { name: 'Start the Pathway Wizard' }).waitFor();
      assert.match(await page.getByRole('link', { name: 'Start the Pathway Wizard' }).getAttribute('href'), /next=%2Fcollege-lab\.html/);
    } finally {
      await page.close();
    }
  });

  test('the sign-in page works on a phone and keeps picture buttons large enough to tap', async () => {
    const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
    try {
      await page.goto(`${base}/signin.html`);
      await page.waitForSelector('.picture-option');
      const box = await page.locator('.picture-option').first().boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, `${box.width}x${box.height}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.equal(overflow, 0, 'no sideways scrolling');
      // Every picture has a name a screen reader can say.
      const names = await page.locator('.picture-option').evaluateAll((els) => els.map((e) => e.textContent.trim()));
      assert.equal(names.length, 20);
      assert.ok(names.every((n) => /[A-Za-z]/.test(n)));
    } finally {
      await page.close();
    }
  });
});
