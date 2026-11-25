-- =====================================================================
-- Heartbeat · Part 1: Friends & social
-- Run AFTER 001_foundation.sql and 002_reviews.sql. Safe to run again.
--
-- What it adds:
--  * Profiles: avatar (photo upload), bio, favorite 4 titles, private profile
--  * Friend requests (accept / decline), friends, follows, block, report
--  * Taste Match % between two people + "people with similar taste"
--  * Activity feed (friends' ratings, reviews, watchlist adds) with likes + comments
--  * Invite links (and QR codes in the app) that make you friends in one tap
--
-- Safety:
--  * The app can't write these tables directly. It calls server functions.
--  * Under-18 profiles are always friends-only, never suggested to strangers,
--    can't be followed by strangers, and only show up in search by exact username.
--  * Blocking hides both people from each other everywhere.
--  * Rate limits on friend requests, follows, likes, comments, invites and reports.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Profile fields
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists fav_titles  text[]  not null default '{}';
alter table public.profiles add column if not exists is_private  boolean not null default false;
alter table public.profiles add column if not exists invite_code text;
create unique index if not exists profiles_invite_code on public.profiles (invite_code);
update public.profiles set invite_code = left(replace(gen_random_uuid()::text, '-', ''), 12) where invite_code is null;
alter table public.profiles alter column invite_code set default left(replace(gen_random_uuid()::text, '-', ''), 12);

create index if not exists ratings_title_idx on public.ratings (title_key);

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.friend_requests (
  id           bigint generated always as identity primary key,
  sender       uuid not null references auth.users on delete cascade,
  receiver     uuid not null references auth.users on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted','declined','canceled')),
  via          text not null default 'request' check (via in ('request','invite')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  check (sender <> receiver)
);
create unique index if not exists friend_requests_open on public.friend_requests (least(sender, receiver), greatest(sender, receiver)) where status = 'pending';
create index if not exists friend_requests_rcv on public.friend_requests (receiver, status);
create index if not exists friend_requests_snd on public.friend_requests (sender, created_at desc);

create table if not exists public.friendships (
  user_a     uuid not null references auth.users on delete cascade,   -- always the smaller id
  user_b     uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index if not exists friendships_b on public.friendships (user_b);

create table if not exists public.follows (
  follower   uuid not null references auth.users on delete cascade,
  followee   uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create index if not exists follows_followee on public.follows (followee);

create table if not exists public.blocks (
  blocker    uuid not null references auth.users on delete cascade,
  blocked    uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
create index if not exists blocks_blocked on public.blocks (blocked);

create table if not exists public.user_reports (
  id         bigint generated always as identity primary key,
  reporter   uuid not null references auth.users on delete cascade,
  target     uuid not null references auth.users on delete cascade,
  reason     text not null check (reason in ('spam','harassment','hate','fake','underage','other')),
  note       text check (char_length(note) <= 300),
  status     text not null default 'open' check (status in ('open','kept','removed')),
  created_at timestamptz not null default now()
);
create unique index if not exists user_reports_once on public.user_reports (reporter, target) where status = 'open';

create table if not exists public.activities (
  id            bigint generated always as identity primary key,
  actor         uuid not null references auth.users on delete cascade,
  kind          text not null check (kind in ('rated','reviewed','saved')),
  title_key     text not null check (title_key ~ '^(movie|tv):[0-9]{1,9}$'),
  review_id     bigint references public.reviews on delete cascade,
  data          jsonb not null default '{}',
  vis           text not null default 'public' check (vis in ('public','friends')),
  like_count    int not null default 0,
  comment_count int not null default 0,
  created_at    timestamptz not null default now()
);
create unique index if not exists activities_one on public.activities (actor, kind, title_key) where kind in ('rated','saved');
create unique index if not exists activities_review on public.activities (review_id) where review_id is not null;
create index if not exists activities_actor on public.activities (actor, created_at desc);

create table if not exists public.activity_likes (
  user_id     uuid not null references auth.users on delete cascade,
  activity_id bigint not null references public.activities on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, activity_id)
);
create index if not exists activity_likes_act on public.activity_likes (activity_id);

create table if not exists public.activity_comments (
  id          bigint generated always as identity primary key,
  activity_id bigint not null references public.activities on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  body        text not null check (char_length(body) between 1 and 500),
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists activity_comments_act on public.activity_comments (activity_id, created_at);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select a is not null and b is not null and a <> b
     and exists (select 1 from friendships where user_a = least(a, b) and user_b = greatest(a, b))
$$;

-- Has either person blocked the other?
create or replace function public.is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select a is not null and b is not null
     and exists (select 1 from blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a))
$$;

create or replace function public._is_minor(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_minor from user_stats where user_id = u), true)
$$;

-- Private = the person turned it on, or they are under 18 (always friends-only).
create or replace function public._private(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_private from profiles where id = u), true) or _is_minor(u)
$$;

-- Can the signed-in person see this person's ratings, activity and taste?
create or replace function public.can_see_user(owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(owner = auth.uid(), false)
      or (not is_blocked(auth.uid(), owner) and (are_friends(auth.uid(), owner) or not _private(owner)))
$$;

create or replace function public.can_see_activity(a public.activities) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(a.actor = auth.uid(), false)
      or (not is_blocked(auth.uid(), a.actor) and (
            are_friends(auth.uid(), a.actor)
         or (a.vis = 'public' and not _private(a.actor))))
$$;

-- Reviews now also respect blocks.
create or replace function public.can_see_review(r public.reviews) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(r.user_id = auth.uid(), false)
      or (not r.hidden and r.ai_status <> 'held' and not is_blocked(auth.uid(), r.user_id)
          and (r.privacy = 'public' or (r.privacy = 'friends' and auth.uid() is not null and are_friends(auth.uid(), r.user_id))))
$$;

-- Rule-breaking text (bios, names, comments). Returns a friendly reason or null.
create or replace function public._bad_text(t text) returns text
language sql immutable as $$
  select case
    when t is null then null
    when lower(t) ~ '(https?://|www\.|\m[a-z0-9-]+\.(com|net|org|io|xyz|ru|ly|gg|link|shop)\M)' then 'Links aren''t allowed here.'
    when lower(t) ~ '(promo code|discount code|buy now|free followers|dm me|whatsapp|telegram|onlyfans|crypto|bitcoin|earn \$|make money|click here)' then 'That looks like spam.'
    when lower(t) ~ '(kill yourself|\mkys\M|go die|you should die|i will kill you|hope you die)' then 'Please be kind. Harassment isn''t allowed.'
    when lower(t) ~ '(\mnudes?\M|\mporn|\msex video|\mxxx\M|send pics)' then 'Sexual content isn''t allowed.'
    when lower(t) ~ '(\m(subhuman|vermin)\M.*\m(people|race|religion|women|men)\M|\mgo back to your country\M)' then 'Hate speech isn''t allowed.'
  end
$$;

-- Small public card for a person.
create or replace function public._mini(u uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
    'rank', s.rank, 'top_critic', s.rank in ('Top Critic','Director''s Cut','Legend'))
  from profiles p left join user_stats s on s.user_id = p.id where p.id = u
$$;

-- One score (1–5) per title for a person: their journey rating, or their Quick Rate swipe.
create or replace function public._scores(u uuid) returns table (title_key text, s numeric)
language sql stable security definer set search_path = public as $$
  select title_key, overall from ratings where user_id = u and overall is not null
  union all
  select w.title_key, case w.kind when 'loved' then 4.5 else 2 end from swipes w
   where w.user_id = u and w.kind in ('loved','disliked')
     and not exists (select 1 from ratings r where r.user_id = u and r.title_key = w.title_key)
$$;

-- Taste Match % (same formula the app has always shown). Needs 2+ shared titles.
create or replace function public._match(a uuid, b uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('n', count(*),
    'pct', case when count(*) >= 2 then greatest(0, least(99, round(100 - avg(abs(x.s - y.s)) * 26 + least(count(*), 6))))::int end)
  from _scores(a) x join _scores(b) y using (title_key)
$$;

-- How two people are connected.
create or replace function public._rel(me uuid, other uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'self', me = other,
    'friend', are_friends(me, other),
    'following', exists (select 1 from follows where follower = me and followee = other),
    'follows_me', exists (select 1 from follows where follower = other and followee = me),
    'req_out', (select id from friend_requests where sender = me and receiver = other and status = 'pending'),
    'req_in',  (select id from friend_requests where sender = other and receiver = me and status = 'pending'),
    'blocked', exists (select 1 from blocks where blocker = me and blocked = other))
$$;

create or replace function public._streak_alive(u uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when streak_last >= (now() at time zone 'utc')::date - 1 then streak_count else 0 end from user_stats where user_id = u
$$;

create or replace function public._limit(uid uuid, k text, n int, per interval, msg text) returns void
language plpgsql security definer set search_path = public as $$
declare c int;
begin
  select count(*) into c from security_events where user_id = uid and kind = k and created_at > now() - per;
  if c >= n then
    insert into security_events (user_id, kind, detail) values (uid, 'rate_limit', jsonb_build_object('what', k));
    raise exception '%', msg;
  end if;
  insert into security_events (user_id, kind) values (uid, k);
end $$;

create or replace function public._need_member(verified boolean default true) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Please sign in first.'; end if;
  if not is_member() then raise exception 'Please finish setting up your account.'; end if;
  if verified and not is_verified() then raise exception 'Please confirm your email first. Check your inbox.'; end if;
  return uid;
end $$;

-- ---------------------------------------------------------------------
-- Profile guard: clean text, check favorites and photo address
-- ---------------------------------------------------------------------
create or replace function public._profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare why text;
begin
  new.bio := _clean(new.bio);
  new.display_name := _clean(new.display_name);
  why := coalesce(_bad_text(new.bio), _bad_text(new.display_name));
  if why is not null and (tg_op = 'INSERT' or new.bio is distinct from old.bio or new.display_name is distinct from old.display_name) then
    raise exception '%', why;
  end if;
  if exists (select 1 from unnest(new.fav_titles) x where x !~ '^(movie|tv):[0-9]{1,9}$')
     or array_length(new.fav_titles, 1) > 4
     or (select count(distinct x) from unnest(new.fav_titles) x) <> coalesce(array_length(new.fav_titles, 1), 0) then
    raise exception 'Pick up to 4 favorites.';
  end if;
  if new.avatar_url is not null and new.avatar_url !~ ('^https://[a-z0-9.-]+/storage/v1/object/public/avatars/' || new.id::text || '/[A-Za-z0-9._-]{1,80}$') then
    raise exception 'That photo address isn''t allowed.';
  end if;
  if tg_op = 'UPDATE' and coalesce(current_setting('hb.invite', true), '') <> 'on' then new.invite_code := old.invite_code; end if;  -- only reset_invite() changes it
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before insert or update on public.profiles for each row execute function public._profiles_guard();

-- Favorites keep the order the person picked.
create or replace function public.set_favorites(p_titles text[]) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := _need_member(false); clean text[] := '{}'; x text;
begin
  foreach x in array coalesce(p_titles, '{}') loop
    if x ~ '^(movie|tv):[0-9]{1,9}$' and not x = any (clean) then clean := clean || x; end if;
  end loop;
  if array_length(clean, 1) > 4 then raise exception 'Pick up to 4 favorites.'; end if;
  update profiles set fav_titles = clean where id = uid;
end $$;

-- ---------------------------------------------------------------------
-- Activity: made automatically when someone rates, reviews or saves
-- ---------------------------------------------------------------------
create or replace function public._act_rating() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('hb.importing', true) = 'on' then return null; end if;
  if tg_op = 'DELETE' then
    delete from activities where actor = old.user_id and kind = 'rated' and title_key = old.title_key; return null;
  end if;
  if tg_op = 'UPDATE' and new.start_h = old.start_h and new.middle_h = old.middle_h and new.end_h = old.end_h then return null; end if;
  -- Already wrote a review for it? The review is the activity.
  if exists (select 1 from activities where actor = new.user_id and kind = 'reviewed' and title_key = new.title_key) then return null; end if;
  insert into activities (actor, kind, title_key, data)
    values (new.user_id, 'rated', new.title_key, jsonb_build_object('s', new.start_h, 'm', new.middle_h, 'e', new.end_h, 'o', new.overall))
  on conflict (actor, kind, title_key) where kind in ('rated','saved')
    do update set data = excluded.data, created_at = now();
  return null;
end $$;
drop trigger if exists ratings_activity on public.ratings;
create trigger ratings_activity after insert or update or delete on public.ratings for each row execute function public._act_rating();

create or replace function public._act_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.privacy = 'private' or new.hidden or new.ai_status = 'held' then
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
drop trigger if exists reviews_activity on public.reviews;
create trigger reviews_activity after insert or update of privacy, hidden, ai_status, overall on public.reviews
  for each row execute function public._act_review();

create or replace function public._act_watch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('hb.importing', true) = 'on' then return null; end if;
  if tg_op = 'DELETE' then
    delete from activities where actor = old.user_id and kind = 'saved' and title_key = old.title_key;
  else
    insert into activities (actor, kind, title_key) values (new.user_id, 'saved', new.title_key)
      on conflict (actor, kind, title_key) where kind in ('rated','saved') do nothing;
  end if;
  return null;
end $$;
drop trigger if exists watchlist_activity on public.watchlist;
create trigger watchlist_activity after insert or delete on public.watchlist for each row execute function public._act_watch();

-- ---------------------------------------------------------------------
-- Server functions the app calls
-- ---------------------------------------------------------------------

-- My own private profile bits (bio, favorites, invite code).
create or replace function public.my_profile() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('bio', p.bio, 'fav_titles', p.fav_titles, 'is_private', p.is_private, 'invite_code', p.invite_code,
    'is_minor', _is_minor(p.id), 'requests', (select count(*) from friend_requests r where r.receiver = p.id and r.status = 'pending'))
  from profiles p where p.id = auth.uid()
$$;

create or replace function public.reset_invite() returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := _need_member(false); c text := left(replace(gen_random_uuid()::text, '-', ''), 12);
begin
  perform _limit(uid, 'invite_reset', 10, interval '1 day', 'Too many new links today. Try again tomorrow.');
  perform set_config('hb.invite', 'on', true);
  update profiles set invite_code = c where id = uid;
  perform set_config('hb.invite', 'off', true);
  return c;
end $$;

-- A person's profile page.
create or replace function public.get_profile(p_username text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); pid uuid; vis boolean; res jsonb; st user_stats; pr profiles;
begin
  select * into pr from profiles where username = lower(p_username);
  if pr.id is null then return null; end if;
  pid := pr.id;
  if me is not null and exists (select 1 from blocks where blocker = pid and blocked = me) then return null; end if;
  vis := can_see_user(pid);
  select * into st from user_stats where user_id = pid;
  res := _mini(pid) || jsonb_build_object(
    'self', coalesce(me = pid, false),
    'is_private', _private(pid),
    'limited', not vis,
    'bio', case when vis or not _is_minor(pid) then pr.bio end,
    'fav_titles', case when vis then pr.fav_titles else '{}'::text[] end,
    'joined', pr.created_at,
    'xp', st.xp, 'streak', _streak_alive(pid), 'streak_best', st.streak_best,
    'counts', jsonb_build_object(
      'ratings', (select count(*) from ratings where user_id = pid),
      'reviews', (select count(*) from reviews r where r.user_id = pid and can_see_review(r)),
      'friends', (select count(*) from friendships where user_a = pid or user_b = pid),
      'followers', (select count(*) from follows where followee = pid),
      'following', (select count(*) from follows where follower = pid)),
    'rel', case when me is null then null else _rel(me, pid) end,
    'match', case when me is not null and me <> pid and vis then _match(me, pid) end);
  if vis then
    res := res || jsonb_build_object(
      'taste', (select jsonb_build_object('n', count(*), 'avg', round(avg(overall), 2), 'start', round(avg(start_h), 2),
                  'middle', round(avg(middle_h), 2), 'end', round(avg(end_h), 2)) from ratings where user_id = pid),
      'loved', (select coalesce(jsonb_agg(jsonb_build_object('k', title_key, 'o', overall) order by overall desc, updated_at desc), '[]')
                  from (select * from ratings where user_id = pid and overall >= 4 order by overall desc, updated_at desc limit 10) x),
      'recent', (select coalesce(jsonb_agg(jsonb_build_object('k', title_key, 's', start_h, 'm', middle_h, 'e', end_h, 'o', overall, 'at', updated_at) order by updated_at desc), '[]')
                  from (select * from ratings where user_id = pid order by updated_at desc limit 12) x));
  end if;
  return res;
end $$;

-- Where we agree and disagree (only when you can see them).
create or replace function public.taste_match(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  if me = p_user or not can_see_user(p_user) then return null; end if;
  return _match(me, p_user) || jsonb_build_object(
    'agree', (select coalesce(jsonb_agg(jsonb_build_object('k', x.title_key, 'me', x.s, 'them', y.s) order by x.s + y.s desc), '[]')
              from _scores(me) x join _scores(p_user) y using (title_key) where abs(x.s - y.s) <= 0.5),
    'disagree', (select coalesce(jsonb_agg(jsonb_build_object('k', x.title_key, 'me', x.s, 'them', y.s) order by abs(x.s - y.s) desc), '[]')
              from _scores(me) x join _scores(p_user) y using (title_key) where abs(x.s - y.s) >= 1.5));
end $$;

-- Find people by username or name.
create or replace function public.search_people(p_q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); q text := lower(btrim(coalesce(p_q, '')));
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  q := regexp_replace(q, '^@', '');
  if char_length(q) < 2 then return '[]'; end if;
  q := regexp_replace(q, '([%_\\])', '\\\1', 'g');
  return (select coalesce(jsonb_agg(_mini(p.id) || jsonb_build_object('rel', _rel(me, p.id)) order by (p.username = q) desc, p.username), '[]')
    from (select p.* from profiles p
           where p.username is not null and p.id <> me and not is_blocked(me, p.id)
             and (p.username = q   -- under 18: only an exact username finds them
                  or (not _is_minor(p.id) and (p.username like q || '%' or lower(p.display_name) like '%' || q || '%')))
           order by (p.username = q) desc, p.username limit 20) p);
end $$;

-- People with similar taste (public profiles, 3+ titles in common). Off for under-18 accounts.
create or replace function public.suggest_people(p_limit int default 12) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  if _is_minor(me) then return '[]'; end if;
  return (select coalesce(jsonb_agg(_mini(c.uid) || jsonb_build_object('pct', c.pct, 'n', c.n, 'rel', _rel(me, c.uid)) order by c.pct desc, c.n desc), '[]')
    from (select y.user_id uid, count(*) n,
                 greatest(0, least(99, round(100 - avg(abs(x.s - y.overall)) * 26 + least(count(*), 6))))::int pct
            from _scores(me) x join ratings y on y.title_key = x.title_key and y.user_id <> me
           where y.overall is not null
           group by y.user_id having count(*) >= 3) c
    join profiles p on p.id = c.uid
    where p.username is not null and not _private(c.uid) and not is_blocked(me, c.uid) and not are_friends(me, c.uid)
    limit least(coalesce(p_limit, 12), 30));
end $$;

create or replace function public.friends_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  return jsonb_build_object(
    'friends', (select coalesce(jsonb_agg(_mini(f.u) || jsonb_build_object('since', f.created_at, 'pct', _match(me, f.u)->'pct') order by p.username), '[]')
                from (select case when user_a = me then user_b else user_a end u, created_at from friendships where user_a = me or user_b = me) f
                join profiles p on p.id = f.u),
    'incoming', (select coalesce(jsonb_agg(_mini(r.sender) || jsonb_build_object('req', r.id, 'at', r.created_at,
                   'pct', case when can_see_user(r.sender) then _match(me, r.sender)->'pct' end) order by r.created_at desc), '[]')
                from friend_requests r where r.receiver = me and r.status = 'pending' and not is_blocked(me, r.sender)),
    'outgoing', (select coalesce(jsonb_agg(_mini(r.receiver) || jsonb_build_object('req', r.id, 'at', r.created_at) order by r.created_at desc), '[]')
                from friend_requests r where r.sender = me and r.status = 'pending'),
    'following', (select coalesce(jsonb_agg(_mini(f.followee) order by f.created_at desc), '[]') from follows f where f.follower = me),
    'followers', (select count(*) from follows where followee = me));
end $$;

create or replace function public._make_friends(a uuid, b uuid) returns void
language sql security definer set search_path = public as $$
  insert into friendships (user_a, user_b) values (least(a, b), greatest(a, b)) on conflict do nothing;
$$;

create or replace function public.send_friend_request(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(true); rid bigint;
begin
  if p_user is null or p_user = me or not exists (select 1 from profiles where id = p_user and username is not null) then raise exception 'Person not found.'; end if;
  if is_blocked(me, p_user) then raise exception 'You can''t add this person.'; end if;
  if are_friends(me, p_user) then return 'friends'; end if;
  -- They already asked you? Then you're friends now.
  select id into rid from friend_requests where sender = p_user and receiver = me and status = 'pending';
  if rid is not null then
    update friend_requests set status = 'accepted', responded_at = now() where id = rid;
    perform _make_friends(me, p_user);
    return 'friends';
  end if;
  if exists (select 1 from friend_requests where sender = me and receiver = p_user and status = 'pending') then return 'pending'; end if;
  if exists (select 1 from friend_requests where sender = me and receiver = p_user and status = 'declined' and responded_at > now() - interval '7 days') then
    raise exception 'Please wait a few days before asking again.';
  end if;
  perform _limit(me, 'friend_request', 30, interval '1 hour', 'You sent a lot of friend requests. Take a little break!');
  if (select count(*) from friend_requests where sender = me and created_at > now() - interval '1 day') >= 100 then
    raise exception 'That''s a lot of friend requests today. Try again tomorrow.';
  end if;
  insert into friend_requests (sender, receiver) values (me, p_user);
  return 'pending';
end $$;

create or replace function public.respond_friend_request(p_id bigint, p_accept boolean) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(false); r friend_requests;
begin
  select * into r from friend_requests where id = p_id and receiver = me and status = 'pending';
  if r.id is null then raise exception 'That request is gone.'; end if;
  update friend_requests set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now() where id = p_id;
  if p_accept then perform _make_friends(me, r.sender); return 'friends'; end if;
  return 'declined';
end $$;

create or replace function public.cancel_friend_request(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update friend_requests set status = 'canceled', responded_at = now() where id = p_id and sender = auth.uid() and status = 'pending';
end $$;

create or replace function public.unfriend(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  delete from friendships where user_a = least(me, p_user) and user_b = greatest(me, p_user);
end $$;

create or replace function public.follow_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(true);
begin
  if p_user is null or p_user = me or not exists (select 1 from profiles where id = p_user and username is not null) then raise exception 'Person not found.'; end if;
  if is_blocked(me, p_user) then raise exception 'You can''t follow this person.'; end if;
  if _private(p_user) and not are_friends(me, p_user) then raise exception 'This profile is private. Send a friend request instead.'; end if;
  if exists (select 1 from follows where follower = me and followee = p_user) then return; end if;
  perform _limit(me, 'follow', 60, interval '1 hour', 'You followed a lot of people. Take a little break!');
  insert into follows (follower, followee) values (me, p_user) on conflict do nothing;
end $$;

create or replace function public.unfollow_user(p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from follows where follower = auth.uid() and followee = p_user;
$$;

create or replace function public.block_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  if p_user is null or p_user = me then raise exception 'Person not found.'; end if;
  insert into blocks (blocker, blocked) values (me, p_user) on conflict do nothing;
  delete from friendships where user_a = least(me, p_user) and user_b = greatest(me, p_user);
  delete from follows where (follower = me and followee = p_user) or (follower = p_user and followee = me);
  update friend_requests set status = 'canceled', responded_at = now()
    where status = 'pending' and ((sender = me and receiver = p_user) or (sender = p_user and receiver = me));
end $$;

create or replace function public.unblock_user(p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from blocks where blocker = auth.uid() and blocked = p_user;
$$;

create or replace function public.report_user(p_user uuid, p_reason text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  if p_reason not in ('spam','harassment','hate','fake','underage','other') then raise exception 'Pick a reason.'; end if;
  if p_user = me then raise exception 'You can''t report yourself.'; end if;
  perform _limit(me, 'user_report', 20, interval '1 hour', 'Thanks! You''ve sent a lot of reports. Our team will look at them.');
  insert into user_reports (reporter, target, reason, note) values (me, p_user, p_reason, left(_clean(p_note), 300)) on conflict do nothing;
end $$;

-- Invite links: sharing your link means "I want to be friends", so opening it makes you friends.
create or replace function public.invite_info(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select _mini(id) from profiles where invite_code = p_code and username is not null and p_code ~ '^[a-f0-9]{12}$'
$$;

create or replace function public.accept_invite(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(false); them uuid;
begin
  perform _limit(me, 'invite_accept', 10, interval '1 hour', 'Too many invite links. Try again in a bit.');
  select id into them from profiles where invite_code = p_code and username is not null and p_code ~ '^[a-f0-9]{12}$';
  if them is null then raise exception 'That invite link doesn''t work anymore. Ask your friend for a new one.'; end if;
  if them = me then return jsonb_build_object('status', 'self', 'user', _mini(me)); end if;
  if is_blocked(me, them) then raise exception 'You can''t add this person.'; end if;
  if not are_friends(me, them) then
    update friend_requests set status = 'accepted', responded_at = now()
      where status = 'pending' and ((sender = me and receiver = them) or (sender = them and receiver = me));
    insert into friend_requests (sender, receiver, status, via, responded_at) values (them, me, 'accepted', 'invite', now());
    perform _make_friends(me, them);
  end if;
  return jsonb_build_object('status', 'friends', 'user', _mini(them));
end $$;

-- Activity feed: friends + people you follow.
create or replace function public.get_feed(p_before timestamptz default null, p_limit int default 20, p_user uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'at')::timestamptz desc), '[]') from (
    select jsonb_build_object('id', a.id, 'kind', a.kind, 'k', a.title_key, 'data', a.data, 'at', a.created_at,
      'user', _mini(a.actor), 'mine', a.actor = auth.uid(),
      'likes', a.like_count, 'comments', a.comment_count,
      'my_like', exists (select 1 from activity_likes l where l.activity_id = a.id and l.user_id = auth.uid()),
      'review', case when a.review_id is not null then (select jsonb_build_object('id', r.id, 'headline', r.headline,
          'body', case when r.has_spoilers then null else left(r.body, 280) end, 'spoilers', r.has_spoilers,
          's', r.start_h, 'm', r.middle_h, 'e', r.end_h) from reviews r where r.id = a.review_id) end) x
    from activities a
    where auth.uid() is not null and can_see_activity(a)
      and (p_before is null or a.created_at < p_before)
      and (case when p_user is not null then a.actor = p_user
                else a.actor <> auth.uid() and (are_friends(auth.uid(), a.actor)
                     or exists (select 1 from follows f where f.follower = auth.uid() and f.followee = a.actor)) end)
    order by a.created_at desc limit least(coalesce(p_limit, 20), 50)) t
$$;

create or replace function public.toggle_activity_like(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(false); a activities; had boolean;
begin
  select * into a from activities where id = p_id;
  if a.id is null or not can_see_activity(a) then raise exception 'Not found.'; end if;
  delete from activity_likes where user_id = me and activity_id = p_id; had := found;
  if not had then
    if (select count(*) from activity_likes where user_id = me and created_at > now() - interval '1 hour') >= 300 then
      raise exception 'Lots of likes this hour! Take a short break.';
    end if;
    insert into activity_likes (user_id, activity_id) values (me, p_id);
  end if;
  update activities set like_count = (select count(*) from activity_likes where activity_id = p_id) where id = p_id returning * into a;
  return jsonb_build_object('on', not had, 'likes', a.like_count);
end $$;

create or replace function public.add_activity_comment(p_id bigint, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(true); a activities; b text := _clean(p_body); cid bigint; why text;
begin
  select * into a from activities where id = p_id;
  if a.id is null or not can_see_activity(a) then raise exception 'Not found.'; end if;
  if b is null then raise exception 'Write something first.'; end if;
  if char_length(b) > 500 then raise exception 'Comments can be up to 500 characters.'; end if;
  why := _bad_text(b);
  if why is not null then
    insert into security_events (user_id, kind, detail) values (me, 'comment_blocked', jsonb_build_object('activity', p_id));
    raise exception '%', why;
  end if;
  perform _limit(me, 'activity_comment', 30, interval '1 hour', 'Lots of comments this hour! Take a short break.');
  insert into activity_comments (activity_id, user_id, body) values (p_id, me, b) returning id into cid;
  update activities set comment_count = (select count(*) from activity_comments where activity_id = p_id and not hidden) where id = p_id;
  return cid;
end $$;

create or replace function public.list_activity_comments(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(_mini(c.user_id) || jsonb_build_object('cid', c.id, 'body', c.body, 'at', c.created_at,
      'mine', c.user_id = auth.uid(), 'can_delete', c.user_id = auth.uid() or a.actor = auth.uid()) order by c.created_at), '[]')
  from activity_comments c join activities a on a.id = c.activity_id
  where c.activity_id = p_id and not c.hidden and can_see_activity(a) and not is_blocked(auth.uid(), c.user_id)
$$;

create or replace function public.delete_activity_comment(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare aid bigint;
begin
  delete from activity_comments c using activities a
    where c.id = p_id and a.id = c.activity_id and (c.user_id = auth.uid() or a.actor = auth.uid())
    returning c.activity_id into aid;
  if aid is null then raise exception 'You can''t delete that comment.'; end if;
  update activities set comment_count = (select count(*) from activity_comments where activity_id = aid and not hidden) where id = aid;
end $$;

-- Review comments: show photos, hide people you blocked.
create or replace function public.list_comments(p_review bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'parent_id', c.parent_id, 'body', c.body, 'created_at', c.created_at,
      'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'rank', s.rank, 'mine', c.user_id = auth.uid())
      order by coalesce(c.parent_id, c.id), c.id), '[]')
  from review_comments c join profiles p on p.id = c.user_id join user_stats s on s.user_id = c.user_id
  join reviews r on r.id = c.review_id
  where c.review_id = p_review and not c.hidden and can_see_review(r) and not is_blocked(auth.uid(), c.user_id)
$$;

-- ---------------------------------------------------------------------
-- Row Level Security: read only your own rows; writes only via functions.
-- ---------------------------------------------------------------------
alter table public.friend_requests   enable row level security;
alter table public.friendships       enable row level security;
alter table public.follows           enable row level security;
alter table public.blocks            enable row level security;
alter table public.user_reports      enable row level security;
alter table public.activities        enable row level security;
alter table public.activity_likes    enable row level security;
alter table public.activity_comments enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
    and tablename in ('friend_requests','friendships','follows','blocks','user_reports','activities','activity_likes','activity_comments')
  loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
end $$;

create policy "requests mine" on public.friend_requests for select using (auth.uid() in (sender, receiver));
create policy "friendships mine" on public.friendships for select using (auth.uid() in (user_a, user_b));
create policy "follows mine" on public.follows for select using (auth.uid() in (follower, followee));
create policy "blocks mine" on public.blocks for select using (auth.uid() = blocker);
create policy "reports mine" on public.user_reports for select using (auth.uid() = reporter);
create policy "activities visible" on public.activities for select using (public.can_see_activity(activities));
create policy "activity likes mine" on public.activity_likes for select using (auth.uid() = user_id);
create policy "activity comments visible" on public.activity_comments for select
  using (not hidden and exists (select 1 from public.activities a where a.id = activity_id and public.can_see_activity(a)));

revoke all on public.friend_requests, public.friendships, public.follows, public.blocks, public.user_reports,
  public.activities, public.activity_likes, public.activity_comments from anon, authenticated;
grant select on public.friend_requests, public.friendships, public.follows, public.blocks, public.user_reports,
  public.activities, public.activity_likes, public.activity_comments to authenticated;

-- Profiles: everyone can read the basics. Bio, favorites and invite code go through
-- get_profile() / my_profile(), so private and under-18 profiles stay private.
revoke select on public.profiles from anon, authenticated;
grant select (id, username, display_name, avatar_url, created_at) on public.profiles to anon, authenticated;
revoke update on public.profiles from anon, authenticated;
grant update (username, display_name, bio, avatar_url, is_private) on public.profiles to authenticated;

-- Internal helpers can't be called by the app.
revoke execute on function public._is_minor(uuid), public._private(uuid), public._bad_text(text), public._mini(uuid), public._scores(uuid),
  public._match(uuid,uuid), public._rel(uuid,uuid), public._streak_alive(uuid), public._limit(uuid,text,int,interval,text),
  public._need_member(boolean), public._make_friends(uuid,uuid) from public, anon, authenticated;

revoke execute on function public.my_profile(), public.reset_invite(), public.taste_match(uuid), public.search_people(text),
  public.suggest_people(int), public.friends_overview(), public.send_friend_request(uuid), public.respond_friend_request(bigint,boolean),
  public.cancel_friend_request(bigint), public.unfriend(uuid), public.follow_user(uuid), public.unfollow_user(uuid),
  public.block_user(uuid), public.unblock_user(uuid), public.report_user(uuid,text,text), public.accept_invite(text),
  public.get_feed(timestamptz,int,uuid), public.toggle_activity_like(bigint), public.add_activity_comment(bigint,text),
  public.list_activity_comments(bigint), public.delete_activity_comment(bigint), public.set_favorites(text[]) from public, anon;
grant execute on function public.my_profile(), public.reset_invite(), public.taste_match(uuid), public.search_people(text),
  public.suggest_people(int), public.friends_overview(), public.send_friend_request(uuid), public.respond_friend_request(bigint,boolean),
  public.cancel_friend_request(bigint), public.unfriend(uuid), public.follow_user(uuid), public.unfollow_user(uuid),
  public.block_user(uuid), public.unblock_user(uuid), public.report_user(uuid,text,text), public.accept_invite(text),
  public.get_feed(timestamptz,int,uuid), public.toggle_activity_like(bigint), public.add_activity_comment(bigint,text),
  public.list_activity_comments(bigint), public.delete_activity_comment(bigint), public.set_favorites(text[]) to authenticated;
grant execute on function public.get_profile(text), public.invite_info(text), public.are_friends(uuid,uuid), public.is_blocked(uuid,uuid),
  public.can_see_user(uuid), public.can_see_activity(public.activities), public.can_see_review(public.reviews) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Profile photos (Supabase Storage). Each person can only write to their own folder.
-- ---------------------------------------------------------------------
do $$ begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('avatars', 'avatars', true, 1048576, array['image/webp','image/jpeg','image/png'])
      on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/webp','image/jpeg','image/png'];
    drop policy if exists "avatars own read"   on storage.objects;
    drop policy if exists "avatars own insert" on storage.objects;
    drop policy if exists "avatars own update" on storage.objects;
    drop policy if exists "avatars own delete" on storage.objects;
    create policy "avatars own read" on storage.objects for select to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
    create policy "avatars own insert" on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.is_member());
    create policy "avatars own update" on storage.objects for update to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
    create policy "avatars own delete" on storage.objects for delete to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;
