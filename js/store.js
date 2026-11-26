// Everything the user does is saved on this device (localStorage), wrapped in try/catch.
// When signed in, ratings, Quick Rate swipes and the watchlist are ALSO saved to the server
// (see cloud.js). The server is the boss for XP, rank and streak.
import { TITLES, BYID, PEOPLE, BADGES, LISTS } from './data.js';
import { cloud, pushRating, pushSwipe, pushWatch, idOf } from './cloud.js';

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

/** Shows a small note if the server refused (for example: rate limit). */
let onSyncError = () => {};
export const setSyncErrorHandler = fn => { onSyncError = fn; };
const sync = p => p.then(r => { if (r && r.error) onSyncError(r.error); }).catch(() => {});

export function rate(id, j) {
  const overall = Math.round(((j.start + j.middle + j.end * 2) / 4) * 2) / 2;
  U.ratings[id] = { start: j.start, middle: j.middle, end: j.end, overall, ts: Date.now() };
  if (U.swipes[id] === 'unseen') delete U.swipes[id];
  sync(pushRating(id, U.ratings[id]));
  return activity();
}
export function swipe(id, kind) { U.swipes[id] = kind; sync(pushSwipe(id, kind)); return activity(); }
export function toggleSave(id) {
  if (U.watchlist[id]) delete U.watchlist[id]; else U.watchlist[id] = Date.now();
  sync(pushWatch(id, !!U.watchlist[id]));
  const r = checkBadges(); save(); return { saved: !!U.watchlist[id], newBadges: r };
}

/** After sign-in: the server copy becomes the truth on this device. */
export function applyRemote(remote, userId) {
  U.ratings = {}; U.swipes = {}; U.watchlist = {};
  remote.ratings.forEach(r => { U.ratings[idOf(r.title_key)] = { start: r.start_h, middle: r.middle_h, end: r.end_h, overall: +r.overall, ts: Date.parse(r.updated_at) }; });
  remote.swipes.forEach(r => { U.swipes[idOf(r.title_key)] = r.kind; });
  remote.watchlist.forEach(r => { U.watchlist[idOf(r.title_key)] = Date.parse(r.added_at); });
  U.syncedUser = userId;
  checkBadges(); save();
}
/** Name to show: the account username when signed in. */
export const displayName = () => cloud.profile?.username || U.name;
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
    style = diff <= -0.5 ? { e: '<i class="i i-glasses" aria-hidden="true"></i>', name: 'Tough on endings', note: 'You expect a story to stick the landing.' }
      : diff >= 0.5 ? { e: '<i class="i i-activity" aria-hidden="true"></i>', name: 'Slow-burn lover', note: 'You forgive slow starts if the ending pays off.' }
      : { e: '<i class="i i-scale" aria-hidden="true"></i>', name: 'Even-keeled', note: 'You judge the whole ride fairly.' };
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
export function streakAlive() {
  if (cloud.stats) { // server streak (UTC days)
    const t = new Date().toISOString().slice(0, 10), y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    return cloud.stats.streak_last === t || cloud.stats.streak_last === y ? cloud.stats.streak_count : 0;
  }
  const t = day(), y = day(new Date(Date.now() - 864e5)); return U.streak.last === t || U.streak.last === y ? U.streak.count : 0;
}
export function dailyPick() {
  const todo = TITLES.filter(t => myScore(t.id) == null);
  const pool = todo.length ? todo : TITLES;
  const seed = [...day()].reduce((a, c) => a * 31 + c.charCodeAt(0) >>> 0, 7);
  const scored = pool.map(t => ({ t, s: (forYou(t)?.score || t.hype[1] / 2) + ((seed ^ t.tmdb) % 100) / 250 }));
  return scored.sort((a, b) => b.s - a.s)[0].t;
}
export const titleById = id => BYID[id];
export const today = day;
