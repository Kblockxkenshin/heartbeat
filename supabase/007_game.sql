-- =====================================================================
-- Heartbeat · Part 5: Ranks & game system
-- Run AFTER 001–006. Safe to run again.
--
-- What it adds (all on the server, the app can't change any of it):
--  * Weekly leagues like Duolingo: 7 tiers, 30 people per group. Weeks start Monday (UTC).
--    Top 7 move up, bottom 5 move down. The Diamond group winner gets a free month of Plus.
--    Weeks close by themselves the first time anyone opens a league after Monday (no cron needed).
--  * Daily challenges (3 a day, +15 XP each) and weekly quests (3 a week, +60 XP each).
--    Finishing a weekly quest also earns a free user 1 Streak Shield a month.
--  * Streak Shield: fix a streak after missing ONE day. Plus: 2 a month. Free: the ones you earn.
--  * Take a break (1–14 days, once a month): your streak waits for you.
--  * Mystery box after every 7-day streak.
--  * Achievements (badges) checked from your real activity.
--  * Seasonal events: prediction games (Oscars). Picks lock at a set time.
--  * Recommendations your friend loves now give +15 XP (was +5).
-- Healthy design: no fake timers, no XP for buying Plus, mystery-box XP doesn't count for leagues.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
alter table public.user_stats add column if not exists freezes        smallint not null default 0;
alter table public.user_stats add column if not exists broken_count   int;
alter table public.user_stats add column if not exists broken_last    date;
alter table public.user_stats add column if not exists break_from     date;
alter table public.user_stats add column if not exists break_until    date;
alter table public.user_stats add column if not exists plus_gift_until timestamptz;

create table if not exists public.user_league (
  user_id uuid primary key references auth.users on delete cascade,
  tier    smallint not null default 0 check (tier between 0 and 6)
);
create table if not exists public.league_members (
  week      date not null,
  user_id   uuid not null references auth.users on delete cascade,
  tier      smallint not null,
  grp       int not null,
  joined_at timestamptz not null default now(),
  primary key (week, user_id)
);
create index if not exists league_members_grp on public.league_members (week, tier, grp);
create table if not exists public.league_weeks (week date primary key, done_at timestamptz not null default now());
create table if not exists public.league_results (
  week     date not null,
  user_id  uuid not null references auth.users on delete cascade,
  tier     smallint not null,
  new_tier smallint not null,
  place    int not null,
  size     int not null,
  xp       int not null,
  outcome  text not null check (outcome in ('up','down','stay','win')),
  reward   text,
  seen     boolean not null default false,
  primary key (week, user_id)
);

create table if not exists public.streak_repairs (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  source  text not null check (source in ('plus','shield','break')),
  at      timestamptz not null default now()
);
create table if not exists public.shield_grants (
  user_id uuid not null references auth.users on delete cascade,
  month   date not null,
  primary key (user_id, month)
);
create table if not exists public.mystery_boxes (
  user_id uuid not null references auth.users on delete cascade,
  ref     text not null,
  reward  jsonb not null,
  at      timestamptz not null default now(),
  primary key (user_id, ref)
);

create table if not exists public.events (
  slug     text primary key check (slug ~ '^[a-z0-9-]{3,40}$'),
  title    text not null,
  emoji    text not null default '🏆',
  info     text,
  status   text not null default 'soon' check (status in ('soon','open','locked','done')),
  locks_at timestamptz,
  xp_each  int not null default 10,
  sort     int not null default 0
);
create table if not exists public.event_categories (
  id       bigint generated always as identity primary key,
  event    text not null references public.events on delete cascade,
  name     text not null,
  sort     int not null default 0,
  nominees jsonb not null default '[]'::jsonb,   -- [{"k":"movie:123","label":"Title"}, ...]
  winner   text,
  unique (event, name)
);
create table if not exists public.event_picks (
  user_id  uuid not null references auth.users on delete cascade,
  category bigint not null references public.event_categories on delete cascade,
  pick     text not null,
  at       timestamptz not null default now(),
  primary key (user_id, category)
);

-- ---------------------------------------------------------------------
-- Leagues
-- ---------------------------------------------------------------------
create or replace function public._week(t timestamptz default now()) returns date
language sql stable as $$ select date_trunc('week', t at time zone 'utc')::date $$;

create or replace function public._tier_name(t int) returns text
language sql immutable as $$
  select (array['Bronze','Silver','Gold','Sapphire','Ruby','Emerald','Diamond'])[t + 1]
$$;

-- XP earned in a week (mystery-box luck doesn't count).
create or replace function public._week_xp(u uuid, w date) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::int from xp_events
  where user_id = u and kind <> 'mystery'
    and created_at >= (w::timestamp at time zone 'utc') and created_at < ((w + 7)::timestamp at time zone 'utc')
$$;

create or replace function public._join_league(u uuid) returns void
language plpgsql security definer set search_path = public as $$
declare w date := _week(); t int; g int;
begin
  if exists (select 1 from league_members where week = w and user_id = u) then return; end if;
  insert into user_league (user_id) values (u) on conflict do nothing;
  select tier into t from user_league where user_id = u;
  perform pg_advisory_xact_lock(hashtext('league:' || w || ':' || t));
  if exists (select 1 from league_members where week = w and user_id = u) then return; end if;
  select grp into g from league_members where week = w and tier = t group by grp having count(*) < 30 order by grp limit 1;
  if g is null then select coalesce(max(grp), 0) + 1 into g from league_members where week = w and tier = t; end if;
  insert into league_members (week, user_id, tier, grp) values (w, u, t, g) on conflict do nothing;
end $$;

-- Close finished weeks: move people up/down and give rewards. Safe to call often.
create or replace function public._league_rollover() returns int
language plpgsql security definer set search_path = public as $$
declare w date; r record; n int := 0; cur date := _week(); nt int; oc text; rw text;
begin
  for w in select distinct week from league_members m where m.week < cur
           and not exists (select 1 from league_weeks x where x.week = m.week) order by week loop
    perform pg_advisory_xact_lock(hashtext('league-rollover'));
    if exists (select 1 from league_weeks where week = w) then continue; end if;
    for r in
      select m.user_id, m.tier, m.grp, x.xp,
             row_number() over (partition by m.tier, m.grp order by x.xp desc, m.joined_at) as place,
             count(*) over (partition by m.tier, m.grp) as size
      from league_members m cross join lateral (select _week_xp(m.user_id, w) as xp) x
      where m.week = w
    loop
      nt := r.tier; oc := 'stay'; rw := null;
      if r.place <= 7 and r.xp > 0 and r.tier < 6 then nt := r.tier + 1; oc := 'up';
      elsif r.place > 7 and r.place > r.size - 5 and r.size >= 10 and r.tier > 0 then nt := r.tier - 1; oc := 'down';
      end if;
      if r.tier = 6 and r.place = 1 and r.size >= 10 and r.xp > 0 then
        oc := 'win'; rw := 'plus_month';
        update user_stats set plus_gift_until = greatest(coalesce(plus_gift_until, now()), now()) + interval '30 days'
          where user_id = r.user_id;
        update user_stats set plus_until = greatest(coalesce(plus_until, now()), plus_gift_until) where user_id = r.user_id;
      end if;
      insert into user_league (user_id, tier) values (r.user_id, nt) on conflict (user_id) do update set tier = nt;
      insert into league_results (week, user_id, tier, new_tier, place, size, xp, outcome, reward)
        values (w, r.user_id, r.tier, nt, r.place, r.size, r.xp, oc, rw) on conflict do nothing;
    end loop;
    insert into league_weeks (week) values (w) on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

-- XP now also puts you in this week's league.
create or replace function public._award_xp(uid uuid, k text, r text, amt int) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into xp_events (user_id, kind, ref, amount) values (uid, k, r, amt)
  on conflict (user_id, kind, ref) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return 0; end if;
  update user_stats set xp = xp + amt, rank = rank_for(xp + amt), updated_at = now() where user_id = uid;
  if k <> 'mystery' then perform _join_league(uid); end if;
  return amt;
end $$;

-- Plus that ends (canceled/unpaid) keeps any free month won in leagues.
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
      update user_stats set plus_until = greatest(least(coalesce(plus_until, now()), now()), coalesce(plus_gift_until, now())), updated_at = now()
        where user_id = p_user;
    end if;
    insert into security_events (user_id, kind, detail)
      values (p_user, 'billing', jsonb_build_object('status', p_status, 'plan', p_plan, 'until', p_period_end));
  end if;
  return jsonb_build_object('plus', is_plus(p_user));
end $$;

-- A league row as others see it. Under-18s who aren't your friend show as a hidden player.
create or replace function public._league_person(u uuid, me uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when u <> me and _is_minor(u) and not are_friends(me, u)
    then jsonb_build_object('id', null, 'username', null, 'display_name', 'A Heartbeat fan', 'hidden', true)
    else _mini(u) end
$$;

create or replace function public.my_league() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(false); w date; m league_members; res jsonb; last league_results;
begin
  perform _league_rollover();
  perform _join_league(me);
  w := _week();
  select * into m from league_members where week = w and user_id = me;
  select * into last from league_results where user_id = me and not seen order by week desc limit 1;
  select jsonb_build_object(
    'week', w, 'ends_at', ((w + 7)::timestamp at time zone 'utc'),
    'tier', m.tier, 'tier_name', _tier_name(m.tier), 'top', m.tier = 6, 'bottom', m.tier = 0,
    'people', coalesce(jsonb_agg(p.j order by p.place), '[]'::jsonb),
    'size', count(*), 'up', case when m.tier < 6 then 7 else 0 end,
    'down', case when count(*) >= 10 and m.tier > 0 then 5 else 0 end,
    'result', case when last.week is null then null else jsonb_build_object('week', last.week, 'tier', last.tier,
       'tier_name', _tier_name(last.tier), 'new_tier', last.new_tier, 'new_tier_name', _tier_name(last.new_tier),
       'place', last.place, 'size', last.size, 'xp', last.xp, 'outcome', last.outcome, 'reward', last.reward) end)
  into res
  from (select x.user_id, _league_person(x.user_id, me) || jsonb_build_object('xp', x.xp, 'place', x.place, 'me', x.user_id = me) j, x.place
        from (select l.user_id, _week_xp(l.user_id, w) xp,
                     row_number() over (order by _week_xp(l.user_id, w) desc, l.joined_at) place
              from league_members l where l.week = w and l.tier = m.tier and l.grp = m.grp) x) p;
  return res;
end $$;

create or replace function public.league_seen(p_week date) returns void
language sql security definer set search_path = public as $$
  update league_results set seen = true where user_id = auth.uid() and week <= p_week
$$;

-- ---------------------------------------------------------------------
-- Daily challenges & weekly quests
-- ---------------------------------------------------------------------
create or replace function public._ch_pool() returns table (id text, label text, emoji text, kind text, goal int, social boolean, weekly boolean)
language sql immutable as $$
  values ('rate1', 'Rate a title', '💖', 'rate', 1, false, false),
         ('rate3', 'Rate 3 titles', '💖', 'rate', 3, false, false),
         ('swipe10', 'Swipe 10 titles in Quick Rate', '👆', 'swipe', 10, false, false),
         ('save2', 'Add 2 titles to your watchlist', '🔖', 'save', 2, false, false),
         ('review1', 'Write a review', '✍️', 'review', 1, false, false),
         ('rec1', 'Recommend a title to a friend', '🎁', 'rec', 1, true, false),
         ('like3', 'Like 3 friend updates', '❤️', 'like', 3, true, false),
         ('comment1', 'Comment on a friend update', '💬', 'comment', 1, true, false),
         ('w_rate15', 'Rate 15 titles this week', '💖', 'rate', 15, false, true),
         ('w_review2', 'Write 2 reviews this week', '✍️', 'review', 2, false, true),
         ('w_days5', 'Be active 5 days this week', '🔥', 'days', 5, false, true),
         ('w_swipe50', 'Swipe 50 titles this week', '👆', 'swipe', 50, false, true),
         ('w_rec3', 'Recommend 3 titles to friends', '🎁', 'rec', 3, true, true),
         ('w_social10', 'Like or comment 10 times', '❤️', 'social', 10, true, true)
$$;

-- Today's 3 (2 solo + 1 with friends), or this week's 3. Same for everyone.
create or replace function public._ch_today(p_weekly boolean, d date) returns setof text
language sql immutable as $$
  (select id from _ch_pool() where weekly = p_weekly and not social order by md5(d::text || id) limit 2)
  union all
  (select id from _ch_pool() where weekly = p_weekly and social order by md5(d::text || id) limit 1)
$$;

create or replace function public._ch_count(u uuid, k text, a timestamptz, b timestamptz) returns int
language sql stable security definer set search_path = public as $$
  select (case k
    when 'rate'    then (select count(*) from xp_events where user_id = u and kind = 'rate' and created_at >= a and created_at < b)
    when 'swipe'   then (select count(*) from xp_events where user_id = u and kind = 'swipe' and created_at >= a and created_at < b)
    when 'review'  then (select count(*) from xp_events where user_id = u and kind = 'review' and created_at >= a and created_at < b)
    when 'save'    then (select count(*) from watchlist where user_id = u and added_at >= a and added_at < b)
    when 'rec'     then (select count(*) from recommendations where sender = u and created_at >= a and created_at < b)
    when 'like'    then (select count(*) from activity_likes where user_id = u and created_at >= a and created_at < b)
    when 'comment' then (select count(*) from activity_comments where user_id = u and not hidden and created_at >= a and created_at < b)
    when 'social'  then (select count(*) from activity_likes where user_id = u and created_at >= a and created_at < b)
                      + (select count(*) from activity_comments where user_id = u and not hidden and created_at >= a and created_at < b)
    when 'days'    then (select count(distinct (created_at at time zone 'utc')::date) from xp_events
                         where user_id = u and kind in ('rate','swipe','review') and created_at >= a and created_at < b)
    else 0 end)::int
$$;

create or replace function public.my_challenges() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _need_member(false); d date := (now() at time zone 'utc')::date; w date := _week();
  da timestamptz := d::timestamp at time zone 'utc'; wa timestamptz := w::timestamp at time zone 'utc';
begin
  return jsonb_build_object(
    'day', d, 'week', w,
    'daily', (select jsonb_agg(jsonb_build_object('id', p.id, 'label', p.label, 'emoji', p.emoji, 'goal', p.goal, 'xp', 15,
                'have', least(p.goal, _ch_count(me, p.kind, da, da + interval '1 day')),
                'claimed', exists (select 1 from xp_events where user_id = me and kind = 'challenge' and ref = d || ':' || p.id))
              order by p.social, p.id)
              from _ch_pool() p where p.id in (select _ch_today(false, d))),
    'weekly', (select jsonb_agg(jsonb_build_object('id', p.id, 'label', p.label, 'emoji', p.emoji, 'goal', p.goal, 'xp', 60,
                'have', least(p.goal, _ch_count(me, p.kind, wa, wa + interval '7 days')),
                'claimed', exists (select 1 from xp_events where user_id = me and kind = 'quest' and ref = w || ':' || p.id))
              order by p.social, p.id)
              from _ch_pool() p where p.id in (select _ch_today(true, w))));
end $$;

create or replace function public.claim_challenge(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(false); p record; d date := (now() at time zone 'utc')::date; w date := _week();
  a timestamptz; got int; shield boolean := false; mon date := date_trunc('month', now() at time zone 'utc')::date;
begin
  select * into p from _ch_pool() x where x.id = p_id;
  if p.id is null then raise exception 'Unknown challenge.'; end if;
  if (p.weekly and p.id not in (select _ch_today(true, w))) or (not p.weekly and p.id not in (select _ch_today(false, d))) then
    raise exception 'That challenge isn''t active right now.'; end if;
  a := case when p.weekly then w::timestamp at time zone 'utc' else d::timestamp at time zone 'utc' end;
  if _ch_count(me, p.kind, a, a + case when p.weekly then interval '7 days' else interval '1 day' end) < p.goal then
    raise exception 'Not done yet. Keep going!'; end if;
  got := _award_xp(me, case when p.weekly then 'quest' else 'challenge' end, (case when p.weekly then w else d end) || ':' || p.id,
                   case when p.weekly then 60 else 15 end);
  if got = 0 then raise exception 'Already claimed.'; end if;
  -- Free users earn 1 Streak Shield a month by finishing a weekly quest (max 2 saved).
  if p.weekly and not is_plus(me) then
    insert into shield_grants (user_id, month) values (me, mon) on conflict do nothing;
    if found then update user_stats set freezes = least(freezes + 1, 2) where user_id = me; shield := true; end if;
  end if;
  return jsonb_build_object('xp_gained', got, 'shield', shield,
    'xp', (select xp from user_stats where user_id = me), 'rank', (select rank from user_stats where user_id = me));
end $$;

-- ---------------------------------------------------------------------
-- Streaks: Shield (repair), Take a break, Mystery box
-- ---------------------------------------------------------------------
create or replace function public._on_break(s public.user_stats, today date) returns boolean
language sql immutable as $$
  select s.streak_last is not null and s.break_from is not null
     and s.break_from <= s.streak_last + 1 and s.break_until >= today - 1
$$;

create or replace function public._touch_streak(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s user_stats; today date := (now() at time zone 'utc')::date; cont boolean;
begin
  select * into s from user_stats where user_id = uid for update;
  if s.streak_last = today then return; end if;
  cont := s.streak_last = today - 1 or _on_break(s, today);
  if cont then
    update user_stats set streak_count = s.streak_count + 1, streak_best = greatest(streak_best, s.streak_count + 1),
      streak_last = today, updated_at = now() where user_id = uid;
  else
    update user_stats set
      broken_count = case when s.streak_count > 0 then s.streak_count else broken_count end,
      broken_last  = case when s.streak_count > 0 then s.streak_last else broken_last end,
      streak_count = 1, streak_best = greatest(streak_best, 1), streak_last = today, updated_at = now()
    where user_id = uid;
  end if;
end $$;

create or replace function public._streak_alive(u uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when s.streak_last >= (now() at time zone 'utc')::date - 1 or _on_break(s, (now() at time zone 'utc')::date)
    then s.streak_count else 0 end from user_stats s where s.user_id = u
$$;

create or replace function public._repairs_left(me uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when is_plus(me) then greatest(0, 2 - (select count(*) from streak_repairs where user_id = me and source = 'plus'
                 and at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'))::int else 0 end
$$;

create or replace function public.streak_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _need_member(false); s user_stats; today date := (now() at time zone 'utc')::date;
  fix text; mon timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc'; ms int;
begin
  select * into s from user_stats where user_id = me;
  fix := case when s.streak_last = today - 2 and s.streak_count > 0 and not _on_break(s, today) then 'missed'
              when s.streak_last = today and s.streak_count = 1 and s.broken_last = today - 2 and s.broken_count > 0 then 'reset'
              else null end;
  ms := floor(coalesce(_streak_alive(me), 0) / 7);
  return jsonb_build_object(
    'streak', _streak_alive(me), 'best', s.streak_best, 'last', s.streak_last,
    'can_fix', fix is not null, 'fix_to', case fix when 'missed' then s.streak_count when 'reset' then s.broken_count + 1 end,
    'shields', s.freezes, 'plus_repairs', _repairs_left(me), 'plus', is_plus(me),
    'break_from', case when s.break_until >= today then s.break_from end, 'break_until', case when s.break_until >= today then s.break_until end,
    'break_used', exists (select 1 from streak_repairs where user_id = me and source = 'break' and at >= mon),
    'box', ms >= 1 and not exists (select 1 from mystery_boxes where user_id = me
             and ref = ((s.streak_last - s.streak_count + 1) || ':' || ms)),
    'box_at', (ms + 1) * 7);
end $$;

create or replace function public.repair_streak() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(false); s user_stats; today date := (now() at time zone 'utc')::date; src text;
begin
  select * into s from user_stats where user_id = me for update;
  if _repairs_left(me) > 0 then src := 'plus';
  elsif s.freezes > 0 then src := 'shield';
  else raise exception 'You have no Streak Shields right now. Finish a weekly quest to earn one!'; end if;
  if s.streak_last = today - 2 and s.streak_count > 0 and not _on_break(s, today) then
    update user_stats set streak_last = today - 1 where user_id = me;            -- yesterday is covered
  elsif s.streak_last = today and s.streak_count = 1 and s.broken_last = today - 2 and s.broken_count > 0 then
    update user_stats set streak_count = s.broken_count + 1, streak_best = greatest(streak_best, s.broken_count + 1),
      broken_count = null, broken_last = null where user_id = me;
  else
    raise exception 'Your streak is fine! A Shield only fixes a streak after missing one day.';
  end if;
  if src = 'shield' then update user_stats set freezes = freezes - 1 where user_id = me; end if;
  insert into streak_repairs (user_id, source) values (me, src);
  return streak_status();
end $$;

create or replace function public.take_break(p_days int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(false); today date := (now() at time zone 'utc')::date;
begin
  if p_days is null or p_days < 1 or p_days > 14 then raise exception 'Pick 1 to 14 days.'; end if;
  if exists (select 1 from streak_repairs where user_id = me and source = 'break'
             and at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc') then
    raise exception 'You can take one break a month.'; end if;
  update user_stats set break_from = today, break_until = today + p_days - 1 where user_id = me;
  insert into streak_repairs (user_id, source) values (me, 'break');
  return streak_status();
end $$;

create or replace function public.end_break() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(false); today date := (now() at time zone 'utc')::date;
begin
  update user_stats set break_until = greatest(break_from, today - 1) where user_id = me and break_until >= today;
  update user_stats set break_from = null, break_until = null where user_id = me and break_from >= today;
  return streak_status();
end $$;

create or replace function public.open_mystery_box() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(false); s user_stats; ms int; bref text; roll float := random(); rw jsonb; amt int;
begin
  select * into s from user_stats where user_id = me for update;
  ms := floor(coalesce(_streak_alive(me), 0) / 7);
  if ms < 1 then raise exception 'Keep your streak for 7 days to open a mystery box.'; end if;
  bref := (s.streak_last - s.streak_count + 1) || ':' || ms;
  if exists (select 1 from mystery_boxes b where b.user_id = me and b.ref = bref) then
    raise exception 'You already opened this box. Next one at a %-day streak!', (ms + 1) * 7; end if;
  if roll < 0.25 and s.freezes < 2 then
    update user_stats set freezes = freezes + 1 where user_id = me;
    rw := jsonb_build_object('kind', 'shield', 'label', 'A Streak Shield!', 'emoji', '🛡️');
  else
    amt := case when roll > 0.95 then 100 else 15 + floor(random() * 36)::int end;
    perform _award_xp(me, 'mystery', bref, amt);
    rw := jsonb_build_object('kind', 'xp', 'amount', amt, 'label', '+' || amt || ' XP', 'emoji', case when amt >= 100 then '🌟' else '✨' end);
  end if;
  insert into mystery_boxes (user_id, ref, reward) values (me, bref, rw);
  return rw;
end $$;

-- ---------------------------------------------------------------------
-- Achievements
-- ---------------------------------------------------------------------
create or replace function public.my_achievements(p_tz text default 'UTC') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _need_member(false); tz text := 'UTC';
  nr int; nrev int; helpful int; nfr int; nloved int; best int; quests int; ch int; up boolean; won boolean; owl boolean; gem int;
  movies int; series int; picks int;
begin
  if exists (select 1 from pg_timezone_names where name = p_tz) then tz := p_tz; end if;
  select count(*) into nr from ratings where user_id = me;
  select count(*) into nrev from reviews where user_id = me and not hidden;
  select count(*) into helpful from review_votes v join reviews r on r.id = v.review_id
    where r.user_id = me and v.kind = 'helpful' and v.counted;
  select count(*) into nfr from friendships where me in (user_a, user_b);
  select count(*) into nloved from recommendations r where r.sender = me and r.loved;
  select streak_best into best from user_stats where user_id = me;
  select count(*) into quests from xp_events where user_id = me and kind = 'quest';
  select count(*) into ch from xp_events where user_id = me and kind = 'challenge';
  up := exists (select 1 from league_results where user_id = me and outcome in ('up','win'));
  won := exists (select 1 from league_results where user_id = me and place = 1 and size >= 10);
  owl := exists (select 1 from ratings where user_id = me and extract(hour from created_at at time zone tz) < 4);
  select count(*) into gem from ratings r where r.user_id = me and r.overall >= 4
    and (select count(*) from ratings x where x.title_key = r.title_key) <= 3;
  select count(*) filter (where title_key like 'movie:%'), count(*) filter (where title_key like 'tv:%') into movies, series
    from ratings where user_id = me;
  select count(*) into picks from event_picks where user_id = me;
  return (select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'emoji', a.emoji, 'desc', a.d,
            'have', least(a.have, a.goal), 'goal', a.goal, 'got', a.have >= a.goal) order by (a.have >= a.goal) desc, a.sort)
    from (values
      (1, 'first_rating', 'First Heartbeat', '💖', 'Rate your first title', nr, 1),
      (2, 'ratings_10', 'Getting Into It', '🎟️', 'Rate 10 titles', nr, 10),
      (3, 'ratings_50', 'Binge Mode', '📺', 'Rate 50 titles', nr, 50),
      (4, 'ratings_100', 'Century Club', '💯', 'Rate 100 titles', nr, 100),
      (5, 'first_review', 'First Review', '✍️', 'Write your first review', nrev, 1),
      (6, 'reviews_5', 'Critic in the Making', '📝', 'Write 5 reviews', nrev, 5),
      (7, 'helpful_10', 'Helpful Human', '🙌', 'Get 10 helpful votes', helpful, 10),
      (8, 'hidden_gem', 'Hidden Gem Hunter', '💎', 'Love 3 titles that almost nobody here has rated', gem, 3),
      (9, 'night_owl', 'Night Owl', '🦉', 'Rate something between midnight and 4 am', owl::int, 1),
      (10, 'two_worlds', 'Two Worlds', '🌗', 'Rate 5 movies and 5 series', least(movies, 5) + least(series, 5), 10),
      (11, 'friends_5', 'Social Butterfly', '🦋', 'Have 5 friends', nfr, 5),
      (12, 'good_taste_3', 'Good Taste', '🎁', '3 friends loved your recommendation', nloved, 3),
      (13, 'streak_7', 'On Fire', '🔥', 'Reach a 7-day streak', coalesce(best, 0), 7),
      (14, 'streak_30', 'Unstoppable', '☄️', 'Reach a 30-day streak', coalesce(best, 0), 30),
      (15, 'challenges_10', 'Challenger', '🎯', 'Finish 10 daily challenges', ch, 10),
      (16, 'quest_1', 'Quest Taker', '🗺️', 'Finish a weekly quest', quests, 1),
      (17, 'promoted', 'Moving Up', '⬆️', 'Move up a league', up::int, 1),
      (18, 'league_winner', 'Champion', '🏆', 'Finish #1 in your league', won::int, 1),
      (19, 'predictor', 'Fortune Teller', '🔮', 'Make a prediction in an event', least(picks, 1), 1)
    ) as a(sort, id, name, emoji, d, have, goal));
end $$;

-- ---------------------------------------------------------------------
-- Events (prediction games)
-- ---------------------------------------------------------------------
create or replace function public._event_status(e public.events) returns text
language sql stable as $$
  select case when e.status = 'open' and e.locks_at is not null and now() >= e.locks_at then 'locked' else e.status end
$$;

create or replace function public.list_events() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('slug', e.slug, 'title', e.title, 'emoji', e.emoji, 'info', e.info,
    'status', _event_status(e), 'locks_at', e.locks_at,
    'categories', (select count(*) from event_categories c where c.event = e.slug),
    'my_picks', (select count(*) from event_picks p join event_categories c on c.id = p.category where c.event = e.slug and p.user_id = auth.uid()))
    order by e.sort, e.slug), '[]'::jsonb)
  from events e
$$;

create or replace function public.event_detail(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('slug', e.slug, 'title', e.title, 'emoji', e.emoji, 'info', e.info, 'status', _event_status(e),
    'locks_at', e.locks_at, 'xp_each', e.xp_each,
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'nominees', c.nominees,
        'winner', case when e.status = 'done' then c.winner end,
        'mine', (select pick from event_picks p where p.category = c.id and p.user_id = auth.uid()),
        'counts', case when _event_status(e) in ('locked','done') then
            (select coalesce(jsonb_object_agg(pick, n), '{}'::jsonb) from (select pick, count(*) n from event_picks p where p.category = c.id group by pick) z) end)
      order by c.sort, c.id), '[]'::jsonb) from event_categories c where c.event = e.slug))
  from events e where e.slug = p_slug
$$;

create or replace function public.make_pick(p_category bigint, p_pick text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(false); c event_categories; e events;
begin
  select * into c from event_categories where id = p_category;
  if c.id is null then raise exception 'Unknown category.'; end if;
  select * into e from events where slug = c.event;
  if _event_status(e) <> 'open' then raise exception 'Picks are closed for this event.'; end if;
  if not exists (select 1 from jsonb_array_elements(c.nominees) n where n->>'k' = p_pick) then raise exception 'Pick one of the nominees.'; end if;
  perform _limit(me, 'event_pick', 200, interval '1 hour', 'Too many changes. Try again later.');
  insert into event_picks (user_id, category, pick) values (me, p_category, p_pick)
    on conflict (user_id, category) do update set pick = excluded.pick, at = now();
  return jsonb_build_object('category', p_category, 'pick', p_pick);
end $$;

-- Leaderboard after winners are announced. scope: 'friends' (you + friends) or 'all' (top 50).
create or replace function public.event_board(p_slug text, p_scope text default 'friends') returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (
    select p.user_id, count(*) filter (where p.pick = c.winner) as correct, count(*) as picks
    from event_picks p join event_categories c on c.id = p.category join events e on e.slug = c.event
    where c.event = p_slug and e.status = 'done'
      and (p_scope = 'all' or p.user_id = auth.uid() or are_friends(auth.uid(), p.user_id))
      and not is_blocked(auth.uid(), p.user_id)
    group by p.user_id)
  select coalesce(jsonb_agg(_league_person(s.user_id, auth.uid()) || jsonb_build_object('correct', s.correct, 'picks', s.picks, 'me', s.user_id = auth.uid())
    order by s.correct desc, s.picks desc), '[]'::jsonb)
  from (select * from s order by correct desc, picks desc limit 50) s
$$;

-- Admin only (run in the Supabase SQL editor): announce winners and give +XP for each correct pick.
create or replace function public.finish_event(p_slug text) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; e events;
begin
  select * into e from events where slug = p_slug;
  if e.slug is null then raise exception 'Unknown event.'; end if;
  update events set status = 'done' where slug = p_slug;
  for r in select p.user_id, c.id from event_picks p join event_categories c on c.id = p.category
           where c.event = p_slug and c.winner is not null and p.pick = c.winner loop
    n := n + _award_xp(r.user_id, 'event', p_slug || ':' || r.id, e.xp_each);
  end loop;
  return n;
end $$;

-- Seasonal event: Oscars. Nominees come out in January; add them then (see README) and set status = 'open'.
insert into public.events (slug, title, emoji, info, status, xp_each, sort) values
  ('oscars-2027', 'Oscars 2027 Predictions', '🏆',
   'Guess the winners before the show. +10 XP for every right pick, and a leaderboard with your friends. Nominees are announced in January, so check back then!',
   'soon', 10, 1)
on conflict (slug) do nothing;
insert into public.event_categories (event, name, sort) values
  ('oscars-2027', 'Best Picture', 1), ('oscars-2027', 'Best Director', 2), ('oscars-2027', 'Best Actor', 3),
  ('oscars-2027', 'Best Actress', 4), ('oscars-2027', 'Best Supporting Actor', 5), ('oscars-2027', 'Best Supporting Actress', 6),
  ('oscars-2027', 'Best Animated Feature', 7), ('oscars-2027', 'Best Original Screenplay', 8)
on conflict (event, name) do nothing;

-- ---------------------------------------------------------------------
-- Recommendations your friend loves: +15 XP (spec), was +5
-- ---------------------------------------------------------------------
create or replace function public._recs_on_rate() returns trigger
language plpgsql security definer set search_path = public as $$
declare r recommendations; is_loved boolean;
begin
  if current_setting('hb.importing', true) = 'on' then return null; end if;
  is_loved := new.overall >= 4;
  for r in select * from recommendations
           where receiver = new.user_id and title_key = new.title_key and rated_at is null
           for update
  loop
    update recommendations set rated_overall = new.overall, rated_at = now(), loved = is_loved,
      points = case when is_loved then 10 else 0 end,
      status = case when status in ('new','saved') then 'watched' else status end,
      responded_at = coalesce(responded_at, now())
    where id = r.id;
    if is_loved then perform _award_xp(r.sender, 'good_taste', r.id::text, 15); end if;
    if not is_blocked(r.sender, r.receiver) then
      insert into notifications (user_id, kind, actor, title_key, data)
      values (r.sender, 'rec_rated', r.receiver, r.title_key,
              jsonb_build_object('rec', r.id, 'overall', new.overall, 'loved', is_loved, 'points', case when is_loved then 10 else 0 end));
    end if;
  end loop;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- Rules: nobody writes these tables from the app. Reads go through the functions above.
-- ---------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['user_league','league_members','league_weeks','league_results','streak_repairs','shield_grants',
                           'mystery_boxes','events','event_categories','event_picks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
drop policy if exists "events read" on public.events;
create policy "events read" on public.events for select using (true);
drop policy if exists "event cats read" on public.event_categories;
create policy "event cats read" on public.event_categories for select using (true);
drop policy if exists "my picks" on public.event_picks;
create policy "my picks" on public.event_picks for select using (auth.uid() = user_id);
grant select on public.events, public.event_categories to anon, authenticated;
grant select on public.event_picks to authenticated;

revoke execute on function public._join_league(uuid), public._league_rollover(), public._week_xp(uuid,date),
  public._league_person(uuid,uuid), public._ch_count(uuid,text,timestamptz,timestamptz), public._repairs_left(uuid),
  public.finish_event(text) from public, anon, authenticated;
revoke execute on function public.my_league(), public.league_seen(date), public.my_challenges(), public.claim_challenge(text),
  public.streak_status(), public.repair_streak(), public.take_break(int), public.end_break(), public.open_mystery_box(),
  public.my_achievements(text), public.make_pick(bigint,text) from public, anon;
grant execute on function public.my_league(), public.league_seen(date), public.my_challenges(), public.claim_challenge(text),
  public.streak_status(), public.repair_streak(), public.take_break(int), public.end_break(), public.open_mystery_box(),
  public.my_achievements(text), public.make_pick(bigint,text) to authenticated;
grant execute on function public.list_events(), public.event_detail(text), public.event_board(text,text) to anon, authenticated;
