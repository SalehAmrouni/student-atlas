// Wires the review handlers to their storage from environment variables.
// Used by the Vercel functions in api/ and by the local dev server.

import fs from 'node:fs';
import { createReviewHandlers } from './handler.js';
import { reviewStoreFromEnv, SupabaseReviewStore } from './store.js';

let knownIds;
function loadKnownIds() {
  if (knownIds !== undefined) return knownIds;
  try {
    const data = JSON.parse(fs.readFileSync(new URL('../../public/data/opportunities.json', import.meta.url), 'utf8'));
    knownIds = new Set(data.opportunities.map((o) => o.id));
  } catch {
    // If the data file isn't bundled, fall back to checking the id's format only.
    knownIds = null;
  }
  return knownIds;
}

/**
 * `localFallback` (a Promise of an rpc function, see server/db/local.js) keeps
 * reviews in an in-process database when Supabase isn't configured, so
 * `npm run dev` works without an account. Reviews are lost on restart.
 */
export function reviewHandlersFromEnv(env = process.env, { localFallback = null } = {}) {
  const store = reviewStoreFromEnv(env) ?? (localFallback ? new SupabaseReviewStore(localFallback) : null);
  return createReviewHandlers({ store, env, knownIds: loadKnownIds() });
}
