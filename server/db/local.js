// An in-process Postgres (PGlite) with the same migrations as Supabase, for
// `npm run dev` and the tests. Nothing is saved: data is gone on restart.
// PGlite is a dev dependency, so production never loads this file.

import fs from 'node:fs';

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const FN = /^atlas_[a-z_]+$/;
const ARG = /^p_[a-z_]+$/;

/** Starts a fresh database. Returns `{ rpc, db }`: rpc has the same shape as server/db/supabase.js. */
export async function localDatabase() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = await PGlite.create();
  // Supabase's API roles, so the migrations' grants run as they do there.
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;`);
  for (const file of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(fs.readFileSync(new URL(file, MIGRATIONS), 'utf8'));
  }
  const rpc = async (fn, args = {}) => {
    if (!FN.test(fn)) throw new Error(`Unknown database function ${fn}`);
    const keys = Object.keys(args).filter((k) => args[k] !== undefined);
    if (!keys.every((k) => ARG.test(k))) throw new Error('Bad argument name');
    // JSON-encode objects for jsonb parameters, as PostgREST does.
    const values = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' && !Array.isArray(args[k]) ? JSON.stringify(args[k]) : args[k]));
    const { rows } = await db.query(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, values);
    return rows[0]?.r ?? null;
  };
  return { rpc, db };
}

let shared;
/** One database shared by the dev server's accounts and reviews. */
export function sharedLocalRpc() {
  shared ??= localDatabase().then(({ rpc }) => rpc);
  return shared;
}
