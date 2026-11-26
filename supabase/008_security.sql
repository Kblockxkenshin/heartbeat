-- =====================================================================
-- Heartbeat · Part 6: Security & anti-cheat
-- Run AFTER 001–007. Safe to run again.
--
-- What it adds (all on the server):
--  * Account status: suspend or ban. A paused account can't rate, review, chat or play.
--  * Admin panel backend. Admins are listed in public.admins and MUST use 2-step sign-in (aal2).
--    Every admin action is logged in admin_actions.
--  * Bot / fake account signals: devices (hashed id + hashed IP, never the raw values),
--    "many accounts on one device", and "too many ratings too fast" (flag at 40 in 2 min, stop at 100).
--  * Anti review-bombing: sudden waves of ratings on one title from brand-new or linked accounts
--    are HELD: they don't count in public scores or give XP until an admin checks them.
--  * Public "Heartbeat fans" score per title, which leaves out held ratings and banned users.
-- To make yourself an admin (SQL editor):
--   insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';
-- =====================================================================

create table if not exists public.admins (
  user_id  uuid primary key references auth.users on delete cascade,
  added_at timestamptz not null default now()
);
create table if not exists public.user_status (
  user_id uuid primary key references auth.users on delete cascade,
  status  text not null default 'ok' check (status in ('ok','suspended','banned')),
  until   timestamptz,
  reason  text check (char_length(reason) <= 300),
  by_user uuid references auth.users on delete set null,
  at      timestamptz not null default now()
);
create table if not exists public.account_flags (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users on delete cascade,
  title_key   text,
  kind        text not null check (kind in ('rating_burst','multi_account','review_bomb','manual')),
  detail      jsonb not null default '{}'::jsonb,
  status      text not null default 'open' check (status in ('open','cleared','actioned')),
  created_at  timestamptz not null default now(),
  resolved_by uuid references auth.users on delete set null,
  resolved_at timestamptz
);
create unique index if not exists account_flags_open_user on public.account_flags (user_id, kind) where status = 'open' and user_id is not null;
create unique index if not exists account_flags_open_title on public.account_flags (title_key, kind) where status = 'open' and title_key is not null;
create table if not exists public.user_devices (
  user_id    uuid not null references auth.users on delete cascade,
  device     text not null,            -- sha256 of a random id the app keeps on the device
  ip_hash    text not null default '', -- sha256 of the IP address (never the address itself)
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  hits       int not null default 1,
  primary key (user_id, device, ip_hash)
);
create index if not exists user_devices_device on public.user_devices (device);
create table if not exists public.admin_actions (
  id        bigint generated always as identity primary key,
  admin     uuid references auth.users on delete set null,
  action    text not null,
  target    uuid,
  target_id text,
  note      text,
  at        timestamptz not null default now()
);

alter table public.ratings add column if not exists held boolean not null default false;
alter table public.ratings add column if not exists held_reason text;
create index if not exists ratings_held on public.ratings (title_key) where held;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public._claims() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
create or replace function public._aal() returns text
language sql stable as $$
  select coalesce(_claims()->>'aal', nullif(current_setting('request.jwt.claim.aal', true), ''), 'aal1')
$$;
-- 2-step sign-in: if you turned it on, the server only accepts you after the code (aal2).
create or replace function public._mfa_ok() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select _aal() = 'aal2' or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
$$;
create or replace function public._paused(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_status s where s.user_id = u
                 and (s.status = 'banned' or (s.status = 'suspended' and (s.until is null or s.until > now()))))
$$;
create or replace function public._is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from admins where user_id = auth.uid()) and _aal() = 'aal2'
$$;
create or replace function public._need_admin() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from admins where user_id = auth.uid()) then raise exception 'Admins only.'; end if;
  if _aal() <> 'aal2' then raise exception 'Admins must sign in with 2-step verification.'; end if;
  return auth.uid();
end $$;
create or replace function public._log_admin(a text, t uuid, tid text, n text) returns void
language sql security definer set search_path = public as $$
  insert into admin_actions (admin, action, target, target_id, note) values (auth.uid(), a, t, tid, n);
  insert into security_events (user_id, kind, detail) values (auth.uid(), 'admin', jsonb_build_object('action', a, 'target', t, 'id', tid));
