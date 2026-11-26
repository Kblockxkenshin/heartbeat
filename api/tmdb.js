// Vercel serverless function: a small, safe helper for the free TMDB API.
// The secret key stays on the server. Set TMDB_API_KEY in Vercel → Settings → Environment Variables.
//
//   /api/tmdb?q=breaking bad          -> search movies + series
//   /api/tmdb?type=movie&id=27205     -> one movie
//   /api/tmdb?type=tv&id=1396         -> one series
//   /api/tmdb?upcoming=1&page=1[&lang=hi] -> upcoming Indian movies (next 6 months) with director + main cast
//   /api/tmdb?released=2026&page=1[&lang=hi][&sort=pop] -> Indian movies already released that year (newest first, or most popular)
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

// Indian languages for the Upcoming page (TMDB original_language codes).
export const IN_LANGS = ['hi', 'te', 'ta', 'ml', 'kn', 'bn', 'mr', 'pa', 'gu', 'or', 'as'];
let genreCache = null;
async function genres() {
  if (!genreCache) { const g = await tmdb('genre/movie/list', { language: 'en-US' }); genreCache = Object.fromEntries((g.genres || []).map(x => [x.id, x.name])); }
  return genreCache;
}
const iso = d => d.toISOString().slice(0, 10);
async function upcoming(query) {
  const lang = IN_LANGS.includes(String(query.lang)) ? String(query.lang) : IN_LANGS.join('|');
  const page = Math.min(Math.max(parseInt(query.page, 10) || 1, 1), 5);
  const today = new Date(), until = new Date(Date.now() + 183 * 864e5);
  const [d, G] = await Promise.all([tmdb('discover/movie', {
    region: 'IN', with_original_language: lang, 'release_date.gte': iso(today), 'release_date.lte': iso(until),
    with_release_type: '2|3', sort_by: 'primary_release_date.asc', include_adult: 'false', include_video: 'false', language: 'en-US', page: String(page),
  }), genres()]);
  const list = (d.results || []).slice(0, 20);
  // Director + 3 main actors for each film (cached by Vercel for 6 hours).
  const credits = await Promise.all(list.map(m => tmdb(`movie/${m.id}/credits`, { language: 'en-US' }).catch(() => null)));
  return {
    page, total_pages: Math.min(d.total_pages || 1, 5),
    results: list.map((m, i) => ({
      id: m.id, name: m.title, original_name: m.original_title !== m.title ? m.original_title : null, lang: m.original_language,
      date: m.release_date || null, poster_path: m.poster_path || null, overview: (m.overview || '').slice(0, 400),
      genres: (m.genre_ids || []).map(g => G[g]).filter(Boolean),
      director: (credits[i]?.crew || []).filter(c => c.job === 'Director').map(c => c.name).slice(0, 2),
      cast: (credits[i]?.cast || []).slice(0, 3).map(c => c.name),
    })),
  };
}

async function released(query) {
  const year = Math.min(Math.max(parseInt(query.released, 10) || new Date().getFullYear(), 1950), new Date().getFullYear());
  const lang = IN_LANGS.includes(String(query.lang)) ? String(query.lang) : IN_LANGS.join('|');
  const page = Math.min(Math.max(parseInt(query.page, 10) || 1, 1), 100);
  const end = new Date(Math.min(Date.now(), Date.UTC(year, 11, 31)));
  const d = await tmdb('discover/movie', {
    region: 'IN', with_original_language: lang, 'primary_release_date.gte': `${year}-01-01`, 'primary_release_date.lte': iso(end),
    sort_by: query.sort === 'pop' ? 'popularity.desc' : 'primary_release_date.desc', include_adult: 'false', include_video: 'false', language: 'en-US', page: String(page),
  });
  return {
    page, total_pages: Math.min(d.total_pages || 1, 100), total: d.total_results || 0,
    results: (d.results || []).map(m => ({ id: m.id, name: m.title, original_name: m.original_title, lang: m.original_language, date: m.release_date || null, poster_path: m.poster_path || null })),
  };
}

export default async function handler(req, res) {
  try {
    const { q, type, id } = req.query;
    if (req.query.released) {
      const out = await released(req.query);
      res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
      return res.status(200).json(out);
    }
    if (req.query.upcoming) {
      const out = await upcoming(req.query);
      res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
      return res.status(200).json(out);
    }
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
      const d = await tmdb(`${type}/${id}`, { language: 'en-US', append_to_response: 'videos' });
      // Best YouTube trailer: official trailers first, then teasers.
      const vids = (d.videos?.results || []).filter(v => v.site === 'YouTube' && /^[\w-]{6,20}$/.test(v.key || '') && (v.type === 'Trailer' || v.type === 'Teaser'));
      vids.sort((a, b) => (b.type === 'Trailer') - (a.type === 'Trailer') || (b.official === true) - (a.official === true));
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
        release_date: d.release_date || d.first_air_date || null,
        trailer: vids[0]?.key || null,
      });
    }
    return res.status(400).json({ error: 'Use ?q=name or ?type=movie|tv&id=123' });
  } catch (e) {
    return res.status(e.code || 500).json({ error: e.message });
  }
}
