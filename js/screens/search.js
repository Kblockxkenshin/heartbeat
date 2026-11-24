import { TITLES } from '../data.js';
import { U, addRecent, save } from '../store.js';
import { $, esc, poster, hydratePosters, empty } from '../ui.js';
import { search as tmdbSearch } from '../tmdb.js';
import { rerender } from '../app.js';

const norm = s => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, '').trim();
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
/** Instant local search that forgives spelling mistakes. */
export function localSearch(q) {
  q = norm(q); if (!q) return [];
  return TITLES.map(t => {
    const n = norm(t.name); let sc = n.startsWith(q) ? 0 : n.includes(q) ? 1 : 99;
    if (sc === 99) { const best = Math.min(...n.split(' ').concat([n]).map(w => lev(q, w.slice(0, Math.max(q.length, Math.min(w.length, q.length + 1)))))); if (best <= Math.max(1, Math.floor(q.length / 3))) sc = 2 + best; }
    if (sc === 99 && t.genres.some(g => norm(g).startsWith(q))) sc = 5;
    return { t, sc };
  }).filter(x => x.sc < 99).sort((a, b) => a.sc - b.sc).map(x => x.t);
}

export function renderSearch(app, initial = '') {
  document.title = 'Search — Heartbeat';
  app.innerHTML = `<div class="screen">
    <header class="top"><div class="logo" style="font-size:24px">Search</div></header>
    <label class="searchbar" style="cursor:text"><span aria-hidden="true">🔎</span><input id="q" type="search" placeholder="Movie, series or genre…" autocomplete="off" aria-label="Search movies and series" value="${esc(initial)}"></label>
    <div id="out"></div>
  </div>`;
  const q = $('#q'), out = $('#out'); let timer, live = [];
  const row = (t, href) => `<a class="res" href="${href}">${poster(t, { mine: false })}<div><b>${esc(t.name)}</b><div class="meta">${t.year || ''} · ${t.type === 'tv' ? 'Series' : 'Movie'}${t.genres?.length ? ' · ' + esc(t.genres.slice(0, 2).join(', ')) : ''}</div></div></a>`;
  const draw = () => {
    const v = q.value;
    if (!v.trim()) {
      out.innerHTML = (U.recent.length ? `<div class="sec"><h2>🕘 Recent</h2><button class="see" id="clr">Clear</button></div><div class="recent">${U.recent.map(r => `<button class="chip" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : '')
        + `<div class="sec"><h2>💡 Try</h2></div><div class="recent">${['Sci-Fi', 'Comedy', 'breking bad', 'intersteller'].map(r => `<button class="chip" data-r="${r}">${r}</button>`).join('')}</div>`;
    } else {
      const loc = localSearch(v);
      const extra = live.filter(x => !loc.some(t => norm(t.name) === norm(x.name))).slice(0, 8)
        .map(x => ({ id: 'x', name: x.name, year: x.year, type: x.type, genres: [], poster: x.poster, colors: ['#262036', '#ff4f9a'] }));
      out.innerHTML = loc.map(t => row(t, `#/t/${t.id}`)).join('')
        + (extra.length ? `<div class="sec"><h2>🌍 More from TMDB</h2></div>` + extra.map(t => row(t, `#/search/${encodeURIComponent(t.name)}`)).join('') : '')
        + (!loc.length && !extra.length ? empty(`No match for “${esc(v)}” yet.<br>Check the spelling or try a genre.`, 'sad') : '');
    }
    hydratePosters(out);
  };
  q.addEventListener('input', () => { draw(); clearTimeout(timer); timer = setTimeout(async () => { live = await tmdbSearch(q.value); draw(); }, 280); });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') { addRecent(q.value); const a = out.querySelector('a.res'); if (a) a.click(); } });
  out.addEventListener('click', e => {
    const c = e.target.closest('[data-r]'); if (c) { q.value = c.dataset.r; q.dispatchEvent(new Event('input')); return; }
    if (e.target.closest('#clr')) { U.recent = []; save(); rerender(); return; }
    if (e.target.closest('a.res')) addRecent(q.value);
  });
  draw(); setTimeout(() => q.focus(), 60);
}
