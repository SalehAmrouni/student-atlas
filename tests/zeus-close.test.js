// Zeus's X (close) buttons. The floating chat on tablets and phones once
// ignored its X because the base .zeus-dock rule came after the media queries
// and won the cascade, so the chat stayed on the page whatever was clicked.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');

describe('Zeus chat CSS', () => {
  test('the docked panel rule comes before the media queries that float and hide it', () => {
    const base = css.search(/^\.zeus-dock \{/m);
    const floating = css.indexOf('.zeus-dock.open { display: flex; }');
    assert.ok(base !== -1 && floating !== -1);
    assert.ok(base < css.lastIndexOf('@media', floating), 'the base .zeus-dock rule must precede @media (max-width: 1280px)');
    assert.equal(css.match(/^\.zeus-dock \{/gm).length, 1, 'one unconditional .zeus-dock rule');
  });
});

// Browser checks need Chromium for Playwright (`npx playwright install chromium`);
// without it they're skipped.
let browser = null;
try {
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
} catch { /* no browser available */ }

describe('Zeus close buttons in the browser', { skip: !browser && 'Chromium for Playwright is not installed' }, () => {
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

  async function explore(width) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.goto(`${base}/dashboard`);
    await page.waitForSelector('.zeus-messages', { state: 'attached' });
    await page.waitForSelector('.results-grid button');
    return page;
  }
  const dockShown = (page) => page.locator('#zeus').isVisible();

  for (const [label, width] of [['tablet', 1024], ['phone', 390]]) {
    test(`the X closes the floating chat on a ${label}`, async () => {
      const page = await explore(width);
      try {
        assert.equal(await dockShown(page), false, 'starts closed');
        await page.click('#chat-fab');
        assert.equal(await dockShown(page), true);
        assert.equal(await page.getAttribute('#chat-fab', 'aria-expanded'), 'true');

        const close = page.getByRole('button', { name: 'Close chat' });
        const box = await close.boundingBox();
        assert.ok(box && box.y >= 0 && box.y + box.height <= 800, 'the X is on screen');
        assert.ok(box.width >= 24 && box.height >= 24, 'the X is a large enough target');
        await close.click(); // Playwright fails this if anything covers the button.
        assert.equal(await dockShown(page), false, 'the X closes the chat');
        assert.equal(await page.getAttribute('#chat-fab', 'aria-expanded'), 'false');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'chat-fab', 'focus returns to Ask Zeus');

        await page.click('#chat-fab');
        await page.keyboard.press('Escape');
        assert.equal(await dockShown(page), false, 'Escape closes it too');
      } finally {
        await page.close();
      }
    });
  }

  test('"Ask Zeus about this" opens the chat and its X still closes it', async () => {
    const page = await explore(1024);
    try {
      await page.locator('.results-grid button', { hasText: 'Details' }).first().click();
      await page.getByRole('button', { name: 'Ask Zeus about this' }).click();
      assert.equal(await dockShown(page), true);
      await page.getByRole('button', { name: 'Close chat' }).click();
      assert.equal(await dockShown(page), false);
    } finally {
      await page.close();
    }
  });

  test('the X closes an opportunity opened from a Zeus answer', async () => {
    const page = await explore(1440);
    try {
      assert.equal(await page.getByRole('button', { name: 'Close chat' }).isVisible(), false, 'the docked chat has no X on wide screens');
      await page.getByRole('button', { name: 'Show my top matches' }).or(page.getByRole('button', { name: 'Paid internships' })).first().click();
      const link = page.locator('#zeus .opp-link').first();
      await link.waitFor();
      await link.click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      assert.equal(await page.locator('.modal-backdrop').count(), 0, 'the X closes the opportunity');
    } finally {
      await page.close();
    }
  });
});
