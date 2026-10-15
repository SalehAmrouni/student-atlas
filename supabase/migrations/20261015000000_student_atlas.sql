-- Student Atlas storage on Supabase Postgres: anonymous student accounts,
-- classroom rooms, and opportunity reviews.
--
-- Access model
--   * The tables live in the `atlas` schema, which the Supabase Data API does
--     not expose, and row-level security is on for every table with no
--     policies, so the public (anon) and signed-in (authenticated) API roles
--     can't read or write a single row even if the schema were exposed.
--   * The server reaches the data only through the `public.atlas_*` functions
--     below, using the project's secret (service_role) key from Vercel's
--     environment. Execute rights on those functions are revoked from
--     anon/authenticated, so the public key can't call them either.
--   * Real student names never reach this database in readable form: the
--     browser encrypts them with the room's public key before joining.
--
-- Times the app shows (createdAt, lastActive, joinedAt) are stored as epoch
-- milliseconds, matching the JSON the API returns. Expiry uses timestamptz:
-- accounts and rooms expire after about 13 months without activity.

create schema if not exists atlas;
revoke all on schema atlas from public;

create table atlas.accounts (
  id              text primary key,
  username        text not null,
  username_key    text not null unique,      -- normalized username for sign-in
  emoji           text not null default '',
  code_hash       text not null,             -- salted hash of the sign-in code
  created_at      bigint not null,
  last_active     bigint,
  data            jsonb not null default '{}'::jsonb,  -- synced profile, saved list, tracker, My Story, chats, College Lab
  data_version    integer not null default 1,
  data_updated_at bigint,
  expires_at      timestamptz not null
);

create table atlas.sessions (
  token_hash text primary key,               -- sha256 of the cookie token
  account_id text not null references atlas.accounts (id) on delete cascade,
  expires_at timestamptz not null
);
create index sessions_account_idx on atlas.sessions (account_id);

create table atlas.rooms (
  code        text primary key,
  name        text not null,
  open        boolean not null default true,
  auth_hash   text not null,                 -- sha256 of the teacher's auth token
  public_key  text not null,                 -- students encrypt their real name with this
  wrapped_key text not null,                 -- the room's private key, encrypted with the teacher key
  wrap_iv     text not null,
  created_at  bigint not null,
  expires_at  timestamptz not null
);

-- One room per student. enc_name is the real name, encrypted in the browser.
create table atlas.room_members (
  account_id text primary key references atlas.accounts (id) on delete cascade,
  room_code  text not null references atlas.rooms (code) on delete cascade,
  enc_name   text not null,
  grade      smallint,
  joined_at  bigint not null
);
create index room_members_room_idx on atlas.room_members (room_code);

create table atlas.rate_limits (
  bucket     text primary key,
  count      integer not null,
  expires_at timestamptz not null
);

create table atlas.reviews (
  id             text primary key,
  opportunity_id text not null,
  rating         smallint not null check (rating between 1 and 5),
  created_at     bigint not null,
  state          text not null default 'draft' check (state in ('draft', 'published', 'pending')),
  review         jsonb not null              -- the review as the API stores it, including moderation fields
);
create index reviews_published_idx on atlas.reviews (opportunity_id, created_at desc) where state = 'published';
create index reviews_pending_idx on atlas.reviews (created_at) where state = 'pending';

create table atlas.review_reporters (
  review_id text not null references atlas.reviews (id) on delete cascade,
  reporter  text not null,                   -- salted hash of the reporter's IP
  primary key (review_id, reporter)
);

create table atlas.review_once (
  key        text primary key,               -- "only once" markers (one review per opportunity per visitor)
  expires_at timestamptz not null
);

alter table atlas.accounts enable row level security;
alter table atlas.sessions enable row level security;
alter table atlas.rooms enable row level security;
alter table atlas.room_members enable row level security;
alter table atlas.rate_limits enable row level security;
alter table atlas.reviews enable row level security;
alter table atlas.review_reporters enable row level security;
alter table atlas.review_once enable row level security;

-- ---- Helpers ------------------------------------------------------------------
create function atlas.keep() returns timestamptz
language sql stable set search_path = '' as $$ select now() + interval '400 days' $$;

