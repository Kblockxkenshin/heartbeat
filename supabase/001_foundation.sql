-- =====================================================================
-- Heartbeat · Part 0 · Foundation
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run again (it only adds what is missing).
--
-- Rules this file follows:
--  * Row Level Security (RLS) is ON for every table.
--  * People can only change their own rows.
--  * XP, rank, streak and Plus status live in tables the app CANNOT write.
--    Only server functions (security definer) and triggers change them.
--  * Minimum age 13. Birthdates are private (only the owner can read them).
-- =====================================================================

create extension if not exists citext;

-- ---------------------------------------------------------------------
-- Helper: rank names from XP
-- ---------------------------------------------------------------------
create or replace function public.rank_for(xp int) returns text
language sql immutable as $$
  select case
    when xp >= 6000 then 'Legend'
    when xp >= 3000 then 'Director''s Cut'
    when xp >= 1500 then 'Top Critic'
    when xp >=  700 then 'Critic'
    when xp >=  300 then 'Front Row'
    when xp >=  100 then 'Ticket Holder'
    else 'Popcorn' end
$$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

-- Public profile. The owner can edit these fields.
create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  username     citext unique check (username ~ '^[a-z0-9_.]{3,20}$'),
  display_name text check (char_length(display_name) <= 40),
  bio          text check (char_length(bio) <= 160),
  avatar_url   text check (avatar_url is null or avatar_url ~ '^https://'),
  created_at   timestamptz not null default now()
);

-- Private details. Only the owner can read. Nobody can edit from the app
-- (birthdate is set once through set_birthdate()).
create table if not exists public.private_profiles (
  id         uuid primary key references auth.users on delete cascade,
  birthdate  date,
  created_at timestamptz not null default now()
);

-- Game numbers. Everyone can read. ONLY the server writes.
create table if not exists public.user_stats (
  user_id      uuid primary key references auth.users on delete cascade,
  xp           int  not null default 0 check (xp >= 0),
  rank         text not null default 'Popcorn',
  streak_count int  not null default 0,
  streak_best  int  not null default 0,
  streak_last  date,
  plus_until   timestamptz,          -- Heartbeat Plus (set by payment webhooks later)
  is_minor     boolean not null default true,  -- safe default until birthdate is known
  updated_at   timestamptz not null default now()
);

-- Title key format: 'movie:27205' or 'tv:1396'
create table if not exists public.ratings (
  user_id    uuid not null references auth.users on delete cascade,
  title_key  text not null check (title_key ~ '^(movie|tv):[0-9]{1,9}$'),
  start_h    smallint not null check (start_h  between 1 and 5),
  middle_h   smallint not null check (middle_h between 1 and 5),
  end_h      smallint not null check (end_h    between 1 and 5),
  overall    numeric(2,1),           -- filled by the server
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, title_key)
);

create table if not exists public.swipes (
  user_id    uuid not null references auth.users on delete cascade,
  title_key  text not null check (title_key ~ '^(movie|tv):[0-9]{1,9}$'),
  kind       text not null check (kind in ('loved','disliked','unseen')),
  created_at timestamptz not null default now(),
  primary key (user_id, title_key)
);

create table if not exists public.watchlist (
  user_id    uuid not null references auth.users on delete cascade,
  title_key  text not null check (title_key ~ '^(movie|tv):[0-9]{1,9}$'),
  added_at   timestamptz not null default now(),
  primary key (user_id, title_key)
);

-- XP ledger. One row per reward. The unique key stops double rewards.
create table if not exists public.xp_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  kind       text not null,
  ref        text not null,
  amount     int  not null,
  created_at timestamptz not null default now(),
  unique (user_id, kind, ref)
);

-- Security log (sign-ups, blocked actions). Only the server writes. Nobody reads from the app.
create table if not exists public.security_events (
  id         bigint generated always as identity primary key,
  user_id    uuid,
  kind       text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ratings_title_idx on public.ratings (title_key);
create index if not exists ratings_user_time_idx on public.ratings (user_id, updated_at);
create index if not exists xp_user_idx on public.xp_events (user_id, created_at);

-- Is the signed-in person a full member? (birthday known and 13+)
-- Google sign-ups stay read-only until they enter a birthday.
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from private_profiles where id = auth.uid() and birthdate is not null
                 and extract(year from age((now() at time zone 'utc')::date, birthdate)) >= 13)
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.private_profiles enable row level security;
alter table public.user_stats       enable row level security;
alter table public.ratings          enable row level security;
alter table public.swipes           enable row level security;
alter table public.watchlist        enable row level security;
alter table public.xp_events        enable row level security;
alter table public.security_events  enable row level security;

-- Drop + recreate so this file can be run again.
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
    and tablename in ('profiles','private_profiles','user_stats','ratings','swipes','watchlist','xp_events','security_events')
  loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
end $$;

-- profiles: anyone can read; owner can update their own (not insert/delete: the server does that)
create policy "profiles readable" on public.profiles for select using (true);
create policy "profiles owner update" on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id and public.is_member());

