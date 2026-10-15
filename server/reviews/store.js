// Review storage on Supabase Postgres (tables and functions in
// supabase/migrations). The store takes an `rpc(fn, args)` function: the
// Supabase REST client in production (server/db/supabase.js), or the
// in-process database for `npm run dev` and tests (server/db/local.js).
//
// A review's content and its state are saved separately: saveReview writes
// the review, and publish / hold move it in and out of the public list and the
// moderation queue. Star counts are computed from published reviews.

import { supabaseFromEnv } from '../db/supabase.js';

export function reviewStoreFromEnv(env = process.env) {
  const rpc = supabaseFromEnv(env);
  return rpc ? new SupabaseReviewStore(rpc) : null;
}

export class SupabaseReviewStore {
  /** @param {Function|Promise<Function>} rpc */
  constructor(rpc) {
    this.db = rpc;
  }

  async #rpc(fn, args) {
    return (await this.db)(fn, args);
  }

  async getReview(id) {
    const [review] = await this.getReviews([id]);
    return review ?? null;
  }

  async getReviews(ids) {
    if (!ids.length) return [];
    return this.#rpc('atlas_reviews_get', { p_ids: ids });
  }

  async saveReview(review) {
    await this.#rpc('atlas_review_save', { p_review: review });
  }

  async listPublishedIds(oppId, offset, limit) {
    return this.#rpc('atlas_reviews_published_ids', { p_opportunity_id: oppId, p_offset: offset, p_limit: limit });
  }

  async listPendingIds(limit) {
    return this.#rpc('atlas_reviews_pending_ids', { p_limit: limit });
  }

  async publish(review) {
    await this.#rpc('atlas_review_set_state', { p_id: review.id, p_state: 'published' });
  }

  async hold(review) {
    await this.#rpc('atlas_review_set_state', { p_id: review.id, p_state: 'pending' });
  }

  async remove(review) {
    await this.#rpc('atlas_review_delete', { p_id: review.id });
  }

  async starCounts() {
    return this.#rpc('atlas_review_star_counts', {});
  }

  /** Increments a rate-limit counter and returns its new value. */
  async hit(bucket, ttlSeconds) {
    return this.#rpc('atlas_hit', { p_bucket: `rv:${bucket}`, p_seconds: ttlSeconds });
  }

  /** True the first time it's called for a key within the TTL. */
  async once(key, ttlSeconds) {
    return this.#rpc('atlas_review_once', { p_key: key, p_seconds: ttlSeconds });
  }

  async release(key) {
    await this.#rpc('atlas_review_release', { p_key: key });
  }

  /** Records a reporter; returns the number of distinct reporters, or 0 if this one already reported. */
  async addReporter(reviewId, who) {
    return this.#rpc('atlas_review_add_reporter', { p_review_id: reviewId, p_reporter: who });
  }
}
