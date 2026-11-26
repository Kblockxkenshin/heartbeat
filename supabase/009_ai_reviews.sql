-- =====================================================================
-- Heartbeat · Part 7: AI review check (quality + safety)
-- Run AFTER 001–008. Safe to run again.
--
-- How it works:
--  1. The fast rule check (002) still runs first and blocks clear rule breaks right away.
--  2. When the AI check is on, a new or changed review waits as "pending": only the writer sees it,
--     and it earns no XP yet.
--  3. The app calls /api/review-check. That server function asks Claude about the review and saves
--     the answer with ai_apply_review (server key only, the app can't call it):
--       approve           → public, XP by quality (20 / 10 / 3), spoiler sentences hidden
--       block (sure)      → "blocked", the writer sees why and can edit or appeal
--       block (unsure),
--       unsure, or likely
--       paid / fake       → "held" for a human moderator
--     A review whose rating was held for review-bombing (Part 6) is held too.
--  4. If the AI can't be reached, the rule check decides (so reviews never get stuck).
-- The AI check turns itself on when the server has ANTHROPIC_API_KEY and is used, and off
-- again 2 days after it stops being used.
-- =====================================================================

alter table public.reviews drop constraint if exists reviews_ai_status_check;
alter table public.reviews add constraint reviews_ai_status_check check (ai_status in ('pending','ok','tips','held','blocked'));
alter table public.reviews add column if not exists ai_tips       text[] not null default '{}';
alter table public.reviews add column if not exists ai_note       text;            -- shown to the writer (why held / blocked)
alter table public.reviews add column if not exists ai_xp_due     smallint not null default 0;  -- XP from the rule check
alter table public.reviews add column if not exists ai_tries      smallint not null default 0;
alter table public.reviews add column if not exists ai_checked_at timestamptz;
alter table public.reviews add column if not exists ai_model      text;
alter table public.reviews add column if not exists ai_detail     jsonb not null default '{}'::jsonb;  -- for moderators only
alter table public.reviews add column if not exists ai_flag       boolean not null default false;     -- public, but a person should look
alter table public.reviews add column if not exists mod_by        uuid references auth.users on delete set null;
alter table public.reviews add column if not exists mod_at        timestamptz;
create index if not exists reviews_ai_pending on public.reviews (created_at) where ai_status = 'pending';
create index if not exists reviews_ai_queue on public.reviews (updated_at) where ai_status in ('held','blocked') or ai_flag;

create table if not exists public.review_appeals (
  id          bigint generated always as identity primary key,
  review_id   bigint not null unique references public.reviews on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  note        text check (char_length(note) <= 300),
  status      text not null default 'open' check (status in ('open','upheld','overturned')),
  created_at  timestamptz not null default now(),
  decided_by  uuid references auth.users on delete set null,
  decided_at  timestamptz
);
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public._ai_on() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_settings where key = 'ai_reviews' and coalesce((value->>'on')::boolean, false)
                 and updated_at > now() - interval '2 days')
$$;
create or replace function public._review_xp(score int) returns int
language sql immutable as $$ select case when score >= 60 then 20 when score >= 35 then 10 else 3 end $$;
create or replace function public._review_public(st text) returns boolean
language sql immutable as $$ select st in ('ok','tips') $$;

-- Only checked reviews are public (the writer always sees their own).
create or replace function public.can_see_review(r public.reviews) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(r.user_id = auth.uid(), false)
      or (not r.hidden and _review_public(r.ai_status) and not is_blocked(auth.uid(), r.user_id)
          and (r.privacy = 'public' or (r.privacy = 'friends' and auth.uid() is not null and are_friends(auth.uid(), r.user_id))))
$$;

-- Friends' feed: only checked reviews show up.
create or replace function public._act_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.privacy = 'private' or new.hidden or not _review_public(new.ai_status) then
    delete from activities where review_id = new.id; return null;
  end if;
  if exists (select 1 from activities where review_id = new.id) then
    update activities set vis = new.privacy, data = jsonb_build_object('o', new.overall, 'rewatch', new.is_rewatch) where review_id = new.id;
  else
    delete from activities where actor = new.user_id and kind = 'rated' and title_key = new.title_key;
    insert into activities (actor, kind, title_key, review_id, vis, data)
      values (new.user_id, 'reviewed', new.title_key, new.id, new.privacy, jsonb_build_object('o', new.overall, 'rewatch', new.is_rewatch));
  end if;
  return null;
