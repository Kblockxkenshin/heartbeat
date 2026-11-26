-- =====================================================================
-- Heartbeat · Part 8: Heartbeat for Studios
-- Run AFTER 001–009. Safe to run again.
--
-- Studios (producers, directors, marketing teams) get a separate dashboard:
--  * Audience insights for titles they track: journey (where people lose interest), sentiment over
--    time, top themes, age ranges and regions.
--  * Hype tracker: watchlist adds, trailer reactions, "Most anticipated" ranking.
--  * Comparison with their other titles and the Heartbeat average.
--  * Early Screener Panels: invite top-ranked, verified critics who opted in.
-- Privacy rules (enforced here, on the server):
--  * Studios only ever get COUNTS and AVERAGES. Never names, profiles, messages or single ratings.
--  * Only "trusted" data: email confirmed, 18+, account older than 3 days, not paused or flagged,
--    ratings not held. Under-18s are never included.
--  * Age and region groups smaller than 10 people are hidden.
--  * Anyone can opt out (Me → Security → Studios & your data). Then they are left out of everything.
--  * Panel answers are shared without names, and only after 3 people answered.
-- Studio access is sold by the sales team: people request it on #/studios and an admin approves.
-- Studio members must use 2-step sign-in (like admins).
-- =====================================================================

create table if not exists public.user_privacy (
  user_id        uuid primary key references auth.users on delete cascade,
  studio_opt_out boolean not null default false,   -- leave me out of studio numbers
  panels_opt_in  boolean not null default false,   -- I want screener panel invites
  region         text check (char_length(region) <= 20),  -- country code or world area, for grouped stats
  updated_at     timestamptz not null default now()
);
create table if not exists public.trailer_reactions (
  user_id    uuid not null references auth.users on delete cascade,
  title_key  text not null check (title_key ~ '^(movie|tv):[0-9]{1,9}$'),
  kind       text not null check (kind in ('fire','love','meh','nope')),
  created_at timestamptz not null default now(),
  primary key (user_id, title_key)
);
create index if not exists trailer_reactions_title on public.trailer_reactions (title_key, created_at);
create index if not exists watchlist_title_time on public.watchlist (title_key, added_at);