create function atlas.account_json(a atlas.accounts) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', a.id, 'username', a.username, 'emoji', a.emoji, 'codeHash', a.code_hash,
    'createdAt', a.created_at, 'lastActive', a.last_active,
    'room', m.room_code, 'roomName', r.name)
  from (select 1) _
  left join atlas.room_members m on m.account_id = a.id
  left join atlas.rooms r on r.code = m.room_code and r.expires_at > now()
$$;

create function atlas.room_json(r atlas.rooms) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'code', r.code, 'name', r.name, 'open', r.open, 'createdAt', r.created_at,
    'authHash', r.auth_hash, 'publicKey', r.public_key, 'wrappedKey', r.wrapped_key, 'wrapIv', r.wrap_iv)
$$;

-- ---- Rate limits ----------------------------------------------------------------
create function public.atlas_hit(p_bucket text, p_seconds integer) returns integer
language sql set search_path = '' as $$
  insert into atlas.rate_limits as r (bucket, count, expires_at)
  values (p_bucket, 1, now() + make_interval(secs => p_seconds))
  on conflict (bucket) do update set
    count = case when r.expires_at <= now() then 1 else r.count + 1 end,
    expires_at = case when r.expires_at <= now() then excluded.expires_at else r.expires_at end
  returning count
$$;

create function public.atlas_peek(p_buckets text[]) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(coalesce(r.count, 0) order by b.ord), '[]'::jsonb)
  from unnest(p_buckets) with ordinality as b (bucket, ord)
  left join atlas.rate_limits r on r.bucket = b.bucket and r.expires_at > now()
$$;

-- ---- Accounts -------------------------------------------------------------------
create function public.atlas_create_account(
  p_id text, p_username text, p_username_key text, p_emoji text, p_code_hash text, p_created_at bigint, p_data jsonb
) returns boolean
language plpgsql set search_path = '' as $$
begin
  delete from atlas.accounts where username_key = p_username_key and expires_at <= now();
  insert into atlas.accounts (id, username, username_key, emoji, code_hash, created_at, last_active, data, data_version, data_updated_at, expires_at)
  values (p_id, p_username, p_username_key, p_emoji, p_code_hash, p_created_at, p_created_at, coalesce(p_data, '{}'::jsonb), 1, p_created_at, atlas.keep())
  on conflict do nothing;
  return found;
end $$;

create function public.atlas_get_account(p_id text default null, p_username_key text default null) returns jsonb
language sql stable set search_path = '' as $$
  select atlas.account_json(a) from atlas.accounts a
  where (a.id = p_id or a.username_key = p_username_key) and a.expires_at > now()
  limit 1
$$;

create function public.atlas_touch_account(p_id text) returns void
language sql set search_path = '' as $$
  update atlas.accounts set expires_at = atlas.keep() where id = p_id
$$;

create function public.atlas_set_code(p_id text, p_code_hash text) returns void
language sql set search_path = '' as $$
  update atlas.accounts set code_hash = p_code_hash where id = p_id
$$;

create function public.atlas_delete_account(p_id text) returns void
language sql set search_path = '' as $$
  delete from atlas.accounts where id = p_id
$$;

