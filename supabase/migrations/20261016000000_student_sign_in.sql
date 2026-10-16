-- Easier student sign-in: a picture password (three pictures in order), a
-- downloadable Login Pass (a QR code image), and teacher-managed lock/unlock
-- with one-time sign-in links. Same access model as the first migration: only
-- the server's secret key can reach any of this.

alter table atlas.accounts
  add column picture_hash         text,               -- slow, salted hash of the picture sequence
  add column picture_fails        integer not null default 0,  -- wrong picture tries since the last sign-in
  add column picture_locked_until timestamptz,
  add column pass_hash            text,               -- hash of the Login Pass secret (one pass per account)
  add column locked               boolean not null default false;  -- locked by a teacher: no sign-in at all
create unique index accounts_pass_hash_idx on atlas.accounts (pass_hash) where pass_hash is not null;

-- One-time sign-in links a teacher makes for a student in their room.
create table atlas.login_links (
  token_hash text primary key,
  account_id text not null references atlas.accounts (id) on delete cascade,
  expires_at timestamptz not null
);
create index login_links_account_idx on atlas.login_links (account_id);
alter table atlas.login_links enable row level security;

-- ---- Account JSON gains the sign-in state ------------------------------------------
create or replace function atlas.account_json(a atlas.accounts) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', a.id, 'username', a.username, 'emoji', a.emoji, 'codeHash', a.code_hash,
    'createdAt', a.created_at, 'lastActive', a.last_active,
    'room', m.room_code, 'roomName', r.name,
    'pictureHash', a.picture_hash, 'pictureFails', a.picture_fails,
    'pictureLockedUntil', (extract(epoch from a.picture_locked_until) * 1000)::bigint,
    'hasPass', a.pass_hash is not null, 'locked', a.locked)
  from (select 1) _
  left join atlas.room_members m on m.account_id = a.id
  left join atlas.rooms r on r.code = m.room_code and r.expires_at > now()
$$;

-- A locked account's sessions stop working.
create or replace function public.atlas_session_account(p_token_hash text) returns jsonb
language sql stable set search_path = '' as $$
  select atlas.account_json(a)
  from atlas.sessions s join atlas.accounts a on a.id = s.account_id
  where s.token_hash = p_token_hash and s.expires_at > now() and a.expires_at > now() and not a.locked
$$;

-- ---- Picture password ------------------------------------------------------------------
create function public.atlas_set_picture(p_id text, p_hash text) returns void
language sql set search_path = '' as $$
  update atlas.accounts set picture_hash = p_hash, picture_fails = 0, picture_locked_until = null where id = p_id
$$;

-- Counts a wrong picture try. Every p_lock_every wrong tries lock the picture
-- password for p_lock_seconds. Returns the new count and the lock time.
create function public.atlas_picture_fail(p_id text, p_lock_every integer, p_lock_seconds integer) returns jsonb
language sql set search_path = '' as $$
  update atlas.accounts set
    picture_fails = picture_fails + 1,
    picture_locked_until = case when (picture_fails + 1) % p_lock_every = 0 then now() + make_interval(secs => p_lock_seconds) else picture_locked_until end
  where id = p_id
  returning jsonb_build_object('fails', picture_fails, 'lockedUntil', (extract(epoch from picture_locked_until) * 1000)::bigint)
$$;

-- Any successful sign-in clears the wrong-picture count.
create function public.atlas_signed_in(p_id text) returns void
language sql set search_path = '' as $$
  update atlas.accounts set picture_fails = 0, picture_locked_until = null, expires_at = atlas.keep() where id = p_id
$$;

-- ---- Login Pass --------------------------------------------------------------------------
create function public.atlas_set_pass(p_id text, p_hash text) returns void
language sql set search_path = '' as $$
  update atlas.accounts set pass_hash = p_hash where id = p_id
$$;

create function public.atlas_account_by_pass(p_hash text) returns jsonb
language sql stable set search_path = '' as $$
  select atlas.account_json(a) from atlas.accounts a where a.pass_hash = p_hash and a.expires_at > now()
$$;

-- ---- Teacher lock and sign-in links ---------------------------------------------------------
-- Locking signs the student out everywhere; unlocking also clears a picture lockout.
create function public.atlas_set_locked(p_id text, p_locked boolean) returns void
language plpgsql set search_path = '' as $$
begin
  update atlas.accounts set locked = p_locked,
    picture_fails = case when p_locked then picture_fails else 0 end,
    picture_locked_until = case when p_locked then picture_locked_until else null end
  where id = p_id;
  if p_locked then
    delete from atlas.sessions where account_id = p_id;
    delete from atlas.login_links where account_id = p_id;
  end if;
end $$;

-- A new link replaces any earlier one for the same student.
create function public.atlas_create_login_link(p_token_hash text, p_account_id text, p_seconds integer) returns void
language plpgsql set search_path = '' as $$
begin
  delete from atlas.login_links where account_id = p_account_id;
  insert into atlas.login_links (token_hash, account_id, expires_at)
  values (p_token_hash, p_account_id, now() + make_interval(secs => p_seconds));
end $$;

-- Uses up a link: it works once, and never for a locked account.
create function public.atlas_use_login_link(p_token_hash text) returns jsonb
language plpgsql set search_path = '' as $$
declare
  acct text;
begin
  delete from atlas.login_links where token_hash = p_token_hash and expires_at > now() returning account_id into acct;
  if acct is null then return null; end if;
  return (select atlas.account_json(a) from atlas.accounts a where a.id = acct and a.expires_at > now() and not a.locked);
end $$;

create or replace function public.atlas_purge_expired() returns void
language sql set search_path = '' as $$
  delete from atlas.sessions where expires_at <= now();
  delete from atlas.login_links where expires_at <= now();
  delete from atlas.accounts where expires_at <= now();
  delete from atlas.rooms where expires_at <= now();
  delete from atlas.rate_limits where expires_at <= now();
  delete from atlas.review_once where expires_at <= now();
$$;

-- ---- Privileges (as in the first migration) ---------------------------------------------------
revoke all on all tables in schema atlas from public;
revoke all on all functions in schema atlas from public;
do $$
declare
  f record;
  api_roles text := (select string_agg(quote_ident(rolname), ', ') from pg_roles where rolname in ('anon', 'authenticated'));
begin
  if api_roles is not null then
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
    grant select, insert, update, delete on all tables in schema atlas to service_role;
    grant execute on all functions in schema atlas to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';