create table if not exists public.studios (
  id          bigint generated always as identity primary key,
  name        text not null check (char_length(name) between 2 and 80),
  website     text check (char_length(website) <= 200),
  plan        text not null default 'pilot' check (plan in ('pilot','pro','enterprise')),
  title_limit int not null default 10 check (title_limit between 1 and 500),
  status      text not null default 'active' check (status in ('active','suspended')),
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now()
);
create table if not exists public.studio_members (
  studio_id bigint not null references public.studios on delete cascade,
  user_id   uuid not null references auth.users on delete cascade,
  role      text not null default 'member' check (role in ('owner','member')),
  added_at  timestamptz not null default now(),
  primary key (studio_id, user_id)
);
create table if not exists public.studio_requests (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  company    text not null check (char_length(company) between 2 and 80),
  job        text check (char_length(job) <= 80),
  work_email text not null check (char_length(work_email) <= 120),
  website    text check (char_length(website) <= 200),
  message    text check (char_length(message) <= 1000),
  status     text not null default 'open' check (status in ('open','approved','declined')),
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users on delete set null
);
create table if not exists public.studio_titles (
  studio_id bigint not null references public.studios on delete cascade,
  title_key text not null check (title_key ~ '^(movie|tv):[0-9]{1,9}$'),
  added_at  timestamptz not null default now(),
  primary key (studio_id, title_key)
);
create table if not exists public.title_summaries (
  title_key  text primary key check (title_key ~ '^(movie|tv):[0-9]{1,9}$'),
  data       jsonb not null,
  n_reviews  int not null default 0,
  model      text,
  created_at timestamptz not null default now()
);
create table if not exists public.screener_panels (
  id         bigint generated always as identity primary key,
  studio_id  bigint not null references public.studios on delete cascade,
  title_key  text not null check (title_key ~ '^(movie|tv):[0-9]{1,9}$'),
  name       text not null check (char_length(name) between 3 and 80),
  kind       text not null default 'trailer' check (kind in ('trailer','early_cut')),
  video_url  text not null check (char_length(video_url) <= 300),
  intro      text check (char_length(intro) <= 500),
  questions  jsonb not null,
  seats      int not null check (seats between 1 and 50),
  min_rank   text not null default 'Critic',
  closes_at  timestamptz not null,
  status     text not null default 'open' check (status in ('open','closed')),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.panel_invites (
  panel_id    bigint not null references public.screener_panels on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  status      text not null default 'invited' check (status in ('invited','accepted','declined','done')),
  answers     jsonb,
  invited_at  timestamptz not null default now(),
  answered_at timestamptz,
  primary key (panel_id, user_id)
);
create index if not exists panel_invites_user on public.panel_invites (user_id, status);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public._rank_n(r text) returns int
language sql immutable as $$
  select case r when 'Legend' then 6 when 'Director''s Cut' then 5 when 'Top Critic' then 4 when 'Critic' then 3
    when 'Front Row' then 2 when 'Ticket Holder' then 1 else 0 end
$$;

-- People whose data studios may count (see the rules at the top).
create or replace function public._trusted_ids() returns setof uuid
language sql stable security definer set search_path = public, auth as $$
  select a.id from auth.users a join private_profiles pp on pp.id = a.id
  where a.email_confirmed_at is not null and a.created_at < now() - interval '3 days'
    and pp.birthdate is not null and pp.birthdate <= (current_date - interval '18 years')::date
    and not exists (select 1 from user_status s where s.user_id = a.id
                    and (s.status = 'banned' or (s.status = 'suspended' and (s.until is null or s.until > now()))))
    and not exists (select 1 from account_flags f where f.user_id = a.id and f.status = 'open')
    and not exists (select 1 from user_privacy p where p.user_id = a.id and p.studio_opt_out)
$$;

-- Studio member with 2-step sign-in, studio active. Returns the role.
create or replace function public._studio_need(p_studio bigint, p_owner boolean default false) returns text
language plpgsql stable security definer set search_path = public as $$
declare r text; st text;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select m.role, s.status into r, st from studio_members m join studios s on s.id = m.studio_id
    where m.studio_id = p_studio and m.user_id = auth.uid();
  if r is null then raise exception 'This studio dashboard is for its team only.'; end if;
  if st <> 'active' then raise exception 'This studio account is paused. Please contact Heartbeat.'; end if;
  if _aal() <> 'aal2' then raise exception 'Studio dashboards need 2-step sign-in. Turn it on in Me → Security.'; end if;
  if p_owner and r <> 'owner' then raise exception 'Only the studio owner can do this.'; end if;
  return r;
end $$;
create or replace function public._studio_title(p_studio bigint, p_title text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from studio_titles where studio_id = p_studio and title_key = p_title) then
    raise exception 'Add this title to your studio first.'; end if;
end $$;

-- Groups smaller than k are hidden (k = 10).
create or replace function public._k() returns int language sql immutable as $$ select 10 $$;

-- ---------------------------------------------------------------------
-- Everyone: privacy switches, region, trailer reactions
-- ---------------------------------------------------------------------
-- Rough region for grouped stats: a 2-letter country code from the network, else the world area of the time zone.
create or replace function public.set_region(p_tz text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); h json; cc text; reg text;
begin
  if me is null then return; end if;
  h := nullif(current_setting('request.headers', true), '')::json;
  cc := upper(coalesce(h->>'cf-ipcountry', h->>'x-vercel-ip-country', ''));
  reg := case when cc ~ '^[A-Z]{2}$' and cc not in ('XX','T1') then cc
    else case split_part(coalesce(p_tz, ''), '/', 1)
      when 'America' then 'Americas' when 'Europe' then 'Europe' when 'Asia' then 'Asia' when 'Africa' then 'Africa'
      when 'Australia' then 'Oceania' when 'Pacific' then 'Oceania' else null end end;
  if reg is not null then
    insert into user_privacy (user_id, region) values (me, reg)
      on conflict (user_id) do update set region = excluded.region, updated_at = now();
  end if;
end $$;

create or replace function public.my_privacy() returns jsonb
language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'studio_opt_out', coalesce(p.studio_opt_out, false), 'panels_opt_in', coalesce(p.panels_opt_in, false),
    'adult', coalesce((select birthdate <= (current_date - interval '18 years')::date from private_profiles where id = auth.uid()), false),
    'verified', is_verified(),
    'rank', (select rank from user_stats where user_id = auth.uid()),
    'panel_ready', coalesce((select _rank_n(rank) >= 3 from user_stats where user_id = auth.uid()), false))
  from (select auth.uid() id) me left join user_privacy p on p.user_id = me.id
  where auth.uid() is not null
$$;

