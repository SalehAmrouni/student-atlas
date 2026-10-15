// A tiny key-value client for accounts and classroom rooms. Production uses
// Redis over Upstash's REST API (the same database the reviews use), called
// with fetch so no SDK is needed. Local development and tests use an
// in-memory store that understands the same handful of commands.

export function kvFromEnv(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new RedisKV(url, token) : null;
}

export class RedisKV {
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
    if (!res.ok) throw new Error(`Account store responded ${res.status}`);
    return res.json();
  }

  async cmd(...args) {
    const out = await this.#call('', args.map(String));
    if (out.error) throw new Error(`Account store error: ${out.error}`);
    return out.result;
  }

  async pipeline(commands) {
    if (!commands.length) return [];
    const out = await this.#call('/pipeline', commands.map((c) => c.map(String)));
    return out.map((r) => {
      if (r.error) throw new Error(`Account store error: ${r.error}`);
      return r.result;
    });
  }
}

/** In-memory stand-in with Redis semantics for the commands accounts use. */
export class MemoryKV {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.data = new Map(); // key -> { value: string | Map, until?: number }
  }

  #get(key) {
    const entry = this.data.get(key);
    if (entry?.until !== undefined && entry.until <= this.now()) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }

  #hash(key, create = false) {
    const entry = this.#get(key);
    if (entry) return entry.value;
    if (!create) return null;
    const value = new Map();
    this.data.set(key, { value });
    return value;
  }

  async pipeline(commands) {
    const out = [];
    for (const c of commands) out.push(await this.cmd(...c));
    return out;
  }

  async cmd(name, ...args) {
    const a = args.map(String);
    switch (String(name).toUpperCase()) {
      case 'GET': return this.#get(a[0])?.value ?? null;
      case 'MGET': return a.map((k) => { const v = this.#get(k)?.value; return typeof v === 'string' ? v : null; });
      case 'SET': {
        const [key, value, ...opts] = a;
        const upper = opts.map((o) => o.toUpperCase());
        if (upper.includes('NX') && this.#get(key)) return null;
        const ex = upper.indexOf('EX');
        this.data.set(key, { value, until: ex === -1 ? undefined : this.now() + Number(opts[ex + 1]) * 1000 });
        return 'OK';
      }
      case 'DEL': {
        let n = 0;
        for (const k of a) if (this.#get(k) && this.data.delete(k)) n += 1;
        return n;
      }
      case 'EXISTS': return a.filter((k) => this.#get(k)).length;
      case 'EXPIRE': {
        const entry = this.#get(a[0]);
        if (!entry) return 0;
        entry.until = this.now() + Number(a[1]) * 1000;
        return 1;
      }
      case 'TTL': {
        const entry = this.#get(a[0]);
        if (!entry) return -2;
        return entry.until === undefined ? -1 : Math.ceil((entry.until - this.now()) / 1000);
      }
      case 'INCR': {
        const entry = this.#get(a[0]);
        const next = Number(entry?.value ?? 0) + 1;
        if (entry) entry.value = String(next);
        else this.data.set(a[0], { value: String(next) });
        return next;
      }
      case 'HSET': {
        const hash = this.#hash(a[0], true);
        let added = 0;
        for (let i = 1; i < a.length; i += 2) {
          if (!hash.has(a[i])) added += 1;
          hash.set(a[i], a[i + 1]);
        }
        return added;
      }
      case 'HGET': return this.#hash(a[0])?.get(a[1]) ?? null;
      case 'HDEL': {
        const hash = this.#hash(a[0]);
        if (!hash) return 0;
        let n = 0;
        for (const f of a.slice(1)) if (hash.delete(f)) n += 1;
        if (!hash.size) this.data.delete(a[0]);
        return n;
      }
      case 'HLEN': return this.#hash(a[0])?.size ?? 0;
      case 'HGETALL': return [...(this.#hash(a[0]) ?? new Map())].flat();
      default: throw new Error(`MemoryKV: unsupported command ${name}`);
    }
  }
}
