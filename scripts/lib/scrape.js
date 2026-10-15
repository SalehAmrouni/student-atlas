// Polite web scraping helpers for the opportunity checker:
//   - robots.txt parsing (RFC 9309), checked before every request
//   - a fetcher with a per-host delay, a timeout, a size cap, and manual redirects
//   - HTML to text, link extraction, deadline-date extraction, and "applications closed" detection
// Everything except `createFetcher` is a pure function so it can be unit tested offline.

export const USER_AGENT_TOKEN = 'StudentAtlasBot';
export const USER_AGENT = `${USER_AGENT_TOKEN}/1.0 (+https://github.com/SalehAmrouni/student-atlas; checks listed opportunities weekly)`;

// ---------------------------------------------------------------------------
// robots.txt

/** Parses robots.txt into groups of { agents, rules: [{ allow, pattern }], crawlDelay }. */
export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      // An empty Disallow means "allow everything" and adds no rule.
      if (value) current.rules.push({ allow: key === 'allow', pattern: value });
    } else if (key === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }
  return groups;
}

function patternToRegex(pattern) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** The groups that apply to our crawler: the ones naming it, else the `*` group. */
function groupsFor(groups, agentToken) {
  const token = agentToken.toLowerCase();
  const named = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  return named.length ? named : groups.filter((g) => g.agents.includes('*'));
}

/** True when `pathWithQuery` may be fetched. Longest matching rule wins; Allow wins a tie. */
export function isAllowedByRobots(groups, pathWithQuery, agentToken = USER_AGENT_TOKEN) {
  if (pathWithQuery === '/robots.txt') return true;
  let best = null;
  for (const g of groupsFor(groups, agentToken)) {
    for (const rule of g.rules) {
      if (!patternToRegex(rule.pattern).test(pathWithQuery)) continue;
      const len = rule.pattern.length;
      if (!best || len > best.len || (len === best.len && rule.allow)) best = { len, allow: rule.allow };
    }
  }
  return best ? best.allow : true;
}

export function crawlDelayFor(groups, agentToken = USER_AGENT_TOKEN) {
  const delays = groupsFor(groups, agentToken).map((g) => g.crawlDelay).filter((d) => d !== null);
  return delays.length ? Math.max(...delays) : null;
}

