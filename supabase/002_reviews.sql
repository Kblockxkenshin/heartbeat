-- =====================================================================
-- Heartbeat · Written reviews
-- Run AFTER 001_foundation.sql. Paste into Supabase → SQL Editor → Run.
-- Safe to run again.
--
-- How it stays safe:
--  * The app can't write review tables directly. It calls server functions
--    (post_review, edit_review, toggle_vote, add_comment, report_review ...).
--  * Every review is checked on the server (quality score, spam, links, hate,
--    harassment, gibberish, copy-paste, filler, rating mismatch, spoilers).
--  * XP, helpful counts and vote-ring detection are done on the server.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.reviews (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references auth.users on delete cascade,
  title_key        text not null check (title_key ~ '^(movie|tv):[0-9]{1,9}$'),
  headline         text check (char_length(headline) <= 120),
  body             text not null check (char_length(body) between 20 and 5000),
  start_note       text check (char_length(start_note)  <= 500),
  middle_note      text check (char_length(middle_note) <= 500),
  ending_note      text check (char_length(ending_note) <= 500),
  tags             text[] not null default '{}',
  has_spoilers     boolean not null default false,
  spoiler_ranges   jsonb not null default '[]',
  is_rewatch       boolean not null default false,
  watch_no         smallint not null default 1,
  watched_on       date,
  privacy          text not null default 'public' check (privacy in ('public','friends','private')),
  start_h          smallint not null check (start_h  between 1 and 5),
  middle_h         smallint not null check (middle_h between 1 and 5),
  end_h            smallint not null check (end_h    between 1 and 5),
  overall          numeric(2,1) not null,
  ai_quality_score smallint not null default 0,
  ai_status        text not null default 'ok' check (ai_status in ('ok','tips','held')),
  ai_reasons       text[] not null default '{}',
  helpful_count    int not null default 0,
  like_count       int not null default 0,
  comment_count    int not null default 0,
  report_count     int not null default 0,
  hidden           boolean not null default false,   -- held for a moderator
  edited           boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- One main review per title per person (rewatch reviews are extra)
create unique index if not exists reviews_one_main on public.reviews (user_id, title_key) where not is_rewatch;
create index if not exists reviews_title_idx on public.reviews (title_key, helpful_count desc, created_at desc);
create index if not exists reviews_user_idx on public.reviews (user_id, created_at desc);

create table if not exists public.review_votes (
  user_id    uuid not null references auth.users on delete cascade,
  review_id  bigint not null references public.reviews on delete cascade,
  kind       text not null check (kind in ('helpful','like')),
  counted    boolean not null default true,      -- false = ignored (vote ring)
  created_at timestamptz not null default now(),
  primary key (user_id, review_id, kind)
);
create index if not exists votes_review_idx on public.review_votes (review_id);

create table if not exists public.review_comments (
  id         bigint generated always as identity primary key,
  review_id  bigint not null references public.reviews on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  parent_id  bigint references public.review_comments on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  hidden     boolean not null default false,
  report_count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists comments_review_idx on public.review_comments (review_id, created_at);

create table if not exists public.review_reports (
  id          bigint generated always as identity primary key,
  reporter    uuid not null references auth.users on delete cascade,
  review_id   bigint references public.reviews on delete cascade,
  comment_id  bigint references public.review_comments on delete cascade,
  reason      text not null check (reason in ('spam','spoilers','hate','harassment','other')),
  note        text check (char_length(note) <= 300),
  status      text not null default 'open' check (status in ('open','kept','removed')),
  created_at  timestamptz not null default now(),
  check (review_id is not null or comment_id is not null)
);
create unique index if not exists reports_once on public.review_reports (reporter, coalesce(review_id, 0), coalesce(comment_id, 0));

create table if not exists public.review_drafts (
  user_id    uuid not null references auth.users on delete cascade,
  title_key  text not null check (title_key ~ '^(movie|tv):[0-9]{1,9}$'),
  data       jsonb not null check (octet_length(data::text) < 24000),
  updated_at timestamptz not null default now(),
  primary key (user_id, title_key)
);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
-- Part 1 (friends) will replace this. Until then nobody is a friend.
create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable as $$ select false $$;

-- Has this person confirmed their email (or signed in with Google)?
create or replace function public.is_verified() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null)
$$;

-- Can the signed-in person see this review?
create or replace function public.can_see_review(r public.reviews) returns boolean
language sql stable security definer set search_path = public as $$
  select r.user_id = auth.uid()
      or (not r.hidden and r.ai_status <> 'held'
          and (r.privacy = 'public' or (r.privacy = 'friends' and auth.uid() is not null and are_friends(auth.uid(), r.user_id))))
$$;

-- Clean user text: remove HTML tags and odd control characters, trim, squash blank lines.
create or replace function public._clean(t text) returns text
language sql immutable as $$
  select nullif(btrim(regexp_replace(regexp_replace(regexp_replace(coalesce(t, ''),
    '<[^>]*>', '', 'g'),                         -- no HTML
    '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'),  -- no control chars
    '\n{3,}', E'\n\n', 'g')), '')
$$;

create or replace function public._norm(t text) returns text
language sql immutable as $$ select regexp_replace(lower(coalesce(t,'')), '[^a-z0-9]+', '', 'g') $$;

-- Allowed quick tags
create or replace function public._tags_ok(t text[]) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(t, '{}')) x
  where x = any (array['Great acting','Slow start','Amazing ending','Rewatchable','Cried 😭','Mind-blown 🤯',
    'Funny','Scary','Beautiful visuals','Great music','Plot twist','Weak ending','Too long','Comfort watch','Overrated','Underrated'])