$$;
create or replace function public._flag(u uuid, t text, k text, d jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if u is not null then
    insert into account_flags (user_id, kind, detail) values (u, k, d) on conflict do nothing;
  else
    insert into account_flags (title_key, kind, detail) values (t, k, d) on conflict do nothing;
  end if;
  insert into security_events (user_id, kind, detail) values (u, 'flag', jsonb_build_object('kind', k, 'title', t) || d);
end $$;

-- Paused accounts are not members: every rule that needs a member now blocks them too.
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from private_profiles where id = auth.uid() and birthdate is not null
                 and extract(year from age((now() at time zone 'utc')::date, birthdate)) >= 13)
     and not _paused(auth.uid()) and _mfa_ok()
$$;

create or replace function public._need_member(verified boolean default true) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); s user_status;
begin
  if uid is null then raise exception 'Please sign in first.'; end if;
  select * into s from user_status where user_id = uid;
  if s.status = 'banned' then raise exception 'This account was banned for breaking the community rules.'; end if;
  if s.status = 'suspended' and (s.until is null or s.until > now()) then
    raise exception 'Your account is paused until %. Reason: %', to_char(s.until at time zone 'utc', 'Mon DD, YYYY'), coalesce(s.reason, 'community rules'); end if;
  if not _mfa_ok() then raise exception 'Please enter your 2-step sign-in code first.'; end if;
  if not is_member() then raise exception 'Please finish setting up your account.'; end if;
  if verified and not is_verified() then raise exception 'Please confirm your email first. Check your inbox.'; end if;
  return uid;
end $$;

