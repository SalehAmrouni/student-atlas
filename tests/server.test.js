import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-'));
process.env.SUBMISSIONS_DIR = tmp;

const { loadOpportunities, searchOpportunities, CLUSTERS } = await import('../server/opportunities.js');
const { createApp } = await import('../server/index.js');

const opportunities = loadOpportunities();

// ---------------------------------------------------------------------------
describe('opportunities database', () => {
  test('loads, validates, and covers every cluster', () => {
    assert.ok(opportunities.length >= 200, `expected 200+ opportunities, got ${opportunities.length}`);
    for (const key of Object.keys(CLUSTERS)) {
      assert.ok(opportunities.some((o) => o.cluster === key), `no opportunities in ${key}`);
    }
  });

  test('ids are unique and all links use https', () => {
    const ids = new Set(opportunities.map((o) => o.id));
    assert.equal(ids.size, opportunities.length);
    assert.ok(opportunities.every((o) => o.url.startsWith('https://')));
  });

  test('search ranks keyword matches and applies filters', () => {
    const robotics = searchOpportunities(opportunities, { query: 'robotics', limit: 5 });
    assert.ok(robotics.length > 0);
    assert.match(robotics[0].title, /robot/i);

    const free11 = searchOpportunities(opportunities, { grade: 11, cost: 'Free' });
    assert.ok(free11.length > 0);
    assert.ok(free11.every((o) => o.grades.includes(11) && o.cost === 'Free'));

    assert.equal(searchOpportunities(opportunities, { query: 'zzzz-not-a-thing' }).length, 0);
  });
});

// ---------------------------------------------------------------------------
const goodSubmission = {
  title: 'Example Program', organization: 'Example Org', url: 'https://example.org',
  cluster: 'STEM', type: 'Summer Program', grades: [10, 11],
  description: 'A free summer program where students learn engineering by building projects.',
  submitterRole: 'Student', consent: true,
};

describe('HTTP API', () => {
  let server;
  let base;

  before(async () => {
    server = createApp({ opportunities }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('sends security headers', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  test('serves pages, vendor assets, and a 404 page', async () => {
    for (const p of ['/dashboard', '/profile', '/submission', '/references', '/vendor/lucide/lucide.min.js']) {
      assert.equal((await fetch(base + p)).status, 200, p);
    }
    assert.equal((await fetch(`${base}/missing-page`)).status, 404);
    assert.equal((await fetch(`${base}/api/missing`)).status, 404);
  });

  test('does not expose server source or data files', async () => {
    for (const p of ['/server/index.js', '/package.json', '/.env', '/data/opportunities/stem.json', '/../server/index.js']) {
      assert.equal((await fetch(base + p)).status, 404, p);
    }
  });

  test('returns opportunities with cluster metadata', async () => {
    const json = await (await fetch(`${base}/api/opportunities`)).json();
    assert.equal(json.count, opportunities.length);
    assert.ok(json.clusters.STEM);
    assert.ok(Array.isArray(json.types));
  });

  test('rejects cross-origin POSTs', async () => {
    const res = await fetch(`${base}/api/submissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify(goodSubmission),
    });
    assert.equal(res.status, 403);
  });

  test('accepts same-host POSTs even when TLS is terminated by a proxy', async () => {
    const host = new URL(base).host;
    const res = await fetch(`${base}/api/submissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `https://${host}` },
      body: JSON.stringify(goodSubmission),
    });
    assert.equal(res.status, 201);
  });

  test('rejects oversized bodies', async () => {
    const res = await fetch(`${base}/api/submissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...goodSubmission, description: 'x'.repeat(100_000) }),
    });
    assert.equal(res.status, 413);
  });

  test('accepts valid submissions and queues them for review', async () => {
    const good = goodSubmission;
    const res = await fetch(`${base}/api/submissions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(good) });
    assert.equal(res.status, 201);
    const queue = fs.readFileSync(path.join(tmp, 'queue.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(queue.at(-1).title, 'Example Program');
    assert.equal(queue.at(-1).status, 'pending-review');

    const bad = await fetch(`${base}/api/submissions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...good, url: 'javascript:alert(1)' }) });
    assert.equal(bad.status, 400);

    const before = fs.readFileSync(path.join(tmp, 'queue.jsonl'), 'utf8');
    const bot = await fetch(`${base}/api/submissions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...good, website2: 'spam' }) });
    assert.equal(bot.status, 202);
    assert.equal(fs.readFileSync(path.join(tmp, 'queue.jsonl'), 'utf8'), before, 'honeypot submissions must not be stored');
  });
});

describe('removed AI service', () => {
  test('the server exposes no chat endpoint', async () => {
    const server = createApp({ opportunities }).listen(0);
    await new Promise((r) => server.once('listening', r));
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 404);
    server.close();
  });
});
