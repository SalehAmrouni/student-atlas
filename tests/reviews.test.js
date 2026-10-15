import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { validateReview } = await import('../server/reviews/validate.js');
const { createReviewHandlers, REPORTS_TO_HIDE, PAGE_SIZE } = await import('../server/reviews/handler.js');
const { SupabaseReviewStore, reviewStoreFromEnv } = await import('../server/reviews/store.js');
const { freshDatabase } = await import('./helpers/db.js');
const { supabaseRpc } = await import('../server/db/supabase.js');
const { createApp } = await import('../server/index.js');

const OPP = 'test-program';
const ADMIN = 'a-very-long-moderator-token';
const good = (extra = {}) => ({
  action: 'create', opportunityId: OPP, rating: 5, title: 'Loved it',
  body: 'The mentors were great and I learned a lot about research.',
  name: 'Sam', role: 'Student', experience: 'Participated', agree: true, elapsedMs: 10_000, ...extra,
});

async function setup(env = {}) {
  const store = new SupabaseReviewStore((await freshDatabase()).rpc);
  const { reviews, admin } = createReviewHandlers({ store, env: { REVIEWS_ADMIN_TOKEN: ADMIN, ...env }, knownIds: new Set([OPP, 'other']) });
  const call = async (handler, method, { ip = '1.1.1.1', body, query = '', headers = {} } = {}) => {
    const res = await handler(new Request(`https://atlas.test/api/reviews${query}`, {
      method,
      headers: { 'x-real-ip': ip, host: 'atlas.test', ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }));
    return { status: res.status, data: await res.json(), headers: res.headers };
  };
  return {
    store,
    get: (query, opts) => call(reviews, 'GET', { ...opts, query }),
    post: (body, opts) => call(reviews, 'POST', { ...opts, body }),
    admin: (method, opts) => call(admin, method, opts),
  };
}

describe('review validation', () => {
  test('accepts a complete review and defaults the name', () => {
    const { review, flags } = validateReview(good({ name: '' }));
    assert.equal(review.name, 'Anonymous');
    assert.deepEqual(flags, []);
  });

  test('rejects missing fields and bad ratings', () => {
    const { errors } = validateReview({ opportunityId: OPP, rating: 7, body: 'short' });
    assert.ok(errors.rating && errors.body && errors.role && errors.experience && errors.agree);
  });

  test('refuses contact details and links', () => {
    for (const body of [
      'Email me at sam@example.com for tips on the essays',
      'Text me at (555) 123-4567 if you want to chat about it',
      'More info at https://spam.example and it is great',
      'Check out my site bestessays.com for help with this',
      'Follow me @samthestudent for more about this program',
    ]) assert.ok(validateReview(good({ body })).errors?.body, body);
  });

  test('holds offensive or shouty reviews for moderation', () => {
    assert.deepEqual(validateReview(good({ body: 'This program is shit and a waste of time honestly.' })).flags, ['language']);
    assert.ok(validateReview(good({ body: 'THIS PROGRAM IS THE BEST THING EVER EVERYONE APPLY' })).flags.includes('shouting'));
  });

  test('strips control and bidi characters', () => {
    assert.equal(validateReview(good({ title: 'Hi‮there\u0000' })).review.title, 'Hithere');
  });
});

describe('reviews API', () => {
  test('posts a review and shows it with a summary', async () => {
    const api = await setup();
    const created = await api.post(good());
    assert.equal(created.status, 201);
    assert.equal(created.data.status, 'published');
    assert.equal(created.data.review.author, undefined, 'author hash must stay private');

    const { data } = await api.get(`?id=${OPP}`);
    assert.deepEqual(data.summary, { count: 1, average: 5, distribution: [0, 0, 0, 0, 1] });
    assert.equal(data.reviews[0].body, good().body);

    const all = await api.get('');
    assert.deepEqual(all.data.summaries, { [OPP]: { count: 1, average: 5 } });
  });

  test('validates input and rejects unknown opportunities', async () => {
    const api = await setup();
    assert.equal((await api.post(good({ rating: 0 }))).status, 422);
    assert.equal((await api.post(good({ opportunityId: 'not-real' }))).status, 404);
    assert.equal((await api.get('?id=not-real')).status, 404);
  });

  test('silently drops bots (honeypot or instant submit)', async () => {
    const api = await setup();
    assert.equal((await api.post(good({ website: 'http://spam' }))).status, 202);
    assert.equal((await api.post(good({ elapsedMs: 200 }))).status, 202);
    assert.equal((await api.post(good({ elapsedMs: undefined }))).status, 202);
    assert.equal((await api.get(`?id=${OPP}`)).data.summary.count, 0);
  });

  test('one review per person per opportunity, and rate limits', async () => {
    const api = await setup();
    assert.equal((await api.post(good())).status, 201);
    assert.equal((await api.post(good())).status, 409);
    assert.equal((await api.post(good({ opportunityId: 'other' }))).status, 201);
    // Burst limit: 3 attempts per 10 minutes per visitor.
    const limited = await api.post(good({ opportunityId: 'other' }));
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
  });

  test('blocks cross-site posts and non-JSON bodies', async () => {
    const api = await setup();
    assert.equal((await api.post(good(), { headers: { origin: 'https://evil.test' } })).status, 403);
    assert.equal((await api.post(good(), { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
    assert.equal((await api.post(good(), { headers: { origin: 'https://atlas.test' } })).status, 201);
    assert.equal((await api.post(good({ body: 'x'.repeat(5000) }), { ip: '2.2.2.2' })).status, 413);
  });

  test('flagged reviews wait for a moderator, who can approve them', async () => {
    const api = await setup();
    const created = await api.post(good({ body: 'Honestly this was a shit experience for most of us.' }));
    assert.equal(created.data.status, 'pending');
    assert.equal((await api.get(`?id=${OPP}`)).data.reviews.length, 0);

    assert.equal((await api.admin('GET', { headers: { authorization: 'Bearer wrong' } })).status, 401);
    const queue = await api.admin('GET', { headers: { authorization: `Bearer ${ADMIN}` } });
    assert.equal(queue.data.pending.length, 1);
    assert.deepEqual(queue.data.pending[0].flags, ['language']);

    const approve = await api.admin('POST', { headers: { authorization: `Bearer ${ADMIN}` }, body: { action: 'approve', reviewId: created.data.review.id } });
    assert.equal(approve.status, 200);
    assert.equal((await api.get(`?id=${OPP}`)).data.summary.count, 1);
  });

  test('REVIEWS_MODERATION=all holds every review', async () => {
    const api = await setup({ REVIEWS_MODERATION: 'all' });
    assert.equal((await api.post(good())).data.status, 'pending');
  });

  test('enough reports hide a review until a moderator checks it', async () => {
    const api = await setup();
    const { review } = (await api.post(good())).data;
    for (let i = 0; i < REPORTS_TO_HIDE - 1; i++) await api.post({ action: 'report', reviewId: review.id, reason: 'Spam or advertising' }, { ip: `9.9.9.${i}` });
    // The same person reporting twice doesn't count twice.
    await api.post({ action: 'report', reviewId: review.id }, { ip: '9.9.9.0' });
    assert.equal((await api.get(`?id=${OPP}`)).data.reviews.length, 1);
    await api.post({ action: 'report', reviewId: review.id, reason: 'Rude or hateful' }, { ip: '9.9.9.99' });
    const after = (await api.get(`?id=${OPP}`)).data;
    assert.equal(after.reviews.length, 0);
    assert.equal(after.summary.count, 0);

    const remove = await api.admin('POST', { headers: { authorization: `Bearer ${ADMIN}` }, body: { action: 'remove', reviewId: review.id } });
    assert.equal(remove.status, 200);
    assert.equal((await api.admin('GET', { headers: { authorization: `Bearer ${ADMIN}` } })).data.pending.length, 0);
  });

  test('pages through reviews newest first', async () => {
    const api = await setup();
    let t = 0;
    api.store.now = () => t;
    const handlers = createReviewHandlers({ store: api.store, env: {}, knownIds: new Set([OPP]), now: () => ++t });
    for (let i = 0; i < PAGE_SIZE + 2; i++) {
      await handlers.reviews(new Request('https://atlas.test/api/reviews', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': `10.0.0.${i}` }, body: JSON.stringify(good({ title: `Review ${i}` })),
      }));
    }
    const first = (await api.get(`?id=${OPP}`)).data;
    assert.equal(first.reviews.length, PAGE_SIZE);
    assert.equal(first.reviews[0].title, `Review ${PAGE_SIZE + 1}`);
    const second = (await api.get(`?id=${OPP}&offset=${first.nextOffset}`)).data;
    assert.equal(second.reviews.length, 2);
    assert.equal(second.nextOffset, null);
  });

  test('without storage, reads say disabled and writes are refused', async () => {
    const { reviews, admin } = createReviewHandlers({ store: null });
    const get = await reviews(new Request('https://atlas.test/api/reviews'));
    assert.deepEqual(await get.json(), { enabled: false });
    const post = await reviews(new Request('https://atlas.test/api/reviews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(good()) }));
    assert.equal(post.status, 503);
    assert.equal((await admin(new Request('https://atlas.test/api/reviews-admin'))).status, 503);
  });
});

describe('Supabase review store', () => {
  test('is configured from the Supabase URL and secret key', () => {
    assert.equal(reviewStoreFromEnv({}), null);
    assert.equal(reviewStoreFromEnv({ KV_REST_API_URL: 'https://kv.test', KV_REST_API_TOKEN: 't' }), null);
    assert.ok(reviewStoreFromEnv({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_x' }) instanceof SupabaseReviewStore);
    assert.ok(reviewStoreFromEnv({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'eyJ.x.y' }) instanceof SupabaseReviewStore);
  });

  test('calls the database functions over the Supabase REST API', async () => {
    const calls = [];
    const fakeFetch = async (url, init) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return new Response('3');
    };
    const store = new SupabaseReviewStore(supabaseRpc('https://x.supabase.co/', 'sb_secret_abc', fakeFetch));
    assert.equal(await store.hit('c:1', 60), 3);
    assert.equal(calls[0].url, 'https://x.supabase.co/rest/v1/rpc/atlas_hit');
    assert.equal(calls[0].headers.apikey, 'sb_secret_abc');
    assert.equal(calls[0].headers.Authorization, undefined);
    assert.deepEqual(calls[0].body, { p_bucket: 'rv:c:1', p_seconds: 60 });

    const legacy = supabaseRpc('https://x.supabase.co', 'eyJhbGciOi.x.y', fakeFetch);
    await legacy('atlas_review_star_counts');
    assert.equal(calls[1].headers.Authorization, 'Bearer eyJhbGciOi.x.y');
    await assert.rejects(legacy('pg_sleep'), /Unknown database function/);
  });

  test('keeps star counts in step with publishing, holding, and removing', async () => {
    const store = new SupabaseReviewStore((await freshDatabase()).rpc);
    const review = { id: 'abc12345', opportunityId: OPP, rating: 4, createdAt: 1, status: 'published' };
    await store.saveReview(review);
    await store.publish(review);
    await store.publish(review);
    assert.deepEqual(await store.starCounts(), { [`${OPP}:4`]: 1 });
    await store.hold(review);
    assert.deepEqual(await store.starCounts(), {});
    assert.deepEqual(await store.listPendingIds(10), ['abc12345']);
    await store.publish(review);
    await store.remove(review);
    assert.deepEqual(await store.starCounts(), {});
    assert.equal(await store.getReview('abc12345'), null);
  });
});

describe('local server reviews', () => {
  test('serves the reviews API from memory in development', async () => {
    const server = createApp({ env: {} }).listen(0);
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const { opportunities } = await (await fetch(`${base}/data/opportunities.json`)).json();
      const id = opportunities[0].id;
      const res = await fetch(`${base}/api/reviews`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(good({ opportunityId: id })) });
      assert.equal(res.status, 201);
      assert.equal(res.headers.get('content-security-policy')?.startsWith("default-src 'self'"), true);
      const list = await (await fetch(`${base}/api/reviews?id=${id}`)).json();
      assert.equal(list.reviews.length, 1);
    } finally {
      server.close();
    }
  });
});
