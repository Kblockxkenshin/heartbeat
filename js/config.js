// App settings. Your secret TMDB key is NOT here.
// It lives on the server as the TMDB_API_KEY environment variable (see .env.example),
// and /api/tmdb.js uses it. The browser only ever talks to /api/tmdb.
export const CONFIG = {
  tmdbProxy: '/api/tmdb',
  imageBase: 'https://image.tmdb.org/t/p/',
  // Responsive sizes: phone gets w342, bigger screens w500, backdrops w1280.
  posterSizes: [['w342', 342], ['w500', 500]],
  backdropSize: 'w1280',
  cacheDays: 7,
  failRetryMinutes: 10,
};

// TMDB works whenever the app runs on a real web server (Vercel, or a local test server).
export const LIVE = /^https?:$/.test(location.protocol) && !/claudeusercontent|claude\.ai/.test(location.host);