$$;

-- ---------------------------------------------------------------------
-- The review check ("AI check"). Rules today; a real AI model can be added
-- later without changing the app. Returns:
--   { block: text|null, score: 0..100, status, reasons[], tips[], spoilers[] }
-- ---------------------------------------------------------------------
create or replace function public.check_review_text(
  p_body text, p_headline text, p_start text, p_middle text, p_end text,
  p_s int, p_m int, p_e int, p_uid uuid, p_title_key text, p_review_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  b text := coalesce(p_body, '');
  all_text text := lower(concat_ws(' ', p_headline, p_body, p_start, p_middle, p_end));
  words text[]; nwords int; uniq int; score int := 0; reasons text[] := '{}'; tips text[] := '{}';
  spoilers text[] := '{}'; sent text; overall numeric; letters int; vowels int; filler int := 0;
  block text := null; status text := 'ok'; why boolean;
begin
  words := regexp_split_to_array(btrim(regexp_replace(lower(b), '[^a-z0-9'' ]+', ' ', 'g')), '\s+');
  nwords := coalesce(array_length(array_remove(words, ''), 1), 0);
  select count(distinct w) into uniq from unnest(words) w where w <> '';
  overall := round(((p_s + p_m + p_e * 2)::numeric / 4) * 2) / 2;

  -- 1) Things that break the rules (the review is not posted)
  if all_text ~ '(https?://|www\.|\m[a-z0-9-]+\.(com|net|org|io|xyz|ru|ly|gg|link|shop)\M)' then
    block := 'Links aren''t allowed in reviews. Please remove them.';
  elsif all_text ~ '(promo code|discount code|buy now|free followers|follow me on|dm me|whatsapp|telegram|onlyfans|crypto|bitcoin|earn \$|make money|click here|subscribe to my)' then
    block := 'This looks like an ad or spam. Reviews are only about the movie or show.';
  elsif all_text ~ '(kill yourself|\mkys\M|go die|you should die|i will kill you|hope you die)' then
    block := 'Please be kind. Harassment isn''t allowed.';
  elsif all_text ~ '(\mnudes?\M|\mporn|\msex video|\mxxx\M|send pics)' then
    block := 'Sexual content isn''t allowed in reviews.';
  elsif all_text ~ '(\m(subhuman|vermin)\M.*\m(people|race|religion|women|men)\M|\mgo back to your country\M)' then
    block := 'Hate speech isn''t allowed.';
  end if;

  -- Gibberish: long runs of the same letter, too few vowels, or barely any real words.
  if block is null then
    letters := length(regexp_replace(lower(b), '[^a-z]', '', 'g'));
    vowels  := length(regexp_replace(lower(b), '[^aeiouy]', '', 'g'));
    if b ~ '(.)\1{6,}' or (letters > 15 and vowels::numeric / letters < 0.18)
       or (nwords >= 6 and uniq::numeric / nwords < 0.25) then
      block := 'This looks like random letters. Tell people what you thought!';
    end if;
  end if;

  -- Copy-paste: the same text already exists in another review.
  if block is null and length(_norm(b)) >= 40 and exists (
      select 1 from reviews r where _norm(r.body) = _norm(b) and r.id is distinct from p_review_id
        and (r.user_id <> p_uid or r.title_key <> p_title_key)) then
    block := 'This review looks copied. Please write your own words.';
  end if;

  -- 2) Quality score (0–100)
  score := least(40, (nwords * 40) / 80);                                       -- length
  why := all_text ~ '(because|since|\mso\M|the reason|made me|felt|feel|how|why|which|but|although|while)';
  if why then score := score + 20; end if;                                       -- explains why
  if uniq >= 15 then score := score + 10; end if;                                -- varied words
  if coalesce(p_start,'') <> '' or coalesce(p_middle,'') <> '' or coalesce(p_end,'') <> '' then score := score + 10; end if;
  if all_text ~ '(acting|actor|actress|cast|story|plot|ending|start|middle|pacing|music|score|visual|scene|character|dialogue|script|director|episode|season|twist|cinematograph|effects)' then
    score := score + 15;                                                         -- talks about specifics
  end if;
  if nwords >= 8 and all_text !~ '^\s*(good|great|bad|nice|ok|okay|awesome|amazing|boring|cool|fine)\s+(movie|show|film|series)[.! ]*$' then
    score := score + 5;
  else
    score := least(score, 15);  -- "good movie" style
  end if;

  -- AI-style filler
  select count(*) into filler from unnest(array['as an ai','a testament to','delve','tapestry','rollercoaster of emotions',
    'cinematic experience','in conclusion','masterclass in','resonates deeply','thought-provoking journey','tour de force',
    'leaves a lasting impression','a must-watch for','all in all']) f where all_text like '%' || f || '%';
  if filler >= 3 then
    score := score - 25; reasons := reasons || 'ai_filler'::text;
    tips := tips || 'This sounds a bit like a template. Use your own words to earn full XP!'::text;
  end if;
  score := greatest(0, least(100, score));

  -- 3) Rating mismatch (posted, but flagged)
  if overall <= 2 and all_text ~ '(best (movie|show|film|series) ever|masterpiece|loved it|10/10|perfect|amazing|incredible)' and all_text !~ '(not|isn''t|wasn''t|never)' then
    reasons := reasons || 'rating_mismatch'::text;
    tips := tips || 'Your words sound happy but your rating is low. Did you mean to change your hearts?'::text;
  elsif overall >= 4.5 and all_text ~ '(worst|hated it|terrible|awful|waste of time|garbage|trash)' then
    reasons := reasons || 'rating_mismatch'::text;
    tips := tips || 'Your words sound unhappy but your rating is high. Did you mean to change your hearts?'::text;
  end if;

  -- Friendly tips
  if not why then tips := tips || 'Add why you felt that way to earn full XP!'::text; end if;
  if nwords < 25 then tips := tips || 'A few more sentences will help people decide.'::text; end if;
  if coalesce(p_end,'') = '' and (p_e >= 5 or p_e <= 2) then
    tips := tips || (case when p_e >= 5 then 'Add why the ending worked for you!' else 'Add what went wrong with the ending!' end)::text;
  end if;

  -- 4) Spoilers: sentences that probably give things away (not already hidden)
  for sent in select s from regexp_split_to_table(regexp_replace(b, '\|\|[^|]*\|\|', ' ', 'g'), '(?<=[.!?\n])\s+') s loop
    if lower(sent) ~ '(\mdies\M|\mdied\M|is killed|gets killed|\mkills\M|turns out|the twist|twist is|in the end|at the end|the ending (is|was) where|the killer|reveals? that|was dead|is dead|was actually|is actually|secretly|final episode|last episode|ends with)' then
      spoilers := spoilers || btrim(sent);
    end if;
  end loop;

  status := case when array_length(tips, 1) > 0 or array_length(reasons, 1) > 0 then 'tips' else 'ok' end;
  return jsonb_build_object('block', block, 'score', score, 'status', status, 'reasons', to_jsonb(reasons),
    'tips', to_jsonb(tips), 'spoilers', to_jsonb(spoilers), 'xp', case when score >= 60 then 20 when score >= 35 then 10 else 3 end);