-- ---------------------------------------------------------------------
-- Devices: the app sends a random device id after sign-in. We keep only hashes.
-- ---------------------------------------------------------------------
create or replace function public.register_device(p_device text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); d text; ip text; iph text; n int;
begin
  if me is null then return; end if;
  if p_device is null or p_device !~ '^[A-Za-z0-9-]{16,64}$' then raise exception 'Bad device id.'; end if;
  d := encode(sha256(convert_to('hb-device:' || p_device, 'utf8')), 'hex');
  ip := split_part(coalesce(nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for', ''), ',', 1);
  iph := case when ip = '' then '' else encode(sha256(convert_to('hb-ip:' || btrim(ip), 'utf8')), 'hex') end;
  insert into user_devices (user_id, device, ip_hash) values (me, d, iph)
    on conflict (user_id, device, ip_hash) do update set last_seen = now(), hits = user_devices.hits + 1;
  -- Many accounts on one device in 30 days = suspicious (flag only; a person decides).
  select count(distinct user_id) into n from user_devices where device = d and last_seen > now() - interval '30 days';
  if n >= 4 then
    perform _flag(u.user_id, null, 'multi_account', jsonb_build_object('accounts_on_device', n))
      from (select distinct user_id from user_devices where device = d) u;
  end if;
end $$;

-- Accounts that share a device with u.
create or replace function public._linked(u uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct b.user_id from user_devices a join user_devices b on b.device = a.device
  where a.user_id = u and b.user_id <> u
$$;

-- ---------------------------------------------------------------------
-- Ratings: speed checks + review-bombing hold
-- ---------------------------------------------------------------------
create or replace function public._ratings_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare recent int; acct_age interval; fresh boolean; wave int; linked int;
begin
  if new.start_h is null or new.middle_h is null or new.end_h is null then raise exception 'Rate all three parts.'; end if;
  if new.start_h not between 1 and 5 or new.middle_h not between 1 and 5 or new.end_h not between 1 and 5 then
    raise exception 'Ratings go from 1 to 5.'; end if;
  new.overall := round(((new.start_h + new.middle_h + new.end_h * 2)::numeric / 4) * 2) / 2;
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    -- Only an admin decision can change the "held" mark.
    if current_setting('hb.admin', true) is distinct from 'on' then new.held := old.held; new.held_reason := old.held_reason; end if;
    return new;
  end if;
  new.created_at := now();
  new.held := false; new.held_reason := null;
  if current_setting('hb.importing', true) = 'on' then return new; end if;
  if _paused(new.user_id) then raise exception 'Your account is paused.'; end if;
  select count(*) into recent from ratings where user_id = new.user_id and created_at > now() - interval '2 minutes';
  if recent >= 100 then
    raise exception 'Slow down a little! Too many ratings at once.' using errcode = 'P0001';
  end if;
  if recent >= 40 then
    -- Nobody watches this fast: keep the rating but hold it, and flag the account for a person to check.
    new.held := true; new.held_reason := 'too_fast';
    perform _flag(new.user_id, null, 'rating_burst', jsonb_build_object('in_2_min', recent + 1));
    return new;
  end if;
  -- Review-bombing: a wave on one title from brand-new accounts, or from accounts linked to this one.
  select now() - created_at into acct_age from auth.users where id = new.user_id;
  fresh := acct_age < interval '3 days' or exists (select 1 from account_flags where user_id = new.user_id and status = 'open');
  if fresh then
    select count(*) into wave from ratings r join auth.users u on u.id = r.user_id
      where r.title_key = new.title_key and r.created_at > now() - interval '1 hour' and u.created_at > now() - interval '3 days';
    if wave >= 3 then
      new.held := true; new.held_reason := 'wave';
      -- Hold the rest of the wave too (earlier ratings from brand-new accounts on this title).
      perform set_config('hb.admin', 'on', true);
      update ratings r set held = true, held_reason = 'wave'
        from auth.users u where u.id = r.user_id and r.title_key = new.title_key and not r.held
          and r.created_at > now() - interval '1 hour' and u.created_at > now() - interval '3 days';
      perform set_config('hb.admin', 'off', true);
      perform _flag(null, new.title_key, 'review_bomb', jsonb_build_object('new_accounts_last_hour', wave + 1));
      return new;
    end if;
  end if;
  select count(*) into linked from ratings r where r.title_key = new.title_key and r.created_at > now() - interval '1 day'
    and r.user_id in (select _linked(new.user_id));
  if linked >= 1 then
    new.held := true; new.held_reason := 'linked';
    perform _flag(null, new.title_key, 'review_bomb', jsonb_build_object('linked_accounts', linked + 1));
  end if;
  return new;
end $$;

-- Held ratings give no XP until released (the streak still counts: the person did show up).
create or replace function public._ratings_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('hb.importing', true) = 'on' then return null; end if;
  if not new.held then perform _award_xp(new.user_id, 'rate', new.title_key, 5); end if;
  perform _touch_streak(new.user_id);
  return null;
end $$;

-- Public score for a title from Heartbeat members (held ratings and banned accounts left out).
create or replace function public.title_scores(p_title text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('n', count(*), 'overall', round(avg(r.overall), 1), 'start', round(avg(r.start_h), 1),
    'middle', round(avg(r.middle_h), 1), 'end', round(avg(r.end_h), 1),
    'held', (select count(*) from ratings h where h.title_key = p_title and h.held))
  from ratings r
  where r.title_key = p_title and not r.held
    and not exists (select 1 from user_status s where s.user_id = r.user_id and s.status = 'banned')
$$;

-- ---------------------------------------------------------------------
-- For the app: my account status (+ whether I can open the admin panel)
-- ---------------------------------------------------------------------
create or replace function public.my_security() returns jsonb
language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'admin', exists (select 1 from admins where user_id = auth.uid()),
    'aal', _aal(),
    'status', coalesce(s.status, 'ok'),
    'until', s.until, 'reason', s.reason,
    'paused', _paused(auth.uid()),
    'mfa', exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'),
    'needs_code', not _mfa_ok())
  from (select auth.uid() id) me left join user_status s on s.user_id = me.id
  where auth.uid() is not null
$$;

-- ---------------------------------------------------------------------
-- Admin panel (admins + 2-step sign-in only). Every change is logged.
-- ---------------------------------------------------------------------
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _need_admin();
  return jsonb_build_object(
    'reports', (select count(*) from user_reports where status = 'open') + (select count(*) from review_reports where status = 'open')
               + (select count(*) from chat_reports where status = 'open'),
    'flags', (select count(*) from account_flags where status = 'open'),
    'held', (select count(*) from ratings where held),
    'paused', (select count(*) from user_status where status = 'banned' or (status = 'suspended' and until > now())),
    'users', (select count(*) from profiles where username is not null),
    'new_today', (select count(*) from auth.users where created_at > now() - interval '1 day'),
    'events_today', (select count(*) from security_events where created_at > now() - interval '1 day' and kind in ('rate_limit','flag','billing','admin')));
end $$;

create or replace function public.admin_reports(p_kind text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _need_admin();
  if p_kind = 'review' then
    return (select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) from (
      select jsonb_build_object('id', r.id, 'reason', r.reason, 'note', r.note, 'at', r.created_at, 'reporter', _mini(r.reporter),
        'target', _mini(coalesce(v.user_id, c.user_id)), 'what', case when r.comment_id is not null then 'comment' else 'review' end,
        'title_key', v.title_key, 'text', coalesce(left(c.body, 400), left(coalesce(v.headline || ' — ', '') || v.body, 400)),
        'hidden', coalesce(c.hidden, v.hidden)) x
      from review_reports r left join reviews v on v.id = r.review_id left join review_comments c on c.id = r.comment_id
      where r.status = 'open' limit 100) z);
  elsif p_kind = 'chat' then
    return (select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) from (
      select jsonb_build_object('id', r.id, 'reason', r.reason, 'note', r.note, 'at', r.created_at, 'reporter', _mini(r.reporter),
        'target', _mini(m.sender), 'what', 'message', 'text', left(m.body, 400), 'hidden', m.hidden) x
      from chat_reports r join chat_messages m on m.id = r.message_id where r.status = 'open' limit 100) z);
  elsif p_kind = 'user' then
    return (select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) from (
      select jsonb_build_object('id', r.id, 'reason', r.reason, 'note', r.note, 'at', r.created_at, 'reporter', _mini(r.reporter),
        'target', _mini(r.target), 'what', 'user', 'text', (select bio from profiles where id = r.target)) x
      from user_reports r where r.status = 'open' limit 100) z);
  end if;
  raise exception 'Unknown report type.';
end $$;

-- action: 'keep' (report was wrong) or 'remove' (hide the content)
create or replace function public.admin_resolve_report(p_kind text, p_id bigint, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform _need_admin();
  if p_action not in ('keep','remove') then raise exception 'Pick keep or remove.'; end if;
  if p_kind = 'review' then
    select * into r from review_reports where id = p_id;
    if r.id is null then raise exception 'Report not found.'; end if;
    if p_action = 'remove' then
      if r.comment_id is not null then update review_comments set hidden = true where id = r.comment_id;
      else update reviews set hidden = true where id = r.review_id; end if;
    end if;
    update review_reports set status = case when p_action = 'keep' then 'kept' else 'removed' end
      where status = 'open' and (review_id is not distinct from r.review_id) and (comment_id is not distinct from r.comment_id);
  elsif p_kind = 'chat' then
    select * into r from chat_reports where id = p_id;
    if r.id is null then raise exception 'Report not found.'; end if;
    update chat_messages set hidden = (p_action = 'remove') where id = r.message_id;
    update chat_reports set status = case when p_action = 'keep' then 'kept' else 'removed' end where status = 'open' and message_id = r.message_id;
  elsif p_kind = 'user' then
    update user_reports set status = case when p_action = 'keep' then 'kept' else 'removed' end where id = p_id;
  else raise exception 'Unknown report type.'; end if;
  perform _log_admin('report_' || p_action, null, p_kind || ':' || p_id, null);
end $$;

create or replace function public.admin_flags() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _need_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'detail', f.detail, 'at', f.created_at,
      'user', case when f.user_id is not null then _mini(f.user_id) end, 'title_key', f.title_key,
      'linked', case when f.user_id is not null then (select count(*) from _linked(f.user_id)) end,
      'paused', case when f.user_id is not null then _paused(f.user_id) end) order by f.created_at desc), '[]'::jsonb)
    from account_flags f where f.status = 'open');
