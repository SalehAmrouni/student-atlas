// Weekly opportunity checker, run by .github/workflows/check-opportunities.yml (or by hand).
//
// 1. Visits every opportunity's official site (respecting robots.txt, one request per host at a
//    time with a delay) and records in data/status.json whether the link works, the exact deadline
//    for this cycle when the page states one, and whether the page says applications are closed.
// 2. Looks for new opportunities: links on those pages and on the listing pages in
//    data/sources.json whose text names a program (internship, scholarship, competition, ...)
//    and that aren't in the directory yet. They go to data/candidates.json for a person to review;
//    nothing is added to the directory automatically.
// 3. Writes a Markdown report of what changed (used as the pull request description).
//
// Usage: node scripts/check-opportunities.js [--only id,id] [--limit N] [--no-discover]
//                                             [--report path] [--today YYYY-MM-DD] [--dry-run]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadOpportunities, loadStatus, StatusFileSchema } from '../server/opportunities.js';
import {
  createFetcher, htmlToText, extractLinks, findDeadlineDates, pickDeadline, findClosedNotice,
  looksLikeOpportunity, urlKey,
} from './lib/scrape.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATUS_FILE = path.join(root, 'data', 'status.json');
const SOURCES_FILE = path.join(root, 'data', 'sources.json');
const CANDIDATES_FILE = path.join(root, 'data', 'candidates.json');

const { values: args } = parseArgs({
  options: {
    only: { type: 'string' },
    limit: { type: 'string' },
    'no-discover': { type: 'boolean', default: false },
    report: { type: 'string' },
    today: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '6' },
  },
});

const today = args.today ?? new Date().toISOString().slice(0, 10);
const MAX_NEW_CANDIDATES = 40;
const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);
const writeJson = (file, data) => fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

const all = loadOpportunities();
let targets = all;
if (args.only) {
  const ids = new Set(args.only.split(',').map((s) => s.trim()));
  targets = all.filter((o) => ids.has(o.id));
}
if (args.limit) targets = targets.slice(0, Number(args.limit));

const previous = loadStatus();
const status = { ...previous };
const fetcher = createFetcher();
const discovered = []; // { url, title, foundOn }

function isHtml(res) {
  return /html|xml/i.test(res.contentType) || /^\s*</.test(res.body.slice(0, 200));
}

function classifyLink(res) {
  if (res.error === 'robots-disallowed') return 'blocked';
  if (res.error) return 'error';
  if (res.status === 404 || res.status === 410) return 'broken';
  if (res.status === 401 || res.status === 403 || res.status === 429) return 'blocked';
  return res.status >= 200 && res.status < 300 ? 'ok' : 'error';
}

async function checkOne(opp) {
  const prev = previous[opp.id];
  const res = await fetcher.get(opp.url);
  const linkStatus = classifyLink(res);
  const entry = {
    lastChecked: today,
    linkStatus,
    httpStatus: res.status ?? null,
    // Keep the last known deadline when this run couldn't read the page or found nothing new.
    nextDeadline: prev?.nextDeadline ?? null,
    deadlineEvidence: prev?.deadlineEvidence ?? null,
    applicationsClosed: prev?.applicationsClosed ?? false,
    closedEvidence: prev?.closedEvidence ?? null,
  };

  if (linkStatus === 'ok' && isHtml(res)) {
    const text = htmlToText(res.body);
    const picked = pickDeadline(findDeadlineDates(text), today);
    if (picked) {
      entry.nextDeadline = picked.date;
      entry.deadlineEvidence = picked.evidence;
    }
    const closed = findClosedNotice(text);
    entry.applicationsClosed = Boolean(closed);
    entry.closedEvidence = closed;

    const host = new URL(res.finalUrl).hostname;
    for (const link of extractLinks(res.body, res.finalUrl)) {
      // Program pages often link to sibling programs on the same site.
      if (new URL(link.url).hostname === host && looksLikeOpportunity(link.text, link.url)) {
        discovered.push({ url: link.url, title: link.text, foundOn: opp.url });
      }
    }
  }
  status[opp.id] = entry;
  return { opp, prev, entry, res };
}

