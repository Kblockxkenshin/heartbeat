-- =====================================================================
-- Heartbeat · Part 4: Heartbeat Plus
-- Run AFTER 001–005. Safe to run again.
--
-- What it adds:
--  * Plus status, kept ONLY on the server. The app can never set it.
--    Only the payment webhook (running on Vercel with the secret server key) can change it,
--    through billing_apply(), which normal users and guests can't call.
--  * Plus styles on profiles: theme, banner, avatar frame (server checks you have Plus).
--  * Taste Match Pro (part-by-part compare with a friend) and Movie Night picker for a group.
--
-- Fair play: Plus gives NO XP, rank or leaderboard advantage. Nothing here touches XP.
-- =====================================================================

create table if not exists public.billing (
  user_id              uuid primary key references auth.users on delete cascade,
  customer_id          text unique,
  subscription_id      text,
  status               text,
  plan                 text check (plan in ('monthly','yearly','student')),
  period_end           timestamptz,
  cancel_at_period_end boolean not null default false,
  trial_used           boolean not null default false,
  updated_at           timestamptz not null default now()
);

alter table public.profiles add column if not exists theme  text;
alter table public.profiles add column if not exists banner text;
alter table public.profiles add column if not exists frame  text;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.is_plus(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select plus_until > now() from user_stats where user_id = u), false)
$$;

-- Public card for a person, now with the Plus badge and Plus styles (styles only while Plus is on).
create or replace function public._mini(u uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
    'rank', s.rank, 'top_critic', s.rank in ('Top Critic','Director''s Cut','Legend'),
    'plus', coalesce(s.plus_until > now(), false),
    'theme',  case when s.plus_until > now() then p.theme end,
    'banner', case when s.plus_until > now() then p.banner end,
    'frame',  case when s.plus_until > now() then p.frame end)
  from profiles p left join user_stats s on s.user_id = p.id where p.id = u
$$;

-- Plus styles: only known values, and only with Plus.
create or replace function public._plus_style_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.theme is not null and new.theme not in ('sunset','ocean','aurora','midnight','candy','forest') then
    raise exception 'Unknown theme.'; end if;
  if new.banner is not null and new.banner not in ('stars','waves','hearts','film','neon','confetti') then
    raise exception 'Unknown banner.'; end if;
  if new.frame is not null and new.frame not in ('glow','rainbow','gold','hearts','neon') then
    raise exception 'Unknown frame.'; end if;
  if (new.theme is distinct from old.theme and new.theme is not null)
     or (new.banner is distinct from old.banner and new.banner is not null)
     or (new.frame is distinct from old.frame and new.frame is not null) then
    if not is_plus(new.id) then raise exception 'That style is part of Heartbeat Plus.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_plus_style on public.profiles;
create trigger profiles_plus_style before update on public.profiles
  for each row execute function public._plus_style_guard();

