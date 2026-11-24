// Everything the user does is saved on this device (localStorage), wrapped in try/catch.
import { TITLES, BYID, PEOPLE, BADGES, LISTS } from './data.js';

const KEY = 'heartbeat_v2';
const fresh = () => ({
  name: 'You', joined: Date.now(),
  ratings: {},     // id -> {start, middle, end, overall, ts}
  swipes: {},      // id -> 'loved' | 'disliked' | 'unseen'
  watchlist: {},   // id -> ts
  streak: { count: 0, last: null, days: [] },
  badges: {},      // id -> ts
  recent: [],      // recent searches
  settings: { reminders: true },
  tags: [], gotGood: {}, quit: {}, progress: {}, likes: {}, helped: {}, videos: {},
});

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s === 'object') return Object.assign(fresh(), s);
  } catch (e) { /* storage blocked or corrupt */ }
  return fresh();
}
export const U = load();
export function save() { try { localStorage.setItem(KEY, JSON.stringify(U)); } catch (e) { /* ignore */ } }

const day = (d = new Date()) => d.toISOString().slice(0, 10);

/** Call on any rating action. Returns {streakUp, newBadges}. */
function activity() {
  const today = day();
  let streakUp = false;
  if (U.streak.last !== today) {
    const y = day(new Date(Date.now() - 864e5));
    U.streak.count = U.streak.last === y ? U.streak.count + 1 : 1;
    U.streak.last = today;
    U.streak.days = [...new Set([...(U.streak.days || []), today])].slice(-30);
    streakUp = U.streak.count > 1;
  }
  const newBadges = checkBadges();
  save();
  return { streakUp, newBadges };
}

export function rate(id, j) {
  const overall = Math.round(((j.start + j.middle + j.end * 2) / 4) * 2) / 2;
  U.ratings[id] = { ...j, overall, ts: Date.now() };
  if (U.swipes[id] === 'unseen') delete U.swipes[id];
  return activity();
}
export function swipe(id, kind) { U.swipes[id] = kind; return activity(); }
export function toggleSave(id) { if (U.watchlist[id]) delete U.watchlist[id]; else U.watchlist[id] = Date.now(); const r = checkBadges(); save(); return { saved: !!U.watchlist[id], newBadges: r }; }
export function addRecent(q) { q = q.trim(); if (!q) return; U.recent = [q, ...U.recent.filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 6); save(); }

/** My 1–5 score for a title, from a full rating or a swipe. */
export function myScore(id) {
  if (U.ratings[id]) return U.ratings[id].overall;
  if (U.swipes[id] === 'loved') return 4.5;
  if (U.swipes[id] === 'disliked') return 2;
  return null;
}
function myVector() { const v = {}; TITLES.forEach(t => { const s = myScore(t.id); if (s != null) v[t.id] = s; }); return v; }

export function similarity(a, b) {
  const ks = Object.keys(a).filter(k => b[k] != null);
  if (ks.length < 2) return null;
  const d = ks.reduce((s, k) => s + Math.abs(a[k] - b[k]), 0) / ks.length;
  return { pct: Math.max(0, Math.min(99, Math.round(100 - d * 26 + Math.min(ks.length, 6)))), shared: ks };
}
export function matches() {
  const me = myVector();
  return PEOPLE.map(p => ({ p, m: similarity(me, p.r) })).filter(x => x.m).sort((a, b) => b.m.pct - a.m.pct);
}
/** Predicted score for you (1–5) from people with similar taste. */
export function forYou(t) {
  const me = myVector(); let w = 0, s = 0, n = 0;
  PEOPLE.forEach(p => { if (p.r[t.id] == null) return; const m = similarity(me, p.r); if (!m) return; const wt = (m.pct / 100) ** 3; w += wt; s += wt * p.r[t.id]; n++; });
  if (!w) return null;
  return { score: Math.round((s / w * .75 + t.hype[1] / 2 * .25) * 10) / 10, n };
}

export function stats() {
  const rated = Object.keys(U.ratings).length + Object.values(U.swipes).filter(x => x !== 'unseen').length;
  const rs = Object.entries(U.ratings);
  const gemIds = TITLES.slice().sort((a, b) => LISTS.gems.sort(b) - LISTS.gems.sort(a)).slice(0, 6).map(t => t.id);
  const gems = gemIds.filter(id => (myScore(id) || 0) >= 4).length;
  const scores = TITLES.map(t => myScore(t.id)).filter(x => x != null);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const genre = {};
  TITLES.forEach(t => { const s = myScore(t.id); if (s == null) return; t.genres.forEach(g => { genre[g] = genre[g] || { n: 0, sum: 0 }; genre[g].n++; genre[g].sum += s; }); });
  const genres = Object.entries(genre).map(([g, v]) => ({ g, n: v.n, avg: v.sum / v.n, score: v.sum })).sort((a, b) => b.score - a.score).slice(0, 4);
  let style = null;
  if (rs.length) {
    const st = rs.reduce((a, [, r]) => a + r.start, 0) / rs.length, en = rs.reduce((a, [, r]) => a + r.end, 0) / rs.length;
    const diff = en - st;
    style = diff <= -0.5 ? { e: '🧐', name: 'Tough on endings', note: 'You expect a story to stick the landing.' }
      : diff >= 0.5 ? { e: '🎢', name: 'Slow-burn lover', note: 'You forgive slow starts if the ending pays off.' }
      : { e: '⚖️', name: 'Even-keeled', note: 'You judge the whole ride fairly.' };
    style.start = st; style.end = en;
  }
  const m = matches();
  return {
    rated, gems, avg, genres, style, journeys: rs.length,
    swipes: Object.keys(U.swipes).length, saved: Object.keys(U.watchlist).length,
    streak: U.streak.count, bestMatch: m[0] ? m[0].m.pct : 0,
    xp: rs.length * 15 + Object.keys(U.swipes).length * 4 + Object.keys(U.watchlist).length * 2,
  };
}
export function level(xp) { const lv = Math.floor(Math.sqrt(xp / 25)) + 1; const lo = (lv - 1) ** 2 * 25, hi = lv ** 2 * 25; return { lv, pct: Math.round((xp - lo) / (hi - lo) * 100), toNext: hi - xp }; }

function checkBadges() {
  const s = stats(); const got = [];
  BADGES.forEach(b => { if (!U.badges[b.id] && b.test(s)) { U.badges[b.id] = Date.now(); got.push(b); } });
  return got;
}
export function streakAlive() { const t = day(), y = day(new Date(Date.now() - 864e5)); return U.streak.last === t || U.streak.last === y ? U.streak.count : 0; }
export function dailyPick() {
  const todo = TITLES.filter(t => myScore(t.id) == null);
  const pool = todo.length ? todo : TITLES;
  const seed = [...day()].reduce((a, c) => a * 31 + c.charCodeAt(0) >>> 0, 7);
  const scored = pool.map(t => ({ t, s: (forYou(t)?.score || t.hype[1] / 2) + ((seed ^ t.tmdb) % 100) / 250 }));
  return scored.sort((a, b) => b.s - a.s)[0].t;
}
export const titleById = id => BYID[id];
export const today = day;
