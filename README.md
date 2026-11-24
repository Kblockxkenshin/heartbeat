# Heartbeat 💓 — rate the journey, not just the ending

This folder is a working prototype. Open `index.html` in a browser to try it.
Right now it uses **sample data**. Your taps are saved only on your own device.

What works now:
- Search with suggestions that fixes spelling mistakes (try "breking bad")
- Title page: pick the whole show, one season, or one episode
- Heartbeat graph (tap any point), "Gets good at", "Where people quit"
- Hype vs Reality, Your Score, Vibe Card, spoiler-hidden reviews
- Video review feed (swipe up/down), likes, comments, "Helped me decide", report
- Paste a YouTube Shorts / TikTok / Instagram Reel link (the link is checked first)
- Taste Match + invite link, profile with "Founding Reviewer" badge
- Share links, "Save as image" for Vibe Cards and Heartbeat graphs
- Installs on a phone like an app (after it is online)

---

## Step 1 — Get a free TMDB API key (about 5 minutes)

1. Go to **themoviedb.org** and click **Join TMDB**. Make a free account.
2. Open the email from TMDB and click the link to confirm your account.
3. Log in. Click your profile picture (top right) → **Settings**.
4. On the left, click **API**.
5. Click **Create** (or "Request an API key") → choose **Developer**.
6. Accept the terms. Fill in the short form:
   - Type of use: **Personal / non-commercial**
   - App name: **Heartbeat**
   - App URL: put your Vercel address later, or `https://heartbeat.vercel.app` for now
   - Summary: "A free app to rate movies and shows and share short reviews."
7. Click **Submit**. You will see two keys. Copy the one called **API Read Access Token** (the long one).
   Keep it secret. Do not paste it into `index.html`.

## Step 2 — Put the app online free on Vercel (about 10 minutes)

The easy way (uses GitHub, also free):

1. Make a free account at **github.com**.
2. Click **+** (top right) → **New repository**. Name it `heartbeat`. Click **Create repository**.
3. On the new page, click **uploading an existing file**. Drag in **everything in this folder**
   (including the `api` and `supabase` folders). Click **Commit changes**.
4. Go to **vercel.com** → **Sign Up** → choose **Hobby** (free) → **Continue with GitHub**.
5. Click **Add New… → Project**. Find `heartbeat` and click **Import**.
6. Open **Environment Variables**. Add:
   - Name: `TMDB_API_KEY`  Value: (paste your TMDB token from Step 1)
7. Click **Deploy**. Wait about 1 minute.
8. You get a free address like `heartbeat-abc.vercel.app`. Open it. Search now finds **real** movies and shows.
9. To change the name: Project → **Settings → Domains** → edit to something like `heartbeat-reviews.vercel.app` (if it's free).

Install on your phone: open your link in Chrome (Android) → menu ⋮ → **Add to Home screen**.
On iPhone: open in Safari → Share button → **Add to Home Screen**.

Every time you change a file on GitHub, Vercel updates the site by itself.

## Step 3 — Set up free Supabase (database + login) (about 15 minutes)

1. Go to **supabase.com** → **Start your project** → sign in with GitHub.
2. Click **New project**. Name: `heartbeat`. Make a strong database password and save it somewhere safe.
   Pick the region closest to you. Plan: **Free**. Click **Create**. Wait 1–2 minutes.
3. On the left, click **SQL Editor** → **New query**.
   Open `supabase/schema.sql` from this folder, copy all of it, paste it in, click **Run**.
   You should see "Success". (Run it only once.)
4. **Email login:** left side → **Authentication → Sign In / Providers → Email**. Make sure it is ON.
5. **Google login:**
   - Go to **console.cloud.google.com** → make a new project called Heartbeat.
   - Search for **"OAuth consent screen"** → set it up as **External**, add your app name and email.
   - Go to **Credentials → Create credentials → OAuth client ID → Web application**.
   - Under "Authorized redirect URIs", paste the **Callback URL** shown in Supabase
     (Authentication → Providers → Google). It looks like `https://xxxx.supabase.co/auth/v1/callback`.
   - Copy the **Client ID** and **Client secret** into Supabase → Google provider → turn it ON → Save.
6. Supabase → **Authentication → URL Configuration** → set **Site URL** to your Vercel address.
7. Supabase → **Project Settings → API**. Copy the **Project URL** and the **anon public** key.
   These two are safe to put in the website (the security rules in `schema.sql` protect the data).
8. Send those two values to Claude and ask: "Connect Heartbeat to Supabase." The next build step
   swaps the sample data for real data and turns on the login buttons.

---

## ⚠️ Things that might cost money later (read this)

Everything above is free today. Watch out for these:

- **Vercel Hobby (free) is for personal, non-commercial use only.** If you add ads, sell anything,
  or run it as a business, you must move to the paid Pro plan.
- **TMDB is free for non-commercial use** and you must show their credit (the app already does).
  If the app makes money, you need a commercial agreement with TMDB.
  Add the official TMDB logo from themoviedb.org/about/logos-attribution to replace the text badge.
- **Supabase free plan pauses your project after 1 week with no activity.** You get an email first.
  Open the dashboard to wake it up. Limits: 2 free projects, 500 MB database per project.
  If you need more or want no pausing, Pro costs money.
- **Custom domain** (like heartbeat.com) costs money. The `.vercel.app` address is free.
- **Video embeds:** YouTube and TikTok embeds are free. Instagram embeds sometimes need a
  Meta developer app; if a Reel doesn't show, the app shows an "Open on Instagram" button instead.
- **Share previews (nice image when you paste a link)** and **Google search pages** need the next
  build step: real page addresses (like `/title/breaking-bad`) made on the server. Vercel can do this
  free with Next.js. The prototype uses `#/t/...` links, which work for sharing but don't make
  per-title previews yet.

## Files

- `index.html` — the whole app (design + logic)
- `api/tmdb.js` — keeps your TMDB key secret and fetches real movie/show data
- `supabase/schema.sql` — the database tables and security rules
- `manifest.json`, `sw.js`, `icon.svg` — make it install like a phone app