async function scanSource(source) {
  const res = await fetcher.get(source.url);
  if (res.error || res.status >= 400 || !isHtml(res)) return { source, ok: false, reason: res.error ?? `HTTP ${res.status}` };
  let count = 0;
  for (const link of extractLinks(res.body, res.finalUrl)) {
    if (looksLikeOpportunity(link.text, link.url)) {
      discovered.push({ url: link.url, title: link.text, foundOn: source.url, cluster: source.cluster ?? null });
      count += 1;
    }
  }
  return { source, ok: true, count };
}

/** Runs `fn` over `items` with at most `n` in flight (the fetcher still serializes each host). */
async function pool(items, n, fn) {
  const results = [];
  let i = 0;
  let done = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
      done += 1;
      if (done % 25 === 0) console.log(`  ${done}/${items.length}`);
    }
  }));
  return results;
}

console.log(`Checking ${targets.length} opportunities (today is ${today})…`);
const concurrency = Math.max(1, Number(args.concurrency) || 6);
const checks = await pool(targets, concurrency, checkOne);

const sources = args['no-discover'] ? [] : readJson(SOURCES_FILE, []);
const sourceResults = sources.length ? await pool(sources, concurrency, scanSource) : [];

// ---- candidates ------------------------------------------------------------------
const candidates = readJson(CANDIDATES_FILE, []);
const known = new Set([...all.map((o) => urlKey(o.url)), ...candidates.map((c) => urlKey(c.url))]);
const newCandidates = [];
if (!args['no-discover']) {
  for (const d of discovered) {
    const key = urlKey(d.url);
    if (known.has(key) || newCandidates.length >= MAX_NEW_CANDIDATES) continue;
    known.add(key);
    newCandidates.push({ title: d.title, url: d.url, foundOn: d.foundOn, cluster: d.cluster ?? null, firstSeen: today, status: 'new' });
  }
}

// ---- report ----------------------------------------------------------------------
const fmt = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const quote = (s) => (s ? ` — “${s.replace(/\s+/g, ' ').replace(/[|`]/g, ' ')}”` : '');
const sections = { broken: [], recovered: [], deadline: [], expired: [], closed: [], reopened: [], blocked: [], error: [] };
for (const { opp, prev, entry, res } of checks) {
  const name = `[${opp.title}](${opp.url})`;
  if (entry.linkStatus === 'broken' && prev?.linkStatus !== 'broken') sections.broken.push(`- ${name}: HTTP ${res.status} (\`${opp.id}\`)`);
  if (entry.linkStatus === 'ok' && prev?.linkStatus === 'broken') sections.recovered.push(`- ${name}`);
  if (entry.linkStatus === 'blocked') sections.blocked.push(`- ${name}: ${res.error ?? `HTTP ${res.status}`}`);
  if (entry.linkStatus === 'error') sections.error.push(`- ${name}: ${res.error ?? `HTTP ${res.status}`}`);
  if (entry.nextDeadline && entry.nextDeadline !== prev?.nextDeadline) {
    const line = `- ${name}: ${fmt(entry.nextDeadline)}${prev?.nextDeadline ? ` (was ${fmt(prev.nextDeadline)})` : ''}${quote(entry.deadlineEvidence)}`;
    (entry.nextDeadline < today ? sections.expired : sections.deadline).push(line);
  } else if (entry.nextDeadline && entry.nextDeadline < today && !(prev?.nextDeadline < today)) {
    sections.expired.push(`- ${name}: deadline ${fmt(entry.nextDeadline)} has passed`);
  }
  if (entry.applicationsClosed && !prev?.applicationsClosed) sections.closed.push(`- ${name}${quote(entry.closedEvidence)}`);
  if (!entry.applicationsClosed && prev?.applicationsClosed && entry.linkStatus === 'ok') sections.reopened.push(`- ${name}`);
}

