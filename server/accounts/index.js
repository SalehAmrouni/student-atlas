// Wires the account and room handlers to storage from environment variables.
// Used by the Vercel functions in api/ and by the local dev server.

import fs from 'node:fs';
import { createAccountHandlers } from './handler.js';
import { kvFromEnv, MemoryKV } from '../kv.js';

let opportunities;
function loadOpportunities() {
  if (opportunities !== undefined) return opportunities;
  try {
    const data = JSON.parse(fs.readFileSync(new URL('../../public/data/opportunities.json', import.meta.url), 'utf8'));
    opportunities = new Map(data.opportunities.map((o) => [o.id, o]));
  } catch {
    opportunities = new Map();
  }
  return opportunities;
}

/**
 * `memoryFallback` keeps accounts in memory when no store is configured, so
 * `npm run dev` works without an account. Everything is lost on restart.
 */
export function accountHandlersFromEnv(env = process.env, { memoryFallback = false } = {}) {
  const kv = kvFromEnv(env) ?? (memoryFallback ? new MemoryKV() : null);
  return createAccountHandlers({ kv, env, byId: loadOpportunities() });
}