end $$;

-- Give the review XP (once per title per watch; the XP log stops doubles).
create or replace function public._review_award(r public.reviews, score int) returns int
language sql security definer set search_path = public as $$
  select _award_xp(r.user_id, 'review', r.title_key || ':' || r.watch_no, _review_xp(score))
$$;

-- ---------------------------------------------------------------------
-- Posting and editing (same as before, plus the AI step)
-- ---------------------------------------------------------------------
create or replace function public.post_review(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid; k text := p->>'title_key';
  b text := _clean(p->>'body'); hl text := _clean(p->>'headline');
  sn text := _clean(p->>'start_note'); mn text := _clean(p->>'middle_note'); en text := _clean(p->>'ending_note');
  s int := (p->>'start_h')::int; m int := (p->>'middle_h')::int; e int := (p->>'end_h')::int;
  rew boolean := coalesce((p->>'is_rewatch')::boolean, false); priv text := coalesce(p->>'privacy', 'public');
  chk jsonb; n int; wn int; rid bigint; xp int := 0; existing bigint; st text; note text; rheld boolean; rv reviews;
begin
  uid := _need_member(false);
  if k is null or k !~ '^(movie|tv):[0-9]{1,9}$' then raise exception 'Unknown title.'; end if;
  if s is null or m is null or e is null or least(s,m,e) < 1 or greatest(s,m,e) > 5 then raise exception 'Please rate the Start, Middle and Ending first.'; end if;
  if priv not in ('public','friends','private') then priv := 'public'; end if;
  if not is_verified() then priv := 'private'; end if;              -- unverified accounts: only me
  if char_length(coalesce(b,'')) < 20 then raise exception 'Reviews need at least 20 characters.'; end if;
  if char_length(b) > 5000 then raise exception 'Reviews can be up to 5,000 characters.'; end if;

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

  insert into ratings (user_id, title_key, start_h, middle_h, end_h) values (uid, k, s, m, e)
    on conflict (user_id, title_key) do update set start_h = excluded.start_h, middle_h = excluded.middle_h, end_h = excluded.end_h;
  select held into rheld from ratings where user_id = uid and title_key = k;

  -- Review-bombing (Part 6): if the rating is held, the review waits for a person too.
  if coalesce(rheld, false) then
    st := 'held'; note := 'Lots of new accounts rated this title at the same time, so a person will check your review first.';
  elsif _ai_on() then
    st := 'pending';
  else
    st := chk->>'status';
  end if;

  insert into reviews (user_id, title_key, headline, body, start_note, middle_note, ending_note, tags,
      has_spoilers, spoiler_ranges, is_rewatch, watch_no, watched_on, privacy, start_h, middle_h, end_h, overall,
      ai_quality_score, ai_status, ai_reasons, ai_tips, ai_note, ai_xp_due)
    values (uid, k, hl, b, sn, mn, en, (_tags_ok(array(select jsonb_array_elements_text(coalesce(p->'tags','[]')))))[1:8],
      coalesce((p->>'has_spoilers')::boolean, false) or b like '%||%||%', _spoiler_ranges(b), rew, wn,
      case when (p->>'watched_on') ~ '^\d{4}-\d{2}-\d{2}$' and (p->>'watched_on')::date <= current_date then (p->>'watched_on')::date end,
      priv, s, m, e, round(((s + m + e * 2)::numeric / 4) * 2) / 2,
      (chk->>'score')::int, st, array(select jsonb_array_elements_text(chk->'reasons')),
      array(select jsonb_array_elements_text(chk->'tips')), note, (chk->>'xp')::int)
    returning * into rv;
  rid := rv.id;

  if _review_public(st) then xp := _review_award(rv, (chk->>'score')::int); end if;
  perform _touch_streak(uid);
  delete from review_drafts where user_id = uid and title_key = k;
  return jsonb_build_object('id', rid, 'xp', xp, 'score', chk->'score', 'tips', chk->'tips', 'privacy', priv,
    'status', st, 'note', note, 'xp_later', (chk->>'xp')::int);
end $$;

create or replace function public.edit_review(p_id bigint, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid; r reviews; chk jsonb; n int; st text; changed boolean;
  b text := _clean(p->>'body'); hl text := _clean(p->>'headline');
  sn text := _clean(p->>'start_note'); mn text := _clean(p->>'middle_note'); en text := _clean(p->>'ending_note');
  priv text := coalesce(p->>'privacy', 'public');
begin
  uid := _need_member(false);
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

  -- New words need a new check. (Spoiler marks and tags alone don't.)
  changed := _norm(concat_ws('|', hl, replace(b, '||', ''), sn, mn, en))
          <> _norm(concat_ws('|', r.headline, replace(r.body, '||', ''), r.start_note, r.middle_note, r.ending_note));
  st := r.ai_status;
  if changed then
    if r.ai_status = 'held' then st := 'held';                           -- a person will see the new words
    elsif _ai_on() then st := 'pending';
    else st := chk->>'status'; end if;
  end if;

  update reviews set headline = hl, body = b, start_note = sn, middle_note = mn, ending_note = en,
    tags = (_tags_ok(array(select jsonb_array_elements_text(coalesce(p->'tags','[]')))))[1:8],
    has_spoilers = coalesce((p->>'has_spoilers')::boolean, false) or b like '%||%||%', spoiler_ranges = _spoiler_ranges(b),
    watched_on = case when (p->>'watched_on') ~ '^\d{4}-\d{2}-\d{2}$' and (p->>'watched_on')::date <= current_date then (p->>'watched_on')::date end,
    privacy = priv, ai_quality_score = case when changed then (chk->>'score')::int else ai_quality_score end,
    ai_status = st,
    ai_reasons = case when changed then array(select jsonb_array_elements_text(chk->'reasons')) else ai_reasons end,
    ai_tips = case when changed then array(select jsonb_array_elements_text(chk->'tips')) else ai_tips end,
    ai_xp_due = case when changed then (chk->>'xp')::int else ai_xp_due end,
    ai_note = case when changed and st <> 'held' then null else ai_note end,
    ai_tries = case when changed then 0 else ai_tries end,
    ai_checked_at = case when changed then null else ai_checked_at end,
    ai_flag = case when changed then false else ai_flag end,
    mod_by = case when changed and st <> 'held' then null else mod_by end,
    edited = true, updated_at = now()
  where id = p_id returning * into r;
  -- A blocked review that is now fine (no AI): it goes public and earns its XP.
  if changed and _review_public(st) then perform _review_award(r, r.ai_quality_score); end if;
  insert into security_events (user_id, kind, detail) values (uid, 'review_edit', jsonb_build_object('id', p_id));
  return jsonb_build_object('id', p_id, 'score', chk->'score', 'tips', chk->'tips', 'privacy', priv, 'status', st, 'note', r.ai_note);
end $$;

-- ---------------------------------------------------------------------
-- Server side of /api/review-check (server key only)
-- ---------------------------------------------------------------------
-- The server says "the AI check works" each time it is used (p_model null = the AI key was removed: off now).
create or replace function public.ai_heartbeat(p_model text) returns void
language sql security definer set search_path = public as $$
  insert into app_settings (key, value, updated_at) values ('ai_reviews', jsonb_build_object('on', p_model is not null, 'model', left(p_model, 60)), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
$$;

-- Reviews to check now: the caller's review (p_id), plus one old pending review from anyone, so nothing stays stuck.
-- Each review gets at most 3 tries. Returns { limited } or { items: [...] } with the text and some context.
create or replace function public.ai_claim(p_user uuid, p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int; ids bigint[] := '{}'; x bigint;
begin
  select count(*) into n from security_events where user_id = p_user and kind = 'ai_check' and created_at > now() - interval '1 hour';
  if n >= 40 then return jsonb_build_object('limited', true, 'items', '[]'::jsonb); end if;
  select id into x from reviews where id = p_id and user_id = p_user and ai_tries < 3 and mod_by is null
    and (ai_status = 'pending' or (_review_public(ai_status) and ai_checked_at is null))
    for update skip locked;
  if x is not null then ids := ids || x; end if;
  select id into x from reviews where ai_status = 'pending' and ai_tries < 3 and id <> coalesce(p_id, 0)
    and created_at < now() - interval '2 minutes' and (ai_checked_at is null or ai_checked_at < now() - interval '2 minutes')
    order by created_at limit 1 for update skip locked;
  if x is not null then ids := ids || x; end if;
  if array_length(ids, 1) is null then return jsonb_build_object('items', '[]'::jsonb); end if;
  update reviews set ai_tries = ai_tries + 1, ai_checked_at = now() where id = any (ids);
  insert into security_events (user_id, kind, detail) values (p_user, 'ai_check', jsonb_build_object('ids', to_jsonb(ids)));
  return jsonb_build_object('items', (select jsonb_agg(jsonb_build_object(
      'id', r.id, 'title_key', r.title_key, 'headline', r.headline, 'body', r.body,
      'start_note', r.start_note, 'middle_note', r.middle_note, 'ending_note', r.ending_note, 'tags', r.tags,
      'start_h', r.start_h, 'middle_h', r.middle_h, 'end_h', r.end_h, 'overall', r.overall, 'is_rewatch', r.is_rewatch,
      'rules', jsonb_build_object('score', r.ai_quality_score, 'reasons', r.ai_reasons),
      'context', jsonb_build_object(
        'account_days', (select extract(day from now() - u.created_at)::int from auth.users u where u.id = r.user_id),
        'other_reviews', (select count(*) from reviews o where o.user_id = r.user_id and o.id <> r.id),
        'reviews_last_hour', (select count(*) from reviews o where o.user_id = r.user_id and o.created_at > now() - interval '1 hour'),
        'rating_held', coalesce((select held from ratings g where g.user_id = r.user_id and g.title_key = r.title_key), false),
        'linked_accounts', (select count(*) from _linked(r.user_id)),
        'open_flags', (select count(*) from account_flags f where f.user_id = r.user_id and f.status = 'open'),
        'new_account_reviews_on_title_24h', (select count(*) from reviews o join auth.users u on u.id = o.user_id
            where o.title_key = r.title_key and o.created_at > now() - interval '1 day' and u.created_at > now() - interval '7 days'))
    ) order by r.id) from reviews r where r.id = any (ids)));
end $$;

-- Save Claude's answer. p = { verdict: approve|block|unsure, category, confidence 0–1, quality 0–100,
--   rating_match: match|mismatch|unclear, spoilers: [sentences], paid_fake_risk 0–1, tip, model, why }
create or replace function public.ai_apply_review(p_id bigint, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r reviews; v text := p->>'verdict'; cat text := coalesce(p->>'category', 'none');
  conf numeric := least(greatest(coalesce((p->>'confidence')::numeric, 0), 0), 1);
  q int := least(greatest(coalesce(round((p->>'quality')::numeric)::int, 0), 0), 100);
  fake numeric := least(greatest(coalesce((p->>'paid_fake_risk')::numeric, 0), 0), 1);
  mismatch boolean := coalesce(p->>'rating_match' = 'mismatch', false);
  tip text := coalesce(left(_clean(p->>'tip'), 200), ''); st text; note text; xp int := 0;
  nb text; s text; pos int; hid int := 0; tips text[]; reasons text[];
begin
  select * into r from reviews where id = p_id for update;
  if r.id is null then raise exception 'Review not found.'; end if;
  if v not in ('approve','block','unsure') then v := 'unsure'; end if;
  -- A person already decided, or it's waiting for one: the AI doesn't change it.
  if r.mod_by is not null or r.ai_status in ('held','blocked') then
    return jsonb_build_object('id', r.id, 'status', r.ai_status, 'score', r.ai_quality_score, 'xp', 0, 'tips', to_jsonb(r.ai_tips), 'note', r.ai_note, 'hidden_spoilers', 0);
  end if;

  -- Hide spoiler sentences behind "tap to reveal" (only exact sentences from the review, not already hidden).
  nb := r.body;
  for s in select btrim(x) from jsonb_array_elements_text(coalesce(p->'spoilers', '[]'::jsonb)) x limit 8 loop
    pos := strpos(nb, s);
    if char_length(s) >= 8 and s !~ '\|\|' and pos > 0
       and (char_length(left(nb, pos - 1)) - char_length(replace(left(nb, pos - 1), '||', ''))) / 2 % 2 = 0   -- not inside ||…||
       and char_length(nb) + 4 <= 5000 then
      nb := left(nb, pos - 1) || '||' || s || '||' || substr(nb, pos + char_length(s));
      hid := hid + 1;
    end if;
  end loop;

  reasons := r.ai_reasons;
  tips := '{}';
  if tip <> '' then tips := tips || tip; end if;
  if mismatch then
    reasons := array(select distinct x from unnest(reasons || 'rating_mismatch'::text) x);
    tips := tips || (case when r.overall <= 2.5 then 'Your words sound happy but your rating is low. Did you mean to change your hearts?'
                          else 'Your words sound unhappy but your rating is high. Did you mean to change your hearts?' end)::text;
  end if;

  if v = 'block' and conf >= 0.8 and cat <> 'none' then
    st := 'blocked';
    note := case cat
      when 'spam' then 'This looks like an ad or spam. Reviews are only about the movie or show.'
      when 'gibberish' then 'This looks like random letters. Tell people what you thought!'
      when 'copied' then 'This looks copied from somewhere else. Please write it in your own words.'
      when 'ai_filler' then 'This sounds like computer-made filler. Tell people what YOU felt, in your own words.'
      when 'hate' then 'Hate speech isn''t allowed. Please keep it about the movie or show.'
      when 'harassment' then 'Please be kind. Attacking people isn''t allowed.'
      when 'sexual' then 'Sexual content isn''t allowed in reviews.'
      when 'off_topic' then 'This doesn''t seem to be about this title. Tell people what you thought of it!'
      else 'This review breaks the community rules.' end;
  elsif v <> 'approve' or fake >= 0.7 then
    st := 'held';
    note := case when fake >= 0.7 then 'This review looks a lot like paid or fake reviews, so a person will check it first.'
                 else 'Our robot wasn''t sure about this one, so a person will check it soon.' end;
  else
    st := case when array_length(tips, 1) > 0 or array_length(reasons, 1) > 0 then 'tips' else 'ok' end;
  end if;

  update reviews set body = nb, spoiler_ranges = _spoiler_ranges(nb), has_spoilers = has_spoilers or hid > 0,
    ai_status = st, ai_quality_score = q, ai_reasons = reasons, ai_tips = tips, ai_note = note, ai_flag = mismatch and _review_public(st),
    ai_model = left(p->>'model', 60), ai_checked_at = now(),
    ai_detail = jsonb_build_object('verdict', v, 'category', cat, 'confidence', conf, 'quality', q, 'rating_match', p->>'rating_match',
      'paid_fake_risk', fake, 'why', left(_clean(p->>'why'), 300), 'hidden_spoilers', hid)
  where id = p_id returning * into r;
  if _review_public(st) then xp := _review_award(r, q); end if;
  insert into security_events (user_id, kind, detail) values (r.user_id, 'ai_review', jsonb_build_object('id', r.id, 'verdict', v, 'category', cat, 'status', st));
  return jsonb_build_object('id', r.id, 'status', st, 'score', q, 'xp', xp, 'tips', to_jsonb(tips), 'note', note, 'hidden_spoilers', hid);
end $$;

-- ---------------------------------------------------------------------
-- For the writer
-- ---------------------------------------------------------------------
-- If the AI is off, or couldn't check a review (3 tries or 2 hours), the rule check decides.
create or replace function public.review_status_sync() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r reviews;
begin
  if me is null then return '[]'::jsonb; end if;
  for r in select * from reviews where user_id = me and ai_status = 'pending'
      and (not _ai_on() or (ai_tries >= 3 and ai_checked_at < now() - interval '2 minutes') or created_at < now() - interval '2 hours') for update loop
    update reviews set ai_status = case when array_length(ai_tips, 1) > 0 or array_length(ai_reasons, 1) > 0 then 'tips' else 'ok' end
      where id = r.id returning * into r;
    perform _award_xp(r.user_id, 'review', r.title_key || ':' || r.watch_no, greatest(r.ai_xp_due, 3));
  end loop;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title_key', title_key, 'status', ai_status)), '[]'::jsonb)
          from reviews where user_id = me and ai_status = 'pending');
end $$;

-- Ask a person to look again (once per review).
create or replace function public.appeal_review(p_id bigint, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r reviews; n int;
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  select * into r from reviews where id = p_id;
  if r.id is null or r.user_id <> me then raise exception 'You can only appeal your own reviews.'; end if;
  if r.ai_status not in ('blocked','held') then raise exception 'This review isn''t blocked.'; end if;
  if exists (select 1 from review_appeals where review_id = p_id) then raise exception 'You already asked for a second look. A person will check it.'; end if;
  select count(*) into n from review_appeals where user_id = me and created_at > now() - interval '1 day';
  if n >= 5 then raise exception 'You sent a lot of appeals today. Please wait for the answers.'; end if;
  insert into review_appeals (review_id, user_id, note) values (p_id, me, left(_clean(p_note), 300));
end $$;

-- My reviews, with the check status (no moderator-only details).
create or replace function public.my_reviews(p_q text default null, p_sort text default 'new') returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(r) - 'spoiler_ranges' - 'ai_detail' - 'mod_by' - 'ai_model'
      || jsonb_build_object('appeal', (select a.status from review_appeals a where a.review_id = r.id)) order by
      case when p_sort = 'helpful' then r.helpful_count end desc nulls last,
      case when p_sort = 'rating' then r.overall end desc nulls last,
      r.created_at desc), '[]')
  from reviews r where r.user_id = auth.uid()
    and (p_q is null or p_q = '' or r.body ilike '%' || p_q || '%' or r.headline ilike '%' || p_q || '%')
$$;

-- Title page list: same as before, plus the check status on MY review.
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
        'ai_status', case when r.user_id = auth.uid() then r.ai_status end,
        'ai_note', case when r.user_id = auth.uid() then r.ai_note end,
        'ai_tips', case when r.user_id = auth.uid() then to_jsonb(r.ai_tips) end,
        'appeal', case when r.user_id = auth.uid() then (select a.status from review_appeals a where a.review_id = r.id) end,
        'my_helpful', exists (select 1 from review_votes v where v.review_id = r.id and v.user_id = auth.uid() and v.kind = 'helpful'),
        'my_like', exists (select 1 from review_votes v where v.review_id = r.id and v.user_id = auth.uid() and v.kind = 'like')) x
    from reviews r join profiles p on p.id = r.user_id join user_stats s on s.user_id = r.user_id
    where r.title_key = p_title and can_see_review(r) and r.overall between p_min and p_max
    order by 1 limit least(p_limit, 50) offset p_offset
  ) t
$$;

-- ---------------------------------------------------------------------
-- Moderator queue (admins with 2-step sign-in)
-- ---------------------------------------------------------------------
create or replace function public.admin_ai_queue() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _need_admin();
  return (select coalesce(jsonb_agg(x order by x->>'ord', x->>'at'), '[]'::jsonb) from (
    select jsonb_build_object(
      'ord', case when a.status = 'open' then 0 when r.ai_status = 'held' then 1 else 2 end,
      'kind', case when a.status = 'open' then 'appeal' when r.ai_status = 'held' then 'held' else 'check' end,
      'id', r.id, 'at', r.updated_at, 'author', _mini(r.user_id), 'title_key', r.title_key,
      'headline', r.headline, 'text', left(r.body, 1200), 'notes', concat_ws(' / ', r.start_note, r.middle_note, r.ending_note),
      'overall', r.overall, 'start_h', r.start_h, 'middle_h', r.middle_h, 'end_h', r.end_h,
      'status', r.ai_status, 'score', r.ai_quality_score, 'reasons', to_jsonb(r.ai_reasons), 'note', r.ai_note,
      'ai', r.ai_detail, 'appeal_note', a.note) x
    from reviews r left join review_appeals a on a.review_id = r.id
    where r.ai_status = 'held' or (r.ai_flag and _review_public(r.ai_status)) or (r.ai_status = 'blocked' and a.status = 'open')
    limit 150) z);
end $$;

-- approve = make it public (+XP) · block = keep it hidden · clear = the flag was fine
create or replace function public.admin_ai_decide(p_review bigint, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_admin(); r reviews; xp int := 0;
begin
  if p_action not in ('approve','block','clear') then raise exception 'Pick approve, block or clear.'; end if;
  select * into r from reviews where id = p_review for update;
  if r.id is null then raise exception 'Review not found.'; end if;
  if p_action = 'approve' then
    update reviews set ai_status = case when array_length(ai_tips, 1) > 0 then 'tips' else 'ok' end, ai_note = null, ai_flag = false,
      mod_by = me, mod_at = now() where id = p_review returning * into r;
    xp := _review_award(r, r.ai_quality_score);
    update review_appeals set status = 'overturned', decided_by = me, decided_at = now() where review_id = p_review and status = 'open';
  elsif p_action = 'block' then
    update reviews set ai_status = 'blocked', ai_flag = false, mod_by = me, mod_at = now(),
      ai_note = coalesce(nullif(left(_clean(p_note), 300), ''), ai_note, 'A moderator decided this review breaks the community rules.')
      where id = p_review returning * into r;
    update review_appeals set status = 'upheld', decided_by = me, decided_at = now() where review_id = p_review and status = 'open';
  else
    update reviews set ai_flag = false, mod_by = me, mod_at = now() where id = p_review;
  end if;
  perform _log_admin('review_' || p_action, r.user_id, p_review::text, p_note);
  return jsonb_build_object('status', r.ai_status, 'xp', xp);
end $$;

-- Overview: now also counts the AI queue.
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _need_admin();
  return jsonb_build_object(
    'reports', (select count(*) from user_reports where status = 'open') + (select count(*) from review_reports where status = 'open')
               + (select count(*) from chat_reports where status = 'open'),
    'flags', (select count(*) from account_flags where status = 'open'),
    'held', (select count(*) from ratings where held),
    'paused', (select count(*) from user_status where status = 'banned' or (status = 'suspended' and until > now())),
    'users', (select count(*) from profiles where username is not null),
    'new_today', (select count(*) from auth.users where created_at > now() - interval '1 day'),
    'events_today', (select count(*) from security_events where created_at > now() - interval '1 day' and kind in ('rate_limit','flag','billing','admin')),
    'ai_queue', (select count(*) from reviews r where r.ai_status = 'held' or (r.ai_flag and _review_public(r.ai_status))
                   or (r.ai_status = 'blocked' and exists (select 1 from review_appeals a where a.review_id = r.id and a.status = 'open'))),
    'ai_on', _ai_on(),
    'ai_today', (select count(*) from security_events where kind = 'ai_review' and created_at > now() - interval '1 day'));
end $$;

-- ---------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------
alter table public.review_appeals enable row level security;
alter table public.app_settings enable row level security;
revoke all on public.review_appeals, public.app_settings from anon, authenticated;

-- Moderator-only columns are not readable from the app (reads list the safe columns).
do $$ declare cols text; begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns where table_schema = 'public' and table_name = 'reviews'
      and column_name not in ('ai_detail','mod_by','mod_at','ai_model');
  execute 'revoke select on public.reviews from anon, authenticated';
  execute format('grant select (%s) on public.reviews to anon, authenticated', cols);
end $$;

revoke execute on function public._ai_on(), public._review_award(public.reviews, int) from public, anon, authenticated;
revoke execute on function public.ai_heartbeat(text), public.ai_claim(uuid,bigint), public.ai_apply_review(bigint,jsonb) from public, anon, authenticated;
grant execute on function public.ai_heartbeat(text), public.ai_claim(uuid,bigint), public.ai_apply_review(bigint,jsonb) to service_role;
revoke execute on function public.review_status_sync(), public.appeal_review(bigint,text), public.admin_ai_queue(),
  public.admin_ai_decide(bigint,text,text) from public, anon;
grant execute on function public.review_status_sync(), public.appeal_review(bigint,text), public.admin_ai_queue(),
  public.admin_ai_decide(bigint,text,text), public.my_reviews(text,text), public.post_review(jsonb), public.edit_review(bigint,jsonb) to authenticated;
grant execute on function public.list_reviews(text,text,numeric,numeric,int,int) to anon, authenticated;