create or replace function public.set_studio_privacy(p_opt_out boolean, p_panels boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  if coalesce(p_panels, false) then
    if not exists (select 1 from private_profiles where id = me and birthdate <= (current_date - interval '18 years')::date) then
      raise exception 'Screener panels are for people 18 and older.'; end if;
    if not is_verified() then raise exception 'Please confirm your email first.'; end if;
  end if;
  insert into user_privacy (user_id, studio_opt_out, panels_opt_in) values (me, coalesce(p_opt_out, false), coalesce(p_panels, false))
    on conflict (user_id) do update set studio_opt_out = excluded.studio_opt_out, panels_opt_in = excluded.panels_opt_in, updated_at = now();
  -- Leaving panels: open invites go away.
  if not coalesce(p_panels, false) then
    update panel_invites set status = 'declined', answered_at = now() where user_id = me and status in ('invited','accepted');
  end if;
  return my_privacy();
end $$;

-- 🔥 love 🤔 meh 👎 nope on a trailer (null = take it back)
create or replace function public.react_trailer(p_title text, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; n int;
begin
  me := _need_member(false);
  if p_title !~ '^(movie|tv):[0-9]{1,9}$' then raise exception 'Unknown title.'; end if;
  select count(*) into n from trailer_reactions where user_id = me and created_at > now() - interval '1 hour';
  if n >= 60 then raise exception 'Lots of reactions! Take a little break.'; end if;
  if p_kind is null then delete from trailer_reactions where user_id = me and title_key = p_title;
  elsif p_kind not in ('fire','love','meh','nope') then raise exception 'Unknown reaction.';
  else insert into trailer_reactions (user_id, title_key, kind) values (me, p_title, p_kind)
         on conflict (user_id, title_key) do update set kind = excluded.kind, created_at = now();
  end if;
  return trailer_counts(p_title);
end $$;
create or replace function public.trailer_counts(p_title text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'fire', count(*) filter (where kind = 'fire'), 'love', count(*) filter (where kind = 'love'),
    'meh', count(*) filter (where kind = 'meh'), 'nope', count(*) filter (where kind = 'nope'),
    'mine', (select kind from trailer_reactions where user_id = auth.uid() and title_key = p_title))
  from trailer_reactions where title_key = p_title
$$;

-- ---------------------------------------------------------------------
-- Talk to sales, and studio membership
-- ---------------------------------------------------------------------
create or replace function public.studio_request(p_company text, p_job text, p_email text, p_website text, p_message text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int;
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  select count(*) into n from studio_requests where user_id = me and created_at > now() - interval '1 day';
  if n >= 3 then raise exception 'Thanks! We already have your request. Our team will email you.'; end if;
  if char_length(btrim(coalesce(p_company, ''))) < 2 then raise exception 'Please add your company name.'; end if;
  if coalesce(p_email, '') !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then raise exception 'Please add a work email.'; end if;
  insert into studio_requests (user_id, company, job, work_email, website, message)
  values (me, left(_clean(p_company), 80), left(_clean(p_job), 80), left(btrim(p_email), 120), left(_clean(p_website), 200), left(_clean(p_message), 1000));
end $$;

create or replace function public.my_studios() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'studios', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'role', m.role, 'status', s.status, 'plan', s.plan) order by s.name)
                from studio_members m join studios s on s.id = m.studio_id where m.user_id = auth.uid()), '[]'::jsonb),
    'request', (select jsonb_build_object('company', company, 'status', status, 'at', created_at) from studio_requests
                where user_id = auth.uid() order by created_at desc limit 1))
  where auth.uid() is not null
$$;

