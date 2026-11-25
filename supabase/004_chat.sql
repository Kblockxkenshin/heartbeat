-- =====================================================================
-- Heartbeat · Part 2: Chat
-- Run AFTER 001, 002 and 003. Safe to run again.
--
-- What it adds:
--  * 1-on-1 chats and group chats (up to 20 people), live messages
--  * Send a movie/series as a poster card
--  * Reactions, read receipts (can be turned off), typing indicator (live channel)
--  * Message requests: messages from non-friends go to a "Requests" folder
--  * Mute, block, report message
--
-- Safety:
--  * You must confirm your email before chatting.
--  * Under 18: can only chat with accepted friends. Strangers can't message them.
--  * Group chats: you can only add your friends.
--  * Every message is checked on the server: harassment, scams, links, sexual content, hate.
--  * Rate limits: 30 messages a minute, 500 an hour, 20 new chats an hour.
--  * Someone you haven't been accepted by can send at most 3 messages.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.chats (
  id              bigint generated always as identity primary key,
  kind            text not null check (kind in ('dm','group')),
  title           text check (char_length(title) <= 40),
  dm_key          text unique,                    -- 'uuidA:uuidB' (smaller first) for 1-on-1 chats
  created_by      uuid references auth.users on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.chat_members (
  chat_id      bigint not null references public.chats on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  role         text not null default 'member' check (role in ('owner','member')),
  status       text not null default 'active' check (status in ('active','request','declined','left')),
  muted_until  timestamptz,
  last_read_at timestamptz not null default now(),
  joined_at    timestamptz not null default now(),
  primary key (chat_id, user_id)
);
create index if not exists chat_members_user on public.chat_members (user_id, status);

