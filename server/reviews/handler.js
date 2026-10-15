// Request handlers for opportunity reviews, written against the web-standard
// Request/Response so the same code runs as a Vercel function (api/) and
// inside the local Express server.
//
//   GET  /api/reviews                    star summaries for every opportunity
//   GET  /api/reviews?id=<opp>&offset=N  one opportunity's summary + reviews
//   POST /api/reviews {action:"create"}  write a review
//   POST /api/reviews {action:"report"}  report a review
//   GET  /api/reviews-admin              moderation queue (Bearer token)
//   POST /api/reviews-admin              approve or remove a review (Bearer token)

import crypto from 'node:crypto';
import { LIMITS, validateReview, validateReport, publicReview, isOpportunityId, isReviewId } from './validate.js';

export const PAGE_SIZE = 10;
export const REPORTS_TO_HIDE = 3;
const RATE = {
  createBurst: { max: 3, seconds: 10 * 60 },
  createDaily: { max: 10, seconds: 24 * 60 * 60 },
  report: { max: 10, seconds: 60 * 60 },
  adminFail: { max: 10, seconds: 15 * 60 },
};
const ONE_REVIEW_PER_OPP_SECONDS = 180 * 24 * 60 * 60;
const MIN_FILL_MS = 3000;

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest();

function clientIp(request) {
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/** Blocks cross-site form posts and scripts on other sites. */
function sameOrigin(request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readJson(request) {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) return { error: json(415, { error: 'Send JSON.' }) };
  const text = await request.text();
  if (Buffer.byteLength(text) > LIMITS.requestBytes) return { error: json(413, { error: 'That review is too long.' }) };
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' ? { body } : { error: json(400, { error: 'Invalid request.' }) };
  } catch {
    return { error: json(400, { error: 'Invalid request.' }) };
  }
}

function summarize(counts, oppId) {
  const distribution = [1, 2, 3, 4, 5].map((star) => Math.max(0, counts[`${oppId}:${star}`] ?? 0));
  const count = distribution.reduce((a, b) => a + b, 0);
  const total = distribution.reduce((a, n, i) => a + n * (i + 1), 0);
  return { count, average: count ? Math.round((total / count) * 10) / 10 : null, distribution };
}

/**
 * @param {object} opts
 * @param {object|null} opts.store   a review store, or null when storage isn't configured
 * @param {object} [opts.env]        REVIEWS_MODERATION, REVIEWS_SALT, REVIEWS_ADMIN_TOKEN
 * @param {Set<string>|null} [opts.knownIds] valid opportunity ids
 * @param {() => number} [opts.now]
 */
