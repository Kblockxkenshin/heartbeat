-- =====================================================================
-- Heartbeat · Box Office: numbers for movies in theaters, as posted on X and Instagram (Nov 2026).
-- Run AFTER 013. Safe to run again (replaces all rows).
--  * Each row says WHO posted it (official movie account, crew, trade tracker, news, fan page) and links the post.
--  * Not checked by us. Shown with the source so people can judge.
-- =====================================================================
create table if not exists public.bo_social (
  id          bigint generated always as identity primary key,
  tmdb_id     int  not null,
  title       text not null check (char_length(title) between 1 and 200),
  lang        text not null check (lang ~ '^[a-z]{2}$'),
  release_date date,
  figure      text not null check (char_length(figure) between 1 and 60),
  low_cr      numeric(10,3) not null check (low_cr >= 0),
  high_cr     numeric(10,3) check (high_cr >= low_cr),
  plus        boolean not null default false,
  as_of       date not null,
  days        int check (days between 1 and 400),
  source_type text not null check (source_type in ('Official','Cast & crew','Trade tracker','News','Fan page')),
  source_name text not null check (char_length(source_name) <= 120),
  url         text not null check (url ~ '^https://(x\.com|www\.instagram\.com|www\.koimoi\.com)/' and char_length(url) <= 300),
  rank        int not null default 0,
  updated_at  timestamptz not null default now()
);
create index if not exists bo_social_tmdb on public.bo_social (tmdb_id, rank);

create or replace function public.box_office_social() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('tmdb_id', tmdb_id, 'title', title, 'lang', lang, 'figure', figure, 'low', low_cr, 'high', high_cr,
    'plus', plus, 'as_of', as_of, 'days', days, 'source_type', source_type, 'source_name', source_name, 'url', url) order by tmdb_id, rank), '[]'::jsonb)
  from bo_social
$$;

alter table public.bo_social enable row level security;
revoke all on public.bo_social from anon, authenticated;
revoke execute on function public.box_office_social() from public;
grant execute on function public.box_office_social() to anon, authenticated;

