-- Heartbeat database. Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Every table has Row Level Security: anyone can read, people can only change their own rows.

-- A "title" is a TMDB id + type. "scope" is 'all', 's2' (season 2) or 's2e3' (season 2 episode 3).

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique,
  display_name text,
  founding_reviewer boolean default true,   -- turn this default off later
  created_at timestamptz default now()
);

create table if not exists ratings (
  user_id uuid references auth.users on delete cascade,
  tmdb_id int not null,
  media_type text not null check (media_type in ('movie','tv')),
  scope text not null default 'all',
  score smallint check (score between 1 and 10),
  predicted smallint check (predicted between 1 and 10),   -- Hype: before watching
  real_score smallint check (real_score between 1 and 10), -- Hype: after watching
  vibes text[] default '{}',
  worth text check (worth in ('Must watch','Watch if bored','Skip')),
  best_for text[] default '{}',
  got_good_at smallint,   -- position on the timeline
  quit_at smallint,       -- position on the timeline
  progress smallint,      -- how far they've watched (for spoiler locks)
  updated_at timestamptz default now(),
  primary key (user_id, tmdb_id, media_type, scope)
);

create table if not exists moment_tags (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade,
  tmdb_id int not null, media_type text not null, scope text not null default 'all',
  position smallint not null,
  tag text not null check (tag in ('Boring','Amazing','Funny','Scary','Sad','Plot twist')),
  created_at timestamptz default now(),
  unique (user_id, tmdb_id, media_type, scope, position, tag)
);

create table if not exists text_reviews (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade,
  tmdb_id int not null, media_type text not null,
  body text not null check (char_length(body) <= 280),
  has_spoilers boolean default false,
  created_at timestamptz default now()
);

create table if not exists video_reviews (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade,
  tmdb_id int not null, media_type text not null, scope text not null default 'all',
  url text not null,
  platform text not null check (platform in ('YouTube Shorts','TikTok','Instagram Reel')),
  caption text check (char_length(caption) <= 90),
  moment smallint,   -- null = general review
  hidden boolean default false,  -- set true when reports pile up
  created_at timestamptz default now()
);

create table if not exists video_likes (
  user_id uuid references auth.users on delete cascade,
  video_id bigint references video_reviews on delete cascade,
  kind text not null check (kind in ('like','helped')),
  primary key (user_id, video_id, kind)
);

create table if not exists video_comments (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade,
  video_id bigint references video_reviews on delete cascade,
  body text not null check (char_length(body) <= 200),
  created_at timestamptz default now()
);

create table if not exists reports (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade,
  video_id bigint references video_reviews on delete cascade,
  reason text not null,
  created_at timestamptz default now(),
  unique (user_id, video_id)
);

create table if not exists taste_invites (
  code text primary key,
  from_user uuid references auth.users on delete cascade,
  to_user uuid references auth.users,
  created_at timestamptz default now()
);

-- ---------- Security (Row Level Security) ----------
do $$
declare t text;
begin
  foreach t in array array['profiles','ratings','moment_tags','text_reviews','video_reviews','video_likes','video_comments','taste_invites'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "read all" on %I', t);
    execute format('create policy "read all" on %I for select using (true)', t);
  end loop;
end $$;

alter table reports enable row level security;  -- reports are private: only you see yours

create policy "own profile" on profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "own ratings" on ratings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own tags" on moment_tags for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own reviews" on text_reviews for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own videos" on video_reviews for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own likes" on video_likes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own comments" on video_comments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own reports" on reports for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own invites" on taste_invites for insert with check (auth.uid() = from_user);
create policy "accept invite" on taste_invites for update using (to_user is null) with check (auth.uid() = to_user);

-- Make a profile automatically when someone signs up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Fast lookups for title pages
create index if not exists ratings_title on ratings (tmdb_id, media_type, scope);
create index if not exists tags_title on moment_tags (tmdb_id, media_type, scope);
create index if not exists videos_title on video_reviews (tmdb_id, media_type);
