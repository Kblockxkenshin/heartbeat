# Heartbeat 💓 — rate the journey, not just the ending

Playful, phone-first movie & series rating app. Works without an account (saved on the device). With an account, data is saved in Supabase.

## Files (one job each)
- `index.html` — page shell
- `css/app.css` — the whole look (dark theme, Nunito font, animations)
- `js/config.js` — settings (no secret key here)
- `js/data.js` — sample titles, lists, badges
- `js/store.js` — saving ratings, streaks, badges, stats, Taste Match math
- `js/tmdb.js` — gets real posters/backdrops/info through `/api/tmdb`
- `js/ui.js` — posters (shimmer + fallback), mascot, toasts, hearts, confetti, sheets
- `js/journey.js` — Heartbeat graph, "gets good at", "where people quit"
- `js/screens/*.js` — Home, Detail + Rate, Quick Rate, Me, Search, Match, List, Feed, About
- `api/tmdb.js` — Vercel function that keeps your TMDB key secret
- `.env.example` — the env variable name to set in Vercel: `TMDB_API_KEY`

## Turn on real posters
Vercel → your project → Settings → Environment Variables → add `TMDB_API_KEY` with your TMDB token → Redeploy.

TMDB: This product uses the TMDB API but is not endorsed or certified by TMDB.

## Backend (Supabase) — Part 0
1. Supabase → SQL Editor → paste `supabase/001_foundation.sql` → Run.
2. Vercel → Environment Variables: `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the **anon public** key, never the service_role key) → Redeploy.
3. Supabase → Authentication → URL Configuration: Site URL = your Vercel URL.

Security model: Row Level Security on every table. XP, rank, streak and Plus status live in `user_stats`
and `xp_events`, which the app cannot write. Triggers and server functions give XP. Minimum age 13.

## Written reviews
Run `supabase/002_reviews.sql` after `001_foundation.sql`. The app never writes review tables directly;
it calls server functions (`post_review`, `edit_review`, `toggle_vote`, `add_comment`, `report_review`).
Every review is checked on the server (quality score, links/ads, harassment, gibberish, copy-paste, filler,
rating mismatch, spoilers) before it is saved. `api/img.js` serves TMDB posters for the share-image card.

## Friends & social (Part 1)
Upload the app code first, then run `supabase/003_friends.sql` (it hides `bio` from direct reads, which
older app code used). It adds profile photos (Storage bucket `avatars`, one folder per person), bio,
favorite 4, friends-only profiles, friend requests, follows, block, report, Taste Match %, similar-taste
suggestions, the activity feed with likes and comments, and invite links + QR codes.
Under-18 accounts: always friends-only, never suggested, not followable by strangers, found only by exact username.
`js/vendor/qrcode.js` is qrcode-generator by Kazuhiko Arase (MIT).

## Chat (Part 2)
Upload the app code first, then run `supabase/004_chat.sql`. It adds 1-on-1 and group chats (up to 20),
title cards, reactions, read receipts (can be turned off), typing indicator, message requests from
non-friends, mute, block and report. Messages are checked on the server (links, scams, harassment,
sexual content, hate) and rate limited. Under 18: chat only with friends. Live updates use Supabase
Realtime; the app falls back to checking every few seconds if live updates can't connect.

## Recommendations (Part 3)
Upload the app code first, then run `supabase/005_recs.sql`. Every title has a "🎁 Recommend to..."
button: pick friends and add a short note. Friends get it in Friends → 🎁 Recs → "For me", where they
can tap Watched it, Watchlist or Not for me. When they rate it, you get a notification. If they loved
it (4★ or more) you earn 10 Good Taste points (+5 XP). "Best Recommender" ranks you and your friends.
Friends only, one per friend per title, no titles they already rated, 50 an hour. Notes are checked
on the server.

## Heartbeat Plus (Part 4)
Upload the app code first, then run `supabase/006_plus.sql`. Plus is $3.99/month or $29.99/year with a
7-day free trial (one per person), and $1.99/month for students with a confirmed .edu email.
Everything core stays free. Plus gives no XP, rank or leaderboard advantage.

Plus today: Heartbeat Wrapped (story slides), Taste Match Pro, Movie Night picker, profile themes /
banners / avatar frames, and a Plus badge. Coming later: custom lists with friends, watch parties,
Streak Shield.

Payments use Stripe Checkout. Plus status is only changed on the server (`/api/stripe-webhook` and
`/api/billing`), never by the app. To turn payments on, add these in Vercel → Settings → Environment
Variables (never paste them into chat or code):
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`,
`STRIPE_PRICE_STUDENT`, `SUPABASE_SERVICE_ROLE_KEY`. Then in Stripe add the webhook
`https://<your site>/api/stripe-webhook` with events `checkout.session.completed` and
`customer.subscription.created/updated/deleted`, and turn on the Customer Portal.
Until then the Plus page says "Payments open soon" and the free app works as usual.

## Ranks & game system (Part 5)
Upload the app code first, then run `supabase/007_game.sql`. Everything is decided on the server.
- **Leagues:** 7 tiers (Bronze → Diamond), up to 30 people per group, weeks start Monday (UTC).
  Top 7 move up, bottom 5 move down. The #1 of a Diamond group (10+ players) wins a free month of Plus.
  Weeks close by themselves the first time someone opens a league after Monday.
- **Daily challenges** (3 a day, +15 XP) and **weekly quests** (3 a week, +60 XP). A finished quest
  also gives a free user 1 Streak Shield a month.
- **Streak tools:** Streak Shield fixes a streak after missing one day (Plus: 2 a month).
  Take a break (1–14 days, once a month). Mystery box at every 7-day streak.
- **Badges:** 19 achievements from real activity. Each rank also gives a free profile frame color.
- **Events:** prediction games. The Oscars 2027 event is "coming soon". When nominees are out, add them
  in the SQL editor, for example:
  `update event_categories set nominees = '[{"k":"movie:123","label":"Title"}]' where event = 'oscars-2027' and name = 'Best Picture';`
  then `update events set status = 'open', locks_at = '2027-03-01 00:00+00' where slug = 'oscars-2027';`
  After the show: set each `winner` (the nominee's `k`) and run `select finish_event('oscars-2027');`
- Recommendations a friend loves now give **+15 XP** (was +5).