create function public.atlas_get_data(p_id text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('version', a.data_version, 'updatedAt', a.data_updated_at, 'data', a.data)
  from atlas.accounts a where a.id = p_id and a.expires_at > now()
$$;

-- Merges the changed top-level keys into the synced data, but only if the
-- browser saw the latest version; otherwise returns what's stored so it can merge.
create function public.atlas_sync_data(p_id text, p_base_version integer, p_data jsonb, p_remove text[], p_at bigint) returns jsonb
language plpgsql set search_path = '' as $$
declare
  next_version integer;
  current atlas.accounts;
begin
  update atlas.accounts
  set data = (data || coalesce(p_data, '{}'::jsonb)) - coalesce(p_remove, '{}'::text[]),
      data_version = data_version + 1, data_updated_at = p_at, last_active = p_at, expires_at = atlas.keep()
  where id = p_id and data_version = p_base_version and expires_at > now()
  returning data_version into next_version;
  if next_version is not null then
    return jsonb_build_object('ok', true, 'version', next_version);
  end if;
  select * into current from atlas.accounts where id = p_id;
  return jsonb_build_object('ok', false, 'version', coalesce(current.data_version, 0), 'data', coalesce(current.data, '{}'::jsonb));
end $$;

-- ---- Sessions -------------------------------------------------------------------
create function public.atlas_create_session(p_token_hash text, p_account_id text, p_seconds integer) returns void
language sql set search_path = '' as $$
  insert into atlas.sessions (token_hash, account_id, expires_at)
  values (p_token_hash, p_account_id, now() + make_interval(secs => p_seconds))
$$;

create function public.atlas_session_account(p_token_hash text) returns jsonb
language sql stable set search_path = '' as $$
  select atlas.account_json(a)
  from atlas.sessions s join atlas.accounts a on a.id = s.account_id
  where s.token_hash = p_token_hash and s.expires_at > now() and a.expires_at > now()
$$;

create function public.atlas_delete_session(p_token_hash text) returns void
language sql set search_path = '' as $$
  delete from atlas.sessions where token_hash = p_token_hash
$$;

-- ---- Rooms ----------------------------------------------------------------------
create function public.atlas_create_room(
  p_code text, p_name text, p_auth_hash text, p_public_key text, p_wrapped_key text, p_wrap_iv text, p_created_at bigint
) returns boolean
language plpgsql set search_path = '' as $$
begin
  delete from atlas.rooms where code = p_code and expires_at <= now();
  insert into atlas.rooms (code, name, open, auth_hash, public_key, wrapped_key, wrap_iv, created_at, expires_at)
  values (p_code, p_name, true, p_auth_hash, p_public_key, p_wrapped_key, p_wrap_iv, p_created_at, atlas.keep())
  on conflict do nothing;
  return found;
end $$;

create function public.atlas_get_room(p_code text) returns jsonb
language sql stable set search_path = '' as $$
  select atlas.room_json(r) from atlas.rooms r where r.code = p_code and r.expires_at > now()
$$;

create function public.atlas_touch_room(p_code text) returns void
language sql set search_path = '' as $$
  update atlas.rooms set expires_at = atlas.keep() where code = p_code
$$;

create function public.atlas_update_room(p_code text, p_name text, p_open boolean) returns jsonb
language sql set search_path = '' as $$
  update atlas.rooms r set name = p_name, open = p_open where r.code = p_code
  returning atlas.room_json(r)
$$;

-- Students in the room keep their accounts; they just leave the room.
create function public.atlas_delete_room(p_code text) returns void
language sql set search_path = '' as $$
  delete from atlas.rooms where code = p_code
$$;

-- Joins (or rejoins) a room, leaving any other room. Returns 'ok' or 'full'.
create function public.atlas_join_room(
  p_code text, p_account_id text, p_enc_name text, p_grade integer, p_joined_at bigint, p_max integer
) returns text
language plpgsql set search_path = '' as $$
begin
  perform 1 from atlas.rooms where code = p_code for update;
  if not exists (select 1 from atlas.room_members where account_id = p_account_id and room_code = p_code)
     and (select count(*) from atlas.room_members where room_code = p_code) >= p_max then
    return 'full';
  end if;
  insert into atlas.room_members (account_id, room_code, enc_name, grade, joined_at)
  values (p_account_id, p_code, p_enc_name, p_grade, p_joined_at)
  on conflict (account_id) do update set
    room_code = excluded.room_code, enc_name = excluded.enc_name, grade = excluded.grade, joined_at = excluded.joined_at;
  update atlas.rooms set expires_at = atlas.keep() where code = p_code;
  return 'ok';
end $$;

-- Leaves the student's room (only if it is p_code, when given).
create function public.atlas_leave_room(p_account_id text, p_code text default null) returns boolean
language plpgsql set search_path = '' as $$
begin
  delete from atlas.room_members where account_id = p_account_id and (p_code is null or room_code = p_code);
  return found;
end $$;

-- A room's students for the teacher dashboard: only the parts of their data a
-- teacher may see leave the database (never chats or essays).
create function public.atlas_room_students(p_code text, p_username_key text default null) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'user', atlas.account_json(a),
    'member', jsonb_build_object('encName', m.enc_name, 'grade', m.grade, 'joinedAt', m.joined_at),
    'stored', jsonb_build_object('version', a.data_version, 'updatedAt', a.data_updated_at, 'data', jsonb_strip_nulls(jsonb_build_object(
      'profile', a.data -> 'profile', 'saved', a.data -> 'saved', 'tracker', a.data -> 'tracker', 'portfolio', a.data -> 'portfolio',
      'lab', jsonb_strip_nulls(jsonb_build_object('stats', a.data -> 'lab' -> 'stats'))))))
    order by m.joined_at), '[]'::jsonb)
  from atlas.room_members m
  join atlas.accounts a on a.id = m.account_id and a.expires_at > now()
  where m.room_code = p_code and (p_username_key is null or a.username_key = p_username_key)
