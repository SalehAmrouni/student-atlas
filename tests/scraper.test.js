import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';

const {
  parseRobots, isAllowedByRobots, crawlDelayFor, htmlToText, extractLinks, findDeadlineDates, pickDeadline,
  findClosedNotice, looksLikeOpportunity, urlKey, toIsoDate, createFetcher,
} = await import('../scripts/lib/scrape.js');
const { loadOpportunities, loadStatus, withStatus, StatusFileSchema } = await import('../server/opportunities.js');

describe('robots.txt', () => {
  const robots = parseRobots(`
# comment
User-agent: *
Disallow: /private/
Allow: /private/open-house
Disallow: /*.pdf$
Crawl-delay: 4

User-agent: BadBot
User-agent: StudentAtlasBot
Disallow: /no-bots
`);

  test('our named group wins over *', () => {
    assert.equal(isAllowedByRobots(robots, '/no-bots/page'), false);
    assert.equal(isAllowedByRobots(robots, '/private/x'), true, 'the * rules do not apply once a group names us');
    assert.equal(isAllowedByRobots(robots, '/private/x', 'OtherBot'), false);
  });

  test('longest match wins, Allow wins ties, and wildcards work', () => {
    assert.equal(isAllowedByRobots(robots, '/private/open-house', 'OtherBot'), true);
    assert.equal(isAllowedByRobots(robots, '/files/a.pdf', 'OtherBot'), false);
    assert.equal(isAllowedByRobots(robots, '/files/a.pdf?x=1', 'OtherBot'), true);
    assert.equal(isAllowedByRobots(parseRobots('User-agent: *\nDisallow:'), '/anything'), true);
    assert.equal(isAllowedByRobots([], '/anything'), true);
  });

  test('reads Crawl-delay', () => {
    assert.equal(crawlDelayFor(robots, 'OtherBot'), 4);
    assert.equal(crawlDelayFor(robots), null);
  });
});

describe('HTML parsing', () => {
  const html = `<html><head><style>.x{}</style><script>var deadline = "March 1, 2020";</script></head>
    <body><h1>Summer Program</h1><p>Apply&nbsp;now &amp; <b>soon</b>.</p>
    <a href="/programs/research-internship#top">High School Research Internship</a>
    <a href='http://insecure.example/x'>Insecure Scholarship</a>
    <a href="https://other.example/a">Learn more</a></body></html>`;

  test('htmlToText drops scripts and keeps block lines', () => {
    const text = htmlToText(html);
    assert.ok(!text.includes('var deadline'));
    assert.match(text, /^Summer Program\nApply now & soon \.$/m);
  });

  test('extractLinks resolves relative https links and drops http', () => {
    const links = extractLinks(html, 'https://example.org/about/');
    assert.deepEqual(links.map((l) => l.url), ['https://example.org/programs/research-internship', 'https://other.example/a']);
    assert.equal(links[0].text, 'High School Research Internship');
  });

  test('urlKey ignores www, trailing slashes, and query strings', () => {
    assert.equal(urlKey('https://www.Example.org/path/?utm=1'), urlKey('https://example.org/path'));
  });
});

describe('deadline extraction', () => {
  test('parses common date formats next to deadline words', () => {
    const text = [
      'Applications are due March 1, 2027 at 11:59 pm.',
      'Deadline: 15 January 2027',
      'Priority deadline 2026-12-01',
      'Submit by 2/14/27.',
    ].join('\n');
    assert.deepEqual(findDeadlineDates(text).map((d) => d.date), ['2026-12-01', '2027-01-15', '2027-02-14', '2027-03-01']);
  });

  test('ignores dates that are not deadlines or have no year', () => {
    const text = [
      'Applications open January 5, 2027.',
      'The program runs from June 20, 2027 to August 1, 2027.',
      'Finalists will be notified April 2, 2027.',
      'Last updated: May 3, 2026',
      'Applications are due March 1.',
      'Deadline: February 30, 2027',
    ].join('\n');
    assert.deepEqual(findDeadlineDates(text), []);
  });

  test('uses the nearest cue: "open ... and are due" keeps only the due date', () => {
    const dates = findDeadlineDates('Applications open Nov 1, 2026 and are due Jan. 10th, 2027.');
    assert.deepEqual(dates.map((d) => d.date), ['2027-01-10']);
    assert.match(dates[0].evidence, /due Jan\. 10th, 2027/);
  });

  test('pickDeadline prefers the soonest upcoming date, else the latest past one', () => {
    const dates = [{ date: '2026-03-01' }, { date: '2026-11-01' }, { date: '2027-02-01' }].map((d) => ({ ...d, evidence: '' }));
    assert.deepEqual(pickDeadline(dates, '2026-10-15'), { date: '2026-11-01', evidence: '', expired: false });
    assert.deepEqual(pickDeadline(dates.slice(0, 1), '2026-10-15'), { date: '2026-03-01', evidence: '', expired: true });
    assert.equal(pickDeadline([{ date: '2019-01-01', evidence: '' }], '2026-10-15'), null, 'stale dates are noise');
    assert.equal(pickDeadline([], '2026-10-15'), null);
  });

  test('toIsoDate rejects impossible dates', () => {
    assert.equal(toIsoDate(2027, 2, 29), null);
    assert.equal(toIsoDate(2028, 2, 29), '2028-02-29');
  });
});

