-- =====================================================================
-- Heartbeat · "Your top 10" hook for new visitors (no account needed).
-- A visitor picks up to 10 favorite movies/shows; we tell them how many real people share that taste.
-- Counts only — never who. People = visitors who picked the title here (one per device)
--   + signed-in users who rated it 4+ overall or swiped "loved".
-- Run AFTER 001. Safe to run again.
-- =====================================================================
create table if not exists public.taste_picks (
  device     uuid not null,
  title_key  text not null check (title_key ~ '^(movie|tv):[0-9]{1,9}$'),
  rank       smallint not null check (rank between 1 and 10),
  created_at timestamptz not null default now(),
  primary key (device, title_key)
);
create index if not exists taste_picks_title on public.taste_picks (title_key);
alter table public.taste_picks enable row level security;
revoke all on public.taste_picks from anon, authenticated;

-- Save (replace) one device's top 10.
create or replace function public.taste_save(p_device uuid, p_keys text[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  n := coalesce(array_length(p_keys, 1), 0);
  if p_device is null or n < 1 or n > 10 then raise exception 'Pick 1 to 10 titles.'; end if;
  if exists (select 1 from unnest(p_keys) k where k !~ '^(movie|tv):[0-9]{1,9}$') then raise exception 'That title is not valid.'; end if;
  delete from taste_picks where device = p_device;
  insert into taste_picks (device, title_key, rank)
    select p_device, k, least(i, 10) from unnest(p_keys) with ordinality as t(k, i) on conflict do nothing;
  return n;
end $$;

-- How many people share these favorites (the caller's own device is not counted).
create or replace function public.taste_match(p_device uuid, p_keys text[]) returns jsonb
language sql stable security definer set search_path = public as $$
  with keys as (select distinct k from unnest(p_keys[1:10]) k where k ~ '^(movie|tv):[0-9]{1,9}$'),
  fans as (
    select 'd:' || device::text as who, title_key from taste_picks
      where title_key in (select k from keys) and device is distinct from p_device
    union
    select 'u:' || user_id::text, title_key from ratings where title_key in (select k from keys) and overall >= 4
    union
    select 'u:' || user_id::text, title_key from swipes where title_key in (select k from keys) and kind = 'loved'
  ),
  per as (select title_key, count(distinct who) as n from fans group by title_key),
  people as (select who, count(*) as c from fans group by who)
  select jsonb_build_object(
    'per',   coalesce((select jsonb_object_agg(title_key, n) from per), '{}'::jsonb),
    'any',   (select count(*) from people),
    'three', (select count(*) from people where c >= 3),
    'total', (select count(distinct device) from taste_picks where device is distinct from p_device) + (select count(*) from profiles)
  )
$$;

revoke execute on function public.taste_save(uuid, text[]) from public;
revoke execute on function public.taste_match(uuid, text[]) from public;
grant execute on function public.taste_save(uuid, text[]) to anon, authenticated;
grant execute on function public.taste_match(uuid, text[]) to anon, authenticated;
