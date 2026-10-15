// Wires the account and room handlers to storage from environment variables.
// Used by the Vercel functions in api/ and by the local dev server.

import fs from 'node:fs';
import { createAccountHandlers } from './handler.js';
import { supabaseFromEnv } from '../db/supabase.js';

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
 * `localFallback` (a Promise of an rpc function, see server/db/local.js) keeps
 * accounts in an in-process database when Supabase isn't configured, so
 * `npm run dev` works without an account. Everything is lost on restart.
 */
export function accountHandlersFromEnv(env = process.env, { localFallback = null } = {}) {
  const db = supabaseFromEnv(env) ?? localFallback;
  return createAccountHandlers({ db, env, byId: loadOpportunities() });
}
