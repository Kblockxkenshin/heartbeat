// Talks to our own /api/tmdb helper (which holds the secret key) and caches results.
import { CONFIG, LIVE } from './config.js';

const CK = 'heartbeat_tmdb_cache';
let cache = {};
try { cache = JSON.parse(localStorage.getItem(CK)) || {}; } catch (e) { cache = {}; }
const persist = () => { try { localStorage.setItem(CK, JSON.stringify(cache)); } catch (e) { /* full or blocked */ } };
const fresh = c => c && Date.now() - c.at < CONFIG.cacheDays * 864e5;

export const img = (path, size) => path ? CONFIG.imageBase + size + path : null;
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

/** Merge cached TMDB data into a title object (sync). */
export function apply(t) {
  const c = cache[t.type + t.tmdb];
  if (!c || !c.ok) return t;
  // Safety: only trust the match if the names look alike.
  const a = norm(c.name), b = norm(t.name);
  if (!(a.includes(b.slice(0, 6)) || b.includes(a.slice(0, 6)))) return t;
  t.poster = img(c.poster_path, CONFIG.posterSize);
  t.backdrop = img(c.backdrop_path, CONFIG.backdropSize);
  if (c.year) t.year = +c.year;
  if (c.genres?.length) t.genres = c.genres.slice(0, 3);
  if (c.runtime) t.runtime = c.runtime;
  if (c.overview) t.overview = c.overview;
  return t;
}

const inflight = {};
/** Fetch real info for many titles. Calls onUpdate once when anything new arrives. */
export function hydrate(titles, onUpdate) {
  if (!LIVE) return;
  const need = titles.filter(t => t.tmdb && !fresh(cache[t.type + t.tmdb]) && !inflight[t.type + t.tmdb]);
  if (!need.length) return;
  let changed = false, left = need.length;
  need.forEach(t => {
    const k = t.type + t.tmdb;
    inflight[k] = fetch(`${CONFIG.tmdbProxy}?type=${t.type}&id=${t.tmdb}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { cache[k] = d ? { ...d, ok: true, at: Date.now() } : { ok: false, at: Date.now() }; if (d) { apply(t); changed = true; } })
      .catch(() => {})
      .finally(() => { delete inflight[k]; if (--left === 0) { persist(); if (changed) onUpdate(); } });
  });
}

export async function search(q) {
  if (!LIVE || q.trim().length < 2) return [];
  try {
    const r = await fetch(`${CONFIG.tmdbProxy}?q=${encodeURIComponent(q)}`);
    if (!r.ok) return [];
    const j = await r.json();
    return (j.results || []).map(x => ({ ...x, poster: img(x.poster_path, 'w185') }));
  } catch (e) { return []; }
}
