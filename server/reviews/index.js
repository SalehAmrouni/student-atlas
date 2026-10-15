// Wires the review handlers to their storage from environment variables.
// Used by the Vercel functions in api/ and by the local dev server.

import fs from 'node:fs';
import { createReviewHandlers } from './handler.js';
import { reviewStoreFromEnv, MemoryReviewStore } from './store.js';

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
 * `memoryFallback` keeps reviews in memory when no store is configured, so
 * `npm run dev` works without an account. Reviews are lost on restart.
 */
export function reviewHandlersFromEnv(env = process.env, { memoryFallback = false } = {}) {
  const store = reviewStoreFromEnv(env) ?? (memoryFallback ? new MemoryReviewStore() : null);
  return createReviewHandlers({ store, env, knownIds: loadKnownIds() });
}