-- ---------------------------------------------------------------------
-- Payments (server only). Called by the Stripe webhook / restore on Vercel with the service key.
-- ---------------------------------------------------------------------
create or replace function public.billing_apply(p_user uuid, p_customer text, p_sub text, p_status text, p_plan text,
  p_period_end timestamptz, p_cancel boolean, p_trial boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare active boolean := p_status in ('active','trialing','past_due');
begin
  if p_user is null or not exists (select 1 from auth.users where id = p_user) then raise exception 'Unknown user.'; end if;
  if p_plan is not null and p_plan not in ('monthly','yearly','student') then p_plan := null; end if;
  insert into billing (user_id, customer_id, subscription_id, status, plan, period_end, cancel_at_period_end, trial_used, updated_at)
  values (p_user, p_customer, p_sub, p_status, p_plan, p_period_end, coalesce(p_cancel, false), coalesce(p_trial, false), now())
  on conflict (user_id) do update set
    customer_id = coalesce(excluded.customer_id, billing.customer_id),
    subscription_id = coalesce(excluded.subscription_id, billing.subscription_id),
    status = coalesce(excluded.status, billing.status),
    plan = coalesce(excluded.plan, billing.plan),
    period_end = coalesce(excluded.period_end, billing.period_end),
    cancel_at_period_end = excluded.cancel_at_period_end,
    trial_used = billing.trial_used or excluded.trial_used,
    updated_at = now();
  if p_status is not null then
    if active and p_period_end is not null then
      update user_stats set plus_until = greatest(coalesce(plus_until, now()), p_period_end), updated_at = now() where user_id = p_user;
    elsif not active then
      -- Ended (canceled, unpaid, expired): Plus stops now.
      update user_stats set plus_until = least(coalesce(plus_until, now()), now()), updated_at = now() where user_id = p_user;
    end if;
    insert into security_events (user_id, kind, detail)
      values (p_user, 'billing', jsonb_build_object('status', p_status, 'plan', p_plan, 'until', p_period_end));
  end if;
  return jsonb_build_object('plus', is_plus(p_user));
end $$;

-- My Plus status (for the Plus page).
create or replace function public.my_plus() returns jsonb
language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'plus', is_plus(auth.uid()),
    'plus_until', (select plus_until from user_stats where user_id = auth.uid()),
    'plan', b.plan, 'status', b.status, 'period_end', b.period_end,
    'cancel_at_period_end', coalesce(b.cancel_at_period_end, false),
    'trial_used', coalesce(b.trial_used, false),
    'has_billing', b.customer_id is not null,
    'style', (select jsonb_build_object('theme', theme, 'banner', banner, 'frame', frame) from profiles where id = auth.uid()),
    'student_ok', exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null
                          and lower(u.email) ~ '\.edu$'))
  from (select auth.uid() as id) me left join billing b on b.user_id = me.id
  where auth.uid() is not null
$$;

