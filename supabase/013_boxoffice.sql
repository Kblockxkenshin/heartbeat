-- =====================================================================
-- Heartbeat · Redesign step 3: Box Office (Indian cinema)
-- Run AFTER 001–012. Safe to run again.
--  * Movies + day-by-day collections (₹ crore). Anyone can read; only admins (with 2-step sign-in) can write.
--  * Admins add numbers in Admin → Box office (one movie at a time, or paste a CSV of days).
--  * Verdict is worked out from the numbers unless an admin sets it by hand.
-- =====================================================================

create table if not exists public.bo_movies (
  id            bigint generated always as identity primary key,
  tmdb_id       int unique,
  title         text not null check (char_length(title) between 1 and 200),
  lang          text not null check (lang ~ '^[a-z]{2}$'),
  release_date  date not null,
  certificate   text check (certificate in ('U', 'UA', 'U/A 7+', 'U/A 13+', 'U/A 16+', 'A', 'S')),
  runtime       int check (runtime between 1 and 400),
  budget_cr     numeric(10,2) check (budget_cr >= 0),
  breakeven_cr  numeric(10,2) check (breakeven_cr >= 0),   -- worldwide gross needed to break even (empty = 2 × budget)
  screens       int check (screens between 0 and 20000),
  ott_date      date,
  ott_platform  text check (char_length(ott_platform) <= 40),
  verdict       text check (verdict in ('Blockbuster', 'Superhit', 'Hit', 'Average', 'Flop', 'Disaster')),
  running       boolean not null default true,
  poster_path   text check (poster_path ~ '^/[A-Za-z0-9_.-]{1,80}$'),
  source        text check (char_length(source) <= 200),
  updated_at    timestamptz not null default now()
);
create table if not exists public.bo_days (
  movie_id       bigint not null references public.bo_movies on delete cascade,
  day            int not null check (day between 1 and 400),
  date           date not null,
  india_net_cr   numeric(10,2) not null default 0 check (india_net_cr >= 0),
  india_gross_cr numeric(10,2) check (india_gross_cr >= 0),
  overseas_cr    numeric(10,2) check (overseas_cr >= 0),
  note           text check (char_length(note) <= 40),   -- e.g. "Diwali", "Holiday"
  estimated      boolean not null default false,          -- true = filled in with math between reported numbers
  primary key (movie_id, day)
);
alter table public.bo_days add column if not exists estimated boolean not null default false;

-- Worked-out verdict: ROI on worldwide gross vs break-even.
create or replace function public._bo_verdict(p_verdict text, p_be numeric, p_running boolean, ww numeric) returns text
language sql immutable as $$
  select case
    when p_verdict is not null then p_verdict
    when coalesce(p_be, 0) = 0 then null
    when ww / p_be >= 3 then 'Blockbuster'
    when ww / p_be >= 2 then 'Superhit'
    when ww / p_be >= 1.25 then 'Hit'
    when ww / p_be >= 1 then 'Average'
    when p_running then null
    when ww / p_be >= 0.6 then 'Flop'
    else 'Disaster' end
$$;

-- Everything the Box Office page needs, one row per movie.
create or replace function public.box_office_summary() returns jsonb
language sql stable security definer set search_path = public as $$
  with t as (
    select m.*,
      coalesce(sum(d.india_net_cr), 0) net,
      coalesce(sum(coalesce(d.india_gross_cr, d.india_net_cr * 1.18)), 0) gross,
      coalesce(sum(coalesce(d.india_gross_cr, d.india_net_cr * 1.18) + coalesce(d.overseas_cr, 0)), 0) ww,
      coalesce(sum(d.overseas_cr), 0) overseas,
      count(d.day) ndays, max(d.day) last_day,
      max(d.india_net_cr) filter (where d.day = 1) d1,
      sum(d.india_net_cr) filter (where d.day <= 3) wknd,
      sum(d.india_net_cr) filter (where d.day <= 7) wk1
    from bo_movies m left join bo_days d on d.movie_id = m.id group by m.id)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'tmdb_id', t.tmdb_id, 'title', t.title, 'lang', t.lang, 'release_date', t.release_date, 'running', t.running,
      'poster_path', t.poster_path, 'budget', t.budget_cr, 'breakeven', coalesce(t.breakeven_cr, t.budget_cr * 2),
      'net', round(t.net, 2), 'gross', round(t.gross, 2), 'worldwide', round(t.ww, 2), 'overseas', round(t.overseas, 2),
      'days', t.ndays, 'last_day', t.last_day, 'opening', t.d1, 'weekend', t.wknd, 'week1', t.wk1,
      'last', (select india_net_cr from bo_days where movie_id = t.id and day = t.last_day),
      'prev', (select india_net_cr from bo_days where movie_id = t.id and day = t.last_day - 1),
      'verdict', _bo_verdict(t.verdict, coalesce(t.breakeven_cr, t.budget_cr * 2), t.running, t.ww)) order by t.release_date desc), '[]'::jsonb)
  from t
$$;