export function createReviewHandlers({ store, env = {}, knownIds = null, now = () => Date.now() }) {
  const moderateAll = env.REVIEWS_MODERATION === 'all';
  const salt = env.REVIEWS_SALT || env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || 'student-atlas';
  const visitor = (request) => sha256(`${salt}:${clientIp(request)}`).toString('hex').slice(0, 32);
  const known = (id) => isOpportunityId(id) && (!knownIds || knownIds.has(id));

  const limited = async (bucket, rule) => (await store.hit(bucket, rule.seconds)) > rule.max;
  const tooMany = (rule) => json(429, { error: 'You’re doing that too often. Please try again later.' }, { 'Retry-After': String(rule.seconds) });

  async function getReviews(url) {
    const id = url.searchParams.get('id');
    const counts = await store.starCounts();
    if (!id) {
      const summaries = {};
      for (const key of Object.keys(counts)) {
        const oppId = key.slice(0, key.lastIndexOf(':'));
        if (!summaries[oppId]) {
          const s = summarize(counts, oppId);
          if (s.count) summaries[oppId] = { count: s.count, average: s.average };
        }
      }
      return json(200, { enabled: true, summaries }, { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' });
    }
    if (!known(id)) return json(404, { error: 'Unknown opportunity.' });
    const offset = Math.min(Math.max(Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0), 10_000);
    const ids = await store.listPublishedIds(id, offset, PAGE_SIZE + 1);
    const reviews = (await store.getReviews(ids.slice(0, PAGE_SIZE))).filter((r) => r.status === 'published');
    return json(200, {
      enabled: true,
      summary: summarize(counts, id),
      reviews: reviews.map(publicReview),
      nextOffset: ids.length > PAGE_SIZE ? offset + PAGE_SIZE : null,
    }, { 'Cache-Control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=60' });
  }

  async function createReview(request, body) {
    // Bots that fill the hidden field or submit instantly get a normal-looking
    // answer, but nothing is stored.
    if (body.website || !(Number(body.elapsedMs) >= MIN_FILL_MS)) return json(202, { status: 'pending' });

    const result = validateReview(body);
    if (result.errors) return json(422, { error: 'Please fix the highlighted fields.', errors: result.errors });
    if (!known(result.review.opportunityId)) return json(404, { error: 'Unknown opportunity.' });

    const who = visitor(request);
    if (await limited(`c:${who}`, RATE.createBurst)) return tooMany(RATE.createBurst);
    if (await limited(`d:${who}`, RATE.createDaily)) return tooMany(RATE.createDaily);
    const onceKey = `dup:${result.review.opportunityId}:${who}`;
    if (!(await store.once(onceKey, ONE_REVIEW_PER_OPP_SECONDS))) {
      return json(409, { error: 'You’ve already reviewed this opportunity.' });
    }

    const pending = moderateAll || result.flags.length > 0;
    const review = {
      id: crypto.randomBytes(10).toString('hex'),
      ...result.review,
      createdAt: now(),
      status: pending ? 'pending' : 'published',
      flags: result.flags,
      reports: 0,
      reportReasons: [],
      reportsAtApproval: 0,
      author: who,
    };
    try {
      await store.saveReview(review);
      await (pending ? store.hold(review) : store.publish(review));
    } catch (err) {
      await store.release(onceKey).catch(() => {});
      throw err;
    }
    return json(201, { status: review.status, review: publicReview(review) });
  }

  async function reportReview(request, body) {
    const { reviewId, reason, error } = validateReport(body);
    if (error) return json(404, { error });
    const who = visitor(request);
    if (await limited(`r:${who}`, RATE.report)) return tooMany(RATE.report);
    const review = await store.getReview(reviewId);
    if (!review || review.status !== 'published') return json(200, { ok: true });
    if (review.author === who) return json(200, { ok: true });

    const reporters = await store.addReporter(reviewId, who);
    if (!reporters) return json(200, { ok: true });
    review.reports = reporters;
    review.reportReasons = [...review.reportReasons, reason].slice(-10);
    if (reporters - review.reportsAtApproval >= REPORTS_TO_HIDE) {
      review.status = 'pending';
      review.flags = [...new Set([...review.flags, 'reported'])];
      await store.saveReview(review);
      await store.hold(review);
    } else {
      await store.saveReview(review);
    }
    return json(200, { ok: true });
  }

  async function reviews(request) {
    if (!store) {
      return request.method === 'GET'
        ? json(200, { enabled: false }, { 'Cache-Control': 'public, max-age=0, s-maxage=300' })
        : json(503, { enabled: false, error: 'Reviews aren’t turned on for this site yet.' });
    }
    try {
      if (request.method === 'GET') return await getReviews(new URL(request.url));
      if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' }, { Allow: 'GET, POST' });
      if (!sameOrigin(request)) return json(403, { error: 'Forbidden.' });
      const { body, error } = await readJson(request);
      if (error) return error;
      if (body.action === 'create') return await createReview(request, body);
      if (body.action === 'report') return await reportReview(request, body);
      return json(400, { error: 'Unknown action.' });
    } catch (err) {
      console.error('reviews:', err);
      return json(500, { error: 'Something went wrong. Please try again later.' });
    }
  }

  // ---- Moderation --------------------------------------------------------
  const adminToken = env.REVIEWS_ADMIN_TOKEN ?? '';
  function authorized(request) {
    const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    return given.length > 0 && crypto.timingSafeEqual(sha256(given), sha256(adminToken));
  }

  async function admin(request) {
    if (!store || adminToken.length < 16) {
      return json(503, { error: 'Moderation isn’t set up. Configure review storage and a REVIEWS_ADMIN_TOKEN of at least 16 characters.' });
    }
    try {
      const fails = `af:${visitor(request)}`;
      if (!authorized(request)) {
        if (await limited(fails, RATE.adminFail)) return tooMany(RATE.adminFail);
        return json(401, { error: 'Wrong moderator token.' }, { 'WWW-Authenticate': 'Bearer' });
      }
      if (request.method === 'GET') {
        const queue = await store.getReviews(await store.listPendingIds(100));
        return json(200, {
          pending: queue.map((r) => ({
            ...publicReview(r), opportunityId: r.opportunityId, flags: r.flags, reports: r.reports, reportReasons: r.reportReasons,
          })),
        });
      }
      if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' }, { Allow: 'GET, POST' });
      if (!sameOrigin(request)) return json(403, { error: 'Forbidden.' });
      const { body, error } = await readJson(request);
      if (error) return error;
      if (!isReviewId(body.reviewId)) return json(404, { error: 'Unknown review.' });
      const review = await store.getReview(body.reviewId);
      if (!review) return json(404, { error: 'Unknown review.' });
      if (body.action === 'approve') {
        review.status = 'published';
        review.flags = [];
        review.reportsAtApproval = review.reports;
        await store.saveReview(review);
        await store.publish(review);
        return json(200, { ok: true, status: 'published' });
      }
      if (body.action === 'remove') {
        await store.remove(review);
        return json(200, { ok: true, status: 'removed' });
      }
      return json(400, { error: 'Unknown action.' });
    } catch (err) {
      console.error('reviews-admin:', err);
      return json(500, { error: 'Something went wrong.' });
    }
  }

  return { reviews, admin };
}