// ---------------------------------------------------------------------------
// HTML

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', hellip: '…', middot: '·', bull: '•', reg: '®', copy: '©', trade: '™',
};

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Visible text of an HTML page, one line per block element. */
export function htmlToText(html) {
  return decodeEntities(String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/?(p|div|li|ul|ol|br|h[1-6]|tr|td|th|table|section|article|header|footer|nav|main|aside|dt|dd|blockquote|hr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n[\n ]*/g, '\n')
    .trim();
}

/** Links on a page as { url, text }, resolved against `baseUrl`, https only, deduplicated. */
export function extractLinks(html, baseUrl) {
  const seen = new Set();
  const links = [];
  for (const m of String(html).matchAll(/<a\b[^>]*?\bhref\s*=\s*(["'])([^"']*)\1[^>]*>([\s\S]*?)<\/a\s*>/gi)) {
    let url;
    try {
      url = new URL(decodeEntities(m[2].trim()), baseUrl);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:') continue;
    url.hash = '';
    const text = htmlToText(m[3]).replace(/\s+/g, ' ').trim();
    const key = url.href;
    if (!text || seen.has(key)) continue;
    seen.add(key);
    links.push({ url: key, text });
  }
  return links;
}

/** host + path without "www.", trailing slash, query, or hash, for comparing URLs. */
export function urlKey(url) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return String(url).toLowerCase();
  }
}

// ---------------------------------------------------------------------------
// Deadlines

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

// Each pattern returns [year, month, day] from its match. Dates without a year are ignored on purpose:
// "due March 1" on a stale page could mean last year or next year, and guessing wrong would mislead students.
const DATE_PATTERNS = [
  { re: new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'), ymd: (m) => [m[3], MONTHS[m[1].toLowerCase()], m[2]] },
  { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?,?\\s+(\\d{4})\\b`, 'gi'), ymd: (m) => [m[3], MONTHS[m[2].toLowerCase()], m[1]] },
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, ymd: (m) => [m[1], m[2], m[3]] },
  { re: /\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g, ymd: (m) => [m[3].length === 2 ? `20${m[3]}` : m[3], m[1], m[2]] },
];

const DEADLINE_CUE = /\b(deadlines?|due|apply by|submit(?:ted)?\s+(?:by|no later than)|applications?\s+(?:close|closes|closing|must be (?:received|submitted)|are due|is due)|closes?|closing date|last day to (?:apply|register|submit)|postmarked|no later than|register by|registration (?:closes|deadline|ends))\b/gi;
const OTHER_CUE = /\b(opens?|opening|launch(?:es)?|begins?|starts?|program dates?|session dates?|notif(?:y|ied|ication)|announced?|announcements?|decisions?|results|interviews?|orientation|arriv(?:e|al)|move-in|ceremony|published|posted|updated|copyright|event|held on|takes place|runs from)\b/gi;

export function toIsoDate(y, m, d) {
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!(year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCMonth() !== month - 1) return null; // e.g. February 30
  return dt.toISOString().slice(0, 10);
}

function lastCueIndex(text, re) {
  let last = -1;
  for (const m of text.matchAll(re)) last = m.index + m[0].length;
  return last;
}

/**
 * Finds dates that a page presents as application deadlines: a date counts when the nearest cue
 * word in the text just before it (same line, up to ~120 characters) is a deadline cue such as
 * "deadline", "due", or "applications close", not "opens", "program dates", or "notified".
 * Returns [{ date: 'YYYY-MM-DD', evidence }] sorted by date.
 */
export function findDeadlineDates(text) {
  const found = new Map();
  for (const line of String(text).split('\n')) {
    for (const { re, ymd } of DATE_PATTERNS) {
      for (const m of line.matchAll(re)) {
        const date = toIsoDate(...ymd(m));
        if (!date) continue;
        const before = line.slice(Math.max(0, m.index - 120), m.index);
        const deadlineAt = lastCueIndex(before, DEADLINE_CUE);
        if (deadlineAt < 0 || lastCueIndex(before, OTHER_CUE) > deadlineAt) continue;
        if (!found.has(date)) {
          const start = Math.max(0, m.index - 100);
          const evidence = `${start > 0 ? '…' : ''}${line.slice(start, m.index + m[0].length + 40).trim()}`.slice(0, 200);
          found.set(date, { date, evidence });
        }
      }
    }
  }
  return [...found.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const DAY = 86_400_000;

/**
 * Picks the deadline to show: the soonest one on or after `today`, otherwise the most recent past
 * one (which marks the listing as expired until the organization posts the next cycle).
 * Dates more than ~13 months back or ~18 months ahead are ignored as noise.
 */
export function pickDeadline(dates, today) {
  const t = Date.parse(`${today}T00:00:00Z`);
  const inRange = dates.filter(({ date }) => {
    const d = Date.parse(`${date}T00:00:00Z`);
    return d >= t - 400 * DAY && d <= t + 550 * DAY;
  });
  const upcoming = inRange.filter(({ date }) => date >= today);
  if (upcoming.length) return { ...upcoming[0], expired: false };
  const past = inRange.at(-1);
  return past ? { ...past, expired: true } : null;
}

const CLOSED_PATTERNS = [
  /\bapplications?\s+(?:for\s+(?:the\s+)?[\w\s-]{1,40}?\s+)?(?:(?:are|is|have|has)\s+)?(?:now\s+)?(?:been\s+)?closed\b/i,
  /\b(?:the\s+)?application\s+(?:period|window|cycle)\s+(?:is|has)\s+(?:now\s+)?(?:closed|ended)\b/i,
  /\b(?:no longer|not currently|is not currently|are not currently)\s+accepting\s+(?:new\s+)?(?:applications|submissions|nominations|entries)\b/i,
  /\bregistration\s+(?:is|has)\s+(?:now\s+)?closed\b/i,
  /\b(?:this\s+)?program\s+(?:has\s+been|is|was)\s+(?:discontinued|cancell?ed|suspended|retired)\b/i,
  /\bwill\s+not\s+be\s+(?:offered|held|running)\s+(?:this|in)\b/i,
];

/** The first sentence-sized snippet saying applications are closed or the program ended, or null. */
export function findClosedNotice(text) {
  for (const re of CLOSED_PATTERNS) {
    const m = String(text).match(re);
    if (!m) continue;
    const start = Math.max(0, m.index - 60);
    return String(text).slice(start, m.index + m[0].length + 60).replace(/\s+/g, ' ').trim().slice(0, 200);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Discovery

const OPPORTUNITY_WORDS = /\b(internships?|scholarships?|summer (?:programs?|institutes?|academy|camps?|research|scholars)|research (?:programs?|institutes?|internships?|apprenticeships?)|competitions?|challenges?|olympiads?|fellowships?|apprenticeships?|pre-college|precollege|youth (?:programs?|council|ambassadors?)|high school (?:programs?|students|scholars|internships?)|teen (?:programs?|council|internships?))\b/i;
const NOT_A_PROGRAM = /\b(apply now|learn more|read more|click here|donate|give|log ?in|sign ?in|sign up for (?:our|the) newsletter|subscribe|privacy|terms|cookie|careers at|jobs at|press|news ?room|faq|contact|alumni|staff|board of|annual report|past winners|winners announced|results)\b/i;

/** True when a link's text looks like it names a program a student could join. */
export function looksLikeOpportunity(text) {
  const t = text.trim();
  return t.length >= 8 && t.length <= 120 && OPPORTUNITY_WORDS.test(t) && !NOT_A_PROGRAM.test(t);
}

// ---------------------------------------------------------------------------
// Fetching

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A fetcher that checks robots.txt for every URL (including each redirect hop), waits between
 * requests to the same host (at least `minDelayMs`, or the site's Crawl-delay up to 30s), and
 * stops reading bodies after `maxBytes`.
 * `get(url)` resolves to { status, finalUrl, contentType, body } or { error, finalUrl } and never throws.
 */
export function createFetcher({ fetchImpl = globalThis.fetch, minDelayMs = 1500, timeoutMs = 20_000, maxBytes = 2_000_000, maxRedirects = 5 } = {}) {
  const robotsCache = new Map();
  const nextSlot = new Map();

  // Waits for the host's next free slot and books the one after it. `release` pushes that slot back
  // so the delay is measured from when the response finished, not when the request started.
  async function throttle(host, delayMs) {
    const now = Date.now();
    const at = Math.max(now, nextSlot.get(host) ?? 0);
    nextSlot.set(host, at + delayMs);
    if (at > now) await sleep(at - now);
    return () => nextSlot.set(host, Math.max(nextSlot.get(host) ?? 0, Date.now() + delayMs));
  }

  async function rawGet(url, accept) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'en-US,en;q=0.8' },
      });
      let body = '';
      if (res.body && !(res.status >= 300 && res.status < 400)) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          body += decoder.decode(value, { stream: true });
          if (size >= maxBytes) {
            await reader.cancel();
            body = body.slice(0, maxBytes);
            break;
          }
        }
      }
      return { status: res.status, headers: res.headers, body };
    } finally {
      clearTimeout(timer);
    }
  }

  // RFC 9309: a 4xx robots.txt means no restrictions; an unreachable one (5xx or network error) means stay out.
  async function robotsFor(origin) {
    if (!robotsCache.has(origin)) {
      robotsCache.set(origin, (async () => {
        const release = await throttle(new URL(origin).host, minDelayMs);
        try {
          const res = await rawGet(`${origin}/robots.txt`, 'text/plain,*/*;q=0.5');
          if (res.status >= 200 && res.status < 300) return { groups: parseRobots(res.body), reachable: true };
          if (res.status >= 400 && res.status < 500) return { groups: [], reachable: true };
          return { groups: [], reachable: false };
        } catch {
          return { groups: [], reachable: false };
        } finally {
          release();
        }
      })());
    }
    return robotsCache.get(origin);
  }

  async function get(startUrl) {
    let url = startUrl;
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      let u;
      try {
        u = new URL(url);
      } catch {
        return { error: 'invalid-url', finalUrl: url };
      }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'invalid-url', finalUrl: url };
      const robots = await robotsFor(u.origin);
      if (!robots.reachable) return { error: 'robots-unreachable', finalUrl: url };
      if (!isAllowedByRobots(robots.groups, `${u.pathname}${u.search}`)) return { error: 'robots-disallowed', finalUrl: url };
      const delay = Math.max(minDelayMs, Math.min(30, crawlDelayFor(robots.groups) ?? 0) * 1000);
      const release = await throttle(u.host, delay);
      let res;
      try {
        res = await rawGet(url, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5');
      } catch (err) {
        return { error: err.name === 'AbortError' ? 'timeout' : 'network', finalUrl: url };
      } finally {
        release();
      }
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        url = new URL(location, url).href;
        continue;
      }
      return { status: res.status, finalUrl: url, contentType: res.headers.get('content-type') ?? '', body: res.body };
    }
    return { error: 'too-many-redirects', finalUrl: url };
  }

  return { get };
}
