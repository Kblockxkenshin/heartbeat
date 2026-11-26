-- =====================================================================
-- Heartbeat · Part 9: Legal & trust
-- Run AFTER 001–010. Safe to run again.
--  * Contact us / privacy requests (people write in; admins answer from the Admin → Inbox tab).
--  * Which version of the Terms & Privacy Policy each person agreed to.
--  * Download my data (everything about me, as one JSON file).
--  * Delete my account (right away; my chat messages are wiped first).
--  * Under-18 safety: no Plus purchases (also checked by /api/billing).
-- =====================================================================

create table if not exists public.support_requests (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users on delete set null,
  topic      text not null check (topic in ('help','privacy','safety','legal','bug','studio','other')),
  message    text not null check (char_length(message) between 5 and 2000),
  reply_to   text check (char_length(reply_to) <= 120),
  status     text not null default 'open' check (status in ('open','done')),
  created_at timestamptz not null default now(),
  closed_by  uuid references auth.users on delete set null,
  closed_at  timestamptz
);
create table if not exists public.legal_acceptances (
  user_id     uuid not null references auth.users on delete cascade,
  version     text not null check (version ~ '^\d{4}-\d{2}-\d{2}$'),
  accepted_at timestamptz not null default now(),
  primary key (user_id, version)
);

-- ---------------------------------------------------------------------
-- Contact us
-- ---------------------------------------------------------------------
create or replace function public.contact_us(p_topic text, p_message text, p_reply_to text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int; m text := _clean(p_message);
begin
  if me is null then raise exception 'Please sign in first, so we know who to answer.'; end if;
  if p_topic not in ('help','privacy','safety','legal','bug','studio','other') then p_topic := 'other'; end if;
  if char_length(coalesce(m, '')) < 5 then raise exception 'Please write a little more.'; end if;
  if char_length(m) > 2000 then raise exception 'Messages can be up to 2,000 characters.'; end if;
  if coalesce(p_reply_to, '') <> '' and p_reply_to !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then raise exception 'That email doesn''t look right.'; end if;
  select count(*) into n from support_requests where user_id = me and created_at > now() - interval '1 day';
  if n >= 5 then raise exception 'Thanks! We got your messages. Please wait for our answer.'; end if;
  insert into support_requests (user_id, topic, message, reply_to) values (me, p_topic, m, nullif(btrim(p_reply_to), ''));
end $$;

create or replace function public.admin_inbox() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform _need_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'topic', r.topic, 'message', r.message, 'at', r.created_at,
      'reply_to', coalesce(r.reply_to, (select email from auth.users where id = r.user_id)),
      'who', case when r.user_id is not null then _mini(r.user_id) end) order by r.created_at), '[]'::jsonb)
    from support_requests r where r.status = 'open');
