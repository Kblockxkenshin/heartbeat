// Vercel serverless function: a small, safe helper for the free TMDB API.
// The secret key stays on the server. Set TMDB_API_KEY in Vercel → Settings → Environment Variables.
//
//   /api/tmdb?q=breaking bad          -> search movies + series
//   /api/tmdb?type=movie&id=27205     -> one movie
//   /api/tmdb?type=tv&id=1396         -> one series
// Images are built in the browser from poster_path/backdrop_path:
//   https://image.tmdb.org/t/p/w500{poster_path}

async function tmdb(path, params = {}) {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw Object.assign(new Error('TMDB_API_KEY is not set'), { code: 503 });
  const u = new URL('https://api.themoviedb.org/3/' + path);
  const headers = { accept: 'application/json' };
  // Works with both the short "API Key" and the long "API Read Access Token".
  if (key.length > 60) headers.Authorization = 'Bearer ' + key; else u.searchParams.set('api_key', key);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers });
  if (!r.ok) throw Object.assign(new Error('TMDB error ' + r.status), { code: r.status === 404 ? 404 : 502 });
  return r.json();
}

export default async function handler(req, res) {
  try {
    const { q, type, id } = req.query;
    if (q) {
      const data = await tmdb('search/multi', { query: String(q).slice(0, 100), include_adult: 'false', language: 'en-US', page: '1' });
      const results = (data.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv').slice(0, 12).map(r => ({
        id: r.id, type: r.media_type, name: r.title || r.name,
        year: (r.release_date || r.first_air_date || '').slice(0, 4),
        poster_path: r.poster_path || null,
      }));
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({ results });
    }
    if ((type === 'movie' || type === 'tv') && /^\d+$/.test(String(id || ''))) {
      const d = await tmdb(`${type}/${id}`, { language: 'en-US' });
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
      return res.status(200).json({
        id: d.id, type, name: d.title || d.name,
        year: (d.release_date || d.first_air_date || '').slice(0, 4),
        genres: (d.genres || []).map(g => g.name),
        overview: d.overview || '',
        poster_path: d.poster_path || null,
        backdrop_path: d.backdrop_path || null,
        runtime: d.runtime || (d.episode_run_time && d.episode_run_time[0]) || null,
        seasons: type === 'tv' ? (d.seasons || []).filter(s => s.season_number > 0).map(s => s.episode_count || 1) : null,
      });
    }
    return res.status(400).json({ error: 'Use ?q=name or ?type=movie|tv&id=123' });
  } catch (e) {
    return res.status(e.code || 500).json({ error: e.message });
  }
}