create table if not exists public.chat_messages (
  id           bigint generated always as identity primary key,
  chat_id      bigint not null references public.chats on delete cascade,
  sender       uuid references auth.users on delete set null,     -- null = system message
  kind         text not null default 'text' check (kind in ('text','title','system')),
  body         text check (char_length(body) <= 2000),
  title_key    text check (title_key ~ '^(movie|tv):[0-9]{1,9}$'),
  deleted      boolean not null default false,
  hidden       boolean not null default false,                     -- hidden after 3 reports
  report_count int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists chat_messages_chat on public.chat_messages (chat_id, id desc);
create index if not exists chat_messages_sender on public.chat_messages (sender, created_at desc);

create table if not exists public.chat_reactions (
  message_id bigint not null references public.chat_messages on delete cascade,
  chat_id    bigint not null references public.chats on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  emoji      text not null check (emoji in ('❤️','😂','😮','😢','👍','🔥')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists chat_reactions_chat on public.chat_reactions (chat_id);

create table if not exists public.chat_reports (
  id         bigint generated always as identity primary key,
  reporter   uuid not null references auth.users on delete cascade,
  message_id bigint not null references public.chat_messages on delete cascade,
  target     uuid references auth.users on delete set null,
  reason     text not null check (reason in ('spam','harassment','scam','sexual','hate','other')),
  note       text check (char_length(note) <= 300),
  status     text not null default 'open' check (status in ('open','kept','removed')),
  created_at timestamptz not null default now(),
  unique (reporter, message_id)
);

create table if not exists public.chat_settings (
  user_id        uuid primary key references auth.users on delete cascade,
  read_receipts  boolean not null default true,
  allow_requests text not null default 'everyone' check (allow_requests in ('everyone','friends'))
);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public._chat_status(c bigint, u uuid) returns text
language sql stable security definer set search_path = public as $$
  select status from chat_members where chat_id = c and user_id = u
$$;

-- Can the signed-in person read this chat? (members, and people with a pending request)
create or replace function public.is_chat_member(c bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(_chat_status(c, auth.uid()) in ('active','request'), false)
$$;

create or replace function public._receipts_on(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select read_receipts from chat_settings where user_id = u), true)
$$;

-- Chat text check: rule-breaking words, scams, and links.
create or replace function public._chat_bad_text(t text) returns text
language sql immutable as $$
  select case
    when t is null then null
    when lower(t) ~ '(https?://|www\.|\m[a-z0-9-]+\.(com|net|org|io|xyz|ru|ly|gg|link|shop|me|co|app|site|online|top|click)\M)'
      then 'Links aren''t allowed in chat. This keeps everyone safe from spam.'
    when lower(t) ~ '(gift ?cards?|cash ?app|venmo me|zelle|paypal me|send (me )?money|wire transfer|investment opportunity|double your|crypto ?(deal|invest)|verify your account|your password|login code|verification code|seed phrase|bank details)'
      then 'That looks like a scam. Never share money, codes or passwords in chat.'
    else _bad_text(t)
  end
$$;

-- Why can't these two people chat 1-on-1? Returns a friendly reason, or null if they can.
create or replace function public._dm_blocker(me uuid, other uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when is_blocked(me, other) then 'You can''t message this person.'
    when are_friends(me, other) then null
    when _is_minor(other) then 'You can only message this person after you''re friends.'
    when _is_minor(me) then 'People under 18 can only chat with friends. Send a friend request first!'
    when coalesce((select allow_requests from chat_settings where user_id = other), 'everyone') = 'friends'
      then 'This person only gets messages from friends. Send a friend request first.'
  end
$$;

-- Group safety: anyone under 18 in the group must be friends with everyone else in it.
create or replace function public._group_ok(users uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from unnest(users) a, unnest(users) b
    where a <> b and _is_minor(a) and not are_friends(a, b))
  and not exists (
    select 1 from unnest(users) a, unnest(users) b where a <> b and is_blocked(a, b))
$$;

create or replace function public._sys(c bigint, msg text) returns void
language sql security definer set search_path = public as $$
  insert into chat_messages (chat_id, sender, kind, body) values (c, null, 'system', msg);
  update chats set last_message_at = now() where id = c;
$$;

create or replace function public._uname(u uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(display_name, '@' || username, 'Someone') from profiles where id = u
$$;

-- One message as the app sees it.
create or replace function public._msg_json(m public.chat_messages, me uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', m.id, 'chat_id', m.chat_id, 'kind', m.kind,
    'body', case when m.deleted or m.hidden then null else m.body end,
    'title_key', case when m.deleted or m.hidden then null else m.title_key end,
    'deleted', m.deleted, 'hidden', m.hidden, 'at', m.created_at,
    'mine', m.sender = me, 'user', case when m.sender is not null then _mini(m.sender) end,
    'reactions', coalesce((select jsonb_agg(jsonb_build_object('e', r.emoji, 'n', r.n, 'mine', r.mine) order by r.first)
        from (select emoji, count(*) n, bool_or(user_id = me) mine, min(created_at) first
              from chat_reactions where message_id = m.id group by emoji) r), '[]'))
$$;

-- ---------------------------------------------------------------------
-- Server functions the app calls
-- ---------------------------------------------------------------------

-- Start (or reopen) a 1-on-1 chat. Non-friends land in the other person's Requests folder.
create or replace function public.start_dm(p_user uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(true); why text; k text; cid bigint; their text;
begin
  if p_user is null or p_user = me or not exists (select 1 from profiles where id = p_user and username is not null) then
    raise exception 'Person not found.';
  end if;
  why := _dm_blocker(me, p_user);
  if why is not null then raise exception '%', why; end if;
  k := least(me, p_user)::text || ':' || greatest(me, p_user)::text;
  select id into cid from chats where dm_key = k;
  if cid is null then
    perform _limit(me, 'chat_new', 20, interval '1 hour', 'You started a lot of chats. Take a little break!');
    insert into chats (kind, dm_key, created_by) values ('dm', k, me) returning id into cid;
    insert into chat_members (chat_id, user_id, role, status) values (cid, me, 'owner', 'active');
    insert into chat_members (chat_id, user_id, status)
      values (cid, p_user, case when are_friends(me, p_user) then 'active' else 'request' end);
  else
    update chat_members set status = 'active' where chat_id = cid and user_id = me and status <> 'active';
    select status into their from chat_members where chat_id = cid and user_id = p_user;
    if their = 'left' or (their in ('request','declined') and are_friends(me, p_user)) then
      update chat_members set status = case when are_friends(me, p_user) then 'active' else 'request' end
        where chat_id = cid and user_id = p_user;
    end if;
  end if;
  return cid;
end $$;

-- New group chat with friends (2 to 20 people in total).
create or replace function public.create_group(p_title text, p_users text[]) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(true); ids uuid[]; u uuid; cid bigint; t text := _clean(p_title);
begin
  select array_agg(distinct x::uuid) into ids from unnest(coalesce(p_users, '{}')) x where x ~ '^[0-9a-f-]{36}$' and x::uuid <> me;
  if coalesce(array_length(ids, 1), 0) < 1 then raise exception 'Pick at least one friend.'; end if;
  if array_length(ids, 1) > 19 then raise exception 'Groups can have up to 20 people.'; end if;
  foreach u in array ids loop
    if not are_friends(me, u) then raise exception 'You can only add your friends to a group.'; end if;
  end loop;
  if not _group_ok(ids || me) then raise exception 'Someone in this group can''t chat with everyone else. People under 18 can only be in groups with their friends.'; end if;
  if _chat_bad_text(t) is not null then raise exception '%', _chat_bad_text(t); end if;
  perform _limit(me, 'chat_new', 20, interval '1 hour', 'You started a lot of chats. Take a little break!');
  insert into chats (kind, title, created_by) values ('group', left(t, 40), me) returning id into cid;
  insert into chat_members (chat_id, user_id, role) values (cid, me, 'owner');
  insert into chat_members (chat_id, user_id) select cid, x from unnest(ids) x;
  perform _sys(cid, _uname(me) || ' started the group 🎉');
  return cid;
end $$;

create or replace function public.add_to_group(p_chat bigint, p_users text[]) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(true); ids uuid[]; u uuid; everyone uuid[];
begin
  if (select kind from chats where id = p_chat) is distinct from 'group' or _chat_status(p_chat, me) is distinct from 'active' then
    raise exception 'Chat not found.';
  end if;
  select array_agg(distinct x::uuid) into ids from unnest(coalesce(p_users, '{}')) x
    where x ~ '^[0-9a-f-]{36}$' and coalesce(_chat_status(p_chat, x::uuid), 'left') <> 'active';
  if ids is null then return; end if;
  foreach u in array ids loop
    if not are_friends(me, u) then raise exception 'You can only add your friends.'; end if;
  end loop;
  select array_agg(user_id) || ids into everyone from chat_members where chat_id = p_chat and status = 'active';
  if array_length(everyone, 1) > 20 then raise exception 'Groups can have up to 20 people.'; end if;
  if not _group_ok(everyone) then raise exception 'Someone can''t join: people under 18 can only be in groups with their friends.'; end if;
  insert into chat_members (chat_id, user_id) select p_chat, x from unnest(ids) x
    on conflict (chat_id, user_id) do update set status = 'active', joined_at = now(), last_read_at = now();
  perform _sys(p_chat, _uname(me) || ' added ' || (select string_agg(_uname(x), ', ') from unnest(ids) x));
end $$;

create or replace function public.remove_from_group(p_chat bigint, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if (select role from chat_members where chat_id = p_chat and user_id = me and status = 'active') is distinct from 'owner'
     or (select kind from chats where id = p_chat) <> 'group' then
    raise exception 'Only the group owner can remove people.';
  end if;
  if p_user = me then raise exception 'Use "Leave group" instead.'; end if;
  update chat_members set status = 'left' where chat_id = p_chat and user_id = p_user and status = 'active';
  if found then perform _sys(p_chat, _uname(me) || ' removed ' || _uname(p_user)); end if;
end $$;

create or replace function public.leave_chat(p_chat bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); was text; k text;
begin
  select role into was from chat_members where chat_id = p_chat and user_id = me and status in ('active','request');
  if not found then return; end if;
  select kind into k from chats where id = p_chat;
  update chat_members set status = 'left', role = 'member' where chat_id = p_chat and user_id = me;
  if k = 'group' then
    perform _sys(p_chat, _uname(me) || ' left the group');
    if was = 'owner' then
      update chat_members set role = 'owner' where chat_id = p_chat and user_id =
        (select user_id from chat_members where chat_id = p_chat and status = 'active' order by joined_at limit 1);
    end if;
  end if;
end $$;

create or replace function public.rename_group(p_chat bigint, p_title text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t text := _clean(p_title);
begin
  if (select kind from chats where id = p_chat) is distinct from 'group' or _chat_status(p_chat, me) is distinct from 'active' then
    raise exception 'Chat not found.';
  end if;
  if _chat_bad_text(t) is not null then raise exception '%', _chat_bad_text(t); end if;
  update chats set title = left(t, 40) where id = p_chat;
  perform _sys(p_chat, _uname(me) || ' renamed the group' || coalesce(' to “' || left(t, 40) || '”', ''));
end $$;

create or replace function public.send_message(p_chat bigint, p_body text default null, p_title text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(true); st text; k text; other uuid; other_st text; b text := _clean(p_body); why text; n int; m chat_messages;
begin
  st := _chat_status(p_chat, me);
  if st = 'request' then raise exception 'Accept the message request first.'; end if;
  if st is distinct from 'active' then raise exception 'Chat not found.'; end if;
  select kind into k from chats where id = p_chat;
  if k = 'dm' then
    select user_id, status into other, other_st from chat_members where chat_id = p_chat and user_id <> me;
    why := _dm_blocker(me, other);
    if why is not null then raise exception '%', why; end if;
    if other_st = 'declined' then raise exception 'They didn''t accept your message request.'; end if;
    if other_st = 'request' and (select count(*) from chat_messages where chat_id = p_chat and sender = me) >= 3 then
      raise exception 'Wait for them to accept your message request.';
    end if;
    if other_st = 'left' then update chat_members set status = case when are_friends(me, other) then 'active' else 'request' end
      where chat_id = p_chat and user_id = other; end if;
  end if;
  if p_title is not null and p_title !~ '^(movie|tv):[0-9]{1,9}$' then raise exception 'Unknown title.'; end if;
  if p_title is null and b is null then raise exception 'Write something first.'; end if;
  if char_length(coalesce(b, '')) > 2000 then raise exception 'Messages can be up to 2,000 characters.'; end if;
  why := _chat_bad_text(b);
  if why is not null then
    insert into security_events (user_id, kind, detail) values (me, 'message_blocked', jsonb_build_object('chat', p_chat, 'why', why));
    raise exception '%', why;
  end if;
  select count(*) into n from chat_messages where sender = me and created_at > now() - interval '1 minute';
  if n >= 30 then raise exception 'Slow down a little! Too many messages in a minute.'; end if;
  select count(*) into n from chat_messages where sender = me and created_at > now() - interval '1 hour';
  if n >= 500 then
    insert into security_events (user_id, kind, detail) values (me, 'rate_limit', '{"what":"messages"}');
    raise exception 'You sent a lot of messages this hour. Take a little break!';
  end if;
  insert into chat_messages (chat_id, sender, kind, body, title_key)
    values (p_chat, me, case when p_title is not null then 'title' else 'text' end, b, p_title) returning * into m;
  update chats set last_message_at = now() where id = p_chat;
  update chat_members set last_read_at = now() where chat_id = p_chat and user_id = me;
  return _msg_json(m, me);
end $$;

-- Messages in a chat. p_after = only newer than this id (for live updates); otherwise the latest page before p_before.
create or replace function public.list_messages(p_chat bigint, p_before bigint default null, p_after bigint default null, p_limit int default 40) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(_msg_json(m, auth.uid()) order by m.id), '[]') from (
    select m.* from chat_messages m
      join chats c on c.id = m.chat_id
      join chat_members me on me.chat_id = m.chat_id and me.user_id = auth.uid() and me.status in ('active','request')
    where m.chat_id = p_chat
      and (c.kind = 'dm' or m.created_at >= me.joined_at)   -- new group members don't see older messages
      and (m.sender is null or m.sender = auth.uid() or not is_blocked(auth.uid(), m.sender))
      and (p_after is null or m.id > p_after)
      and (p_before is null or m.id < p_before)
    order by m.id desc limit least(coalesce(p_limit, 40), 100)) m
$$;

-- Who is in the chat, my status, read receipts.
create or replace function public.chat_info(p_chat bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); c chats; mine chat_members; other uuid; show boolean;
begin
  select * into c from chats where id = p_chat;
  select * into mine from chat_members where chat_id = p_chat and user_id = me;
  if c.id is null or mine.status is null or mine.status not in ('active','request') then return null; end if;
  show := _receipts_on(me);
  if c.kind = 'dm' then select user_id into other from chat_members where chat_id = p_chat and user_id <> me; end if;
  return jsonb_build_object('id', c.id, 'kind', c.kind, 'title', c.title, 'status', mine.status, 'role', mine.role,
    'muted', mine.muted_until > now(), 'receipts', show,
    'members', (select coalesce(jsonb_agg(_mini(m.user_id) || jsonb_build_object('status', m.status, 'role', m.role,
                  'read_at', case when show and _receipts_on(m.user_id) then m.last_read_at end) order by m.joined_at), '[]')
                from chat_members m where m.chat_id = p_chat and m.status in ('active','request') and m.user_id <> me),
    'other', case when other is not null then _mini(other) || jsonb_build_object('friend', are_friends(me, other),
                  'blocked_by_me', exists (select 1 from blocks where blocker = me and blocked = other),
                  'can_send', _dm_blocker(me, other) is null, 'why', _dm_blocker(me, other),
                  'status', (select status from chat_members where chat_id = p_chat and user_id = other)) end);
end $$;

create or replace function public.mark_read(p_chat bigint) returns void
language sql security definer set search_path = public as $$
  update chat_members set last_read_at = now() where chat_id = p_chat and user_id = auth.uid() and status in ('active','request');
$$;

-- My chats. p_folder: 'inbox' or 'requests'.
create or replace function public.my_chats(p_folder text default 'inbox') returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'at')::timestamptz desc), '[]') from (
    select jsonb_build_object('id', c.id, 'kind', c.kind, 'title', c.title, 'at', c.last_message_at,
      'muted', coalesce(me.muted_until > now(), false),
      'members', (select coalesce(jsonb_agg(_mini(o.user_id) order by o.joined_at), '[]') from (
          select * from chat_members o where o.chat_id = c.id and o.user_id <> auth.uid() and o.status in ('active','request')
          order by o.joined_at limit 4) o),
      'count', (select count(*) from chat_members o where o.chat_id = c.id and o.status = 'active'),
      'last', (select _msg_json(m, auth.uid()) from chat_messages m where m.chat_id = c.id
                 and (m.sender is null or m.sender = auth.uid() or not is_blocked(auth.uid(), m.sender))
               order by m.id desc limit 1),
      'unread', (select count(*) from chat_messages m where m.chat_id = c.id and m.created_at > me.last_read_at
                   and m.sender is not null and m.sender <> auth.uid() and not m.deleted and not is_blocked(auth.uid(), m.sender))) x
    from chat_members me join chats c on c.id = me.chat_id
    where me.user_id = auth.uid() and me.status = case when p_folder = 'requests' then 'request' else 'active' end
      and exists (select 1 from chat_messages m where m.chat_id = c.id) ) t
$$;

create or replace function public.accept_chat(p_chat bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update chat_members set status = 'active', last_read_at = now() where chat_id = p_chat and user_id = auth.uid() and status = 'request';
  if not found then raise exception 'That request is gone.'; end if;
end $$;

create or replace function public.decline_chat(p_chat bigint, p_block boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare other uuid;
begin
  update chat_members set status = 'declined' where chat_id = p_chat and user_id = auth.uid() and status = 'request';
  if not found then raise exception 'That request is gone.'; end if;
  if p_block then
    select user_id into other from chat_members where chat_id = p_chat and user_id <> auth.uid() limit 1;
    if other is not null then perform block_user(other); end if;
  end if;
end $$;

create or replace function public.toggle_reaction(p_msg bigint, p_emoji text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(false); m chat_messages;
begin
  select * into m from chat_messages where id = p_msg;
  if m.id is null or _chat_status(m.chat_id, me) is distinct from 'active' or m.kind = 'system' or m.deleted then raise exception 'Message not found.'; end if;
  if p_emoji not in ('❤️','😂','😮','😢','👍','🔥') then raise exception 'Pick a reaction.'; end if;
  delete from chat_reactions where message_id = p_msg and user_id = me and emoji = p_emoji;
  if not found then
    if (select count(*) from chat_reactions where user_id = me and created_at > now() - interval '1 minute') >= 60 then
      raise exception 'Slow down a little!';
    end if;
    insert into chat_reactions (message_id, chat_id, user_id, emoji) values (p_msg, m.chat_id, me, p_emoji);
  end if;
  return _msg_json(m, me)->'reactions';
end $$;

create or replace function public.delete_message(p_msg bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update chat_messages set deleted = true, body = null, title_key = null where id = p_msg and sender = auth.uid();
  if not found then raise exception 'You can only delete your own messages.'; end if;
  delete from chat_reactions where message_id = p_msg;
end $$;

create or replace function public.report_message(p_msg bigint, p_reason text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); m chat_messages; n int;
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  select * into m from chat_messages where id = p_msg;
  if m.id is null or not is_chat_member(m.chat_id) or m.sender is null then raise exception 'Message not found.'; end if;
  if m.sender = me then raise exception 'You can''t report your own message.'; end if;
  if p_reason not in ('spam','harassment','scam','sexual','hate','other') then raise exception 'Pick a reason.'; end if;
  perform _limit(me, 'message_report', 20, interval '1 hour', 'Thanks! You''ve sent a lot of reports. Our team will look at them.');
  insert into chat_reports (reporter, message_id, target, reason, note) values (me, p_msg, m.sender, p_reason, left(_clean(p_note), 300))
    on conflict do nothing;
  select count(*) into n from chat_reports where message_id = p_msg;
  update chat_messages set report_count = n, hidden = hidden or n >= 3 where id = p_msg;
end $$;

-- Mute: p_hours null = until I unmute, 0 = unmute.
create or replace function public.mute_chat(p_chat bigint, p_hours int default null) returns void
language sql security definer set search_path = public as $$
  update chat_members set muted_until = case when p_hours = 0 then null when p_hours is null then 'infinity'::timestamptz
                                             else now() + make_interval(hours => least(p_hours, 8760)) end
  where chat_id = p_chat and user_id = auth.uid();
$$;

create or replace function public.my_chat_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('read_receipts', _receipts_on(auth.uid()),
    'allow_requests', coalesce((select allow_requests from chat_settings where user_id = auth.uid()), 'everyone'),
    'is_minor', _is_minor(auth.uid()))
$$;

create or replace function public.set_chat_settings(p_read_receipts boolean, p_allow_requests text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_member(false);
begin
  if p_allow_requests not in ('everyone','friends') then raise exception 'Pick who can message you.'; end if;
  insert into chat_settings (user_id, read_receipts, allow_requests) values (me, coalesce(p_read_receipts, true), p_allow_requests)
    on conflict (user_id) do update set read_receipts = excluded.read_receipts, allow_requests = excluded.allow_requests;
end $$;

-- My private bits now also include chat counts (for the red dots).
create or replace function public.my_profile() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('bio', p.bio, 'fav_titles', p.fav_titles, 'is_private', p.is_private, 'invite_code', p.invite_code,
    'is_minor', _is_minor(p.id), 'requests', (select count(*) from friend_requests r where r.receiver = p.id and r.status = 'pending'),
    'unread_chats', (select count(*) from chat_members me where me.user_id = p.id and me.status = 'active'
                       and coalesce(me.muted_until, '-infinity') < now()
                       and exists (select 1 from chat_messages m where m.chat_id = me.chat_id and m.created_at > me.last_read_at
                                   and m.sender is not null and m.sender <> p.id and not m.deleted and not is_blocked(p.id, m.sender))),
    'chat_requests', (select count(*) from chat_members me where me.user_id = p.id and me.status = 'request'
                       and exists (select 1 from chat_messages m where m.chat_id = me.chat_id)))
  from profiles p where p.id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- Row Level Security: members read their chats; all writes go through functions.
-- (Live updates use these same rules, so nobody can listen in on other chats.)
-- ---------------------------------------------------------------------
alter table public.chats          enable row level security;
alter table public.chat_members   enable row level security;
alter table public.chat_messages  enable row level security;
alter table public.chat_reactions enable row level security;
alter table public.chat_reports   enable row level security;
alter table public.chat_settings  enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
    and tablename in ('chats','chat_members','chat_messages','chat_reactions','chat_reports','chat_settings')
  loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
end $$;

create policy "chats members" on public.chats for select using (public.is_chat_member(id));
create policy "chat members members" on public.chat_members for select using (public.is_chat_member(chat_id));
create policy "chat messages members" on public.chat_messages for select
  using (public.is_chat_member(chat_id) and (sender is null or sender = auth.uid() or not public.is_blocked(auth.uid(), sender)));
create policy "chat reactions members" on public.chat_reactions for select using (public.is_chat_member(chat_id));
create policy "chat reports mine" on public.chat_reports for select using (auth.uid() = reporter);
create policy "chat settings mine" on public.chat_settings for select using (auth.uid() = user_id);

revoke all on public.chats, public.chat_members, public.chat_messages, public.chat_reactions, public.chat_reports, public.chat_settings
  from anon, authenticated;
grant select on public.chats, public.chat_members, public.chat_messages, public.chat_reactions, public.chat_reports, public.chat_settings
  to authenticated;

revoke execute on function public._chat_status(bigint,uuid), public._receipts_on(uuid), public._chat_bad_text(text),
  public._dm_blocker(uuid,uuid), public._group_ok(uuid[]), public._sys(bigint,text), public._uname(uuid),
  public._msg_json(public.chat_messages,uuid) from public, anon, authenticated;

revoke execute on function public.start_dm(uuid), public.create_group(text,text[]), public.add_to_group(bigint,text[]),
  public.remove_from_group(bigint,uuid), public.leave_chat(bigint), public.rename_group(bigint,text),
  public.send_message(bigint,text,text), public.list_messages(bigint,bigint,bigint,int), public.chat_info(bigint),
  public.mark_read(bigint), public.my_chats(text), public.accept_chat(bigint), public.decline_chat(bigint,boolean),
  public.toggle_reaction(bigint,text), public.delete_message(bigint), public.report_message(bigint,text,text),
  public.mute_chat(bigint,int), public.my_chat_settings(), public.set_chat_settings(boolean,text) from public, anon;
grant execute on function public.start_dm(uuid), public.create_group(text,text[]), public.add_to_group(bigint,text[]),
  public.remove_from_group(bigint,uuid), public.leave_chat(bigint), public.rename_group(bigint,text),
  public.send_message(bigint,text,text), public.list_messages(bigint,bigint,bigint,int), public.chat_info(bigint),
  public.mark_read(bigint), public.my_chats(text), public.accept_chat(bigint), public.decline_chat(bigint,boolean),
  public.toggle_reaction(bigint,text), public.delete_message(bigint), public.report_message(bigint,text,text),
  public.mute_chat(bigint,int), public.my_chat_settings(), public.set_chat_settings(boolean,text), public.is_chat_member(bigint)
  to authenticated;

-- ---------------------------------------------------------------------
-- Live updates (Supabase Realtime)
--  * New messages, reactions and "seen" changes stream to chat members (uses the rules above).
--  * Typing indicator uses private channels named 'chat:<id>'; only members can join.
-- ---------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_messages') then
      alter publication supabase_realtime add table public.chat_messages;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_reactions') then
      alter publication supabase_realtime add table public.chat_reactions;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_members') then
      alter publication supabase_realtime add table public.chat_members;
    end if;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'realtime' and table_name = 'messages') then
    drop policy if exists "chat typing read" on realtime.messages;
    drop policy if exists "chat typing send" on realtime.messages;
    create policy "chat typing read" on realtime.messages for select to authenticated
      using ((select realtime.topic()) ~ '^chat:[0-9]{1,18}$' and public.is_chat_member(substr((select realtime.topic()), 6)::bigint));
    create policy "chat typing send" on realtime.messages for insert to authenticated
      with check ((select realtime.topic()) ~ '^chat:[0-9]{1,18}$' and public.is_chat_member(substr((select realtime.topic()), 6)::bigint));
  end if;
end $$;