const meaningful = ['broken', 'recovered', 'deadline', 'expired', 'closed', 'reopened'].some((k) => sections[k].length) || newCandidates.length > 0;
const counts = Object.values(status).reduce((acc, s) => {
  acc[s.linkStatus] = (acc[s.linkStatus] ?? 0) + 1;
  if (s.nextDeadline) acc.dated += 1;
  if (s.nextDeadline && s.nextDeadline < today) acc.expired += 1;
  if (s.applicationsClosed) acc.closed += 1;
  return acc;
}, { dated: 0, expired: 0, closed: 0 });

const part = (title, lines, note = '') => (lines.length ? `### ${title} (${lines.length})\n${note ? `${note}\n\n` : ''}${lines.join('\n')}\n` : '');
const report = [
  `## Opportunity check, ${fmt(today)}`,
  `Checked ${checks.length} official sites${sources.length ? ` and ${sources.length} listing pages` : ''}. `
    + `Links OK: ${counts.ok ?? 0}, broken: ${counts.broken ?? 0}, blocked by the site: ${counts.blocked ?? 0}, errors: ${counts.error ?? 0}. `
    + `${counts.dated} have an exact deadline (${counts.expired} passed), ${counts.closed} say applications are closed.`,
  'Everything below was found automatically. Please spot-check the quoted text before merging; the site shows exact dates and "closed" notices to students as soon as this merges.',
  part('Broken links', sections.broken, 'The official page returned 404 or 410. Find the new URL or remove the listing.'),
  part('Links working again', sections.recovered),
  part('New or changed upcoming deadlines', sections.deadline),
  part('Deadlines that have passed', sections.expired, 'Shown to students as "Deadline passed" until the next cycle\'s date is posted.'),
  part('Applications closed', sections.closed),
  part('No longer marked closed', sections.reopened),
  newCandidates.length
    ? `### Possible new opportunities (${newCandidates.length})\nAdded to \`data/candidates.json\`. To list one, add a full entry to \`data/opportunities/\` and remove it from candidates; to dismiss one, set its \`status\` to \`"rejected"\` so it isn't suggested again.\n\n${newCandidates.map((c) => `- [${c.title.replace(/[[\]]/g, '')}](${c.url}) (found on ${c.foundOn})`).join('\n')}\n`
    : '',
  sourceResults.some((r) => !r.ok) ? part('Listing pages that could not be read', sourceResults.filter((r) => !r.ok).map((r) => `- ${r.source.url}: ${r.reason}`)) : '',
  sections.blocked.length || sections.error.length
    ? `<details><summary>Sites that blocked the checker or failed (${sections.blocked.length + sections.error.length})</summary>\n\nThese keep their previous deadline info; check them by hand if they stay unreachable.\n\n${[...sections.blocked, ...sections.error].join('\n')}\n</details>\n`
    : '',
].map((l) => l.trim()).filter(Boolean).join('\n\n');

StatusFileSchema.parse(status);
if (!args['dry-run']) {
  const sorted = Object.fromEntries(Object.keys(status).sort().map((k) => [k, status[k]]));
  writeJson(STATUS_FILE, sorted);
  if (newCandidates.length) writeJson(CANDIDATES_FILE, [...candidates, ...newCandidates]);
}
// GitHub caps pull request descriptions at 65,536 characters.
const body = report.length > 60_000 ? `${report.slice(0, 60_000)}\n\n…(report truncated)` : report;
if (args.report) fs.writeFileSync(args.report, `${body}\n`);
else console.log(`\n${report}`);

if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `meaningful=${meaningful}\n`);
console.log(`\nDone. Meaningful changes: ${meaningful ? 'yes' : 'no'}.`);
