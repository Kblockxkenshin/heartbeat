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
    <header class="top"><h1 class="logo" style="font-size:26px;margin:0">Search</h1></header>
    <label class="searchbar" style="cursor:text"><span aria-hidden="true"><i class="i i-search" aria-hidden="true"></i></span><input id="q" type="search" placeholder="Movie, series or genre…" autocomplete="off" aria-label="Search movies and series" value="${esc(initial)}"></label>
    <div id="sug" class="sugs" role="listbox" aria-label="Suggestions" hidden></div>
    <div id="out"></div>
  </div>`;
  const q = $('#q'), out = $('#out'), sug = $('#sug'); let timer, live = [], si = -1, my = 0, quiet = false;
  // Suggestions as you type: names that start with what you typed come first, then names that contain it.
  const drawSug = () => {
    const v = q.value.trim(), nv = norm(v);
    if (!nv || quiet) { sug.hidden = true; if (!nv) sug.innerHTML = ''; return; }
    const seen = new Set(), list = [];
    const push = (name, meta) => { const k = norm(name); if (!k || seen.has(k)) return; seen.add(k); list.push({ name, meta, sc: k.startsWith(nv) ? 0 : k.split(' ').some(w => w.startsWith(nv)) ? 1 : k.includes(nv) ? 2 : 3 }); };
    live.forEach(x => push(x.name, `${x.type === 'tv' ? 'Series' : 'Movie'}${x.year ? ' · ' + x.year : ''}`));
    localSearch(v).forEach(t => push(t.name, `${t.type === 'tv' ? 'Series' : 'Movie'} · ${t.year}`));
    const top = list.map((x, i) => ({ ...x, i })).sort((a, b) => a.sc - b.sc || a.i - b.i).slice(0, 7);
    const hl = n => { const k = n.toLowerCase(), at = k.indexOf(v.toLowerCase()); return at < 0 ? esc(n) : esc(n.slice(0, at)) + '<b>' + esc(n.slice(at, at + v.length)) + '</b>' + esc(n.slice(at + v.length)); };
    si = -1;
    sug.innerHTML = top.map((x, i) => `<button class="sug" role="option" id="sg${i}" data-s="${esc(x.name)}"><i class="i i-search" aria-hidden="true"></i><span>${hl(x.name)}</span><small>${esc(x.meta)}</small><i class="i i-arrow-up sugfill" data-fill="${esc(x.name)}" aria-label="Fill in ${esc(x.name)}"></i></button>`).join('');
    sug.hidden = !top.length;
  };
  sug.addEventListener('click', e => {
    const f = e.target.closest('[data-fill]'), b = e.target.closest('[data-s]'); if (!b) return;
    q.value = (f || b).dataset.fill || b.dataset.s; addRecent(q.value);
    quiet = !f; q.dispatchEvent(new Event('input')); if (f) q.focus(); else { sug.hidden = true; q.blur(); }
  });
  const row = (t, href) => `<a class="res" href="${href}">${poster(t, { mine: false, small: true })}<div><b>${esc(t.name)}</b><div class="meta">${t.year || ''} · ${t.type === 'tv' ? 'Series' : 'Movie'}${t.genres?.length ? ' · ' + esc(t.genres.slice(0, 2).join(', ')) : ''}</div></div></a>`;
  const draw = () => {
    const v = q.value;
    if (!v.trim()) {
      out.innerHTML = (U.recent.length ? `<div class="sec"><h2><i class="i i-clock" aria-hidden="true"></i> Recent</h2><button class="see" id="clr">Clear</button></div><div class="recent">${U.recent.map(r => `<button class="chip" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : '')
        + `<div class="sec"><h2><i class="i i-lightbulb" aria-hidden="true"></i> Try</h2></div><div class="recent">${['Sci-Fi', 'Comedy', 'breking bad', 'intersteller'].map(r => `<button class="chip" data-r="${r}">${r}</button>`).join('')}</div>`;
    } else {
      const loc = localSearch(v);
      const extra = live.filter(x => !loc.some(t => norm(t.name) === norm(x.name))).slice(0, 12)
        .map(x => ({ id: `tmdb-${x.type}-${x.id}`, name: x.name, year: x.year, type: x.type, genres: [], posterPath: x.posterPath, colors: ['#262036', '#ff4f9a'] }));
      out.innerHTML = loc.map(t => row(t, `#/t/${t.id}`)).join('')
        + (extra.length ? `<div class="sec"><h2><i class="i i-globe" aria-hidden="true"></i> More from TMDB</h2></div>` + extra.map(t => row(t, `#/t/${t.id}`)).join('') : '')
        + (!loc.length && !extra.length ? empty(`No match for “${esc(v)}” yet.<br>Check the spelling or try a genre.`, 'sad') : '');
    }
    hydratePosters(out);
  };
  q.addEventListener('input', e => { if (e.isTrusted) quiet = false; draw(); drawSug(); clearTimeout(timer); const n = ++my; timer = setTimeout(async () => { const r = await tmdbSearch(q.value); if (n !== my) return; live = r; draw(); drawSug(); }, 160); });
  q.addEventListener('keydown', e => {
    const opts = [...sug.querySelectorAll('.sug')];
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && opts.length && !sug.hidden) { e.preventDefault(); si = (si + (e.key === 'ArrowDown' ? 1 : -1) + opts.length + 1) % (opts.length + 1) - 0; if (si === opts.length) si = -1; opts.forEach((o, i) => o.classList.toggle('act', i === si)); q.setAttribute('aria-activedescendant', si >= 0 ? opts[si].id : ''); return; }
    if (e.key === 'Escape') { sug.hidden = true; return; }
    if (e.key === 'Enter') { if (si >= 0 && opts[si]) { e.preventDefault(); opts[si].click(); return; } addRecent(q.value); sug.hidden = true; const a = out.querySelector('a.res'); if (a) a.click(); }
  });
  q.addEventListener('focus', () => { quiet = false; drawSug(); });
  out.addEventListener('click', e => {
    const c = e.target.closest('[data-r]'); if (c) { q.value = c.dataset.r; q.dispatchEvent(new Event('input')); return; }
    if (e.target.closest('#clr')) { U.recent = []; save(); rerender(); return; }
    if (e.target.closest('a.res')) addRecent(q.value);
  });
  draw(); drawSug(); setTimeout(() => q.focus(), 60);
  if (initial) { clearTimeout(timer); timer = setTimeout(async () => { live = await tmdbSearch(q.value); draw(); drawSug(); }, 0); }
}