delete from public.bo_social;
insert into public.bo_social (tmdb_id, title, lang, release_date, figure, low_cr, high_cr, plus, as_of, days, source_type, source_name, url, rank) values
  (1384528, 'O.M: Operation Mole', 'ta', date '2026-11-20', 'Worldwide gross', 106.25, null, false, date '2026-11-26', null, 'Fan page', '@filmynox05 (Instagram)', 'https://www.instagram.com/p/DgNR_4AIQ8V/', 0),
  (1384528, 'O.M: Operation Mole', 'ta', date '2026-11-20', 'Worldwide gross', 100, null, true, date '2026-11-26', null, 'News', 'ThePrint (X)', 'https://x.com/ThePrintIndia/status/2125911322961613263', 1),
  (1384528, 'O.M: Operation Mole', 'ta', date '2026-11-20', 'India net', 66.02, null, false, date '2026-11-25', 6, 'Trade tracker', '@BoxofficeIn24 (X)', 'https://x.com/BoxofficeIn24/status/2125639391196668187', 2),
  (1402181, 'Scene', 'ta', date '2026-11-06', 'Worldwide gross', 260, null, true, date '2026-11-16', 11, 'Official', '@zhagaramoffl (Instagram)', 'https://www.instagram.com/p/Dfzdt6ATddd/', 0),
  (1402181, 'Scene', 'ta', date '2026-11-06', 'Worldwide gross', 266.27, null, false, date '2026-11-26', null, 'Fan page', '@filmynox05 (Instagram)', 'https://www.instagram.com/p/DgNR_4AIQ8V/', 1),
  (1402181, 'Scene', 'ta', date '2026-11-06', 'Worldwide gross', 255, null, false, date '2026-11-23', 17, 'Trade tracker', '@Cinetrak (X)', 'https://x.com/Cinetrak/status/2124924610844221620', 2),
  (1327835, 'Mookuthi Amman 2', 'ta', date '2026-11-06', 'India net', 14.08, null, false, date '2026-11-10', 4, 'Fan page', '@parallaxcinemas (X), citing Sacnilk', 'https://x.com/parallaxcinemas/status/2120024197099630911', 0),
  (1606527, '418', 'te', date '2026-10-23', 'India net', 10.22, null, false, date '2026-11-02', 7, 'Fan page', '@cinema_woods_ (Instagram)', 'https://www.instagram.com/p/DfQ0PiKIc6_/', 0),
  (1322273, 'Aakasamlo Oka Tara', 'te', date '2026-11-20', 'Worldwide gross', 42.35, null, false, date '2026-11-27', 7, 'Fan page', '@dQtelugu369 (X)', 'https://x.com/dQtelugu369/status/2126238167988928887', 0),
  (1637705, '#Cult', 'te', date '2026-10-30', 'India gross', 6, null, false, date '2026-11-10', null, 'News', 'Gulte (X)', 'https://x.com/GulteOfficial/status/2120084938477408582', 0),
  (1593350, 'Haiku', 'ta', date '2026-10-23', 'Gross', 1.25, null, true, date '2026-10-26', 3, 'Fan page', '@FilmyBowlTamil (X)', 'https://x.com/FilmyBowlTamil/status/2114629154557825372', 0),
  (1209723, 'Yeh Prem Mol Liya', 'hi', date '2026-11-27', 'India net, Day 1', 3.5, 3.75, false, date '2026-11-27', 1, 'News', 'Pinkvilla (Instagram)', 'https://www.instagram.com/p/DgQbZE9znhz/', 0),
  (1209723, 'Yeh Prem Mol Liya', 'hi', date '2026-11-27', 'India net, Day 1', 4.2, 4.3, false, date '2026-11-27', 1, 'Fan page', '@FilmsDiscourse (X)', 'https://x.com/FilmsDiscourse/status/2126377662180692360', 1),
  (1505644, 'ENE Repeat', 'te', date '2026-11-19', 'Worldwide gross', 51.8, null, true, date '2026-11-25', 7, 'Official', '@enerepeat (Instagram)', 'https://www.instagram.com/p/DgMeyK-NLhO/', 0),
  (1505644, 'ENE Repeat', 'te', date '2026-11-19', 'Worldwide gross', 47.1, null, false, date '2026-11-27', 9, 'Trade tracker', '@TheTollyBO (X)', 'https://x.com/TheTollyBO/status/2126451176183099540', 1),
  (1505644, 'ENE Repeat', 'te', date '2026-11-19', 'India net', 25.44, null, false, date '2026-11-27', 9, 'Trade tracker', '@TheTollyBO (X)', 'https://x.com/TheTollyBO/status/2126451176183099540', 2),
  (1680033, 'Appa Kutty', 'ta', date '2026-11-20', 'Collection', 2.5, null, true, date '2026-11-23', 3, 'Fan page', '@parallaxcinemas (X)', 'https://x.com/parallaxcinemas/status/2124845670783648143', 0),
  (1533928, 'Bachelor Party D''eux', 'ml', date '2026-11-19', 'Worldwide gross', 6.75, null, false, date '2026-11-26', 7, 'News', 'Business Times (X)', 'https://x.com/BusinessTimesIn/status/2125959056061862130', 0),
  (1375156, 'Udta Teer', 'hi', date '2026-10-23', 'Worldwide gross', 69.74, null, false, date '2026-11-23', 31, 'Fan page', '@IndiawoodUpdate (X)', 'https://x.com/IndiawoodUpdate/status/2124812706893172811', 0),
  (1441306, 'Sadhak Bamakhyapa', 'bn', date '2026-11-20', 'Collection', 1.42, null, false, date '2026-11-25', 5, 'News', 'Business Times (X)', 'https://x.com/BusinessTimesIn/status/2125634120671735821', 0),
  (1555847, 'Garividi Lakshmi', 'te', date '2026-10-17', 'Worldwide gross', 6.5, null, false, date '2026-10-25', null, 'Fan page', '@dailyculturechannel (Instagram)', 'https://www.instagram.com/p/De8qMn9GKEh/', 0),
  (1641520, 'DNK', 'te', date '2026-11-13', 'Worldwide gross', 10.15, null, false, date '2026-11-16', 3, 'Official', '@mythriofficial (Instagram)', 'https://www.instagram.com/p/Dfy5fBviq40/', 0),
  (1496785, 'Aadarsha Kutumbam House No: 47 - AK47', 'te', date '2026-10-30', 'Worldwide gross', 75.34, null, false, date '2026-11-26', null, 'News', 'Business Times (X)', 'https://x.com/BusinessTimesIn/status/2125959310140133834', 0),
  (1496785, 'Aadarsha Kutumbam House No: 47 - AK47', 'te', date '2026-10-30', 'India net', 49.97, null, false, date '2026-11-21', null, 'Fan page', '@TimesYugCinema (X)', 'https://x.com/TimesYugCinema/status/2124147968622338190', 1),
  (1612811, 'Disco', 'ml', date '2026-11-06', 'India gross, Day 2', 0.25, null, false, date '2026-11-07', 1, 'Fan page', '@boxofficewalaindia (Instagram)', 'https://www.instagram.com/p/Dfdi5beMurZ/', 0),
  (1540824, 'Sathyavan Savithiri', 'ta', date '2026-11-20', 'India net', 1.02, null, false, date '2026-11-23', 3, 'Fan page', '@StarwireX (X)', 'https://x.com/StarwireX/status/2124778667528356122', 0),
  (1772549, 'Pehla Pyaar Doosri Baar', 'hi', date '2026-10-23', 'India net', 2.0, null, false, date '2026-10-26', 3, 'Fan page', '@freshyamerica (X)', 'https://x.com/freshyamerica/status/2114556436600717594', 0),
  (1698932, 'Kaali Kheti', 'hi', date '2026-11-20', 'India net, Day 1', 0.19, null, false, date '2026-11-21', 1, 'Fan page', '@MovieThread_ (X)', 'https://x.com/MovieThread_/status/2124055419534573958', 0),
  (1783280, 'Party Animals', 'hi', date '2026-11-20', 'India net, Day 1', 0.05, null, false, date '2026-11-21', 1, 'Fan page', '@MovieThread_ (X)', 'https://x.com/MovieThread_/status/2124055419534573958', 0),
  (1808244, 'Pratap', 'hi', date '2026-11-20', 'India net, Day 1', 0.03, null, false, date '2026-11-21', 1, 'Fan page', '@MovieThread_ (X)', 'https://x.com/MovieThread_/status/2124055419534573958', 0),
  (1440539, 'Itllu Arjuna', 'te', date '2026-11-13', 'India net', 5.04, null, false, date '2026-11-23', 11, 'Trade tracker', '@TheTollyBO (X)', 'https://x.com/TheTollyBO/status/2124996482202042601', 0),
  (1576389, 'Gondhal', 'mr', date '2026-11-13', 'India net', 0.72, null, false, date '2026-11-21', 8, 'Trade tracker', '@SacNicBO (X)', 'https://x.com/SacNicBO/status/2123997712567951667', 0),
  (1733518, 'Bouma', 'ml', date '2026-11-12', 'Kerala gross', 7.57, null, false, date '2026-11-25', 13, 'Fan page', '@BOSouthIndian (X)', 'https://x.com/BOSouthIndian/status/2125627574428582114', 0),
  (1655020, 'John Doe', 'ta', date '2026-11-13', 'India net', 1.86, null, false, date '2026-11-19', 7, 'Fan page', '@cablesankar (Instagram)', 'https://www.instagram.com/p/Df8qv3piNno/', 0),
  (1510775, 'Gunmaaster G9', 'hi', date '2026-11-27', 'India net, Day 1', 3.65, null, false, date '2026-11-27', 1, 'Trade tracker', '@BoxofficeIn24 (X)', 'https://x.com/BoxofficeIn24/status/2126363147229687826', 0),
  (1510775, 'Gunmaaster G9', 'hi', date '2026-11-27', 'India net, Day 1', 3.0, null, false, date '2026-11-27', 1, 'News', 'Pinkvilla (Instagram)', 'https://www.instagram.com/p/DgQbVbxTAZi/', 1),
  (1704200, 'Hail Mary', 'ml', date '2026-11-26', 'Kerala gross, Day 1', 0.7, null, false, date '2026-11-26', 1, 'Fan page', '@fridaymatineein (Instagram)', 'https://www.instagram.com/p/DgOrGBDvySK/', 0),
  (1374689, 'Pyre', 'hi', date '2026-10-30', 'India net', 3.61, null, false, date '2026-11-23', null, 'Trade tracker', 'Taran Adarsh (X)', 'https://x.com/taran_adarsh/status/2124785547055165475', 0),
  (1650834, 'Chakkven', 'pa', date '2026-11-20', 'Collection', 0.35, null, false, date '2026-11-24', 4, 'News', 'Business Times (X)', 'https://x.com/BusinessTimesIn/status/2125206589816664498', 0),
  (1450342, 'Bhogi', 'te', date '2026-11-27', 'Collection, Day 1', 2.1, null, false, date '2026-11-27', 1, 'Fan page', '@MovieReview_Hub (X)', 'https://x.com/MovieReview_Hub/status/2126363840355119461', 0),
  (1785611, 'Tu Hai Meri Kiran', 'hi', date '2026-10-23', 'Collection', 0.6, null, false, date '2026-10-31', 10, 'Fan page', '@Tejashyy (X)', 'https://x.com/Tejashyy/status/2116410720204300484', 0),
  (1836066, 'Nanhey Dil', 'hi', date '2026-11-20', 'Collection', 0.4, null, true, date '2026-11-26', 6, 'News', 'Business Times (X)', 'https://x.com/BusinessTimesIn/status/2125959560057794817', 0),
  (1735403, 'Brindavihari', 'kn', date '2026-11-20', 'Karnataka gross', 3.91, null, false, date '2026-11-27', 7, 'Fan page', '@DeccanBO_Hub (X)', 'https://x.com/DeccanBO_Hub/status/2126175063733104958', 0),
  (1244547, 'Udumbanchola Vision', 'ml', date '2026-10-23', 'Kerala gross, Day 1', 0.125, null, false, date '2026-10-23', 1, 'Fan page', '@boxofficesouthindian (Instagram)', 'https://www.instagram.com/p/De3SFaGseXw/', 0),
  (1202167, 'Nakhrewaalii', 'hi', date '2026-10-30', 'India net, Day 1 by 5 PM', 0.08, null, false, date '2026-10-30', 1, 'Fan page', '@bollybourse (Instagram)', 'https://www.instagram.com/p/DfHnbGpDVlM/', 0),
  (1434462, 'Melcow Pondicherry', 'ml', date '2026-11-13', 'Collection', 0.61, null, false, date '2026-11-23', 3, 'Fan page', '@insta_naana (Instagram)', 'https://www.instagram.com/p/DgFejEUFjVR/', 0),
  (1806232, 'Tum Mere Ho', 'hi', date '2026-10-23', 'India gross, Day 1', 0.2, null, false, date '2026-10-24', 1, 'Fan page', '@foreverpanjab (Instagram)', 'https://www.instagram.com/p/De3mA1vTExk/', 0),
  (1826465, 'Jayannth & The Jingo Pen', 'te', date '2026-11-14', 'Gross', 0.6, null, false, date '2026-11-17', 4, 'Official', '@namojayamproductions (Instagram)', 'https://www.instagram.com/p/Df3godJoHiG/', 0),
  (1825111, 'Aadi Anant', 'mr', date '2026-11-12', 'India net', 1.87, null, false, date '2026-11-17', 6, 'Trade tracker', '@sacnilk (Instagram)', 'https://www.instagram.com/p/Df3ethRhAXQ/', 0),
  (1811490, 'Spring', 'ml', date '2026-10-30', 'Kerala collection', 0.15, null, false, date '2026-11-02', 3, 'Official', '@spring__movie (Instagram)', 'https://www.instagram.com/p/DfP3X2HTy_X/', 0),
  (1789037, 'Singgaramm', 'ta', date '2026-10-30', 'India net', 0.12, null, false, date '2026-10-31', 2, 'Fan page', '@cablesankar (Instagram)', 'https://www.instagram.com/p/DfL05YMk4OX/', 0),
  (1812810, 'Pani Vizhum Iravu', 'ta', date '2026-10-30', 'India net', 0.02, null, false, date '2026-10-31', 2, 'Fan page', '@cablesankar (Instagram)', 'https://www.instagram.com/p/DfL05YMk4OX/', 0),
  (1593350, 'Haiku', 'ta', date '2026-10-23', 'India net', 1.2, null, false, date '2026-10-31', 8, 'Fan page', '@cablesankar (Instagram)', 'https://www.instagram.com/p/DfL05YMk4OX/', 1),
  (1688459, 'KillR', 'te', date '2026-10-30', 'Gross, Day 1 (incl. premieres)', 0.65, null, false, date '2026-10-31', 1, 'Cast & crew', '@pro_saisatish, film PR (Instagram)', 'https://www.instagram.com/p/DfKd0cKzVEW/', 0),
  (869152, 'Titans', 'ml', date '2026-10-22', 'India net', 3.01, null, false, date '2026-11-01', 11, 'News', 'Koimoi', 'https://www.koimoi.com/box-office/titans-box-office-collection-day-11-depsite-slow-run-jayasuryas-film-inches-close-to-surpassing-unmadham/', 0);