end $$;

create or replace function public.admin_resolve_flag(p_id bigint, p_action text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _need_admin();
  if p_action not in ('cleared','actioned') then raise exception 'Pick cleared or actioned.'; end if;
  update account_flags set status = p_action, resolved_by = auth.uid(), resolved_at = now() where id = p_id and status = 'open';
  perform _log_admin('flag_' || p_action, null, p_id::text, null);
end $$;

create or replace function public.admin_held() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _need_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('title_key', t.title_key, 'n', t.n, 'avg', t.avg, 'reasons', t.reasons,
      'normal_avg', (select round(avg(overall), 1) from ratings x where x.title_key = t.title_key and not x.held),
      'people', t.people) order by t.n desc), '[]'::jsonb)
    from (select title_key, count(*) n, round(avg(overall), 1) avg, jsonb_agg(distinct held_reason) reasons,
            jsonb_agg(_mini(user_id) || jsonb_build_object('overall', overall)) people
          from ratings where held group by title_key) t);
end $$;

-- 'release' = count them (and give the XP they earned); 'discard' = delete them.
create or replace function public.admin_release_held(p_title text, p_action text) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  perform _need_admin();
  if p_action = 'release' then
    perform set_config('hb.admin', 'on', true);
    for r in select user_id, title_key from ratings where title_key = p_title and held loop
      update ratings set held = false, held_reason = null where user_id = r.user_id and title_key = r.title_key;
      perform _award_xp(r.user_id, 'rate', r.title_key, 5);
      n := n + 1;
    end loop;
    perform set_config('hb.admin', 'off', true);
  elsif p_action = 'discard' then
    delete from ratings where title_key = p_title and held;
    get diagnostics n = row_count;
  else raise exception 'Pick release or discard.'; end if;
  update account_flags set status = 'actioned', resolved_by = auth.uid(), resolved_at = now()
    where title_key = p_title and kind = 'review_bomb' and status = 'open';
  perform _log_admin('held_' || p_action, null, p_title, n || ' ratings');
  return n;
