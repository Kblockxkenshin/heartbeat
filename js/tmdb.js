// Talks to our own /api/tmdb helper (which holds the secret key) and caches results.
import { CONFIG, LIVE } from './config.js';
import { BYID } from './data.js';

const CK = 'heartbeat_tmdb_cache';
let cache = {};
try { cache = JSON.parse(localStorage.getItem(CK)) || {}; } catch (e) { cache = {}; }
const persist = () => { try { localStorage.setItem(CK, JSON.stringify(cache)); } catch (e) { /* full or blocked */ } };
const fresh = c => c && Date.now() - c.at < (c.ok ? CONFIG.cacheDays * 864e5 : CONFIG.failRetryMinutes * 6e4);

export const img = (path, size) => path ? CONFIG.imageBase + size + path : null;
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

/** Merge cached TMDB data into a title object (sync). */
export function apply(t) {
  const c = cache[t.type + t.tmdb];
  if (!c || !c.ok) return t;
  // Safety: only trust the match if the names look alike.
  const a = norm(c.name), b = norm(t.name);
  if (!(a.includes(b.slice(0, 6)) || b.includes(a.slice(0, 6)))) return t;
  t.posterPath = c.poster_path; t.backdropPath = c.backdrop_path;
  if (c.year) t.year = +c.year;
  if (c.genres?.length) t.genres = c.genres.slice(0, 3);
  if (c.runtime) t.runtime = c.runtime;
  if (c.overview) t.overview = c.overview;
  return t;
}

const inflight = {};
function get(type, id) {
  const k = type + id;
  if (fresh(cache[k])) return Promise.resolve(cache[k].ok ? cache[k] : null);
  if (inflight[k]) return inflight[k];
  inflight[k] = fetch(`${CONFIG.tmdbProxy}?type=${type}&id=${id}`)
    .then(r => r.ok ? r.json() : null)
    .then(d => { cache[k] = d ? { ...d, ok: true, at: Date.now() } : { ok: false, at: Date.now() }; persist(); return d ? cache[k] : null; })
    .catch(() => null)
    .finally(() => { delete inflight[k]; });
  return inflight[k];
}

/** Fetch real info for many titles. Calls onUpdate once when anything new arrives. */
export function hydrate(titles, onUpdate, force = false) {
  if (!LIVE) return;
  if (force) titles.forEach(t => { delete cache[t.type + t.tmdb]; });
  const need = titles.filter(t => t.tmdb && !fresh(cache[t.type + t.tmdb]));
  if (!need.length) return;
  Promise.all(need.map(t => get(t.type, t.tmdb).then(d => { if (d) { apply(t); return true; } return false; })))
    .then(r => { if (r.some(Boolean)) onUpdate(); });
}

export async function search(q) {
  if (!LIVE || q.trim().length < 1) return [];
  try {
    const r = await fetch(`${CONFIG.tmdbProxy}?q=${encodeURIComponent(q)}`);
    if (!r.ok) return [];
    const j = await r.json();
    const t = new Date().toISOString().slice(0, 10);
    return (j.results || []).filter(x => !x.date || x.date <= t).map(x => ({ ...x, posterPath: x.poster_path }));
  } catch (e) { return []; }
}

/* Any TMDB title can get a page. Its journey numbers are demo data until people rate it. */
const hash = s => [...s].reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
export async function loadTitle(key) {
  if (BYID[key]) return BYID[key];
  const m = key.match(/^tmdb-(movie|tv)-(\d+)$/); if (!m || !LIVE) return null;
  const d = await get(m[1], m[2]); if (!d) return null;
  let s = hash(key); const r = () => ((s = Math.imul(s ^ s >>> 15, 2246822507) >>> 0) % 1000) / 1000;
  const pal = [['#2b0d4f', '#ff4f9a'], ['#0e3b4a', '#3fb6c9'], ['#3a1a0a', '#e0772b'], ['#16243f', '#9b6bff'], ['#1d5c34', '#c9b23a']];
  const h0 = 6.6 + r() * 2.2, h1 = Math.round((h0 + (r() - .5) * 1.6) * 10) / 10;
  const t = {
    id: key, tmdb: +m[2], type: m[1], name: d.name, year: +d.year || '', genres: (d.genres || []).slice(0, 3),
    runtime: d.runtime || 110, seasons: d.seasons?.length ? d.seasons : [8], overview: d.overview || '',
    posterPath: d.poster_path, backdropPath: d.backdrop_path, colors: pal[hash(key) % pal.length],
    shape: Array.from({ length: 5 }, () => .35 + r() * .6), flavor: { funny: r() * .6, scary: r() * .5, sad: r() * .5 }, twists: [.5 + r() * .45],
    hype: [Math.round(h0 * 10) / 10, h1], vibes: { 'Mind-blowing': r() * .7, 'Funny': r() * .6, 'Sad': r() * .5 },
    worth: [.55, .33, .12], best: ['With friends', 'Date night', 'Alone at 2am', 'Family'][hash(key) % 4],
    journey: [3.4 + r(), 3.4 + r(), 3.4 + r()].map(x => Math.round(x * 10) / 10), live: true,
  };
  BYID[key] = t; return t;
}
