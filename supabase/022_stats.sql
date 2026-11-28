-- =====================================================================
-- Heartbeat · Stats dashboard for the owner (Admin → Stats).
-- Counts visits without storing anything personal: one row per device per day
-- (a random id the browser makes, never an IP address or name), which page they opened first,
-- which site sent them (domain only), phone or computer, and how many pages they looked at.
-- Run AFTER 008. Safe to run again.
-- =====================================================================
create table if not exists public.site_visits (
  day        date not null default (now() at time zone 'utc')::date,
  device     uuid not null,
  pages      int  not null default 1 check (pages between 1 and 1000),
  first_path text check (char_length(first_path) <= 40),
  ref        text check (char_length(ref) <= 80),
  phone      boolean not null default false,
  user_id    uuid references auth.users on delete set null,
  first_at   timestamptz not null default now(),
  last_at    timestamptz not null default now(),
  primary key (day, device)
);
create index if not exists site_visits_device on public.site_visits (device, day);
alter table public.site_visits enable row level security;
revoke all on public.site_visits from anon, authenticated;

-- Called by the app when a page opens. Anyone can call it; it only ever adds to today's row for that device.
create or replace function public.track_visit(p_device uuid, p_path text, p_ref text, p_phone boolean) returns void
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'utc')::date;
  path text := left(coalesce(nullif(regexp_replace(lower(coalesce(p_path, '')), '[^a-z0-9_-]', '', 'g'), ''), 'home'), 40);
  ref text := left(nullif(regexp_replace(lower(coalesce(p_ref, '')), '[^a-z0-9.-]', '', 'g'), ''), 80);
begin
  if p_device is null then return; end if;
  insert into site_visits (day, device, first_path, ref, phone, user_id)
    values (d, p_device, path, ref, coalesce(p_phone, false), auth.uid())
  on conflict (day, device) do update set
    pages = least(site_visits.pages + 1, 1000), last_at = now(),
    user_id = coalesce(site_visits.user_id, excluded.user_id),
    ref = coalesce(site_visits.ref, excluded.ref);
end $$;
revoke execute on function public.track_visit(uuid, text, text, boolean) from public;
grant execute on function public.track_visit(uuid, text, text, boolean) to anon, authenticated;

-- Everything the owner's dashboard shows. Admins only (2-step sign-in not required just to look at numbers).
create or replace function public.admin_stats(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare n int := least(greatest(coalesce(p_days, 30), 7), 365);
  today date := (now() at time zone 'utc')::date;
begin
  if auth.uid() is null or not exists (select 1 from admins where user_id = auth.uid()) then raise exception 'Admins only.'; end if;
  return jsonb_build_object(
    'as_of', now(),
    'two_step', _aal() = 'aal2',
    'members',        (select count(*) from profiles where username is not null),
    'accounts',       (select count(*) from auth.users),
    'new_today',      (select count(*) from auth.users where created_at >= today),
    'new_7d',         (select count(*) from auth.users where created_at >= today - 6),
    'new_30d',        (select count(*) from auth.users where created_at >= today - 29),
    'visitors_today', (select count(*) from site_visits where day = today),
    'visitors_7d',    (select count(distinct device) from site_visits where day >= today - 6),
    'visitors_30d',   (select count(distinct device) from site_visits where day >= today - 29),
    'first_time_today', (select count(*) from site_visits v where v.day = today and not exists (select 1 from site_visits w where w.device = v.device and w.day < today)),
    'returning_7d',   (select count(*) from (select device from site_visits where day >= today - 6 group by device having count(*) >= 2) x),
    'views_today',    (select coalesce(sum(pages), 0) from site_visits where day = today),
    'active_members_7d', (select count(distinct u) from (
        select user_id u from ratings where updated_at >= today - 6 union
        select user_id from swipes where created_at >= today - 6 union
        select user_id from reviews where created_at >= today - 6 union
        select user_id from site_visits where day >= today - 6 and user_id is not null) a),
    'ratings',        (select count(*) from ratings),
    'ratings_today',  (select count(*) from ratings where created_at >= today),
    'swipes',         (select count(*) from swipes),
    'swipes_today',   (select count(*) from swipes where created_at >= today),
    'reviews',        (select count(*) from reviews),
    'taste_visitors', (select count(distinct device) from taste_picks),
    'taste_today',    (select count(distinct device) from taste_picks where created_at >= today),
    'daily', (select coalesce(jsonb_agg(x order by x.day), '[]'::jsonb) from (
        select g::date as day,
          (select count(*) from site_visits v where v.day = g::date) as visitors,
          (select count(*) from site_visits v where v.day = g::date and not exists (select 1 from site_visits w where w.device = v.device and w.day < g::date)) as first_time,
          (select coalesce(sum(pages), 0) from site_visits v where v.day = g::date) as views,
          (select count(*) from auth.users u where u.created_at >= g::date and u.created_at < g::date + 1) as signups,
          (select count(*) from ratings r where r.created_at >= g::date and r.created_at < g::date + 1) as ratings,
          (select count(*) from swipes s where s.created_at >= g::date and s.created_at < g::date + 1) as swipes
        from generate_series(today - (n - 1), today, interval '1 day') g) x),
    'recent_members', (select coalesce(jsonb_agg(x order by x.joined desc), '[]'::jsonb) from (
        select p.username, p.display_name, u.created_at as joined,
          (select count(*) from ratings r where r.user_id = u.id) as ratings,
          (select count(*) from swipes s where s.user_id = u.id) as swipes,
          (select max(v.last_at) from site_visits v where v.user_id = u.id) as last_seen
        from auth.users u left join profiles p on p.id = u.id order by u.created_at desc limit 25) x),
    'top_pages', (select coalesce(jsonb_agg(x order by x.visits desc), '[]'::jsonb) from (
        select first_path as page, count(*) as visits from site_visits where day >= today - 6 group by first_path order by count(*) desc limit 8) x),
    'top_sources', (select coalesce(jsonb_agg(x order by x.visits desc), '[]'::jsonb) from (
        select coalesce(ref, 'direct') as source, count(*) as visits from site_visits where day >= today - 29 group by coalesce(ref, 'direct') order by count(*) desc limit 8) x),
    'phone_share_7d', (select round(100.0 * count(*) filter (where phone) / nullif(count(*), 0)) from site_visits where day >= today - 6),
    'top_titles', (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from (
        select title_key, count(*) as n from (
          select title_key from ratings where updated_at >= today - 6 union all
          select title_key from swipes where kind = 'loved' and created_at >= today - 6 union all
          select title_key from taste_picks where created_at >= today - 6) t
        group by title_key order by count(*) desc limit 10) x)
  );
end $$;
revoke execute on function public.admin_stats(int) from public;
grant execute on function public.admin_stats(int) to authenticated;

-- The owner's account is the site admin.
insert into public.admins (user_id) select id from public.profiles where username = 'kblockxkenshin' on conflict do nothing;
