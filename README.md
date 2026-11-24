# Heartbeat 💓 — rate the journey, not just the ending

Playful, phone-first movie & series rating app. Prototype: ratings are saved on your device only.

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
