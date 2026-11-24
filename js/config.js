// App settings. Your secret TMDB key is NOT here.
// It lives on the server as the TMDB_API_KEY environment variable (see .env.example),
// and /api/tmdb.js uses it. The browser only ever talks to /api/tmdb.
export const CONFIG = {
  tmdbProxy: '/api/tmdb',
  imageBase: 'https://image.tmdb.org/t/p/',
  posterSize: 'w500',
  backdropSize: 'w1280',
  cacheDays: 7,
};

// TMDB only works when the app runs on a real web server (like Vercel).
export const LIVE = /^https?:$/.test(location.protocol) && !/claudeusercontent|claude\.ai|localhost|127\.0\.0\.1/.test(location.host);
