// Vercel serverless function: a small, safe helper for the free TMDB API.
// Your TMDB key stays secret on the server (set TMDB_API_KEY in Vercel).
//
//   /api/tmdb?q=breaking bad          -> search movies + series
//   /api/tmdb?type=movie&id=27205     -> one movie (title, poster, year, genres, cast, plot, runtime)
//   /api/tmdb?type=tv&id=1396         -> one series (also episode count per season)

const IMG = 'https://image.tmdb.org/t/p/w342';

async function tmdb(path, params = {}) {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error('TMDB_API_KEY is not set');
  const u = new URL('https://api.themoviedb.org/3/' + path);
  // Works with both the short "API Key" and the long "API Read Access Token".
  const headers = { accept: 'application/json' };
  if (key.length > 60) headers.Authorization = 'Bearer ' + key;
  else u.searchParams.set('api_key', key);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers });
  if (!r.ok) throw new Error('TMDB error ' + r.status);
  return r.json();
}

export default async function handler(req, res) {
  try {
    const { q, type, id } = req.query;

    if (q) {
      const data = await tmdb('search/multi', { query: String(q).slice(0, 100), include_adult: 'false', language: 'en-US', page: '1' });
      const results = (data.results || [])
        .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
        .slice(0, 10)
        .map(r => ({
          id: r.id,
          type: r.media_type,
          name: r.title || r.name,
          year: (r.release_date || r.first_air_date || '').slice(0, 4),
          poster: r.poster_path ? IMG + r.poster_path : null,
        }));
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({ results });
    }

    if ((type === 'movie' || type === 'tv') && /^\d+$/.test(String(id || ''))) {
      const d = await tmdb(`${type}/${id}`, { append_to_response: 'credits', language: 'en-US' });
      const out = {
        id: d.id,
        type,
        name: d.title || d.name,
        year: (d.release_date || d.first_air_date || '').slice(0, 4),
        genres: (d.genres || []).map(g => g.name),
        cast: ((d.credits && d.credits.cast) || []).slice(0, 5).map(c => c.name),
        plot: d.overview || '',
        poster: d.poster_path ? IMG + d.poster_path : null,
        runtime: d.runtime || (d.episode_run_time && d.episode_run_time[0]) || null,
        seasons: type === 'tv' ? (d.seasons || []).filter(s => s.season_number > 0).map(s => s.episode_count || 1) : null,
      };
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
      return res.status(200).json(out);
    }

    return res.status(400).json({ error: 'Use ?q=name or ?type=movie|tv&id=123' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