end $$;
create or replace function public.admin_inbox_done(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _need_admin();
begin
  update support_requests set status = 'done', closed_by = me, closed_at = now() where id = p_id;
  perform _log_admin('inbox_done', null, p_id::text, null);
end $$;

-- ---------------------------------------------------------------------
-- Terms & Privacy agreement
-- ---------------------------------------------------------------------
create or replace function public.accept_terms(p_version text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if p_version !~ '^\d{4}-\d{2}-\d{2}$' or p_version::date > current_date + 1 then raise exception 'Unknown version.'; end if;
  insert into legal_acceptances (user_id, version) values (auth.uid(), p_version) on conflict do nothing;
end $$;
create or replace function public.my_terms() returns text
language sql stable security definer set search_path = public as $$
  select max(version) from legal_acceptances where user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- Download my data (GDPR / CCPA "right to access")
-- ---------------------------------------------------------------------
create or replace function public.export_my_data() returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid(); n int;
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  if not _mfa_ok() then raise exception 'Please enter your 2-step sign-in code first.'; end if;
  select count(*) into n from security_events where user_id = me and kind = 'data_export' and created_at > now() - interval '1 day';
  if n >= 5 then raise exception 'You downloaded your data a lot today. Please try again tomorrow.'; end if;
  insert into security_events (user_id, kind) values (me, 'data_export');
  return jsonb_build_object(
    'about', 'Your Heartbeat data. Made ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ' UTC.',
    'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'email_confirmed', u.email_confirmed_at is not null, 'created_at', u.created_at)
                from auth.users u where u.id = me),
    'profile', (select to_jsonb(p) from profiles p where p.id = me),
    'birthday', (select birthdate from private_profiles where id = me),
    'stats', (select to_jsonb(s) from user_stats s where s.user_id = me),
    'privacy_settings', (select to_jsonb(p) - 'user_id' from user_privacy p where p.user_id = me),
    'terms_agreed', (select coalesce(jsonb_agg(to_jsonb(a) - 'user_id'), '[]') from legal_acceptances a where a.user_id = me),
    'ratings', (select coalesce(jsonb_agg(to_jsonb(r) - 'user_id' order by r.created_at), '[]') from ratings r where r.user_id = me),
    'quick_rate_swipes', (select coalesce(jsonb_agg(to_jsonb(r) - 'user_id' order by r.created_at), '[]') from swipes r where r.user_id = me),
    'watchlist', (select coalesce(jsonb_agg(to_jsonb(r) - 'user_id' order by r.added_at), '[]') from watchlist r where r.user_id = me),
    'reviews', (select coalesce(jsonb_agg(to_jsonb(r) - 'user_id' - 'ai_detail' - 'mod_by' - 'spoiler_ranges' order by r.created_at), '[]') from reviews r where r.user_id = me),
    'review_drafts', (select coalesce(jsonb_agg(to_jsonb(r) - 'user_id'), '[]') from review_drafts r where r.user_id = me),
    'review_comments', (select coalesce(jsonb_agg(to_jsonb(r) - 'user_id' order by r.created_at), '[]') from review_comments r where r.user_id = me),
    'review_votes', (select coalesce(jsonb_agg(to_jsonb(r) - 'user_id'), '[]') from review_votes r where r.user_id = me),
    'review_appeals', (select coalesce(jsonb_agg(jsonb_build_object('review_id', a.review_id, 'note', a.note, 'status', a.status, 'created_at', a.created_at)), '[]') from review_appeals a where a.user_id = me),
    'reports_i_sent', jsonb_build_object(
      'reviews', (select coalesce(jsonb_agg(jsonb_build_object('reason', r.reason, 'note', r.note, 'status', r.status, 'at', r.created_at)), '[]') from review_reports r where r.reporter = me),
      'people', (select coalesce(jsonb_agg(jsonb_build_object('reason', r.reason, 'note', r.note, 'status', r.status, 'at', r.created_at)), '[]') from user_reports r where r.reporter = me),
      'chat', (select coalesce(jsonb_agg(jsonb_build_object('reason', r.reason, 'note', r.note, 'status', r.status, 'at', r.created_at)), '[]') from chat_reports r where r.reporter = me)),
    'friends', (select coalesce(jsonb_agg(p.username), '[]') from friendships f join profiles p on p.id = case when f.user_a = me then f.user_b else f.user_a end
                where me in (f.user_a, f.user_b)),
    'following', (select coalesce(jsonb_agg(p.username), '[]') from follows f join profiles p on p.id = f.followee where f.follower = me),
    'blocked', (select coalesce(jsonb_agg(p.username), '[]') from blocks b join profiles p on p.id = b.blocked where b.blocker = me),
    'friend_requests', (select coalesce(jsonb_agg(jsonb_build_object('to', pt.username, 'from', pf.username, 'status', r.status, 'at', r.created_at)), '[]')
                        from friend_requests r join profiles pf on pf.id = r.sender join profiles pt on pt.id = r.receiver where me in (r.sender, r.receiver)),
    'activity_posts', (select coalesce(jsonb_agg(to_jsonb(a) - 'actor' order by a.created_at), '[]') from activities a where a.actor = me),
    'activity_comments', (select coalesce(jsonb_agg(to_jsonb(c) - 'user_id' order by c.created_at), '[]') from activity_comments c where c.user_id = me),
    'chat_messages_i_sent', (select coalesce(jsonb_agg(jsonb_build_object('chat', m.chat_id, 'kind', m.kind, 'text', m.body, 'title', m.title_key, 'deleted', m.deleted, 'at', m.created_at) order by m.created_at), '[]')
                             from chat_messages m where m.sender = me),
    'chats_i_am_in', (select coalesce(jsonb_agg(m.chat_id), '[]') from chat_members m where m.user_id = me),
    'recommendations', jsonb_build_object(
      'sent', (select coalesce(jsonb_agg(jsonb_build_object('to', p.username, 'title', r.title_key, 'note', r.note, 'status', r.status, 'at', r.created_at)), '[]') from recommendations r join profiles p on p.id = r.receiver where r.sender = me),
      'received', (select coalesce(jsonb_agg(jsonb_build_object('from', p.username, 'title', r.title_key, 'note', r.note, 'status', r.status, 'at', r.created_at)), '[]') from recommendations r join profiles p on p.id = r.sender where r.receiver = me)),
    'xp_history', (select coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'amount', x.amount, 'at', x.created_at) order by x.created_at), '[]') from xp_events x where x.user_id = me),
    'event_picks', (select coalesce(jsonb_agg(to_jsonb(e) - 'user_id'), '[]') from event_picks e where e.user_id = me),
    'trailer_reactions', (select coalesce(jsonb_agg(to_jsonb(t) - 'user_id'), '[]') from trailer_reactions t where t.user_id = me),
    'screener_panels', (select coalesce(jsonb_agg(jsonb_build_object('panel', i.panel_id, 'status', i.status, 'answers', i.answers, 'at', i.answered_at)), '[]') from panel_invites i where i.user_id = me),
    'plus', (select jsonb_build_object('plan', b.plan, 'status', b.status, 'renews_or_ends', b.period_end, 'cancel_at_period_end', b.cancel_at_period_end) from billing b where b.user_id = me),
    'studios', (select coalesce(jsonb_agg(jsonb_build_object('studio', s.name, 'role', m.role)), '[]') from studio_members m join studios s on s.id = m.studio_id where m.user_id = me),
    'messages_to_us', (select coalesce(jsonb_agg(jsonb_build_object('topic', r.topic, 'message', r.message, 'status', r.status, 'at', r.created_at)), '[]') from support_requests r where r.user_id = me),
    'account_status', (select jsonb_build_object('status', s.status, 'until', s.until, 'reason', s.reason) from user_status s where s.user_id = me),
    'security_log', (select coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'at', e.created_at) order by e.created_at desc), '[]')
                     from (select * from security_events where user_id = me order by created_at desc limit 500) e),
    'not_included', 'Device codes and IP addresses are only kept as one-way scrambled codes, so we cannot show them. Payment card details are kept by Stripe, not by us.');
