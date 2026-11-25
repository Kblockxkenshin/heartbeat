-- =====================================================================
-- Heartbeat · Part 3: Recommendations
-- Run AFTER 001, 002, 003 and 004. Safe to run again.
--
-- What it adds:
--  * "Recommend to..." a title to one or more friends, with a short note
--  * Recommendations inbox: Watched it / Add to watchlist / Not for me
--  * When your friend rates it, you get a notification.
--    If they loved it (4 hearts or more) you earn 10 "Good Taste" points (+5 XP).
--  * "Best Recommender" leaderboard among you and your friends
--
-- Safety:
--  * Only friends. Not if either of you blocked the other.
--  * You must confirm your email first.
--  * Notes are checked on the server (no links, scams, harassment).
--  * Limit: 50 recommendations an hour. One per friend per title, ever.
--  * You can't recommend a title your friend already rated (no free points).
-- =====================================================================

create table if not exists public.recommendations (
  id            bigint generated always as identity primary key,
  sender        uuid not null references auth.users on delete cascade,
  receiver      uuid not null references auth.users on delete cascade,
  title_key     text not null check (title_key ~ '^(movie|tv):[0-9]{1,9}$'),
  note          text check (char_length(note) <= 300),
  status        text not null default 'new' check (status in ('new','saved','watched','nope')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  rated_overall numeric(2,1),
  rated_at      timestamptz,
  loved         boolean,
  points        int not null default 0,
  check (sender <> receiver),
  unique (sender, receiver, title_key)
);
create index if not exists recs_receiver_idx on public.recommendations (receiver, created_at desc);
create index if not exists recs_sender_idx on public.recommendations (sender, created_at desc);
create index if not exists recs_title_idx on public.recommendations (receiver, title_key);

create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  kind       text not null check (kind in ('rec_rated')),
  actor      uuid references auth.users on delete cascade,
  title_key  text,
  data       jsonb not null default '{}'::jsonb,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notes_user_idx on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- When someone rates a title, credit everyone who recommended it to them.
-- ---------------------------------------------------------------------
create or replace function public._recs_on_rate() returns trigger
language plpgsql security definer set search_path = public as $$
declare r recommendations; is_loved boolean;
begin
  if current_setting('hb.importing', true) = 'on' then return null; end if;
  is_loved := new.overall >= 4;
  for r in select * from recommendations
           where receiver = new.user_id and title_key = new.title_key and rated_at is null
           for update
  loop
    update recommendations set rated_overall = new.overall, rated_at = now(), loved = is_loved,
      points = case when is_loved then 10 else 0 end,
      status = case when status in ('new','saved') then 'watched' else status end,
      responded_at = coalesce(responded_at, now())
    where id = r.id;
    if is_loved then perform _award_xp(r.sender, 'good_taste', r.id::text, 5); end if;
    if not is_blocked(r.sender, r.receiver) then
      insert into notifications (user_id, kind, actor, title_key, data)
      values (r.sender, 'rec_rated', r.receiver, r.title_key,
              jsonb_build_object('rec', r.id, 'overall', new.overall, 'loved', is_loved, 'points', case when is_loved then 10 else 0 end));
    end if;
  end loop;
  return null;
end $$;

drop trigger if exists ratings_recs on public.ratings;
create trigger ratings_recs after insert or update of start_h, middle_h, end_h on public.ratings
  for each row execute function public._recs_on_rate();

-- ---------------------------------------------------------------------
-- Functions the app calls
-- ---------------------------------------------------------------------

-- Recommend one title to some friends. Returns how many were sent and who was skipped (and why).
create or replace function public.recommend(p_title text, p_users text[], p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(true); u uuid; why text; n int := 0; skipped jsonb := '[]'::jsonb; note text;
begin
  if p_title is null or p_title !~ '^(movie|tv):[0-9]{1,9}$' then raise exception 'That title looks wrong.'; end if;
  if p_users is null or cardinality(p_users) = 0 then raise exception 'Pick at least one friend.'; end if;
  if cardinality(p_users) > 20 then raise exception 'You can pick up to 20 friends at a time.'; end if;
  note := nullif(btrim(_clean(p_note)), '');
  if char_length(note) > 300 then raise exception 'Keep the note under 300 letters.'; end if;
  why := _chat_bad_text(note);
  if why is not null then raise exception '%', why; end if;
  foreach u in array (select array_agg(distinct x::uuid) from unnest(p_users) x)
  loop
    why := case
      when u = me then 'that is you'
      when not are_friends(me, u) or is_blocked(me, u) then 'not friends'
      when exists (select 1 from ratings where user_id = u and title_key = p_title) then 'already rated it'
      when exists (select 1 from recommendations where sender = me and receiver = u and title_key = p_title) then 'already sent'
      else null end;
    if why is not null then
      skipped := skipped || jsonb_build_array(jsonb_build_object('user', _mini(u), 'why', why));
      continue;
    end if;
    perform _limit(me, 'recommend', 50, interval '1 hour', 'You sent a lot of recommendations. Try again in a bit.');
    insert into recommendations (sender, receiver, title_key, note) values (me, u, p_title, note);
    n := n + 1;
  end loop;
  return jsonb_build_object('sent', n, 'skipped', skipped);
end $$;

-- Friends I could recommend this title to (with a flag if they can't get it).
create or replace function public.rec_targets(p_title text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(_mini(f.id) || jsonb_build_object('why',
      case when exists (select 1 from recommendations r where r.sender = auth.uid() and r.receiver = f.id and r.title_key = p_title) then 'already sent'
           when exists (select 1 from ratings t where t.user_id = f.id and t.title_key = p_title) then 'already rated it'
           else null end) order by p.username), '[]'::jsonb)
  from (select case when user_a = auth.uid() then user_b else user_a end as id
        from friendships where auth.uid() in (user_a, user_b)) f
  join profiles p on p.id = f.id
  where not is_blocked(auth.uid(), f.id)
$$;

-- My inbox (sent to me) or my sent list.
create or replace function public.my_recs(p_folder text default 'inbox', p_limit int default 60) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb) from (
    select r.created_at, jsonb_build_object('id', r.id, 'title_key', r.title_key, 'note', r.note, 'status', r.status,
      'created_at', r.created_at, 'responded_at', r.responded_at, 'rated_overall', r.rated_overall, 'rated_at', r.rated_at,
      'loved', r.loved, 'points', r.points,
      'user', _mini(case when p_folder = 'sent' then r.receiver else r.sender end)) j
    from recommendations r
    where auth.uid() is not null
      and case when p_folder = 'sent' then r.sender = auth.uid() else r.receiver = auth.uid() end
      and not is_blocked(r.sender, r.receiver)
    order by r.created_at desc
    limit least(greatest(coalesce(p_limit, 60), 1), 100)
  ) x
$$;

-- Answer a recommendation sent to me.
create or replace function public.respond_rec(p_id bigint, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(false); r recommendations;
begin
  if p_status not in ('saved','watched','nope') then raise exception 'Pick an answer.'; end if;
  select * into r from recommendations where id = p_id and receiver = me for update;
  if not found then raise exception 'Recommendation not found.'; end if;
  if r.rated_at is not null and p_status <> 'watched' then raise exception 'You already rated this one.'; end if;
  update recommendations set status = p_status, responded_at = now() where id = p_id;
  if p_status = 'saved' then
    insert into watchlist (user_id, title_key) values (me, r.title_key) on conflict do nothing;
  end if;
  return jsonb_build_object('id', p_id, 'status', p_status);
end $$;

-- Best Recommender: me and my friends, ranked by Good Taste points.
create or replace function public.rec_leaderboard() returns jsonb
language sql stable security definer set search_path = public as $$
  with people as (
    select auth.uid() as id where auth.uid() is not null
    union
    select case when user_a = auth.uid() then user_b else user_a end from friendships where auth.uid() in (user_a, user_b)
  ), s as (
    select p.id,
      (select count(*) from recommendations r where r.sender = p.id) as sent,
      (select count(*) from recommendations r where r.sender = p.id and r.rated_at is not null) as rated,
      (select count(*) from recommendations r where r.sender = p.id and r.loved) as loved,
      (select coalesce(sum(points), 0) from recommendations r where r.sender = p.id) as points
    from people p where p.id = auth.uid() or not is_blocked(auth.uid(), p.id)
  )
  select coalesce(jsonb_agg(_mini(s.id) || jsonb_build_object('sent', s.sent, 'rated', s.rated, 'loved', s.loved, 'points', s.points,
      'hit_rate', case when s.rated > 0 then round(100.0 * s.loved / s.rated) else null end, 'me', s.id = auth.uid())
    order by s.points desc, s.loved desc, s.sent asc, s.id), '[]'::jsonb)
  from s
$$;

-- My notifications (newest first).
create or replace function public.my_notifications(p_limit int default 30) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title_key', n.title_key, 'data', n.data,
      'read', n.read, 'created_at', n.created_at, 'actor', _mini(n.actor)) order by n.created_at desc), '[]'::jsonb)
  from (select * from notifications where user_id = auth.uid()
          and (actor is null or not is_blocked(auth.uid(), actor))
        order by created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) n