end $$;

-- Where are the ||spoiler|| parts? Returns [[start, end], ...] as character offsets.
create or replace function public._spoiler_ranges(b text) returns jsonb
language plpgsql immutable as $$
declare res jsonb := '[]'; pos int := 1; s int; e int;
begin
  loop
    s := strpos(substr(b, pos), '||'); exit when s = 0; s := pos + s - 1;
    e := strpos(substr(b, s + 2), '||'); exit when e = 0; e := s + 2 + e - 1;
    res := res || jsonb_build_array(jsonb_build_array(s - 1, e + 1));
    pos := e + 2;
  end loop;
  return res;
end $$;

-- ---------------------------------------------------------------------
-- Server functions the app calls
-- ---------------------------------------------------------------------

-- Check before posting (shows tips; nothing is saved).
create or replace function public.precheck_review(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Please sign in first.'; end if;
  return check_review_text(_clean(p->>'body'), _clean(p->>'headline'), _clean(p->>'start_note'), _clean(p->>'middle_note'), _clean(p->>'ending_note'),
    coalesce((p->>'start_h')::int, 3), coalesce((p->>'middle_h')::int, 3), coalesce((p->>'end_h')::int, 3), uid, p->>'title_key', nullif(p->>'id','')::bigint);
end $$;

create or replace function public.post_review(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); k text := p->>'title_key';
  b text := _clean(p->>'body'); hl text := _clean(p->>'headline');
  sn text := _clean(p->>'start_note'); mn text := _clean(p->>'middle_note'); en text := _clean(p->>'ending_note');
  s int := (p->>'start_h')::int; m int := (p->>'middle_h')::int; e int := (p->>'end_h')::int;
  rew boolean := coalesce((p->>'is_rewatch')::boolean, false); priv text := coalesce(p->>'privacy', 'public');
  chk jsonb; n int; wn int; rid bigint; xp int; existing bigint;
begin
  if uid is null then raise exception 'Please sign in first.'; end if;
  if not is_member() then raise exception 'Please finish setting up your account.'; end if;
  if k is null or k !~ '^(movie|tv):[0-9]{1,9}$' then raise exception 'Unknown title.'; end if;
  if s is null or m is null or e is null or least(s,m,e) < 1 or greatest(s,m,e) > 5 then raise exception 'Please rate the Start, Middle and Ending first.'; end if;
  if priv not in ('public','friends','private') then priv := 'public'; end if;
  if not is_verified() then priv := 'private'; end if;              -- unverified accounts: only me
  if char_length(coalesce(b,'')) < 20 then raise exception 'Reviews need at least 20 characters.'; end if;
  if char_length(b) > 5000 then raise exception 'Reviews can be up to 5,000 characters.'; end if;

  -- Rate limit: 20 reviews per hour
  select count(*) into n from reviews where user_id = uid and created_at > now() - interval '1 hour';
  if n >= 20 then
    insert into security_events (user_id, kind, detail) values (uid, 'rate_limit', '{"table":"reviews"}');
    raise exception 'You''ve posted a lot of reviews this hour. Take a little break and try again soon!';
  end if;

  if not rew then
    select id into existing from reviews where user_id = uid and title_key = k and not is_rewatch;
    if existing is not null then raise exception 'You already reviewed this. Edit it, or post it as a rewatch.' using hint = existing::text; end if;
  end if;

  chk := check_review_text(b, hl, sn, mn, en, s, m, e, uid, k, null);
  if chk->>'block' is not null then
    insert into security_events (user_id, kind, detail) values (uid, 'review_blocked', jsonb_build_object('title', k, 'why', chk->>'block'));
    raise exception '%', chk->>'block';
  end if;

  select coalesce(max(watch_no), 0) + 1 into wn from reviews where user_id = uid and title_key = k;
  if not rew then wn := 1; end if;

  -- The review also saves (or updates) the journey rating.
  insert into ratings (user_id, title_key, start_h, middle_h, end_h) values (uid, k, s, m, e)
    on conflict (user_id, title_key) do update set start_h = excluded.start_h, middle_h = excluded.middle_h, end_h = excluded.end_h;

  insert into reviews (user_id, title_key, headline, body, start_note, middle_note, ending_note, tags,
      has_spoilers, spoiler_ranges, is_rewatch, watch_no, watched_on, privacy, start_h, middle_h, end_h, overall,
      ai_quality_score, ai_status, ai_reasons)
    values (uid, k, hl, b, sn, mn, en, (_tags_ok(array(select jsonb_array_elements_text(coalesce(p->'tags','[]')))))[1:8],
      coalesce((p->>'has_spoilers')::boolean, false) or b like '%||%||%', _spoiler_ranges(b), rew, wn,
      case when (p->>'watched_on') ~ '^\d{4}-\d{2}-\d{2}$' and (p->>'watched_on')::date <= current_date then (p->>'watched_on')::date end,
      priv, s, m, e, round(((s + m + e * 2)::numeric / 4) * 2) / 2,
      (chk->>'score')::int, chk->>'status', array(select jsonb_array_elements_text(chk->'reasons')))
    returning id into rid;

  -- XP once per title per watch (deleting and re-posting doesn't give more)
  xp := _award_xp(uid, 'review', k || ':' || wn, (chk->>'xp')::int);
  perform _touch_streak(uid);
  delete from review_drafts where user_id = uid and title_key = k;
  return jsonb_build_object('id', rid, 'xp', xp, 'score', chk->'score', 'tips', chk->'tips', 'privacy', priv);
end $$;

create or replace function public.edit_review(p_id bigint, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); r reviews; chk jsonb; n int;
  b text := _clean(p->>'body'); hl text := _clean(p->>'headline');
  sn text := _clean(p->>'start_note'); mn text := _clean(p->>'middle_note'); en text := _clean(p->>'ending_note');
  priv text := coalesce(p->>'privacy', 'public');
begin
  select * into r from reviews where id = p_id;
  if r.id is null or r.user_id is distinct from uid then raise exception 'You can only edit your own reviews.'; end if;
  if char_length(coalesce(b,'')) < 20 then raise exception 'Reviews need at least 20 characters.'; end if;
  if char_length(b) > 5000 then raise exception 'Reviews can be up to 5,000 characters.'; end if;
  if priv not in ('public','friends','private') then priv := 'public'; end if;
  if not is_verified() then priv := 'private'; end if;
  select count(*) into n from security_events where user_id = uid and kind = 'review_edit' and created_at > now() - interval '1 hour';
  if n >= 30 then raise exception 'Too many edits this hour. Try again soon!'; end if;
  chk := check_review_text(b, hl, sn, mn, en, r.start_h, r.middle_h, r.end_h, uid, r.title_key, r.id);
  if chk->>'block' is not null then raise exception '%', chk->>'block'; end if;
  update reviews set headline = hl, body = b, start_note = sn, middle_note = mn, ending_note = en,
    tags = (_tags_ok(array(select jsonb_array_elements_text(coalesce(p->'tags','[]')))))[1:8],
    has_spoilers = coalesce((p->>'has_spoilers')::boolean, false) or b like '%||%||%', spoiler_ranges = _spoiler_ranges(b),
    watched_on = case when (p->>'watched_on') ~ '^\d{4}-\d{2}-\d{2}$' and (p->>'watched_on')::date <= current_date then (p->>'watched_on')::date end,
    privacy = priv, ai_quality_score = (chk->>'score')::int, ai_status = case when hidden then ai_status else chk->>'status' end,
    ai_reasons = array(select jsonb_array_elements_text(chk->'reasons')), edited = true, updated_at = now()
  where id = p_id;
  insert into security_events (user_id, kind, detail) values (uid, 'review_edit', jsonb_build_object('id', p_id));
  return jsonb_build_object('id', p_id, 'score', chk->'score', 'tips', chk->'tips', 'privacy', priv);
end $$;

create or replace function public.delete_review(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from reviews where id = p_id and user_id = auth.uid();
  if not found then raise exception 'You can only delete your own reviews.'; end if;
end $$;

-- Helpful 👍 or like ♥ (press again to undo). Returns the new counts.
create or replace function public.toggle_vote(p_review bigint, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r reviews; had boolean; ring boolean := false; a int; b int; today_xp int;
begin
  if uid is null then raise exception 'Please sign in first.'; end if;
  if not is_member() then raise exception 'Please finish setting up your account.'; end if;
  if p_kind not in ('helpful','like') then raise exception 'Unknown vote.'; end if;
  select * into r from reviews where id = p_review;
  if r.id is null or not can_see_review(r) then raise exception 'Review not found.'; end if;
  if r.user_id = uid then raise exception 'You can''t vote on your own review.'; end if;
  delete from review_votes where user_id = uid and review_id = p_review and kind = p_kind;
  had := found;
  if not had then
    -- Vote ring: these two people keep marking each other helpful (3+ each way in 7 days)
    if p_kind = 'helpful' then
      select count(*) into a from review_votes v join reviews x on x.id = v.review_id
        where v.user_id = uid and x.user_id = r.user_id and v.kind = 'helpful' and v.created_at > now() - interval '7 days';
      select count(*) into b from review_votes v join reviews x on x.id = v.review_id
        where v.user_id = r.user_id and x.user_id = uid and v.kind = 'helpful' and v.created_at > now() - interval '7 days';
      ring := a >= 3 and b >= 3;
      if ring then insert into security_events (user_id, kind, detail) values (uid, 'vote_ring', jsonb_build_object('with', r.user_id, 'review', p_review)); end if;
    end if;
    insert into review_votes (user_id, review_id, kind, counted) values (uid, p_review, p_kind, not ring);
    -- +3 XP to the writer for each counted helpful vote, max 30 a day
    if p_kind = 'helpful' and not ring then
      select coalesce(sum(amount), 0) into today_xp from xp_events where user_id = r.user_id and kind = 'helpful' and created_at > date_trunc('day', now());
      if today_xp < 30 then perform _award_xp(r.user_id, 'helpful', p_review || ':' || uid, 3); end if;
    end if;
  end if;
  update reviews set
    helpful_count = (select count(*) from review_votes where review_id = p_review and kind = 'helpful' and counted),
    like_count    = (select count(*) from review_votes where review_id = p_review and kind = 'like' and counted)
  where id = p_review returning * into r;
  return jsonb_build_object('on', not had, 'helpful', r.helpful_count, 'likes', r.like_count);
end $$;

create or replace function public.add_comment(p_review bigint, p_body text, p_parent bigint default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r reviews; b text := _clean(p_body); n int; cid bigint; par review_comments;
begin
  if uid is null then raise exception 'Please sign in first.'; end if;
  if not is_member() then raise exception 'Please finish setting up your account.'; end if;
  if not is_verified() then raise exception 'Please confirm your email before commenting.'; end if;
  select * into r from reviews where id = p_review;
  if r.id is null or not can_see_review(r) then raise exception 'Review not found.'; end if;
  if b is null then raise exception 'Write something first.'; end if;
  if char_length(b) > 1000 then raise exception 'Comments can be up to 1,000 characters.'; end if;
  if p_parent is not null then
    select * into par from review_comments where id = p_parent;
    if par.id is null or par.review_id <> p_review then raise exception 'Reply not found.'; end if;
    if par.parent_id is not null then p_parent := par.parent_id; end if;   -- replies stay one level deep
  end if;
  select count(*) into n from review_comments where user_id = uid and created_at > now() - interval '1 hour';
  if n >= 30 then raise exception 'Lots of comments this hour! Take a short break.'; end if;
  if lower(b) ~ '(https?://|www\.|promo code|buy now|kill yourself|\mkys\M|go die|onlyfans|\mporn|send pics|nudes?\M)' then
    insert into security_events (user_id, kind, detail) values (uid, 'comment_blocked', jsonb_build_object('review', p_review));
    raise exception 'That comment breaks the community rules (links, spam or harassment).';
  end if;
  insert into review_comments (review_id, user_id, parent_id, body) values (p_review, uid, p_parent, b) returning id into cid;
  update reviews set comment_count = (select count(*) from review_comments where review_id = p_review and not hidden) where id = p_review;
  return cid;
end $$;

create or replace function public.delete_comment(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare rid bigint;
begin
  delete from review_comments where id = p_id and user_id = auth.uid() returning review_id into rid;
  if rid is null then raise exception 'You can only delete your own comments.'; end if;
  update reviews set comment_count = (select count(*) from review_comments where review_id = rid and not hidden) where id = rid;
end $$;

-- Report a review or comment. 3 different reports = hidden until a moderator looks.
create or replace function public.report_review(p_review bigint, p_comment bigint, p_reason text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'Please sign in first.'; end if;
  if p_reason not in ('spam','spoilers','hate','harassment','other') then raise exception 'Pick a reason.'; end if;
  select count(*) into n from review_reports where reporter = uid and created_at > now() - interval '1 hour';
  if n >= 20 then raise exception 'Thanks! You''ve sent a lot of reports. Our team will look at them.'; end if;
  insert into review_reports (reporter, review_id, comment_id, reason, note)
    values (uid, case when p_comment is null then p_review end, p_comment, p_reason, left(_clean(p_note), 300))
    on conflict do nothing;
  if p_comment is not null then
    update review_comments set report_count = (select count(*) from review_reports where comment_id = p_comment),
      hidden = hidden or (select count(*) from review_reports where comment_id = p_comment) >= 3 where id = p_comment;
  else
    update reviews set report_count = (select count(*) from review_reports where review_id = p_review),
      hidden = hidden or (select count(*) from review_reports where review_id = p_review) >= 3 where id = p_review;
  end if;
end $$;

-- Reviews for one title. sort: helpful | new | friends | critics. Optional overall rating filter.
create or replace function public.list_reviews(p_title text, p_sort text default 'helpful', p_min numeric default 0,
  p_max numeric default 5, p_limit int default 20, p_offset int default 0) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by ord), '[]') from (
    select row_number() over (order by
        case when p_sort = 'friends' and (r.user_id = auth.uid() or are_friends(auth.uid(), r.user_id)) then 0 else 1 end,
        case when p_sort = 'critics' then case s.rank when 'Legend' then 0 when 'Director''s Cut' then 1 when 'Top Critic' then 2 when 'Critic' then 3 else 9 end end,
        case when p_sort = 'new' then extract(epoch from r.created_at) end desc nulls last,
        r.helpful_count desc, r.ai_quality_score desc, r.created_at desc) ord,
      jsonb_build_object('id', r.id, 'user_id', r.user_id, 'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
        'rank', s.rank, 'top_critic', s.rank in ('Top Critic','Director''s Cut','Legend'),
        'friend', are_friends(auth.uid(), r.user_id), 'mine', r.user_id = auth.uid(),
        'headline', r.headline, 'body', r.body, 'start_note', r.start_note, 'middle_note', r.middle_note, 'ending_note', r.ending_note,
        'tags', r.tags, 'has_spoilers', r.has_spoilers, 'is_rewatch', r.is_rewatch, 'watch_no', r.watch_no, 'watched_on', r.watched_on,
        'privacy', r.privacy, 'start_h', r.start_h, 'middle_h', r.middle_h, 'end_h', r.end_h, 'overall', r.overall,
        'helpful', r.helpful_count, 'likes', r.like_count, 'comments', r.comment_count, 'edited', r.edited,
        'quality', r.ai_quality_score, 'flags', r.ai_reasons, 'hidden', r.hidden, 'created_at', r.created_at, 'updated_at', r.updated_at,
        'my_helpful', exists (select 1 from review_votes v where v.review_id = r.id and v.user_id = auth.uid() and v.kind = 'helpful'),
        'my_like', exists (select 1 from review_votes v where v.review_id = r.id and v.user_id = auth.uid() and v.kind = 'like')) x
    from reviews r join profiles p on p.id = r.user_id join user_stats s on s.user_id = r.user_id
    where r.title_key = p_title and can_see_review(r) and r.overall between p_min and p_max
    order by 1 limit least(p_limit, 50) offset p_offset
  ) t
$$;

-- My own reviews (search + sort)
create or replace function public.my_reviews(p_q text default null, p_sort text default 'new') returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(r) - 'spoiler_ranges' order by
      case when p_sort = 'helpful' then r.helpful_count end desc nulls last,
      case when p_sort = 'rating' then r.overall end desc nulls last,
      r.created_at desc), '[]')
  from reviews r where r.user_id = auth.uid()
    and (p_q is null or p_q = '' or r.body ilike '%' || p_q || '%' or r.headline ilike '%' || p_q || '%')
$$;

create or replace function public.list_comments(p_review bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'parent_id', c.parent_id, 'body', c.body, 'created_at', c.created_at,
      'username', p.username, 'rank', s.rank, 'mine', c.user_id = auth.uid()) order by coalesce(c.parent_id, c.id), c.id), '[]')
  from review_comments c join profiles p on p.id = c.user_id join user_stats s on s.user_id = c.user_id
  join reviews r on r.id = c.review_id
  where c.review_id = p_review and not c.hidden and can_see_review(r)
$$;

-- ---------------------------------------------------------------------
-- Row Level Security: reads go through the rules above, writes only via functions.
-- ---------------------------------------------------------------------
alter table public.reviews         enable row level security;
alter table public.review_votes    enable row level security;
alter table public.review_comments enable row level security;
alter table public.review_reports  enable row level security;
alter table public.review_drafts   enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
    and tablename in ('reviews','review_votes','review_comments','review_reports','review_drafts')
  loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
end $$;

create policy "reviews visible" on public.reviews for select using (public.can_see_review(reviews));
create policy "votes own read" on public.review_votes for select using (auth.uid() = user_id);
create policy "comments visible" on public.review_comments for select
  using (not hidden and exists (select 1 from public.reviews r where r.id = review_id and public.can_see_review(r)));
create policy "reports own read" on public.review_reports for select using (auth.uid() = reporter);
create policy "drafts owner all" on public.review_drafts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id and public.is_member());