-- private_profiles: owner can read only
create policy "private owner read" on public.private_profiles for select using (auth.uid() = id);

-- user_stats: anyone can read, nobody writes from the app
create policy "stats readable" on public.user_stats for select using (true);

-- ratings / swipes / watchlist: owner reads + writes own rows
-- (ratings stay private for now; Part 1 opens them to friends)
create policy "ratings owner all" on public.ratings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id and public.is_member());
create policy "swipes owner all" on public.swipes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id and public.is_member());
create policy "watchlist owner all" on public.watchlist for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id and public.is_member());

-- xp_events: owner can read their own history; nobody writes from the app
create policy "xp owner read" on public.xp_events for select using (auth.uid() = user_id);

-- security_events: no policies = nobody from the app can read or write

-- Give the app roles the rights they need (works even if the project
-- was created with "Grant API access to new tables automatically" turned off).
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.user_stats to anon, authenticated;
grant select on public.private_profiles, public.xp_events, public.ratings, public.swipes, public.watchlist to authenticated;
grant insert, update, delete on public.swipes, public.watchlist to authenticated;

-- Belt and braces: take write rights away from app roles on server-only tables.
revoke insert, update, delete on public.user_stats, public.xp_events, public.security_events, public.private_profiles from anon, authenticated;
revoke insert, delete on public.profiles from anon, authenticated;
-- Owners may only change these profile columns:
revoke update on public.profiles from anon, authenticated;
grant update (username, display_name, bio, avatar_url) on public.profiles to authenticated;
-- Ratings: the app may not write "overall" or the timestamps (the server fills them)
revoke insert, update on public.ratings from anon, authenticated;
grant insert (user_id, title_key, start_h, middle_h, end_h) on public.ratings to authenticated;
grant update (user_id, title_key, start_h, middle_h, end_h) on public.ratings to authenticated;
revoke all on public.ratings, public.swipes, public.watchlist from anon;

-- ---------------------------------------------------------------------
-- Server-side game logic
-- ---------------------------------------------------------------------

-- Give XP once per (kind, ref). Returns the XP actually given (0 if already given).
create or replace function public._award_xp(uid uuid, k text, r text, amt int) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into xp_events (user_id, kind, ref, amount) values (uid, k, r, amt)
  on conflict (user_id, kind, ref) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return 0; end if;
  update user_stats set xp = xp + amt, rank = rank_for(xp + amt), updated_at = now() where user_id = uid;
  return amt;
end $$;

