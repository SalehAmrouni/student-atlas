// Review storage. Production uses Redis over Upstash's REST API (what Vercel's
// Upstash / KV integration provides), called with fetch so no SDK is needed.
// Local development and tests use an in-memory store with the same methods.
//
// Data model (all keys share the `atlas:rv:` prefix):
//   r:<reviewId>        JSON of the review, including moderation fields
//   pub:<oppId>         sorted set of published review ids, scored by time
//   pending             sorted set of review ids waiting for a moderator
//   stars               hash: "<oppId>:<1-5>" -> number of published reviews
//   rl:<bucket>         counters for rate limiting (expire on their own)
//   once:<key>          markers for "only once" rules (expire on their own)
//   rep:<reviewId>      set of reporter hashes for a review

const P = 'atlas:rv:';

export function reviewStoreFromEnv(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new RedisReviewStore(url, token) : null;
}

// ---------------------------------------------------------------------------
export class RedisReviewStore {
  constructor(url, token, fetchImpl = globalThis.fetch) {
    this.url = url.replace(/\/+$/, '');
    this.token = token;
    this.fetch = fetchImpl;
  }

  async #call(path, body) {
    const res = await this.fetch(`${this.url}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Review store responded ${res.status}`);
    return res.json();
  }

  async cmd(...args) {
    const out = await this.#call('', args);
    if (out.error) throw new Error(`Review store error: ${out.error}`);
    return out.result;
  }

  async pipeline(commands) {
    const out = await this.#call('/pipeline', commands);
    return out.map((r) => {
      if (r.error) throw new Error(`Review store error: ${r.error}`);
      return r.result;
    });
  }

  async getReview(id) {
    const raw = await this.cmd('GET', `${P}r:${id}`);
    return raw ? JSON.parse(raw) : null;
  }

  async getReviews(ids) {
    if (!ids.length) return [];
    const raws = await this.cmd('MGET', ...ids.map((id) => `${P}r:${id}`));
    return raws.filter(Boolean).map((raw) => JSON.parse(raw));
  }

  async saveReview(review) {
    await this.cmd('SET', `${P}r:${review.id}`, JSON.stringify(review));
  }

  async listPublishedIds(oppId, offset, limit) {
    return this.cmd('ZREVRANGE', `${P}pub:${oppId}`, offset, offset + limit - 1);
  }

  async listPendingIds(limit) {
    return this.cmd('ZRANGE', `${P}pending`, 0, limit - 1);
  }

  /** Adds to the published set; counts the stars only if it wasn't already there. */
  async publish(review) {
    const [added] = await this.pipeline([
      ['ZADD', `${P}pub:${review.opportunityId}`, review.createdAt, review.id],
      ['ZREM', `${P}pending`, review.id],
    ]);
    if (added === 1) await this.cmd('HINCRBY', `${P}stars`, `${review.opportunityId}:${review.rating}`, 1);
  }

  /** Moves a review out of the published set (if it was there) and into the queue. */
  async hold(review) {
    const [removed] = await this.pipeline([
      ['ZREM', `${P}pub:${review.opportunityId}`, review.id],
      ['ZADD', `${P}pending`, review.createdAt, review.id],
    ]);
    if (removed === 1) await this.cmd('HINCRBY', `${P}stars`, `${review.opportunityId}:${review.rating}`, -1);
  }

  async remove(review) {
    const [removed] = await this.pipeline([
      ['ZREM', `${P}pub:${review.opportunityId}`, review.id],
      ['ZREM', `${P}pending`, review.id],
      ['DEL', `${P}r:${review.id}`, `${P}rep:${review.id}`],
    ]);
    if (removed === 1) await this.cmd('HINCRBY', `${P}stars`, `${review.opportunityId}:${review.rating}`, -1);
  }

  async starCounts() {
    const flat = (await this.cmd('HGETALL', `${P}stars`)) ?? [];
    const out = {};
    for (let i = 0; i < flat.length; i += 2) out[flat[i]] = Number(flat[i + 1]);
    return out;
  }

  /** Increments a rate-limit counter and returns its new value. */
  async hit(bucket, ttlSeconds) {
    const [count, ttl] = await this.pipeline([
      ['INCR', `${P}rl:${bucket}`],
      ['TTL', `${P}rl:${bucket}`],
    ]);
    if (ttl < 0) await this.cmd('EXPIRE', `${P}rl:${bucket}`, ttlSeconds);
    return count;
  }

  /** True the first time it's called for a key within the TTL. */
  async once(key, ttlSeconds) {
    return (await this.cmd('SET', `${P}once:${key}`, '1', 'NX', 'EX', ttlSeconds)) === 'OK';
  }

  async release(key) {
    await this.cmd('DEL', `${P}once:${key}`);
  }

  /** Records a reporter; returns the number of distinct reporters, or 0 if this one already reported. */
  async addReporter(reviewId, who) {
    const [added, count] = await this.pipeline([
      ['SADD', `${P}rep:${reviewId}`, who],
      ['SCARD', `${P}rep:${reviewId}`],
    ]);
    return added === 1 ? count : 0;
  }
}