-- Set my Plus styles (null = default). The guard above checks Plus.
create or replace function public.set_plus_style(p_theme text, p_banner text, p_frame text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(false);
begin
  update profiles set theme = nullif(p_theme, ''), banner = nullif(p_banner, ''), frame = nullif(p_frame, '') where id = me;
  return _mini(me);
end $$;

-- ---------------------------------------------------------------------
-- Taste Match Pro (Plus): every shared title, part by part.
-- ---------------------------------------------------------------------
create or replace function public.match_pro(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _need_member(false);
begin
  if not is_plus(me) then raise exception 'Taste Match Pro is part of Heartbeat Plus.'; end if;
  if me = p_user or not can_see_user(p_user) then raise exception 'You can''t compare with this person.'; end if;
  return _match(me, p_user) || jsonb_build_object(
    'user', _mini(p_user),
    'parts', (select jsonb_build_object('n', count(*),
                'me', jsonb_build_array(round(avg(a.start_h),2), round(avg(a.middle_h),2), round(avg(a.end_h),2)),
                'them', jsonb_build_array(round(avg(b.start_h),2), round(avg(b.middle_h),2), round(avg(b.end_h),2)))
              from ratings a join ratings b on b.title_key = a.title_key and b.user_id = p_user where a.user_id = me),
    'titles', (select coalesce(jsonb_agg(jsonb_build_object('k', a.title_key,
                  'me', jsonb_build_array(a.start_h, a.middle_h, a.end_h, a.overall),
                  'them', jsonb_build_array(b.start_h, b.middle_h, b.end_h, b.overall),
                  'gap', abs(a.overall - b.overall)) order by abs(a.overall - b.overall) desc, a.title_key), '[]'::jsonb)
               from ratings a join ratings b on b.title_key = a.title_key and b.user_id = p_user where a.user_id = me));
end $$;

-- ---------------------------------------------------------------------
-- Movie Night picker (Plus): best title for a group of friends (2–8 people with you).
-- Picks titles someone saved or loved, that most of the group hasn't seen, and nobody disliked.
-- ---------------------------------------------------------------------
create or replace function public.movie_night(p_users text[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _need_member(false); ids uuid[]; u uuid; n int;
begin
  if not is_plus(me) then raise exception 'Movie Night is part of Heartbeat Plus.'; end if;
  select array_agg(distinct x::uuid) into ids from unnest(coalesce(p_users, '{}')) x where x::uuid <> me;
  if ids is null or cardinality(ids) < 1 then raise exception 'Pick at least one friend.'; end if;
  if cardinality(ids) > 7 then raise exception 'Pick up to 7 friends.'; end if;
  foreach u in array ids loop
    if not are_friends(me, u) or is_blocked(me, u) then raise exception 'You can only pick friends.'; end if;
  end loop;
  ids := ids || me; n := cardinality(ids);
  return jsonb_build_object(
    'people', (select jsonb_agg(_mini(x)) from unnest(ids) x),
    'pairs', (select coalesce(jsonb_agg(jsonb_build_object('a', a, 'b', b) || _match(a, b)), '[]'::jsonb)
              from unnest(ids) a cross join unnest(ids) b where a < b),
    'picks', (select coalesce(jsonb_agg(z.c order by z.score desc, z.k), '[]'::jsonb) from (
      select t.k, sc.score, jsonb_build_object('k', t.k, 'saved', sc.saved, 'loved', sc.loved, 'unseen', n - sc.seen, 'score', sc.score,
        'fans', (select coalesce(jsonb_agg(_mini(x)), '[]'::jsonb) from unnest(ids) x
                 where exists (select 1 from watchlist w where w.user_id = x and w.title_key = t.k)
                    or exists (select 1 from ratings r where r.user_id = x and r.title_key = t.k and r.overall >= 4))) c
      from (select title_key k from watchlist where user_id = any(ids)
            union select title_key from ratings where user_id = any(ids) and overall >= 4) t
      cross join lateral (select
          (select count(*) from watchlist w where w.title_key = t.k and w.user_id = any(ids)) saved,
          (select count(*) from ratings r where r.title_key = t.k and r.user_id = any(ids) and r.overall >= 4) loved,
          (select count(*) from ratings r where r.title_key = t.k and r.user_id = any(ids)) seen,
          (select count(*) from ratings r where r.title_key = t.k and r.user_id = any(ids) and r.overall < 3) bad) c0
      cross join lateral (select 2 * c0.saved + 1.5 * c0.loved + (n - c0.seen) as score, c0.saved, c0.loved, c0.seen) sc
      where c0.bad = 0 and c0.seen * 2 <= n
      order by sc.score desc, t.k limit 10) z));
end $$;

-- ---------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------
alter table public.billing enable row level security;
drop policy if exists "billing mine" on public.billing;
create policy "billing mine" on public.billing for select using (auth.uid() = user_id);
revoke all on public.billing from anon, authenticated;
grant select on public.billing to authenticated;

-- Styles change only through set_plus_style (keeps the column grants tight).
revoke update (theme, banner, frame) on public.profiles from anon, authenticated;
grant select (theme, banner, frame) on public.profiles to authenticated;

revoke execute on function public.billing_apply(uuid,text,text,text,text,timestamptz,boolean,boolean) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.billing_apply(uuid,text,text,text,text,timestamptz,boolean,boolean) to service_role;
    grant select, insert, update on public.billing to service_role;
  end if;
end $$;
revoke execute on function public._plus_style_guard() from public, anon, authenticated;
revoke execute on function public.my_plus(), public.set_plus_style(text,text,text), public.match_pro(uuid), public.movie_night(text[])
  from public, anon;
grant execute on function public.my_plus(), public.set_plus_style(text,text,text), public.match_pro(uuid), public.movie_night(text[])
  to authenticated;
grant execute on function public.is_plus(uuid) to anon, authenticated;