-- Count today as an active day for the streak. Uses the user's day in UTC.
create or replace function public._touch_streak(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s user_stats; today date := (now() at time zone 'utc')::date;
begin
  select * into s from user_stats where user_id = uid for update;
  if s.streak_last = today then return; end if;
  update user_stats set
    streak_count = case when s.streak_last = today - 1 then s.streak_count + 1 else 1 end,
    streak_best  = greatest(streak_best, case when s.streak_last = today - 1 then s.streak_count + 1 else 1 end),
    streak_last  = today, updated_at = now()
  where user_id = uid;
end $$;

-- Before a rating is saved: fill "overall", stamp the time, and stop floods.
create or replace function public._ratings_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  new.overall := round(((new.start_h + new.middle_h + new.end_h * 2)::numeric / 4) * 2) / 2;
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    if current_setting('hb.importing', true) = 'on' then return new; end if;
    -- Rate limit: max 40 new ratings in 2 minutes (a person can't really watch that fast).
    select count(*) into recent from ratings
      where user_id = new.user_id and created_at > now() - interval '2 minutes';
    if recent >= 40 then
      insert into security_events (user_id, kind, detail) values (new.user_id, 'rate_limit', jsonb_build_object('table','ratings'));
      raise exception 'Slow down a little! Too many ratings at once.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

-- After a NEW rating: +5 XP (once per title, ever) and count the streak day.
create or replace function public._ratings_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('hb.importing', true) = 'on' then return null; end if;
  perform _award_xp(new.user_id, 'rate', new.title_key, 5);
  perform _touch_streak(new.user_id);
  return null;
end $$;

drop trigger if exists ratings_before on public.ratings;
create trigger ratings_before before insert or update on public.ratings
  for each row execute function public._ratings_before();
drop trigger if exists ratings_after on public.ratings;
create trigger ratings_after after insert on public.ratings
  for each row execute function public._ratings_after();

-- Quick Rate swipes count for the streak, and get +1 XP (once per title). Also rate limited.
create or replace function public._swipes_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  new.created_at := now();
  if current_setting('hb.importing', true) = 'on' then return new; end if;
  select count(*) into recent from swipes where user_id = new.user_id and created_at > now() - interval '2 minutes';
  if recent >= 60 then
    insert into security_events (user_id, kind, detail) values (new.user_id, 'rate_limit', jsonb_build_object('table','swipes'));
    raise exception 'Slow down a little! Too many swipes at once.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create or replace function public._swipes_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('hb.importing', true) = 'on' then return null; end if;
  if new.kind <> 'unseen' then
    perform _award_xp(new.user_id, 'swipe', new.title_key, 1);
    perform _touch_streak(new.user_id);
  end if;
  return null;
end $$;
drop trigger if exists swipes_before on public.swipes;
create trigger swipes_before before insert or update on public.swipes
  for each row execute function public._swipes_before();
drop trigger if exists swipes_after on public.swipes;
create trigger swipes_after after insert or update on public.swipes
  for each row execute function public._swipes_after();

-- Daily check-in: +10 XP once per day. The app calls this when it opens.
create or replace function public.daily_checkin() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); got int; s user_stats;
begin
  if uid is null then raise exception 'Please sign in first.'; end if;
  if not is_member() then raise exception 'Please finish setting up your account.'; end if;
  got := _award_xp(uid, 'daily', to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD'), 10);
  select * into s from user_stats where user_id = uid;
  return jsonb_build_object('xp_gained', got, 'xp', s.xp, 'rank', s.rank, 'streak', s.streak_count);
end $$;

-- ---------------------------------------------------------------------
-- Sign-up: make the profile rows and enforce the age gate (13+)
-- ---------------------------------------------------------------------
create or replace function public._age(b date) returns int
language sql stable as $$ select extract(year from age((now() at time zone 'utc')::date, b))::int $$;

create or replace function public._on_signup() returns trigger
language plpgsql security definer set search_path = public as $$
declare b date; u text;
begin
  begin b := nullif(new.raw_user_meta_data->>'birthdate','')::date; exception when others then b := null; end;
  if b is not null and _age(b) < 13 then
    raise exception 'You must be 13 or older to use Heartbeat.' using errcode = 'P0001';
  end if;
  u := lower(nullif(new.raw_user_meta_data->>'username',''));
  if u is not null and (u !~ '^[a-z0-9_.]{3,20}$' or exists (select 1 from profiles where username = u)) then
    u := null;  -- they can pick one in onboarding
  end if;
  insert into profiles (id, username, display_name)
    values (new.id, u, left(coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', u), 40));
  insert into private_profiles (id, birthdate) values (new.id, b);
  insert into user_stats (user_id, is_minor) values (new.id, b is null or _age(b) < 18);
  insert into security_events (user_id, kind, detail) values (new.id, 'signup', jsonb_build_object('provider', new.raw_app_meta_data->>'provider'));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public._on_signup();

-- Google sign-ups don't give a birthdate, so the app asks once. It can't be changed later.
create or replace function public.set_birthdate(b date) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Please sign in first.'; end if;
  if b is null or b > (now() at time zone 'utc')::date or b < date '1900-01-01' then raise exception 'Please enter a real date.'; end if;
  if (select birthdate from private_profiles where id = uid) is not null then raise exception 'Birthday is already set.'; end if;
  if _age(b) < 13 then
    insert into security_events (user_id, kind) values (uid, 'under_13');
    raise exception 'You must be 13 or older to use Heartbeat.' using errcode = 'P0001';
  end if;
  update private_profiles set birthdate = b where id = uid;
  update user_stats set is_minor = _age(b) < 18, updated_at = now() where user_id = uid;
end $$;

-- Move ratings saved on this device into the account (first sign-in). No XP for imports (fair play).
create or replace function public.import_local(items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); it jsonb; n int := 0;
begin
  if uid is null then raise exception 'Please sign in first.'; end if;
  if not is_member() then raise exception 'Please finish setting up your account.'; end if;
  if jsonb_array_length(items) > 300 then raise exception 'Too many items to import at once.'; end if;
  if exists (select 1 from xp_events where user_id = uid and kind = 'import' ) then return 0; end if;
  perform set_config('hb.importing', 'on', true);  -- tells the triggers: no XP, no rate limit
  for it in select * from jsonb_array_elements(items) loop
    begin
      if it->>'t' = 'rating' then
        insert into ratings (user_id, title_key, start_h, middle_h, end_h, overall)
          values (uid, it->>'k', (it->>'s')::int, (it->>'m')::int, (it->>'e')::int,
                  round((((it->>'s')::int + (it->>'m')::int + (it->>'e')::int * 2)::numeric / 4) * 2) / 2)
          on conflict do nothing;
      elsif it->>'t' = 'swipe' then
        insert into swipes (user_id, title_key, kind) values (uid, it->>'k', it->>'v') on conflict do nothing;
      elsif it->>'t' = 'save' then
        insert into watchlist (user_id, title_key) values (uid, it->>'k') on conflict do nothing;
      end if;
      n := n + 1;
    exception when others then null; -- skip bad items
    end;
  end loop;
  perform set_config('hb.importing', 'off', true);
  insert into xp_events (user_id, kind, ref, amount) values (uid, 'import', 'once', 0);
  return n;
end $$;

-- Only signed-in people can call the server functions. Internal ones (starting with _) are not callable.
revoke execute on function public._award_xp(uuid,text,text,int), public._touch_streak(uuid) from public, anon, authenticated;
revoke execute on function public.daily_checkin(), public.set_birthdate(date), public.import_local(jsonb) from public, anon;
grant  execute on function public.daily_checkin(), public.set_birthdate(date), public.import_local(jsonb) to authenticated;