-- One movie with all its days.
create or replace function public.box_office_movie(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('movie', to_jsonb(m) - 'source' || jsonb_build_object('source', m.source,
           'verdict', _bo_verdict(m.verdict, coalesce(m.breakeven_cr, m.budget_cr * 2), m.running, (select coalesce(sum(coalesce(india_gross_cr, india_net_cr * 1.18) + coalesce(overseas_cr, 0)), 0) from bo_days where movie_id = m.id)),
           'breakeven', coalesce(m.breakeven_cr, m.budget_cr * 2)),
         'days', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'date', d.date, 'net', d.india_net_cr,
           'gross', coalesce(d.india_gross_cr, round(d.india_net_cr * 1.18, 2)), 'overseas', coalesce(d.overseas_cr, 0), 'note', d.note, 'est', d.estimated) order by d.day)
           from bo_days d where d.movie_id = m.id), '[]'::jsonb))
  from bo_movies m where m.id = p_id
$$;

-- ---------- admin ----------
create or replace function public.admin_bo_save(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_admin(); mid bigint := nullif(p->>'id', '')::bigint;
begin
  if mid is null then
    insert into bo_movies (tmdb_id, title, lang, release_date, certificate, runtime, budget_cr, breakeven_cr, screens, ott_date, ott_platform, verdict, running, poster_path, source)
    values (nullif(p->>'tmdb_id', '')::int, btrim(p->>'title'), p->>'lang', (p->>'release_date')::date, nullif(p->>'certificate', ''), nullif(p->>'runtime', '')::int,
      nullif(p->>'budget', '')::numeric, nullif(p->>'breakeven', '')::numeric, nullif(p->>'screens', '')::int, nullif(p->>'ott_date', '')::date, nullif(btrim(p->>'ott_platform'), ''),
      nullif(p->>'verdict', ''), coalesce((p->>'running')::boolean, true), nullif(p->>'poster_path', ''), nullif(btrim(p->>'source'), ''))
    returning id into mid;
  else
    update bo_movies set tmdb_id = nullif(p->>'tmdb_id', '')::int, title = btrim(p->>'title'), lang = p->>'lang', release_date = (p->>'release_date')::date,
      certificate = nullif(p->>'certificate', ''), runtime = nullif(p->>'runtime', '')::int, budget_cr = nullif(p->>'budget', '')::numeric,
      breakeven_cr = nullif(p->>'breakeven', '')::numeric, screens = nullif(p->>'screens', '')::int, ott_date = nullif(p->>'ott_date', '')::date,
      ott_platform = nullif(btrim(p->>'ott_platform'), ''), verdict = nullif(p->>'verdict', ''), running = coalesce((p->>'running')::boolean, true),
      poster_path = nullif(p->>'poster_path', ''), source = nullif(btrim(p->>'source'), ''), updated_at = now()
    where id = mid;
    if not found then raise exception 'Movie not found.'; end if;
  end if;
  perform _log_admin('bo_save', null, mid::text, left(p->>'title', 60));
  return mid;
end $$;

-- Replace or add days. p_days = [{day, date, net, gross, overseas, note}, …] (max 400).
create or replace function public.admin_bo_days(p_movie bigint, p_days jsonb, p_replace boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_admin(); n int; rd date;
begin
  select release_date into rd from bo_movies where id = p_movie;
  if rd is null then raise exception 'Movie not found.'; end if;
  if jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) > 400 then raise exception 'Send up to 400 days.'; end if;
  if p_replace then delete from bo_days where movie_id = p_movie; end if;
  insert into bo_days (movie_id, day, date, india_net_cr, india_gross_cr, overseas_cr, note, estimated)
  select p_movie, (x->>'day')::int, coalesce(nullif(x->>'date', '')::date, rd + (x->>'day')::int - 1),
    coalesce(nullif(x->>'net', '')::numeric, 0), nullif(x->>'gross', '')::numeric, nullif(x->>'overseas', '')::numeric, nullif(btrim(x->>'note'), ''),
    coalesce((x->>'est')::boolean, false)
  from jsonb_array_elements(p_days) x
  on conflict (movie_id, day) do update set date = excluded.date, india_net_cr = excluded.india_net_cr, india_gross_cr = excluded.india_gross_cr,
    overseas_cr = excluded.overseas_cr, note = excluded.note, estimated = excluded.estimated;
  get diagnostics n = row_count;
  update bo_movies set updated_at = now() where id = p_movie;
  perform _log_admin('bo_days', null, p_movie::text, n || ' days');
  return n;
end $$;

create or replace function public.admin_bo_delete(p_movie bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_admin();
begin
  delete from bo_movies where id = p_movie;
  perform _log_admin('bo_delete', null, p_movie::text, null);
end $$;

alter table public.bo_movies enable row level security;
alter table public.bo_days enable row level security;
revoke all on public.bo_movies, public.bo_days from anon, authenticated;
revoke execute on function public.box_office_summary(), public.box_office_movie(bigint), public.admin_bo_save(jsonb),
  public.admin_bo_days(bigint, jsonb, boolean), public.admin_bo_delete(bigint), public._bo_verdict(text, numeric, boolean, numeric) from public;
grant execute on function public.box_office_summary(), public.box_office_movie(bigint) to anon, authenticated;
grant execute on function public.admin_bo_save(jsonb), public.admin_bo_days(bigint, jsonb, boolean), public.admin_bo_delete(bigint) to authenticated;