// ---------------------------------------------------------------------------
export class MemoryReviewStore {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.reviews = new Map();
    this.published = new Map();
    this.pending = new Set();
    this.stars = {};
    this.expiring = new Map();
    this.reporters = new Map();
  }

  #live(key) {
    const entry = this.expiring.get(key);
    if (entry && entry.until <= this.now()) this.expiring.delete(key);
    return this.expiring.get(key);
  }

  #bump(review, delta) {
    const key = `${review.opportunityId}:${review.rating}`;
    this.stars[key] = (this.stars[key] ?? 0) + delta;
  }

  async getReview(id) { return structuredClone(this.reviews.get(id) ?? null); }
  async getReviews(ids) { return ids.map((id) => this.reviews.get(id)).filter(Boolean).map((r) => structuredClone(r)); }
  async saveReview(review) { this.reviews.set(review.id, structuredClone(review)); }

  #sorted(ids) {
    return [...ids].map((id) => this.reviews.get(id)).filter(Boolean).sort((a, b) => a.createdAt - b.createdAt).map((r) => r.id);
  }

  async listPublishedIds(oppId, offset, limit) {
    return this.#sorted(this.published.get(oppId) ?? []).reverse().slice(offset, offset + limit);
  }

  async listPendingIds(limit) { return this.#sorted(this.pending).slice(0, limit); }

  async publish(review) {
    const set = this.published.get(review.opportunityId) ?? new Set();
    this.published.set(review.opportunityId, set);
    this.pending.delete(review.id);
    if (!set.has(review.id)) { set.add(review.id); this.#bump(review, 1); }
  }

  async hold(review) {
    this.pending.add(review.id);
    if (this.published.get(review.opportunityId)?.delete(review.id)) this.#bump(review, -1);
  }

  async remove(review) {
    this.pending.delete(review.id);
    if (this.published.get(review.opportunityId)?.delete(review.id)) this.#bump(review, -1);
    this.reviews.delete(review.id);
    this.reporters.delete(review.id);
  }

  async starCounts() { return { ...this.stars }; }

  async hit(bucket, ttlSeconds) {
    const key = `rl:${bucket}`;
    const entry = this.#live(key) ?? { count: 0, until: this.now() + ttlSeconds * 1000 };
    entry.count += 1;
    this.expiring.set(key, entry);
    return entry.count;
  }

  async once(key, ttlSeconds) {
    if (this.#live(`once:${key}`)) return false;
    this.expiring.set(`once:${key}`, { until: this.now() + ttlSeconds * 1000 });
    return true;
  }

  async release(key) { this.expiring.delete(`once:${key}`); }

  async addReporter(reviewId, who) {
    const set = this.reporters.get(reviewId) ?? new Set();
    this.reporters.set(reviewId, set);
    if (set.has(who)) return 0;
    set.add(who);
    return set.size;
  }
}
