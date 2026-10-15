#!/usr/bin/env node
// One-time copy of accounts, rooms, sessions, and reviews from the old Upstash
// Redis store into Supabase. Safe to run more than once: rows that already
// exist in Supabase are left alone. It only reads from Redis.
//
//   vercel env pull .env.migrate          # needs the Redis and Supabase variables
//   node --env-file=.env.migrate scripts/migrate-redis-to-supabase.js --dry-run
//   node --env-file=.env.migrate scripts/migrate-redis-to-supabase.js
//   rm .env.migrate
//
// Needs KV_REST_API_URL + KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST_* pair),
// SUPABASE_URL, and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).
// Sign-in codes are hashed with ACCOUNTS_SALT, so the site must keep using the
// same salt after the move (see README, "Moving from Redis to Supabase").

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabaseFromEnv } from '../server/db/supabase.js';
import { normalizeUsername } from '../server/accounts/names.js';

const AC = 'atlas:ac:';
const RV = 'atlas:rv:';
const MAX_BATCH_BYTES = 2 * 1024 * 1024;

export function redisFromEnv(env, fetchImpl = globalThis.fetch) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return async (...args) => {
    const res = await fetchImpl(url.replace(/\/+$/, ''), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args.map(String)),
    });
    if (!res.ok) throw new Error(`Redis responded ${res.status}`);
    const out = await res.json();
    if (out.error) throw new Error(`Redis error: ${out.error}`);
    return out.result;
  };
}

async function scan(redis, pattern) {
  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis('SCAN', cursor, 'MATCH', pattern, 'COUNT', 500);
    keys.push(...batch);
    cursor = String(next);
  } while (cursor !== '0');
  return [...new Set(keys)];
}

const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

/** TTL in seconds -> ISO expiry; null keeps the database default; undefined means the key is gone. */
async function expiry(redis, key, now) {
  const ttl = Number(await redis('TTL', key));
  if (ttl === -2) return undefined;
  return ttl > 0 ? new Date(now + ttl * 1000).toISOString() : null;
}

/** Reads everything worth keeping from Redis into rows for public.atlas_import. */
export async function collect(redis, { now = Date.now() } = {}) {
  const out = { rooms: [], accounts: [], members: [], sessions: [], reviews: [], reporters: [], once: [] };

  const users = new Map();
  for (const key of await scan(redis, `${AC}u:*`)) {
    const user = parse(await redis('GET', key));
    const expiresAt = await expiry(redis, key, now);
    if (!user?.id || !user.username || !user.codeHash || expiresAt === undefined) continue;
    const stored = parse(await redis('GET', `${AC}d:${user.id}`));
    users.set(user.id, user);
    out.accounts.push({
      id: user.id, username: user.username, usernameKey: normalizeUsername(user.username), emoji: user.emoji ?? '',
      codeHash: user.codeHash, createdAt: user.createdAt ?? now, lastActive: user.lastActive ?? null,
      data: stored?.data ?? {}, version: stored?.version ?? 1, updatedAt: stored?.updatedAt ?? null, expiresAt,
    });
  }

  for (const key of await scan(redis, `${AC}r:*`)) {
    const room = parse(await redis('GET', key));
    const expiresAt = await expiry(redis, key, now);
    if (!room?.code || expiresAt === undefined) continue;
    out.rooms.push({ ...room, expiresAt });
    const flat = (await redis('HGETALL', `${AC}rm:${room.code}`)) ?? [];
    for (let i = 0; i < flat.length; i += 2) {
      const member = parse(flat[i + 1]);
      // Only students whose account still points at this room, as the old roster did.
      if (member?.encName && users.get(flat[i])?.room === room.code) {
        out.members.push({ accountId: flat[i], roomCode: room.code, encName: member.encName, grade: member.grade ?? null, joinedAt: member.joinedAt ?? now });
      }
    }
  }

  for (const key of await scan(redis, `${AC}s:*`)) {
    const accountId = await redis('GET', key);
    const expiresAt = await expiry(redis, key, now);
    if (!accountId || expiresAt === undefined) continue;
    out.sessions.push({ tokenHash: key.slice(`${AC}s:`.length), accountId, expiresAt: expiresAt ?? new Date(now + 180 * 86400_000).toISOString() });
  }

  const published = new Set();
  for (const key of await scan(redis, `${RV}pub:*`)) for (const id of await redis('ZRANGE', key, 0, -1)) published.add(id);
  const pending = new Set(await redis('ZRANGE', `${RV}pending`, 0, -1));
  for (const key of await scan(redis, `${RV}r:*`)) {
    const review = parse(await redis('GET', key));
    if (!review?.id || !review.opportunityId || !review.rating) continue;
    const state = published.has(review.id) ? 'published' : pending.has(review.id) ? 'pending' : 'draft';
    out.reviews.push({ review, state });
  }
  for (const key of await scan(redis, `${RV}rep:*`)) {
    const reviewId = key.slice(`${RV}rep:`.length);
    for (const reporter of await redis('SMEMBERS', key)) out.reporters.push({ reviewId, reporter });
  }
  for (const key of await scan(redis, `${RV}once:*`)) {
    const expiresAt = await expiry(redis, key, now);
    if (expiresAt) out.once.push({ key: key.slice(`${RV}once:`.length), expiresAt });
  }
  return out;
}

/** Sends the rows in dependency order and in batches small enough for one request. */
export async function importAll(rpc, rows) {
  const totals = {};
  for (const kind of ['rooms', 'accounts', 'members', 'sessions', 'reviews', 'reporters', 'once']) {
    let batch = [];
    let bytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      const counts = await rpc('atlas_import', { p_rows: { [kind]: batch } });
      totals[kind] = (totals[kind] ?? 0) + (counts?.[kind] ?? 0);
      batch = [];
      bytes = 0;
    };
    for (const row of rows[kind]) {
      const size = JSON.stringify(row).length;
      if (bytes + size > MAX_BATCH_BYTES) await flush();
      batch.push(row);
      bytes += size;
    }
    await flush();
    totals[kind] ??= 0;
  }
  return totals;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const redis = redisFromEnv(process.env);
  const rpc = supabaseFromEnv(process.env);
  if (!redis) throw new Error('Set KV_REST_API_URL and KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN).');
  if (!rpc && !dryRun) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY.');
  if (!process.env.ACCOUNTS_SALT) {
    console.warn('Warning: ACCOUNTS_SALT is not set. Sign-in codes were hashed with the first of ACCOUNTS_SALT, REVIEWS_SALT, KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_TOKEN.\n'
      + 'Before removing Redis, set ACCOUNTS_SALT in Vercel to that same value, or every existing sign-in code will stop working.');
  }
  const rows = await collect(redis);
  const found = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length]));
  console.log('Found in Redis:', found);
  if (dryRun) return console.log('Dry run: nothing was written.');
  console.log('Added to Supabase (rows that already existed are skipped):', await importAll(rpc, rows));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