grant select on public.reviews, public.review_comments to anon, authenticated;
grant select on public.review_votes, public.review_reports to authenticated;
grant select, insert, update, delete on public.review_drafts to authenticated;
revoke insert, update, delete on public.reviews, public.review_votes, public.review_comments, public.review_reports from anon, authenticated;

revoke execute on function public.check_review_text(text,text,text,text,text,int,int,int,uuid,text,bigint) from public, anon, authenticated;
revoke execute on function public.precheck_review(jsonb), public.post_review(jsonb), public.edit_review(bigint,jsonb), public.delete_review(bigint),
  public.toggle_vote(bigint,text), public.add_comment(bigint,text,bigint), public.delete_comment(bigint),
  public.report_review(bigint,bigint,text,text), public.my_reviews(text,text) from public, anon;
grant execute on function public.precheck_review(jsonb), public.post_review(jsonb), public.edit_review(bigint,jsonb), public.delete_review(bigint),
  public.toggle_vote(bigint,text), public.add_comment(bigint,text,bigint), public.delete_comment(bigint),
  public.report_review(bigint,bigint,text,text), public.my_reviews(text,text) to authenticated;
grant execute on function public.list_reviews(text,text,numeric,numeric,int,int), public.list_comments(bigint) to anon, authenticated;
