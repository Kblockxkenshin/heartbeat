import { TITLES, BYID, LISTS } from '../data.js';
import { U, dailyPick, forYou, streakAlive, displayName } from '../store.js';
import { card, row, poster, esc, hydratePosters } from '../ui.js';
import { homeFriendsHTML, fillHomeFriends } from './people.js';
import { homePlayHTML, fillHomePlay } from './play.js';

export function listTitles(key) {
  const L = LISTS[key];
  if (L.ids) return L.ids.map(id => BYID[id]);
  return TITLES.slice().sort((a, b) => L.sort(b) - L.sort(a)).slice(0, L.take);
}
export function listBadge(key) {
  return { trending: '🔥 Trending', gems: '💎 Hidden gem', overhyped: '🎈 Overhyped', quit: '🚪 Often quit' }[key];
}
export const rowSub = (key, t) => {
  const gap = Math.round((t.hype[1] - t.hype[0]) / t.hype[0] * 100);
  return key === 'gems' ? `Underrated by ${gap}%` : key === 'overhyped' ? `Overhyped by ${-gap}%` : `${t.year} · ${t.genres[0]}`;
};

export function renderHome(app) {
  document.title = 'Heartbeat — rate the journey, not just the ending';
  const pick = dailyPick(), fy = forYou(pick), streak = streakAlive();
  const hour = new Date().getHours(), hi = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const saved = Object.keys(U.watchlist).map(id => BYID[id]).filter(Boolean);
  const rows = ['trending', 'gems', 'overhyped', 'quit'];
  app.innerHTML = `<div class="screen home">
  <div class="proto">Prototype · sample ratings</div>
  <header class="top phone-only">
    <div class="logo"><span class="mark" aria-hidden="true"><svg viewBox="0 0 32 32" width="24" height="24"><path d="M3 17h6l2.5-6 4 12 3-9 2 3H29" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>heartbeat</div>
    <a class="icon-btn" href="#/me" aria-label="Your streak: ${streak} days">🔥${streak ? `<span class="dot">${streak}</span>` : ''}</a>
  </header>
  <h1 class="hello">${hi}${displayName() !== 'You' ? ', ' + esc(displayName()) : ''}! <b>Rate the journey,</b> not just the ending.</h1>
  <a class="searchbar phone-only" href="#/search" aria-label="Search movies and series"><span aria-hidden="true">🔎</span> Search movies & series…</a>

  <div class="hero-grid">
    <section aria-labelledby="pickh">
      <div class="sec"><h2 id="pickh">✨ Today's pick for you</h2></div>
      <a class="card pick" href="#/t/${pick.id}">
        ${poster(pick, { mine: false })}
        <div><div class="kicker">${fy ? `Our guess for you: ★ ${fy.score}` : 'A great place to start'}</div>
          <h3>${esc(pick.name)}</h3>
          <div class="sub">${pick.year} · ${esc(pick.genres.join(' · '))}</div>
          <p class="sub clamp3 wide-only">${esc(pick.overview)}</p>
          <span class="btn sm" style="margin-top:10px">See the journey →</span></div>
      </a>
    </section>
    <section aria-labelledby="qrh">
      <div class="sec wide-only"><h2 id="qrh">⚡ Quick Rate</h2></div>
      <a class="card qrcard" href="#/rate">
        <span class="qr-emoji" aria-hidden="true">⚡</span>
        <div style="flex:1"><h3 class="phone-only">Quick Rate</h3><div class="sub">Swipe through movies you've seen. 10 in a minute.</div><div class="sub kb-only">Use ← → ↑ on your keyboard.</div></div>
        <span class="btn sm" aria-hidden="true">Go</span>
      </a>
      ${streak ? `<a class="card streakcard wide-only" href="#/me"><span style="font-size:34px" aria-hidden="true">🔥</span><div><h3>${streak}-day streak</h3><div class="sub">Rate one thing today to keep it alive.</div></div></a>` : ''}
    </section>
  </div>

  ${homePlayHTML()}

  ${homeFriendsHTML()}

  ${saved.length ? `<div class="sec"><h2>🔖 Your watchlist</h2><a class="see" href="#/me">See all</a></div>${row(saved.map(t => card(t)).join(''), 'Your watchlist')}` : ''}

  ${rows.map(k => `<div class="sec"><h2>${LISTS[k].emoji} ${LISTS[k].name}</h2><a class="see" href="#/list/${k}" aria-label="See all ${LISTS[k].name}">See all</a></div>
  ${row(listTitles(k).map(t => card(t, { badge: listBadge(k), sub: rowSub(k, t) })).join(''), LISTS[k].name)}`).join('')}

  <div class="sec"><h2>🎬 Everything</h2></div>
  <div class="grid">${TITLES.map(t => card(t)).join('')}</div>
  </div>`;
  hydratePosters(app);
  fillHomeFriends(app);
  fillHomePlay(app);
}