end $$;

-- ---------------------------------------------------------------------
-- Delete my account ("right to erasure"). Happens right away.
-- ---------------------------------------------------------------------
create or replace function public.delete_my_account(p_confirm text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid(); b billing;
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  if p_confirm is distinct from 'DELETE' then raise exception 'Type DELETE to confirm.'; end if;
  if not _mfa_ok() then raise exception 'Please enter your 2-step sign-in code first.'; end if;
  select * into b from billing where user_id = me;
  if b.status in ('active','trialing','past_due') and not b.cancel_at_period_end then
    raise exception 'Please cancel Heartbeat Plus first (Me → Heartbeat Plus → Manage), so you are not charged again.';
  end if;
  if exists (select 1 from studio_members m where m.user_id = me and m.role = 'owner'
             and exists (select 1 from studio_members o where o.studio_id = m.studio_id and o.user_id <> me)) then
    raise exception 'You own a studio team. Please contact us to hand it over first.';
  end if;
  if exists (select 1 from admins where user_id = me) then raise exception 'Admins must remove their admin rights first (in the SQL editor).'; end if;
  -- Wipe what other people could still see.
  update chat_messages set deleted = true, body = null, title_key = null where sender = me;
  delete from studios s where exists (select 1 from studio_members m where m.studio_id = s.id and m.user_id = me and m.role = 'owner');
  -- Keep the safety log, but without the person.
  update security_events set user_id = null where user_id = me;
  insert into security_events (user_id, kind, detail) values (null, 'account_deleted', '{}'::jsonb);
  -- Profile photos (if the storage rules allow it here; the app also removes them first).
  begin
    delete from storage.objects where bucket_id = 'avatars' and name like me::text || '/%';
  exception when others then null;
  end;
  -- Everything else is removed with the account (ratings, reviews, friends, chats, XP, settings…).
  delete from auth.users where id = me;
end $$;

-- ---------------------------------------------------------------------
-- Under-18 safety: the app shows a message instead of the Plus checkout.
-- ---------------------------------------------------------------------
create or replace function public.my_safety() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('minor', _is_minor(auth.uid()), 'protections', case when _is_minor(auth.uid()) then jsonb_build_array(
    'Your profile is only visible to friends.', 'Only friends can send you messages.', 'People can''t find you by name in search.',
    'You are never counted in studio numbers or invited to screener panels.', 'You can''t buy Heartbeat Plus.') else '[]'::jsonb end)
  where auth.uid() is not null
$$;

-- ---------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------
alter table public.support_requests enable row level security;
alter table public.legal_acceptances enable row level security;
revoke all on public.support_requests, public.legal_acceptances from anon, authenticated;
grant select on public.user_stats to service_role;   -- /api/billing checks the age before checkout

revoke execute on function public.contact_us(text, text, text), public.admin_inbox(), public.admin_inbox_done(bigint), public.accept_terms(text),
  public.my_terms(), public.export_my_data(), public.delete_my_account(text), public.my_safety() from public, anon;
grant execute on function public.contact_us(text, text, text), public.admin_inbox(), public.admin_inbox_done(bigint), public.accept_terms(text),
  public.my_terms(), public.export_my_data(), public.delete_my_account(text), public.my_safety() to authenticated;
