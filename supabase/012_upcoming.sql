-- =====================================================================
-- Heartbeat · Redesign step 2: Upcoming (Indian cinema)
-- Run AFTER 001–011. Safe to run again.
--  * "Notify me": a reminder that shows in the app on release day.
--  * "Most anticipated": how many Heartbeat members saved each upcoming title.
-- =====================================================================

create table if not exists public.release_alerts (
  user_id      uuid not null references auth.users on delete cascade,
  title_key    text not null check (title_key ~ '^movie:[0-9]{1,9}$'),
  name         text not null check (char_length(name) between 1 and 200),
  release_date date not null,
  notified_at  timestamptz,
  created_at   timestamptz not null default now(),
  primary key (user_id, title_key)
);
create index if not exists release_alerts_due on public.release_alerts (release_date) where notified_at is null;

-- Turn a reminder on or off. Returns true when it is on.
create or replace function public.toggle_release_alert(p_key text, p_name text, p_date date) returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int;
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  if p_key !~ '^movie:[0-9]{1,9}$' then raise exception 'Unknown title.'; end if;
  if exists (select 1 from release_alerts where user_id = me and title_key = p_key) then
    delete from release_alerts where user_id = me and title_key = p_key; return false;
  end if;
  if p_date is null or p_date < current_date or p_date > current_date + 400 then raise exception 'That release date doesn''t look right.'; end if;
  select count(*) into n from release_alerts where user_id = me and notified_at is null;
  if n >= 200 then raise exception 'You have a lot of reminders already. Remove a few first.'; end if;
  insert into release_alerts (user_id, title_key, name, release_date)
    values (me, p_key, left(coalesce(nullif(btrim(p_name), ''), 'Untitled'), 200), p_date);
  return true;
end $$;

-- My reminders (for the buttons and for "Download my data").
create or replace function public.my_release_alerts() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', title_key, 'name', name, 'date', release_date, 'notified', notified_at is not null) order by release_date), '[]'::jsonb)
  from release_alerts where user_id = auth.uid()
$$;

-- Called when the app opens: reminders that are due now (each one is shown once).
create or replace function public.claim_release_alerts() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); out jsonb;
begin
  if me is null then return '[]'::jsonb; end if;
  with due as (
    update release_alerts set notified_at = now()
    where user_id = me and notified_at is null and release_date <= current_date
    returning title_key, name, release_date)
  select coalesce(jsonb_agg(jsonb_build_object('key', title_key, 'name', name, 'date', release_date)), '[]'::jsonb) into out from due;
  return out;
end $$;

-- "Most anticipated": watchlist saves per upcoming title (counts only, no names).
create or replace function public.upcoming_hype(p_keys text[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(title_key, n), '{}'::jsonb) from (
    select w.title_key, count(*) n from watchlist w
    where w.title_key = any (p_keys[1:200]) group by w.title_key) t
$$;

alter table public.release_alerts enable row level security;
revoke all on public.release_alerts from anon, authenticated;
revoke execute on function public.toggle_release_alert(text, text, date), public.my_release_alerts(), public.claim_release_alerts(), public.upcoming_hype(text[]) from public, anon;
grant execute on function public.toggle_release_alert(text, text, date), public.my_release_alerts(), public.claim_release_alerts(), public.upcoming_hype(text[]) to authenticated;
grant execute on function public.upcoming_hype(text[]) to anon;
