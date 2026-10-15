import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const { loadOpportunities, loadStatus, withStatus, searchOpportunities, CLUSTERS, TYPES } = await import('../server/opportunities.js');
const { SECURITY_HEADERS } = await import('../server/headers.js');
const { createApp } = await import('../server/index.js');

const opportunities = loadOpportunities();
const PUBLIC = path.resolve('public');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}
const siteFiles = walk(PUBLIC).filter((p) => !p.includes(`${path.sep}vendor${path.sep}`));
const sourceOf = (p) => fs.readFileSync(p, 'utf8');

// ---------------------------------------------------------------------------
describe('opportunities database', () => {
  test('loads, validates, and covers every cluster', () => {
    assert.ok(opportunities.length >= 200, `expected 200+ opportunities, got ${opportunities.length}`);
    for (const key of Object.keys(CLUSTERS)) assert.ok(opportunities.some((o) => o.cluster === key), `no opportunities in ${key}`);
  });

  test('ids are unique and all links use https', () => {
    assert.equal(new Set(opportunities.map((o) => o.id)).size, opportunities.length);
    assert.ok(opportunities.every((o) => o.url.startsWith('https://')));
  });

  test('search ranks keyword matches and applies filters', () => {
    assert.match(searchOpportunities(opportunities, { query: 'robotics', limit: 5 })[0].title, /robot/i);
    const free11 = searchOpportunities(opportunities, { grade: 11, cost: 'Free' });
    assert.ok(free11.length && free11.every((o) => o.grades.includes(11) && o.cost === 'Free'));
  });
});

// ---------------------------------------------------------------------------
describe('static build', () => {
  test('public/data/opportunities.json is up to date (run `npm run build` after editing data)', () => {
    const built = JSON.parse(sourceOf(path.join(PUBLIC, 'data', 'opportunities.json')));
    assert.deepEqual(built, JSON.parse(JSON.stringify({ clusters: CLUSTERS, types: TYPES, count: opportunities.length, opportunities: withStatus(opportunities, loadStatus()) })));
  });

  test('the icon bundle is vendored locally', () => {
    assert.ok(fs.statSync(path.join(PUBLIC, 'vendor', 'lucide', 'lucide.min.js')).size > 10_000);
  });

  test('every internal link and asset points to a real file', () => {
    const refs = new Set();
    for (const file of siteFiles.filter((p) => /\.(html|js)$/.test(p))) {
      for (const m of sourceOf(file).matchAll(/(?:href|src)=["'](\/[^"'#?]*)|['"`](\/[a-z0-9-]+\.html)/gi)) refs.add(m[1] ?? m[2]);
    }
    assert.ok(refs.size > 10);
    for (const ref of refs) {
      const target = ref === '/' ? 'index.html' : ref.slice(1);
      assert.ok(fs.existsSync(path.join(PUBLIC, target)), `${ref} is linked but public/${target} does not exist`);
    }
  });

  test('the site needs no server API', () => {
    for (const file of siteFiles.filter((p) => /\.(html|js)$/.test(p))) {
      assert.doesNotMatch(sourceOf(file), /['"`]\/api\//, `${path.relative(PUBLIC, file)} still calls /api/`);
    }
  });

  test('vercel.json serves public/ with the same security headers as the local server', () => {
    const cfg = JSON.parse(sourceOf('vercel.json'));
    assert.equal(cfg.outputDirectory, 'public');
    assert.equal(cfg.framework, null);
    const all = cfg.headers.find((h) => h.source === '/(.*)').headers;
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      assert.equal(all.find((h) => h.key === key)?.value, value, `vercel.json ${key} differs from server/headers.js`);
    }
  });

  test('no inline scripts or styles (required by the Content Security Policy)', () => {
    for (const file of siteFiles.filter((p) => p.endsWith('.html'))) {
      const html = sourceOf(file);
      assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${file} has an inline <script>`);
      assert.doesNotMatch(html, /\son[a-z]+=["']/i, `${file} has an inline event handler`);
      assert.doesNotMatch(html, /\sstyle=["']/i, `${file} has an inline style attribute`);
    }
  });
});

// ---------------------------------------------------------------------------
describe('local server', () => {
  let server;
  let base;
  before(async () => {
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  test('sends the security headers', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers.get(key), value);
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  test('serves pages with and without .html, plus data and icons', async () => {
    for (const p of ['/dashboard', '/dashboard.html', '/profile.html', '/submission.html', '/references.html', '/data/opportunities.json', '/vendor/lucide/lucide.min.js']) {
      assert.equal((await fetch(base + p)).status, 200, p);
    }
    assert.equal((await fetch(`${base}/missing-page`)).status, 404);
  });

  test('does not expose source or config files', async () => {
    for (const p of ['/server/index.js', '/package.json', '/vercel.json', '/data/opportunities/stem.json', '/.gitignore']) {
      assert.equal((await fetch(base + p)).status, 404, p);
    }
  });
});
