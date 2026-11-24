import { TITLES, BYID, LISTS } from '../data.js';
import { U, dailyPick, forYou, streakAlive, myScore } from '../store.js';
import { card, poster, esc, hydratePosters } from '../ui.js';

export function listTitles(key) {
  const L = LISTS[key];
  if (L.ids) return L.ids.map(id => BYID[id]);
  return TITLES.slice().sort((a, b) => L.sort(b) - L.sort(a)).slice(0, L.take);
}
export function listBadge(key, t) {
  const gap = Math.round((t.hype[1] - t.hype[0]) / t.hype[0] * 100);
  return { trending: '🔥 Trending', gems: '💎 Hidden gem', overhyped: '🎈 Overhyped', quit: '🚪 Often quit' }[key];
}
const sub = (key, t) => {
  const gap = Math.round((t.hype[1] - t.hype[0]) / t.hype[0] * 100);
  return key === 'gems' ? `Underrated by ${gap}%` : key === 'overhyped' ? `Overhyped by ${-gap}%` : `${t.year} · ${t.genres[0]}`;
};

export function renderHome(app) {
  document.title = 'Heartbeat — rate the journey, not just the ending';
  const pick = dailyPick(), fy = forYou(pick), streak = streakAlive();
  const hour = new Date().getHours(), hi = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const saved = Object.keys(U.watchlist).map(id => BYID[id]).filter(Boolean);
  const rows = ['trending', 'gems', 'overhyped', 'quit'];
  app.innerHTML = `<div class="screen">
  <div class="proto">Prototype · sample data</div>
  <header class="top">
    <div class="logo"><span class="mark"><svg viewBox="0 0 32 32" width="24" height="24"><path d="M3 17h6l2.5-6 4 12 3-9 2 3H29" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>heartbeat</div>
    <a class="icon-btn" href="#/me" aria-label="Your streak: ${streak} days">🔥${streak ? `<span class="dot">${streak}</span>` : ''}</a>
  </header>
  <div class="hello">${hi}! <b>Rate the journey,</b> not just the ending.</div>
  <a class="searchbar" href="#/search" role="search" aria-label="Search movies and series"><span aria-hidden="true">🔎</span> Search movies & series…</a>

  <div class="sec"><h2>✨ Today's pick for you</h2></div>
  <a class="card pick" href="#/t/${pick.id}">
    ${poster(pick, { mine: false })}
    <div><div class="kicker">${fy ? `Our guess for you: ★ ${fy.score}` : 'A great place to start'}</div>
      <h3>${esc(pick.name)}</h3>
      <div class="sub">${pick.year} · ${esc(pick.genres.join(' · '))}</div>
      <div class="btn sm" style="margin-top:10px">See the journey →</div></div>
  </a>

  <a class="card" href="#/rate" style="display:flex;align-items:center;gap:14px">
    <span style="font-size:38px" aria-hidden="true">⚡</span>
    <div style="flex:1"><h3>Quick Rate</h3><div class="sub">Swipe through movies you've seen. 10 in a minute.</div></div>
    <span class="btn sm" aria-hidden="true">Go</span>
  </a>

  ${saved.length ? `<div class="sec"><h2>🔖 Your watchlist</h2><a class="see" href="#/me">See all</a></div>
  <div class="row">${saved.map(t => card(t)).join('')}</div>` : ''}

  ${rows.map(k => `<div class="sec"><h2>${LISTS[k].emoji} ${LISTS[k].name}</h2><a class="see" href="#/list/${k}">See all</a></div>
  <div class="row">${listTitles(k).map(t => card(t, { badge: listBadge(k, t), sub: sub(k, t) })).join('')}</div>`).join('')}

  <div class="sec"><h2>🎬 Everything</h2></div>
  <div class="grid">${TITLES.map(t => card(t)).join('')}</div>
  </div>`;
  hydratePosters(app);
}
export { sub as rowSub };