end $$;

create or replace function public.admin_find_user(p_q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _need_admin();
  return (select coalesce(jsonb_agg(_mini(p.id) || jsonb_build_object(
      'status', coalesce(s.status, 'ok'), 'until', s.until, 'reason', s.reason, 'paused', _paused(p.id),
      'joined', u.created_at, 'flags', (select count(*) from account_flags f where f.user_id = p.id and f.status = 'open'),
      'reports', (select count(*) from user_reports r where r.target = p.id),
      'linked', (select count(*) from _linked(p.id)), 'admin', exists (select 1 from admins a where a.user_id = p.id))
      order by p.username), '[]'::jsonb)
    from profiles p join auth.users u on u.id = p.id left join user_status s on s.user_id = p.id
    where p.username ilike '%' || replace(replace(left(coalesce(p_q, ''), 30), '%', ''), '_', '\_') || '%' limit 30);
end $$;

-- status: 'ok' (restore), 'suspended' (p_days 1–365), 'banned'
create or replace function public.admin_set_status(p_user uuid, p_status text, p_days int, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_admin();
begin
  if p_status not in ('ok','suspended','banned') then raise exception 'Unknown status.'; end if;
  if p_user = me then raise exception 'You can''t change your own account.'; end if;
  if exists (select 1 from admins where user_id = p_user) then raise exception 'Remove admin rights first (in the SQL editor).'; end if;
  if p_status = 'suspended' and (p_days is null or p_days not between 1 and 365) then raise exception 'Pick 1 to 365 days.'; end if;
  if p_status <> 'ok' and coalesce(btrim(p_reason), '') = '' then raise exception 'Write a short reason. The person will see it.'; end if;
  insert into user_status (user_id, status, until, reason, by_user, at)
  values (p_user, p_status, case when p_status = 'suspended' then now() + make_interval(days => p_days) end, left(p_reason, 300), me, now())
  on conflict (user_id) do update set status = excluded.status, until = excluded.until, reason = excluded.reason, by_user = me, at = now();
  perform _log_admin('status_' || p_status, p_user, null, p_reason);
  return jsonb_build_object('status', p_status);
end $$;

create or replace function public.admin_events(p_limit int default 80) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _need_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('at', e.created_at, 'kind', e.kind, 'detail', e.detail,
      'user', case when e.user_id is not null then _mini(e.user_id) end) order by e.created_at desc), '[]'::jsonb)
    from (select * from security_events where kind in ('rate_limit','flag','billing','admin')
          order by created_at desc limit least(greatest(coalesce(p_limit, 80), 1), 300)) e);
end $$;

-- ---------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['admins','user_status','account_flags','user_devices','admin_actions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
-- The app may not set "held" itself (the trigger also guards it).
revoke update (held, held_reason) on public.ratings from anon, authenticated;

revoke execute on function public._mfa_ok(), public._paused(uuid), public._need_admin(), public._log_admin(text,uuid,text,text), public._flag(uuid,text,text,jsonb),
  public._linked(uuid), public._is_admin() from public, anon, authenticated;
revoke execute on function public.register_device(text), public.my_security(), public.admin_overview(), public.admin_reports(text),
  public.admin_resolve_report(text,bigint,text), public.admin_flags(), public.admin_resolve_flag(bigint,text), public.admin_held(),
  public.admin_release_held(text,text), public.admin_find_user(text), public.admin_set_status(uuid,text,int,text), public.admin_events(int)
  from public, anon;
grant execute on function public.register_device(text), public.my_security(), public.admin_overview(), public.admin_reports(text),
  public.admin_resolve_report(text,bigint,text), public.admin_flags(), public.admin_resolve_flag(bigint,text), public.admin_held(),
  public.admin_release_held(text,text), public.admin_find_user(text), public.admin_set_status(uuid,text,int,text), public.admin_events(int)
  to authenticated;
grant execute on function public.title_scores(text) to anon, authenticated;
