// Every page at phone, tablet, laptop, and large-monitor sizes, in portrait and
// landscape: nothing scrolls sideways, the header menus fit a phone on its side,
// and tapping the menu icon opens the menu (it once opened and shut in one tap).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Browser checks need Chromium for Playwright (`npx playwright install chromium`);
// without it they're skipped.
let browser = null;
try {
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
} catch { /* no browser available */ }

const PAGES = ['/', '/dashboard.html', '/profile.html', '/tracker.html', '/college-lab.html', '/references.html',
  '/submission.html', '/join.html', '/teacher.html', '/moderate.html', '/404.html'];
const SCREENS = [
  ['small phone', 320, 568], ['phone', 390, 844], ['phone landscape', 568, 320], ['large phone landscape', 844, 390],
  ['tablet', 768, 1024], ['tablet landscape', 1024, 768], ['laptop', 1366, 768], ['desktop', 1920, 1080], ['4K monitor', 2560, 1440],
];

describe('Student Atlas on every screen size', { skip: !browser && 'Chromium for Playwright is not installed' }, () => {
  let server;
  let base;

  before(async () => {
    const { createApp } = await import('../server/index.js');
    server = createApp({ env: {} }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await browser?.close();
    server?.close();
  });

  async function open(path, width, height) {
    const touch = width < 1100;
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch && width < 900 });
    const page = await context.newPage();
    await page.goto(`${base}${path}`);
    await page.waitForSelector('.site-header');
    return { page, done: () => context.close() };
  }

  for (const [label, width, height] of SCREENS) {
    test(`no page scrolls sideways on a ${label} (${width}x${height})`, async () => {
      const { page, done } = await open('/', width, height);
      try {
        for (const path of PAGES) {
          await page.goto(`${base}${path}`);
          await page.waitForSelector('.site-header');
          const { scroll, viewport } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
          assert.ok(scroll <= viewport, `${path} is ${scroll}px wide in a ${viewport}px window`);
        }
      } finally {
        await done();
      }
    });
  }

  test('tapping the menu icon opens the menu, and tapping it again closes it', async () => {
    const { page, done } = await open('/', 390, 844);
    try {
      await page.tap('.menu-toggle svg');
      assert.equal(await page.getAttribute('#site-nav', 'class'), 'nav open');
      await page.tap('.menu-toggle svg');
      assert.equal(await page.getAttribute('#site-nav', 'class'), 'nav');
    } finally {
      await done();
    }
  });

  test('on a phone held sideways, the menu, settings, and wizard fit the screen', async () => {
    const { page, done } = await open('/profile.html', 568, 320);
    const fits = (selector) => page.locator(selector).evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight + 1);
    try {
      await page.tap('.menu-toggle');
      assert.ok(await fits('#site-nav'), 'the menu fits');
      await page.locator('#site-nav a:visible').last().scrollIntoViewIfNeeded();
      assert.ok(await page.locator('#site-nav a:visible').last().isVisible(), 'its last link can be reached');
      await page.keyboard.press('Escape');

      await page.tap('[aria-controls="a11y-menu"]');
      assert.ok(await fits('#a11y-menu'), 'the accessibility settings fit');
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: /Start the Pathway Wizard/ }).first().click();
      assert.ok(await fits('.modal'), 'the wizard fits');
      const field = await page.locator('.modal-body input').first().boundingBox();
      const footer = await page.locator('.modal-footer').boundingBox();
      assert.ok(field && footer && field.y + field.height <= footer.y, 'its first field shows above the Continue bar');
    } finally {
      await done();
    }
  });
});