$$;

-- ---- Reviews --------------------------------------------------------------------
create function public.atlas_reviews_get(p_ids text[]) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(r.review order by i.ord), '[]'::jsonb)
  from unnest(p_ids) with ordinality as i (id, ord)
  join atlas.reviews r on r.id = i.id
$$;

-- Saves the review's content; publishing and holding change its state separately.
create function public.atlas_review_save(p_review jsonb) returns void
language sql set search_path = '' as $$
  insert into atlas.reviews (id, opportunity_id, rating, created_at, review)
  values (p_review ->> 'id', p_review ->> 'opportunityId', (p_review ->> 'rating')::smallint, (p_review ->> 'createdAt')::bigint, p_review)
  on conflict (id) do update set review = excluded.review
$$;

create function public.atlas_reviews_published_ids(p_opportunity_id text, p_offset integer, p_limit integer) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(id order by created_at desc, id desc), '[]'::jsonb) from (
    select id, created_at from atlas.reviews
    where opportunity_id = p_opportunity_id and state = 'published'
    order by created_at desc, id desc offset p_offset limit p_limit) s
$$;

create function public.atlas_reviews_pending_ids(p_limit integer) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(id order by created_at, id), '[]'::jsonb) from (
    select id, created_at from atlas.reviews where state = 'pending' order by created_at, id limit p_limit) s
$$;

create function public.atlas_review_set_state(p_id text, p_state text) returns void
language sql set search_path = '' as $$
  update atlas.reviews set state = p_state where id = p_id
$$;

create function public.atlas_review_delete(p_id text) returns void
language sql set search_path = '' as $$
  delete from atlas.reviews where id = p_id
$$;

-- {"<opportunityId>:<stars>": count} over published reviews.
create function public.atlas_review_star_counts() returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
    select opportunity_id || ':' || rating as k, count(*) as n
    from atlas.reviews where state = 'published' group by opportunity_id, rating) s
$$;

create function public.atlas_review_once(p_key text, p_seconds integer) returns boolean
language plpgsql set search_path = '' as $$
begin
  delete from atlas.review_once where key = p_key and expires_at <= now();
  insert into atlas.review_once (key, expires_at) values (p_key, now() + make_interval(secs => p_seconds))
  on conflict do nothing;
  return found;
end $$;

create function public.atlas_review_release(p_key text) returns void
language sql set search_path = '' as $$
  delete from atlas.review_once where key = p_key
$$;

-- Returns the number of distinct reporters, or 0 if this reporter already reported.
create function public.atlas_review_add_reporter(p_review_id text, p_reporter text) returns integer
language plpgsql set search_path = '' as $$
begin
  insert into atlas.review_reporters (review_id, reporter) values (p_review_id, p_reporter) on conflict do nothing;
  if not found then return 0; end if;
  return (select count(*) from atlas.review_reporters where review_id = p_review_id);
end $$;

-- ---- Housekeeping ---------------------------------------------------------------
create function public.atlas_purge_expired() returns void
language sql set search_path = '' as $$
  delete from atlas.sessions where expires_at <= now();
  delete from atlas.accounts where expires_at <= now();
  delete from atlas.rooms where expires_at <= now();
  delete from atlas.rate_limits where expires_at <= now();
  delete from atlas.review_once where expires_at <= now();
$$;

