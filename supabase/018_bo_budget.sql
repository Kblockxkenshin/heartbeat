-- =====================================================================
-- Heartbeat · Box Office: budgets for movies in theaters, as reported online (Nov 2026).
-- Run AFTER 017. Safe to run again (replaces all rows).
--  * Each row links where the budget was reported. Not checked by us.
-- =====================================================================
create table if not exists public.bo_budget (
  tmdb_id     int primary key,
  title       text not null check (char_length(title) between 1 and 200),
  budget_cr   numeric(10,3) not null check (budget_cr > 0),
  high_cr     numeric(10,3) check (high_cr >= budget_cr),
  source_name text not null check (char_length(source_name) <= 120),
  url         text not null check (url ~ '^https://(x\.com|www\.instagram\.com|www\.sacnilk\.com|filmibeat\.com|www\.gulte\.com)/' and char_length(url) <= 300),
  updated_at  timestamptz not null default now()
);

create or replace function public.box_office_budget() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('tmdb_id', tmdb_id, 'title', title, 'low', budget_cr, 'high', high_cr,
    'source_name', source_name, 'url', url) order by tmdb_id), '[]'::jsonb)
  from bo_budget
$$;

alter table public.bo_budget enable row level security;
revoke all on public.bo_budget from anon, authenticated;
revoke execute on function public.box_office_budget() from public;
grant execute on function public.box_office_budget() to anon, authenticated;

delete from public.bo_budget;
insert into public.bo_budget (tmdb_id, title, budget_cr, high_cr, source_name, url) values
  (1402181, 'Scene', 30, null, 'Sacnilk (news)', 'https://www.sacnilk.com/news/suriya-starrer-scene-reportedly-fetches-88-cr-from-netflix-nearly-3x-its-production-budget'),
  (1375156, 'Udta Teer', 50, 65, 'Filmibeat (NewsBytes says ₹65 Cr)', 'https://filmibeat.com/bollywood/box-office/2026/udta-teer-box-office-collection-hit-or-flop-budget-records-everything-to-know-about-ayushmanns-535655.html'),
  (1593350, 'Haiku', 11, null, '@FilmyBowlTamil (X)', 'https://x.com/FilmyBowlTamil/status/2114629154557825372'),
  (1641520, 'DNK', 5, null, 'Gulte (X)', 'https://x.com/GulteOfficial/status/2122348776170127664'),
  (1496785, 'Aadarsha Kutumbam House No: 47 - AK47', 128, null, '@TimesYugCinema (X)', 'https://x.com/TimesYugCinema/status/2124147968622338190'),
  (1505644, 'ENE Repeat', 40, null, '@TimesYugCinema (X)', 'https://x.com/TimesYugCinema/status/2125953249446646271'),
  (1327835, 'Mookuthi Amman 2', 100, null, '@SelVa479070 (X, fan)', 'https://x.com/SelVa479070/status/2120435978619998332'),
  (1510775, 'Gunmaaster G9', 50, null, '@Saksham31629 (X), citing Box Office India', 'https://x.com/Saksham31629/status/2126355825757405423'),
  (1785611, 'Tu Hai Meri Kiran', 20, 25, '@CineAlpha1 (X)', 'https://x.com/CineAlpha1/status/2114708140692554182'),
  (1806232, 'Tum Mere Ho', 16, 20, 'Instagram post', 'https://www.instagram.com/p/DdtNDpQzmoW/'),
  (1606527, '418', 6, null, 'Gulte', 'https://www.gulte.com/movienews/436684/mythris-6-cr-bet-on-418');

-- The social list now also sends each movie's release date (the graph needs it to count days).
create or replace function public.box_office_social() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('tmdb_id', tmdb_id, 'title', title, 'lang', lang, 'release_date', release_date, 'figure', figure, 'low', low_cr, 'high', high_cr,
    'plus', plus, 'as_of', as_of, 'days', days, 'source_type', source_type, 'source_name', source_name, 'url', url) order by tmdb_id, rank), '[]'::jsonb)
  from bo_social
$$;
revoke execute on function public.box_office_social() from public;
grant execute on function public.box_office_social() to anon, authenticated;