create or replace function public.studio_home(p_studio bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare role text;
begin
  role := _studio_need(p_studio);
  return (select jsonb_build_object(
    'id', s.id, 'name', s.name, 'plan', s.plan, 'title_limit', s.title_limit, 'role', role,
    'team', (select jsonb_agg(_mini(m.user_id) || jsonb_build_object('role', m.role) order by m.role desc, m.added_at) from studio_members m where m.studio_id = s.id),
    'titles', coalesce((select jsonb_agg(jsonb_build_object('title_key', t.title_key,
        'n', (select count(*) from ratings r where r.title_key = t.title_key and not r.held and r.user_id in (select _trusted_ids())),
        'overall', (select round(avg(r.overall), 1) from ratings r where r.title_key = t.title_key and not r.held and r.user_id in (select _trusted_ids())),
        'watch_30d', (select count(*) from watchlist w where w.title_key = t.title_key and w.added_at > now() - interval '30 days' and w.user_id in (select _trusted_ids())))
        order by t.added_at) from studio_titles t where t.studio_id = s.id), '[]'::jsonb),
    'panels', (select count(*) from screener_panels p where p.studio_id = s.id and p.status = 'open'))
    from studios s where s.id = p_studio);
end $$;

create or replace function public.studio_track(p_studio bigint, p_title text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare lim int; n int;
begin
  perform _studio_need(p_studio);
  if p_title !~ '^(movie|tv):[0-9]{1,9}$' then raise exception 'Unknown title.'; end if;
  if p_on then
    select title_limit into lim from studios where id = p_studio;
    select count(*) into n from studio_titles where studio_id = p_studio;
    if n >= lim then raise exception 'Your plan has room for % titles. Remove one, or talk to us about a bigger plan.', lim; end if;
    insert into studio_titles (studio_id, title_key) values (p_studio, p_title) on conflict do nothing;
  else
    delete from studio_titles where studio_id = p_studio and title_key = p_title;
  end if;
end $$;

create or replace function public.studio_member(p_studio bigint, p_username text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid; n int;
begin
  perform _studio_need(p_studio, true);
  select id into u from profiles where lower(username) = lower(btrim(p_username));
  if u is null then raise exception 'Nobody with that username.'; end if;
  if u = auth.uid() then raise exception 'You can''t change yourself.'; end if;
  if p_on then
    select count(*) into n from studio_members where studio_id = p_studio;
    if n >= 10 then raise exception 'A studio team can have up to 10 people.'; end if;
    if _is_minor(u) then raise exception 'Studio team members must be 18 or older.'; end if;
    insert into studio_members (studio_id, user_id) values (p_studio, u) on conflict do nothing;
  else
    delete from studio_members where studio_id = p_studio and user_id = u and role <> 'owner';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Insights (counts and averages only)
-- ---------------------------------------------------------------------
create or replace function public.studio_insights(p_studio bigint, p_title text) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  n int; s numeric; m numeric; e numeric; o numeric; all_n int; held int; fresh int; flagged int;
  rev_pub int; rev_checked int; q int; res jsonb; k int := _k(); tr uuid[];
begin
  perform _studio_need(p_studio);
  perform _studio_title(p_studio, p_title);
  tr := array(select _trusted_ids());

  -- Data quality: of the ratings we could use (adults who didn't opt out), how many passed every check?
  select count(*), count(*) filter (where r.held),
         count(*) filter (where not r.held and (a.email_confirmed_at is null or a.created_at >= now() - interval '3 days')),
         count(*) filter (where not r.held and r.user_id <> all (tr) and a.email_confirmed_at is not null and a.created_at < now() - interval '3 days')
    into all_n, held, fresh, flagged
    from ratings r join auth.users a on a.id = r.user_id join private_profiles pp on pp.id = r.user_id
    where r.title_key = p_title and pp.birthdate <= (current_date - interval '18 years')::date
      and not exists (select 1 from user_privacy p where p.user_id = r.user_id and p.studio_opt_out);
  select count(*), round(avg(start_h), 2), round(avg(middle_h), 2), round(avg(end_h), 2), round(avg(overall), 2)
    into n, s, m, e, o from ratings r where r.title_key = p_title and not r.held and r.user_id = any (tr);
  select count(*) filter (where privacy = 'public' and not hidden and _review_public(ai_status)),
         count(*) filter (where privacy = 'public' and not hidden and _review_public(ai_status) and ai_model is not null)
    into rev_pub, rev_checked from reviews where title_key = p_title and user_id = any (tr);
  q := case when all_n = 0 then null
            else round(100 * (0.8 * n::numeric / all_n + 0.2 * case when rev_pub > 0 then rev_checked::numeric / rev_pub else 1 end)) end;

  res := jsonb_build_object(
    'title_key', p_title, 'k', k,
    'quality', jsonb_build_object('score', q, 'used', n, 'all', all_n, 'held', held, 'new_or_unconfirmed', fresh, 'flagged_or_paused', flagged,
                                  'reviews', rev_pub, 'reviews_ai_checked', rev_checked),
    'journey', case when n < 5 then jsonb_build_object('n', n, 'enough', false) else jsonb_build_object('n', n, 'enough', true,
      'start', s, 'middle', m, 'end', e, 'overall', o,
      'lost_middle_pct', (select round(100.0 * count(*) filter (where middle_h < start_h) / count(*)) from ratings r where r.title_key = p_title and not r.held and r.user_id = any (tr)),
      'lost_end_pct', (select round(100.0 * count(*) filter (where end_h < middle_h) / count(*)) from ratings r where r.title_key = p_title and not r.held and r.user_id = any (tr)),
      'weakest', case when greatest(s - m, m - e) < 0.2 then null when s - m >= m - e then 'middle' else 'ending' end,
      'stars', (select jsonb_agg(c order by b) from (select b, (select count(*) from ratings r where r.title_key = p_title and not r.held
                  and r.user_id = any (tr) and greatest(1, ceil(r.overall)) = b) c from generate_series(1, 5) b) z)) end,
    'weeks', (select coalesce(jsonb_agg(jsonb_build_object('week', w, 'n', cnt, 'avg', av) order by w), '[]'::jsonb) from (
        select date_trunc('week', r.created_at)::date w, count(*) cnt, round(avg(r.overall), 2) av
        from ratings r where r.title_key = p_title and not r.held and r.user_id = any (tr) and r.created_at > now() - interval '26 weeks'
        group by 1) z),
    'tags', (select coalesce(jsonb_agg(jsonb_build_object('tag', tg, 'n', cnt) order by cnt desc, tg), '[]'::jsonb) from (
        select tg, count(*) cnt from reviews v, unnest(v.tags) tg
        where v.title_key = p_title and v.privacy = 'public' and not v.hidden and _review_public(v.ai_status) and v.user_id = any (tr)
        group by tg order by cnt desc limit 10) z),
    -- Age ranges (18+ only). Groups under k people are hidden.
    'ages', (select coalesce(jsonb_agg(jsonb_build_object('range', g, 'n', case when cnt >= k then cnt end, 'avg', case when cnt >= k then av end, 'hidden', cnt < k) order by g), '[]'::jsonb) from (
        select case when a < 25 then '18–24' when a < 35 then '25–34' when a < 45 then '35–44' when a < 55 then '45–54' else '55+' end g,
               count(*) cnt, round(avg(ov), 2) av
        from (select extract(year from age(current_date, pp.birthdate))::int a, r.overall ov from ratings r join private_profiles pp on pp.id = r.user_id
              where r.title_key = p_title and not r.held and r.user_id = any (tr)) x group by 1) z),
    -- Regions. Small ones are merged into "Other"; if that is still small, it's hidden.
    'regions', (with g as (select coalesce(p.region, 'Unknown') rg, count(*) cnt, avg(r.overall) av from ratings r left join user_privacy p on p.user_id = r.user_id
                   where r.title_key = p_title and not r.held and r.user_id = any (tr) group by 1),
                 big as (select rg, cnt, av from g where cnt >= k and rg <> 'Unknown'),
                 rest as (select 'Other' rg, sum(cnt)::int cnt, sum(av * cnt) / nullif(sum(cnt), 0) av from g where cnt < k or rg = 'Unknown')
                select coalesce(jsonb_agg(jsonb_build_object('region', rg, 'n', case when cnt >= k then cnt end, 'avg', case when cnt >= k then round(av, 2) end, 'hidden', cnt < k) order by cnt desc), '[]'::jsonb)
                from (select * from big union all select * from rest where cnt > 0) z),
    'hype', jsonb_build_object(
      'watchlist', (select count(*) from watchlist w where w.title_key = p_title and w.user_id = any (tr)),
      'watch_weeks', (select coalesce(jsonb_agg(jsonb_build_object('week', w, 'n', cnt) order by w), '[]'::jsonb) from (
          select date_trunc('week', added_at)::date w, count(*) cnt from watchlist where title_key = p_title and added_at > now() - interval '12 weeks'
            and user_id = any (tr) group by 1) z),
      'trailer', (select jsonb_build_object('fire', count(*) filter (where kind = 'fire'), 'love', count(*) filter (where kind = 'love'),
          'meh', count(*) filter (where kind = 'meh'), 'nope', count(*) filter (where kind = 'nope'))
          from trailer_reactions where title_key = p_title and user_id = any (tr)),
      'recs_30d', (select count(*) from recommendations where title_key = p_title and created_at > now() - interval '30 days' and sender = any (tr)),
      'swipes', (select jsonb_build_object('loved', count(*) filter (where kind = 'loved'), 'disliked', count(*) filter (where kind = 'disliked'))
          from swipes where title_key = p_title and user_id = any (tr))),
    'compare', (select coalesce(jsonb_agg(jsonb_build_object('title_key', t.title_key, 'n', x.cnt, 'start', x.s, 'middle', x.m, 'end', x.e, 'overall', x.o) order by t.added_at), '[]'::jsonb)
        from studio_titles t cross join lateral (select count(*) cnt, round(avg(start_h), 2) s, round(avg(middle_h), 2) m, round(avg(end_h), 2) e, round(avg(overall), 2) o
            from ratings r where r.title_key = t.title_key and not r.held and r.user_id = any (tr)) x
        where t.studio_id = p_studio and x.cnt >= 5),
    'average', (select jsonb_build_object('n', count(*), 'start', round(avg(start_h), 2), 'middle', round(avg(middle_h), 2), 'end', round(avg(end_h), 2), 'overall', round(avg(overall), 2))
        from ratings r where not r.held and r.user_id = any (tr)),
    'summary', (select jsonb_build_object('data', data, 'n_reviews', n_reviews, 'at', created_at) from title_summaries where title_key = p_title));
  return res;
end $$;

-- "Most anticipated": watchlist adds and trailer buzz in the last 30 days (trusted people only).
create or replace function public.studio_hype(p_studio bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _studio_need(p_studio);
  return (with tr as (select _trusted_ids() id),
    w as (select title_key, count(*) adds from watchlist where added_at > now() - interval '30 days' and user_id in (select id from tr) group by 1),
    t as (select title_key, count(*) filter (where kind = 'fire') fire, count(*) filter (where kind = 'love') love,
                 count(*) filter (where kind = 'nope') nope from trailer_reactions where created_at > now() - interval '30 days' and user_id in (select id from tr) group by 1),
    sc as (select coalesce(w.title_key, t.title_key) title_key, coalesce(w.adds, 0) adds, coalesce(t.fire, 0) fire, coalesce(t.love, 0) love, coalesce(t.nope, 0) nope,
                  coalesce(w.adds, 0) + 2 * coalesce(t.fire, 0) + coalesce(t.love, 0) - coalesce(t.nope, 0) score
           from w full join t on t.title_key = w.title_key),
    rk as (select *, rank() over (order by score desc, adds desc, title_key) pos from sc where score > 0)
    select jsonb_build_object(
      'top', coalesce((select jsonb_agg(jsonb_build_object('title_key', title_key, 'pos', pos, 'score', score, 'adds', adds, 'fire', fire, 'love', love)
                       order by pos) from (select * from rk order by pos limit 20) a), '[]'::jsonb),
      'mine', coalesce((select jsonb_agg(jsonb_build_object('title_key', st.title_key, 'pos', rk.pos, 'score', coalesce(rk.score, 0), 'adds', coalesce(rk.adds, 0),
                       'fire', coalesce(rk.fire, 0), 'love', coalesce(rk.love, 0)) order by rk.pos nulls last)
                       from studio_titles st left join rk on rk.title_key = st.title_key where st.studio_id = p_studio), '[]'::jsonb)));
end $$;

-- Review texts for the AI theme summary (no names). Called by /api/studio-summary with the member's sign-in.
create or replace function public.studio_review_sample(p_studio bigint, p_title text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _studio_need(p_studio);
  perform _studio_title(p_studio, p_title);
  return (select coalesce(jsonb_agg(jsonb_build_object('overall', overall, 'start', start_h, 'middle', middle_h, 'end', end_h,
      'text', left(concat_ws(' — ', headline, regexp_replace(body, '\|\|', '', 'g')), 1200))), '[]'::jsonb)
    from (select * from reviews v where v.title_key = p_title and v.privacy = 'public' and not v.hidden and _review_public(v.ai_status)
            and v.user_id in (select _trusted_ids()) order by v.helpful_count desc, v.ai_quality_score desc limit 120) z);
end $$;
-- Saved by the server only.
create or replace function public.studio_save_summary(p_title text, p_data jsonb, p_n int, p_model text) returns void
language sql security definer set search_path = public as $$
  insert into title_summaries (title_key, data, n_reviews, model, created_at) values (p_title, p_data, p_n, left(p_model, 60), now())
  on conflict (title_key) do update set data = excluded.data, n_reviews = excluded.n_reviews, model = excluded.model, created_at = now();
$$;

-- ---------------------------------------------------------------------
-- Early Screener Panels
-- ---------------------------------------------------------------------
-- p = { title_key, name, kind, video_url, intro, questions: [{q, type: stars|text}], seats, min_rank, days }
create or replace function public.studio_create_panel(p_studio bigint, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint; qs jsonb := '[]'::jsonb; x jsonb; seats int := coalesce((p->>'seats')::int, 20); mr text := coalesce(p->>'min_rank', 'Critic');
  url text := btrim(coalesce(p->>'video_url', '')); n int; k text := p->>'title_key';
begin
  perform _studio_need(p_studio);
  perform _studio_title(p_studio, k);
  select count(*) into n from screener_panels where studio_id = p_studio and created_at > now() - interval '1 day';
  if n >= 5 then raise exception 'You can start up to 5 panels a day.'; end if;
  if url !~* '^https://(www\.)?(youtube\.com/watch\?v=|youtu\.be/|vimeo\.com/)[A-Za-z0-9_?=&/-]+$' then
    raise exception 'Use a YouTube or Vimeo link (it can be unlisted or private-link).'; end if;
  if mr not in ('Critic','Top Critic','Director''s Cut','Legend') then raise exception 'Pick Critic or higher.'; end if;
  if seats not between 1 and 50 then raise exception 'Pick 1 to 50 critics.'; end if;
  for x in select * from jsonb_array_elements(coalesce(p->'questions', '[]'::jsonb)) limit 6 loop
    if char_length(btrim(coalesce(x->>'q', ''))) between 3 and 200 then
      qs := qs || jsonb_build_object('q', _clean(x->>'q'), 'type', case when x->>'type' = 'stars' then 'stars' else 'text' end);
    end if;
  end loop;
  if jsonb_array_length(qs) = 0 then raise exception 'Add at least one question.'; end if;
  insert into screener_panels (studio_id, title_key, name, kind, video_url, intro, questions, seats, min_rank, closes_at, created_by)
  values (p_studio, k, left(_clean(p->>'name'), 80), case when p->>'kind' = 'early_cut' then 'early_cut' else 'trailer' end, url,
          left(_clean(p->>'intro'), 500), qs, seats, mr, now() + make_interval(days => least(greatest(coalesce((p->>'days')::int, 7), 1), 30)), auth.uid())
  returning id into pid;
  -- Invite the best critics who said yes to panels (trusted, active in the last 30 days, not on the studio team).
  insert into panel_invites (panel_id, user_id)
    select pid, s.user_id from user_stats s join user_privacy pv on pv.user_id = s.user_id and pv.panels_opt_in
    where s.user_id in (select _trusted_ids()) and _rank_n(s.rank) >= _rank_n(mr) and s.updated_at > now() - interval '30 days'
      and s.user_id not in (select user_id from studio_members where studio_id = p_studio)
    order by s.xp desc limit seats;
  get diagnostics n = row_count;
  return jsonb_build_object('id', pid, 'invited', n);
end $$;

create or replace function public.studio_panels(p_studio bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _studio_need(p_studio);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'title_key', p.title_key, 'name', p.name, 'kind', p.kind, 'seats', p.seats,
      'min_rank', p.min_rank, 'closes_at', p.closes_at, 'status', case when p.status = 'open' and p.closes_at < now() then 'closed' else p.status end,
      'invited', (select count(*) from panel_invites i where i.panel_id = p.id),
      'accepted', (select count(*) from panel_invites i where i.panel_id = p.id and i.status in ('accepted','done')),
      'done', (select count(*) from panel_invites i where i.panel_id = p.id and i.status = 'done')) order by p.created_at desc), '[]'::jsonb)
    from screener_panels p where p.studio_id = p_studio);
end $$;

-- Results: averages for star questions; answers without names, only after 3 people finished.
create or replace function public.studio_panel_results(p_studio bigint, p_panel bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pn screener_panels; d int;
begin
  perform _studio_need(p_studio);
  select * into pn from screener_panels where id = p_panel and studio_id = p_studio;
  if pn.id is null then raise exception 'Panel not found.'; end if;
  select count(*) into d from panel_invites where panel_id = p_panel and status = 'done';
  return jsonb_build_object('id', pn.id, 'name', pn.name, 'title_key', pn.title_key, 'questions', pn.questions, 'done', d, 'min', 3,
    'averages', (select jsonb_agg((select round(avg((i.answers->>(qi - 1)::int)::numeric), 2) from panel_invites i
                   where i.panel_id = p_panel and i.status = 'done' and jsonb_typeof(i.answers->(qi - 1)::int) = 'number') order by qi)
                 from generate_series(1, jsonb_array_length(pn.questions)) qi),
    'answers', case when d < 3 then '[]'::jsonb else (select jsonb_agg(jsonb_build_object('label', 'Critic ' || rn, 'rank', rk, 'answers', ans) order by rn)
                 from (select row_number() over (order by md5(i.user_id::text || pn.id::text)) rn, s.rank rk, i.answers ans
                       from panel_invites i join user_stats s on s.user_id = i.user_id where i.panel_id = p_panel and i.status = 'done') z) end);
end $$;

create or replace function public.studio_close_panel(p_studio bigint, p_panel bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _studio_need(p_studio);
  update screener_panels set status = 'closed' where id = p_panel and studio_id = p_studio;
  update panel_invites set status = 'declined', answered_at = now() where panel_id = p_panel and status in ('invited','accepted');
end $$;

-- For critics: my invites. The video link only shows after you say yes.
create or replace function public.my_screeners() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('panel', p.id, 'studio', s.name, 'title_key', p.title_key, 'name', p.name, 'kind', p.kind,
      'intro', p.intro, 'questions', p.questions, 'closes_at', p.closes_at, 'status', i.status,
      'open', p.status = 'open' and p.closes_at > now(),
      'video_url', case when i.status in ('accepted','done') then p.video_url end, 'answers', i.answers) order by i.invited_at desc), '[]'::jsonb)
  from panel_invites i join screener_panels p on p.id = i.panel_id join studios s on s.id = p.studio_id
  where i.user_id = auth.uid() and i.status <> 'declined'
$$;

create or replace function public.respond_screener(p_panel bigint, p_yes boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update panel_invites i set status = case when p_yes then 'accepted' else 'declined' end, answered_at = case when p_yes then null else now() end
  from screener_panels p where p.id = i.panel_id and i.panel_id = p_panel and i.user_id = auth.uid() and i.status = 'invited'
    and p.status = 'open' and p.closes_at > now();
  if not found then raise exception 'This invite is closed.'; end if;
end $$;

create or replace function public.submit_screener(p_panel bigint, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pn screener_panels; a jsonb := '[]'::jsonb; i int; x jsonb; qt text; v text; bad text; xp int;
begin
  select p.* into pn from screener_panels p join panel_invites iv on iv.panel_id = p.id
    where p.id = p_panel and iv.user_id = me and iv.status = 'accepted' and p.status = 'open' and p.closes_at > now();
  if pn.id is null then raise exception 'This panel is closed.'; end if;
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> jsonb_array_length(pn.questions) then raise exception 'Please answer every question.'; end if;
  for i in 0 .. jsonb_array_length(pn.questions) - 1 loop
    qt := pn.questions->i->>'type'; x := p_answers->i;
    if qt = 'stars' then
      if jsonb_typeof(x) <> 'number' or (x::text)::numeric not in (1,2,3,4,5) then raise exception 'Pick 1 to 5 stars for every star question.'; end if;
      a := a || x;
    else
      v := left(_clean(x #>> '{}'), 1000);
      if v is null or char_length(v) < 3 then raise exception 'Please write a short answer for every question.'; end if;
      bad := _bad_text(v); if bad is not null then raise exception '%', bad; end if;
      a := a || to_jsonb(v);
    end if;
  end loop;
  update panel_invites set status = 'done', answers = a, answered_at = now() where panel_id = p_panel and user_id = me;
  xp := _award_xp(me, 'screener', p_panel::text, 50);
  return jsonb_build_object('xp', xp);
end $$;

-- ---------------------------------------------------------------------
-- Admin (sales team): requests and studios
-- ---------------------------------------------------------------------
create or replace function public.admin_studios() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _need_admin();
  return jsonb_build_object(
    'requests', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'company', r.company, 'job', r.job, 'email', r.work_email, 'website', r.website,
        'message', r.message, 'at', r.created_at, 'who', _mini(r.user_id)) order by r.created_at), '[]'::jsonb) from studio_requests r where r.status = 'open'),
    'studios', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'plan', s.plan, 'status', s.status, 'title_limit', s.title_limit,
        'team', (select count(*) from studio_members m where m.studio_id = s.id), 'titles', (select count(*) from studio_titles t where t.studio_id = s.id),
        'owner', (select _mini(m.user_id) from studio_members m where m.studio_id = s.id and m.role = 'owner' limit 1)) order by s.created_at desc), '[]'::jsonb) from studios s));