-- ---- One-time import from the old Redis store (scripts/migrate-redis-to-supabase.js)
-- Idempotent: rows that already exist are left alone.
create function public.atlas_import(p_rows jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  counts jsonb := '{}'::jsonb;
  n integer;
begin
  insert into atlas.rooms (code, name, open, auth_hash, public_key, wrapped_key, wrap_iv, created_at, expires_at)
  select x ->> 'code', x ->> 'name', coalesce((x ->> 'open')::boolean, true), x ->> 'authHash', x ->> 'publicKey', x ->> 'wrappedKey', x ->> 'wrapIv',
         coalesce((x ->> 'createdAt')::bigint, 0), coalesce((x ->> 'expiresAt')::timestamptz, atlas.keep())
  from jsonb_array_elements(coalesce(p_rows -> 'rooms', '[]'::jsonb)) x
  on conflict do nothing;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('rooms', n);

  insert into atlas.accounts (id, username, username_key, emoji, code_hash, created_at, last_active, data, data_version, data_updated_at, expires_at)
  select x ->> 'id', x ->> 'username', x ->> 'usernameKey', coalesce(x ->> 'emoji', ''), x ->> 'codeHash',
         coalesce((x ->> 'createdAt')::bigint, 0), (x ->> 'lastActive')::bigint, coalesce(x -> 'data', '{}'::jsonb),
         coalesce((x ->> 'version')::integer, 1), (x ->> 'updatedAt')::bigint, coalesce((x ->> 'expiresAt')::timestamptz, atlas.keep())
  from jsonb_array_elements(coalesce(p_rows -> 'accounts', '[]'::jsonb)) x
  on conflict do nothing;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('accounts', n);

  insert into atlas.room_members (account_id, room_code, enc_name, grade, joined_at)
  select x ->> 'accountId', x ->> 'roomCode', x ->> 'encName', (x ->> 'grade')::smallint, coalesce((x ->> 'joinedAt')::bigint, 0)
  from jsonb_array_elements(coalesce(p_rows -> 'members', '[]'::jsonb)) x
  where exists (select 1 from atlas.accounts where id = x ->> 'accountId')
    and exists (select 1 from atlas.rooms where code = x ->> 'roomCode')
  on conflict do nothing;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('members', n);

  insert into atlas.sessions (token_hash, account_id, expires_at)
  select x ->> 'tokenHash', x ->> 'accountId', (x ->> 'expiresAt')::timestamptz
  from jsonb_array_elements(coalesce(p_rows -> 'sessions', '[]'::jsonb)) x
  where exists (select 1 from atlas.accounts where id = x ->> 'accountId')
  on conflict do nothing;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('sessions', n);

  insert into atlas.reviews (id, opportunity_id, rating, created_at, state, review)
  select x -> 'review' ->> 'id', x -> 'review' ->> 'opportunityId', (x -> 'review' ->> 'rating')::smallint,
         (x -> 'review' ->> 'createdAt')::bigint, coalesce(x ->> 'state', 'draft'), x -> 'review'
  from jsonb_array_elements(coalesce(p_rows -> 'reviews', '[]'::jsonb)) x
  on conflict do nothing;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('reviews', n);

  insert into atlas.review_reporters (review_id, reporter)
  select x ->> 'reviewId', x ->> 'reporter'
  from jsonb_array_elements(coalesce(p_rows -> 'reporters', '[]'::jsonb)) x
  where exists (select 1 from atlas.reviews where id = x ->> 'reviewId')
  on conflict do nothing;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('reporters', n);

  insert into atlas.review_once (key, expires_at)
  select x ->> 'key', (x ->> 'expiresAt')::timestamptz
  from jsonb_array_elements(coalesce(p_rows -> 'once', '[]'::jsonb)) x
  on conflict do nothing;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('once', n);

  return counts;
end $$;

-- ---- Privileges -------------------------------------------------------------------
-- Only the server's secret key (service_role) may touch any of this.
revoke all on all tables in schema atlas from public;
revoke all on all functions in schema atlas from public;
do $$
declare
  f record;
  api_roles text := (select string_agg(quote_ident(rolname), ', ') from pg_roles where rolname in ('anon', 'authenticated'));
begin
  if api_roles is not null then
    execute format('revoke all on schema atlas from %s', api_roles);
    execute format('revoke all on all tables in schema atlas from %s', api_roles);
  end if;
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'atlas\_%'
  loop
    execute format('revoke all on function %s from public', f.sig);
    if api_roles is not null then execute format('revoke all on function %s from %s', f.sig, api_roles); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema atlas to service_role;
    grant select, insert, update, delete on all tables in schema atlas to service_role;
    grant execute on all functions in schema atlas to service_role;
  end if;
end $$;

-- Clear out expired accounts, rooms, sessions, and counters every night, when
-- pg_cron is available (it is on Supabase). Reads already ignore expired rows.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('student-atlas-purge', '17 4 * * *', 'select public.atlas_purge_expired()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled (%); run select public.atlas_purge_expired() from time to time instead', sqlerrm;
end $$;

-- Let the Data API see the new functions right away.
notify pgrst, 'reload schema';
