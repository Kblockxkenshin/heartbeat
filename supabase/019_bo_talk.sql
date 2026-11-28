-- =====================================================================
-- Heartbeat · Box Office: public talk + "worth it?" for movies in theaters, and the new verdict names.
-- Run AFTER 018. Safe to run again (replaces all talk rows).
--  * talk = our own short summary of what people are saying, with the links we read.
--  * worth = go | maybe | wait | skip
-- =====================================================================
create table if not exists public.bo_talk (
  tmdb_id    int primary key,
  title      text not null check (char_length(title) between 1 and 200),
  talk       text not null check (char_length(talk) between 1 and 600),
  worth      text check (worth in ('go', 'maybe', 'wait', 'skip')),
  worth_why  text check (char_length(worth_why) <= 300),
  sources    jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  as_of      date not null,
  updated_at timestamptz not null default now()
);

create or replace function public.box_office_talk() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('tmdb_id', tmdb_id, 'title', title, 'talk', talk, 'worth', worth, 'worth_why', worth_why,
    'sources', sources, 'as_of', as_of) order by tmdb_id), '[]'::jsonb)
  from bo_talk
$$;

alter table public.bo_talk enable row level security;
revoke all on public.bo_talk from anon, authenticated;
revoke execute on function public.box_office_talk() from public;
grant execute on function public.box_office_talk() to anon, authenticated;

-- New verdict names (old "Superhit" still allowed for saved rows).
alter table public.bo_movies drop constraint if exists bo_movies_verdict_check;
alter table public.bo_movies add constraint bo_movies_verdict_check
  check (verdict in ('Industry hit', 'Blockbuster', 'Super hit', 'Superhit', 'Hit', 'Average', 'Flop', 'Utter flop', 'Disaster'));

-- Link our tracked "Ramayana: Part 1" to its TMDB page (title differs: "Ramayana: Rise of a Legend").
update public.bo_movies set tmdb_id = 656908 where title = 'Ramayana: Part 1' and tmdb_id is null
  and not exists (select 1 from public.bo_movies where tmdb_id = 656908);

delete from public.bo_talk;
insert into public.bo_talk (tmdb_id, title, talk, worth, worth_why, sources, as_of) values
  (1402181, 'Scene',
   'Mostly positive. People love Suriya in a fun, quirky cop role and call Naslen a stylish villain. Critics mostly liked it too. Common complaints: a slow first half, and some jokes that fall flat.',
   'go', 'Good word of mouth and a fun big-screen crowd film.',
   '[{"name":"Sacnilk review roundup","url":"https://www.sacnilk.com/reviews/Scene_2026_Review-of-Reviews"},{"name":"Koimoi (X reactions)","url":"https://www.koimoi.com/south-indian-cinema/scene-x-review-experimental-fantastic-face-off-unexpected-cameos-netizens-react-to-suriyas-quirky-crime-drama/"},{"name":"Deccan Herald","url":"https://www.deccanherald.com/entertainment/scene-movie-review-suriya-is-compelling-in-average-cop-drama-4210460"},{"name":"Gulte (2.5/5)","url":"https://www.gulte.com/moviereviews/440229/scene-movie-review"}]',
   '2026-11-27'),
  (1496785, 'Aadarsha Kutumbam House No: 47 - AK47',
   'Mixed. Fans enjoy Venkatesh and some of the comedy, but many say the second half is weak and it is not the classic Trivikram entertainer they hoped for. It got trolled a lot on social media. Most call it a one-time family watch.',
   'maybe', 'Fine for a family outing if you keep expectations low.',
   '[{"name":"Deccan Chronicle","url":"https://www.deccanchronicle.com/amp/entertainment/tollywood/aadarsha-kutumbam-mercilessly-trolled-targeting-trivikram-and-thaman-2000773"},{"name":"OneIndia","url":"https://www.oneindia.com/entertainment/aadarsha-kutumbam-movie-review-whats-good-whats-bad-in-ak-47-8245745.html"},{"name":"Gulte (2.5/5)","url":"https://www.gulte.com/moviereviews/438846/aadarsha-kutumbam-movie-review"},{"name":"M9 (2.5/5)","url":"https://www.m9.news/reviews/aadarsha-kutumbam-ak-47-movie-review/"}]',
   '2026-11-27'),
  (656908, 'Ramayana: Rise of a Legend',
   'Split. Huge praise for the visuals and scale, and Yash as Ravana is the big talking point. Others say it picks spectacle over emotion, question the music and pacing, and feel parts of the second half drag.',
   'go', 'Built for the biggest screen you can find (IMAX if possible), even if the story does not land for everyone.',
   '[{"name":"Onmanorama","url":"https://www.onmanorama.com/entertainment/entertainment-news/2026/10/29/ramayana-movie-mixed-reactions-world-premiere-ranbir-sai-pallavi-yash.html"},{"name":"Esquire India (X reactions)","url":"https://www.esquireindia.co.in/entertainment/at-the-movies/ramayana-twitter-review-ranbir-kapoor-and-yash-win-praise-as-viewers-call-it-a-phenomenal-spectacle"},{"name":"LeisureByte (X reactions)","url":"https://leisurebyte.com/ramayana-rise-of-a-legend-review-on-x/"},{"name":"Siasat (X reactions)","url":"https://www.siasat.com/ramayana-x-review-yash-gets-all-love-ranbir-kapoor-gets-flak-3569996/"}]',
   '2026-11-27'),
  (1384528, 'O.M: Operation Mole',
   'Early talk is positive: people like the action, the emotional parts and the big cast (Dhanush, Mammootty, Sai Pallavi). It is long — nearly 3 hours. Fans and trade accounts on X and Instagram say it crossed ₹100 Cr worldwide in its first week.',
   'go', 'Strong early talk and a big-screen action film.',
   '[{"name":"Filmibeat (early review)","url":"https://www.filmibeat.com/tamil/news/2026/om-early-review-dhanush-mammootty-sai-pallavi-film-gets-positive-early-response-538583.html"},{"name":"Outlook India","url":"https://www.outlookindia.com/art-entertainment/dhanushs-om-gets-ua-6-am-tamil-nadu-shows-actor-thanks-cm-vijay"},{"name":"ThePrint (X)","url":"https://x.com/ThePrintIndia/status/2125911322961613263"}]',
   '2026-11-27');
