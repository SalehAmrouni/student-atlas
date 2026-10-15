// Server-side access to Supabase Postgres. Every read and write goes through
// one of the `public.atlas_*` functions in supabase/migrations, called over
// Supabase's REST API (PostgREST) with fetch, so no SDK is needed.
//
// The secret (service_role) key is read from the server's environment only.
// It must never be sent to the browser: the tables have row-level security on
// and only this key can call the functions.

const FN = /^atlas_[a-z_]+$/;

/** An `rpc(fn, args)` function from environment variables, or null when Supabase isn't configured. */
export function supabaseFromEnv(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? supabaseRpc(url, key) : null;
}

export function supabaseRpc(url, key, fetchImpl = globalThis.fetch) {
  const base = `${url.replace(/\/+$/, '')}/rest/v1/rpc/`;
  const headers = { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' };
  // Legacy service_role keys are JWTs and also go in Authorization; the newer
  // sb_secret_ keys only go in the apikey header.
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  return async (fn, args = {}) => {
    if (!FN.test(fn)) throw new Error(`Unknown database function ${fn}`);
    const res = await fetchImpl(base + fn, { method: 'POST', headers, body: JSON.stringify(args) });
    if (!res.ok) throw new Error(`Database responded ${res.status} for ${fn}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
}