describe('closed notices and discovery', () => {
  test('finds "applications closed" and discontinued programs', () => {
    assert.match(findClosedNotice('Thank you! Applications for 2027 are now closed. Check back in fall.'), /are now closed/);
    assert.match(findClosedNotice('We are no longer accepting applications this year.'), /no longer accepting applications/);
    assert.match(findClosedNotice('Sadly, this program has been discontinued.'), /discontinued/);
    assert.equal(findClosedNotice('Applications are open until March 1, 2027.'), null);
    assert.equal(findClosedNotice('Our offices are closed on federal holidays.'), null);
  });

  test('looksLikeOpportunity keeps program names and drops navigation', () => {
    assert.ok(looksLikeOpportunity('Summer Research Internship for High School Students'));
    assert.ok(looksLikeOpportunity('National Youth Science Olympiad'));
    assert.ok(!looksLikeOpportunity('Learn more'));
    assert.ok(!looksLikeOpportunity('Donate to our scholarship fund'));
    assert.ok(!looksLikeOpportunity('2026 competition results'));
  });
});

describe('polite fetcher', () => {
  let server;
  let base;
  const hits = [];
  before(async () => {
    server = http.createServer((req, res) => {
      hits.push({ path: req.url, ua: req.headers['user-agent'], at: Date.now() });
      if (req.url === '/robots.txt') return res.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: *\nDisallow: /secret\n');
      if (req.url === '/old') return res.writeHead(301, { location: '/new' }).end();
      if (req.url === '/to-secret') return res.writeHead(302, { location: '/secret' }).end();
      if (req.url === '/new') return res.writeHead(200, { 'content-type': 'text/html' }).end('<p>Deadline: June 1, 2027</p>');
      if (req.url === '/big') return res.writeHead(200, { 'content-type': 'text/html' }).end('x'.repeat(50_000));
      return res.writeHead(404).end('not found');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  test('follows redirects, honors robots.txt on every hop, waits between requests, and caps size', async () => {
    const fetcher = createFetcher({ minDelayMs: 50, maxBytes: 1000 });
    const ok = await fetcher.get(`${base}/old`);
    assert.equal(ok.status, 200);
    assert.equal(ok.finalUrl, `${base}/new`);
    assert.match(ok.body, /June 1, 2027/);

    assert.equal((await fetcher.get(`${base}/secret`)).error, 'robots-disallowed');
    assert.equal((await fetcher.get(`${base}/to-secret`)).error, 'robots-disallowed');
    assert.equal((await fetcher.get(`${base}/missing`)).status, 404);
    assert.ok((await fetcher.get(`${base}/big`)).body.length < 50_000);

    assert.equal(hits.filter((h) => h.path === '/robots.txt').length, 1, 'robots.txt is cached per host');
    assert.ok(hits.every((h) => h.ua.startsWith('StudentAtlasBot/')));
    assert.ok(!hits.some((h) => h.path === '/secret'));
    for (let i = 1; i < hits.length; i += 1) assert.ok(hits[i].at - hits[i - 1].at >= 45, 'requests to one host are spaced out');
  });

  test('treats an unreachable robots.txt as "stay out"', async () => {
    const fetcher = createFetcher({ minDelayMs: 0, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    assert.equal((await fetcher.get('https://down.example/page')).error, 'robots-unreachable');
  });
});

describe('status data', () => {
  test('data/status.json is valid and only names known opportunities', () => {
    const status = loadStatus();
    const ids = new Set(loadOpportunities().map((o) => o.id));
    assert.ok(Object.keys(status).every((id) => ids.has(id)));
  });

  test('withStatus merges checker fields into opportunities', () => {
    const [opp] = loadOpportunities();
    const status = StatusFileSchema.parse({
      [opp.id]: { lastChecked: '2026-10-15', linkStatus: 'ok', httpStatus: 200, nextDeadline: '2027-01-15', deadlineEvidence: 'Deadline: January 15, 2027', applicationsClosed: false, closedEvidence: null },
    });
    const [merged] = withStatus([opp], status);
    assert.equal(merged.nextDeadline, '2027-01-15');
    assert.equal(merged.lastChecked, '2026-10-15');
    assert.equal(merged.title, opp.title);
  });

  test('sources and candidates files are well formed', () => {
    for (const file of ['data/sources.json', 'data/candidates.json']) {
      const list = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.ok(Array.isArray(list));
      assert.ok(list.every((s) => s.url.startsWith('https://')), `${file}: https URLs only`);
    }
  });
});

describe('deadline status on the site', async () => {
  const { deadlineStatus, isExpired, monthsUntilDeadline, deadlineHint } = await import('../public/js/lib/data.js');
  const now = new Date(2026, 9, 15, 12); // Oct 15, 2026
  const base = { deadlineMonth: 2 };

  test('labels upcoming, passed, and closed deadlines', () => {
    assert.deepEqual(deadlineStatus({ ...base, nextDeadline: '2026-10-15' }, now), { state: 'open', days: 0, label: 'Due today' });
    assert.equal(deadlineStatus({ ...base, nextDeadline: '2026-12-01' }, now).label, 'Due Dec 1, 2026');
    assert.equal(deadlineStatus({ ...base, nextDeadline: '2026-10-14' }, now).state, 'expired');
    assert.equal(deadlineStatus({ ...base, nextDeadline: '2027-01-01', applicationsClosed: true }, now).state, 'closed');
    assert.equal(deadlineStatus(base, now), null);
    assert.ok(isExpired({ ...base, nextDeadline: '2026-01-01' }, now));
    assert.ok(!isExpired(base, now));
  });

  test('exact upcoming dates drive "due soon"; passed ones fall back to the typical month', () => {
    assert.equal(monthsUntilDeadline({ ...base, nextDeadline: '2026-11-20' }, now), 1);
    assert.equal(deadlineHint({ ...base, nextDeadline: '2026-11-20' }, now), 'Due Nov 20, 2026');
    assert.equal(monthsUntilDeadline({ ...base, nextDeadline: '2026-02-01' }, now), 4);
    assert.equal(deadlineHint({ ...base, nextDeadline: '2026-02-01' }, now), null);
  });
});