end $$;
create or replace function public.admin_studio_request(p_id bigint, p_approve boolean, p_name text default null, p_plan text default 'pilot', p_limit int default 10) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_admin(); r studio_requests; sid bigint;
begin
  select * into r from studio_requests where id = p_id and status = 'open';
  if r.id is null then raise exception 'Request not found.'; end if;
  if not p_approve then
    update studio_requests set status = 'declined', decided_by = me where id = p_id;
    perform _log_admin('studio_decline', r.user_id, p_id::text, r.company);
    return jsonb_build_object('status', 'declined');
  end if;
  if _is_minor(r.user_id) then raise exception 'Studio accounts are for adults only.'; end if;
  insert into studios (name, website, plan, title_limit, created_by)
  values (coalesce(nullif(left(_clean(p_name), 80), ''), r.company), r.website, coalesce(p_plan, 'pilot'), coalesce(p_limit, 10), me) returning id into sid;
  insert into studio_members (studio_id, user_id, role) values (sid, r.user_id, 'owner');
  update studio_requests set status = 'approved', decided_by = me where id = p_id;
  perform _log_admin('studio_approve', r.user_id, sid::text, r.company);
  return jsonb_build_object('status', 'approved', 'studio', sid);
end $$;
create or replace function public.admin_studio_set(p_studio bigint, p_status text, p_plan text, p_limit int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _need_admin();
  update studios set status = coalesce(p_status, status), plan = coalesce(p_plan, plan), title_limit = coalesce(p_limit, title_limit) where id = p_studio;
  if not found then raise exception 'Studio not found.'; end if;
  perform _log_admin('studio_set', null, p_studio::text, concat_ws(' ', p_status, p_plan, p_limit));
end $$;

-- ---------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['user_privacy','trailer_reactions','studios','studio_members','studio_requests','studio_titles','title_summaries','screener_panels','panel_invites'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

revoke execute on function public._trusted_ids(), public._studio_need(bigint, boolean), public._studio_title(bigint, text) from public, anon, authenticated;
revoke execute on function public.studio_save_summary(text, jsonb, int, text) from public, anon, authenticated;
grant execute on function public.studio_save_summary(text, jsonb, int, text) to service_role;
grant select on public.title_summaries to service_role;   -- the summary server checks the saved copy first
revoke execute on function public.set_region(text), public.my_privacy(), public.set_studio_privacy(boolean, boolean), public.react_trailer(text, text),
  public.studio_request(text, text, text, text, text), public.my_studios(), public.studio_home(bigint), public.studio_track(bigint, text, boolean),
  public.studio_member(bigint, text, boolean), public.studio_insights(bigint, text), public.studio_hype(bigint), public.studio_review_sample(bigint, text),
  public.studio_create_panel(bigint, jsonb), public.studio_panels(bigint), public.studio_panel_results(bigint, bigint), public.studio_close_panel(bigint, bigint),
  public.my_screeners(), public.respond_screener(bigint, boolean), public.submit_screener(bigint, jsonb),
  public.admin_studios(), public.admin_studio_request(bigint, boolean, text, text, int), public.admin_studio_set(bigint, text, text, int) from public, anon;
grant execute on function public.set_region(text), public.my_privacy(), public.set_studio_privacy(boolean, boolean), public.react_trailer(text, text),
  public.studio_request(text, text, text, text, text), public.my_studios(), public.studio_home(bigint), public.studio_track(bigint, text, boolean),
  public.studio_member(bigint, text, boolean), public.studio_insights(bigint, text), public.studio_hype(bigint), public.studio_review_sample(bigint, text),
  public.studio_create_panel(bigint, jsonb), public.studio_panels(bigint), public.studio_panel_results(bigint, bigint), public.studio_close_panel(bigint, bigint),
  public.my_screeners(), public.respond_screener(bigint, boolean), public.submit_screener(bigint, jsonb),
  public.admin_studios(), public.admin_studio_request(bigint, boolean, text, text, int), public.admin_studio_set(bigint, text, text, int) to authenticated;
grant execute on function public.trailer_counts(text) to anon, authenticated;