$$;

create or replace function public.mark_notifications_read() returns void
language sql security definer set search_path = public as $$
  update notifications set read = true where user_id = auth.uid() and not read
$$;

-- My private bits, now with recommendation counts too (for the red dots).
create or replace function public.my_profile() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('bio', p.bio, 'fav_titles', p.fav_titles, 'is_private', p.is_private, 'invite_code', p.invite_code,
    'is_minor', _is_minor(p.id), 'requests', (select count(*) from friend_requests r where r.receiver = p.id and r.status = 'pending'),
    'unread_chats', (select count(*) from chat_members me where me.user_id = p.id and me.status = 'active'
                       and coalesce(me.muted_until, '-infinity') < now()
                       and exists (select 1 from chat_messages m where m.chat_id = me.chat_id and m.created_at > me.last_read_at
                                   and m.sender is not null and m.sender <> p.id and not m.deleted and not is_blocked(p.id, m.sender))),
    'chat_requests', (select count(*) from chat_members me where me.user_id = p.id and me.status = 'request'
                       and exists (select 1 from chat_messages m where m.chat_id = me.chat_id)),
    'new_recs', (select count(*) from recommendations r where r.receiver = p.id and r.status = 'new' and not is_blocked(p.id, r.sender)),
    'unread_notes', (select count(*) from notifications n where n.user_id = p.id and not n.read
                       and (n.actor is null or not is_blocked(p.id, n.actor))))
  from profiles p where p.id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- Row Level Security: you only see recs you sent or got. All writes go through functions.
-- ---------------------------------------------------------------------
alter table public.recommendations enable row level security;
alter table public.notifications   enable row level security;

drop policy if exists "recs mine" on public.recommendations;
drop policy if exists "notes mine" on public.notifications;
create policy "recs mine" on public.recommendations for select using (auth.uid() in (sender, receiver));
create policy "notes mine" on public.notifications for select using (auth.uid() = user_id);

revoke all on public.recommendations, public.notifications from anon, authenticated;
grant select on public.recommendations, public.notifications to authenticated;

revoke execute on function public._recs_on_rate() from public, anon, authenticated;
revoke execute on function public.recommend(text,text[],text), public.rec_targets(text), public.my_recs(text,int),
  public.respond_rec(bigint,text), public.rec_leaderboard(), public.my_notifications(int), public.mark_notifications_read()
  from public, anon;
grant execute on function public.recommend(text,text[],text), public.rec_targets(text), public.my_recs(text,int),
  public.respond_rec(bigint,text), public.rec_leaderboard(), public.my_notifications(int), public.mark_notifications_read()
  to authenticated;
