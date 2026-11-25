// Heartbeat Wrapped: your year in story slides (tap or swipe, like stories).
// Built from YOUR ratings. Free users see the first two slides; Plus unlocks the whole story.
import { BYID } from '../data.js';
import { U } from '../store.js';
import { loadTitle } from '../tmdb.js';
import { $, esc, poster, hydratePosters, buzz, reduced } from '../ui.js';
import { isPlus } from './plus.js';

/** Numbers for Wrapped. Uses this year's ratings, or all of them if this year has fewer than 5. */
export async function wrappedData() {
  const all = Object.entries(U.ratings);
  const year = new Date().getFullYear(), from = new Date(year, 0, 1).getTime();
  let rs = all.filter(([, r]) => (r.ts || 0) >= from), forYear = true;
  if (rs.length < 5) { rs = all; forYear = false; }
  const items = (await Promise.all(rs.map(async ([id, r]) => ({ t: BYID[id] || await loadTitle(id).catch(() => null), r }))))
    .filter(x => x.t);
  const n = items.length;
  const genre = {}, dec = {};
  let minutes = 0;
  for (const { t, r } of items) {
    for (const g of t.genres || []) { genre[g] = genre[g] || { g, n: 0, sum: 0 }; genre[g].n++; genre[g].sum += r.overall; }
    const y = +t.year; if (y) { const d = Math.floor(y / 10) * 10 + 's'; dec[d] = dec[d] || { d, n: 0, sum: 0 }; dec[d].n++; dec[d].sum += r.overall; }
    minutes += t.type === 'tv' ? Math.min((t.seasons || [8]).reduce((a, b) => a + b, 0), 40) * 45 : (t.runtime || 110);
  }
  const avg = k => n ? items.reduce((a, x) => a + x.r[k], 0) / n : 0;
  const start = avg('start'), middle = avg('middle'), end = avg('end'), diff = end - start;
  const style = !n ? null : diff <= -0.5 ? { e: '🧐', name: 'Tough on endings', note: 'A story has to stick the landing for you.' }
    : diff >= 0.5 ? { e: '🎢', name: 'Slow-burn lover', note: 'You forgive a slow start if the ending pays off.' }
    : { e: '⚖️', name: 'Even-keeled', note: 'You judge the whole ride fairly.' };
  const sorted = items.slice().sort((a, b) => b.r.overall - a.r.overall || b.r.end - a.r.end);
  const biggestTurn = items.slice().sort((a, b) => Math.abs(b.r.end - b.r.start) - Math.abs(a.r.end - a.r.start))[0];
  return {
    n, year: forYear ? year : null, hours: Math.round(minutes / 60),
    movies: items.filter(x => x.t.type !== 'tv').length, series: items.filter(x => x.t.type === 'tv').length,
    genres: Object.values(genre).sort((a, b) => b.sum - a.sum).slice(0, 5),
    decades: Object.values(dec).sort((a, b) => b.n - a.n || b.sum - a.sum),
    start, middle, end, style,
    avgAll: n ? items.reduce((a, x) => a + x.r.overall, 0) / n : 0,
    best: sorted[0], worst: sorted.length > 1 ? sorted[sorted.length - 1] : null, turn: biggestTurn,
  };
}

function journeySVG(w) {
  const pts = [w.start, w.middle, w.end].map((v, i) => [30 + i * 120, 150 - (v / 5) * 120]);
  const d = `M${pts[0]} C${pts[0][0] + 60},${pts[0][1]} ${pts[1][0] - 60},${pts[1][1]} ${pts[1]} S${pts[2][0] - 60},${pts[2][1]} ${pts[2]}`;
  return `<svg viewBox="0 0 300 170" class="wsvg" role="img" aria-label="Average start ${w.start.toFixed(1)}, middle ${w.middle.toFixed(1)}, ending ${w.end.toFixed(1)}">
    <defs><linearGradient id="wg" x1="0" x2="1"><stop offset="0" stop-color="#ff4f9a"/><stop offset="1" stop-color="#9b6bff"/></linearGradient></defs>
    ${[1, 2, 3, 4, 5].map(v => `<line x1="20" x2="290" y1="${150 - v * 24}" y2="${150 - v * 24}" stroke="rgba(255,255,255,.08)"/>`).join('')}
    <path d="${d}" fill="none" stroke="url(#wg)" stroke-width="6" stroke-linecap="round" class="wline"/>
    ${pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="8" fill="#fff"/><text x="${x}" y="168" text-anchor="middle" fill="#cfc6e6" font-size="12" font-weight="800">${['Start', 'Middle', 'Ending'][i]}</text><text x="${x}" y="${y - 14}" text-anchor="middle" fill="#fff" font-size="14" font-weight="900">${[w.start, w.middle, w.end][i].toFixed(1)}</text>`).join('')}
  </svg>`;
}

function slides(w) {
  const yr = w.year ? `${w.year}` : 'so far';
  const bars = (list, key, lab) => { const mx = Math.max(...list.map(x => x.n), 1); return list.map(x => `<div class="wbar"><span>${esc(x[key])}</span><div><i style="width:${x.n / mx * 100}%"></i></div><b>${x.n}</b></div>`).join('') || `<div class="sub">${lab}</div>`; };
  return [
    { c: 'w1', h: `<div class="wbig">🎬</div><div class="wk">Your Heartbeat ${yr}</div><div class="wnum">${w.n}</div><div class="wt">titles rated</div><div class="wsub">${w.movies} movies · ${w.series} series · about ${w.hours} hours of stories</div>` },
    { c: 'w2', h: `<div class="wk">Your top genre</div><div class="wnum sm">${esc(w.genres[0]?.g || '—')}</div><div class="wlist">${bars(w.genres, 'g', 'Rate more to see genres')}</div>` },
    { c: 'w3', h: `<div class="wk">Your decades</div><div class="wnum sm">${esc(w.decades[0]?.d || '—')}</div><div class="wt">is your era</div><div class="wlist">${bars(w.decades.slice(0, 5), 'd', '')}</div>` },
    { c: 'w4', h: `<div class="wbig">${w.style?.e || '⚖️'}</div><div class="wk">Your rating style</div><div class="wnum sm">${esc(w.style?.name || '')}</div><div class="wsub">${esc(w.style?.note || '')}</div><div class="wsub">Average ★ ${w.avgAll.toFixed(1)}</div>` },
    { c: 'w5', h: `<div class="wk">Your journey graph</div><div class="wt">How you rate starts vs endings</div>${journeySVG(w)}<div class="wsub">${w.end > w.start ? 'Endings win your heart.' : w.end < w.start ? 'Great starts, but endings must earn it.' : 'Starts and endings are equal to you.'}</div>` },
    w.best && { c: 'w6', h: `<div class="wk">Your #1 of ${yr}</div><div class="wposter">${poster(w.best.t, { mine: false })}</div><div class="wnum sm">${esc(w.best.t.name)}</div><div class="wsub">★ ${w.best.r.overall} · ending ${w.best.r.end}/5</div>` },
    w.turn && Math.abs(w.turn.r.end - w.turn.r.start) >= 1 && { c: 'w7', h: `<div class="wk">Biggest plot twist (for you)</div><div class="wposter">${poster(w.turn.t, { mine: false })}</div><div class="wnum sm">${esc(w.turn.t.name)}</div><div class="wsub">Started at ${w.turn.r.start}, ended at ${w.turn.r.end}. ${w.turn.r.end > w.turn.r.start ? 'What a comeback!' : 'Ouch, that ending.'}</div>` },
    { c: 'w8', h: `<div class="wbig">💖</div><div class="wk">That's a wrap!</div><div class="wcard"><b>${w.n}</b> titles · <b>${esc(w.genres[0]?.g || '—')}</b> fan · <b>${esc(w.style?.name || '')}</b></div><div class="wsub">Rate the journey, not just the ending.</div>` },
  ].filter(Boolean);
}

export async function renderWrapped(app) {
  document.title = 'Heartbeat Wrapped';
  app.innerHTML = `<div class="wrap-bg"><div class="rskel"></div></div>`;
  const w = await wrappedData();
  if (!w.n) {
    app.innerHTML = `<div class="screen"><header class="top"><a class="icon-btn" href="#/me" aria-label="Back">←</a></header><div class="card" style="text-align:center"><div style="font-size:48px">🎬</div><h2>Your Wrapped needs ratings</h2><div class="sub">Rate a few movies or series with Start / Middle / Ending, then come back.</div><a class="btn" href="#/rate" style="margin-top:12px">💖 Quick Rate</a></div></div>`;
    return;
  }
  const S = slides(w), plus = isPlus(), FREE = 2;
  let i = 0, timer = null;
  app.innerHTML = `<div class="wrap-bg" role="region" aria-label="Heartbeat Wrapped story" aria-roledescription="carousel">
    <div class="wbars">${S.map((_, k) => `<span><i></i></span>`).join('')}</div>
    <a class="icon-btn wclose" href="#/me" aria-label="Close">✕</a>
    <div class="wslide" id="wslide" aria-live="polite"></div>
    <button class="wnav prev" aria-label="Previous slide"></button><button class="wnav next" aria-label="Next slide"></button></div>`;
  const box = $('#wslide', app), bars = [...app.querySelectorAll('.wbars i')];
  const show = k => {
    clearTimeout(timer);
    i = Math.max(0, Math.min(S.length - 1, k));
    const locked = !plus && i >= FREE;
    box.className = `wslide ${S[i].c} ${locked ? 'locked' : ''}`;
    box.innerHTML = locked ? `<div class="wbig">💖</div><div class="wk">There's more to your story</div>
        <div class="wsub">${S.length - FREE} more slides: your decades, rating style, journey graph, your #1 and more.</div>
        <div class="wblur" aria-hidden="true">${S[i].h}</div>
        <a class="btn big" href="#/plus" style="position:relative;z-index:2;margin-top:16px">Unlock with Heartbeat Plus</a>` : S[i].h;
    hydratePosters(box);
    bars.forEach((b, k) => { b.style.transition = 'none'; b.style.width = k < i ? '100%' : '0%'; });
    if (!locked && i < S.length - 1 && !reduced()) {
      requestAnimationFrame(() => { bars[i].style.transition = 'width 6s linear'; bars[i].style.width = '100%'; });
      timer = setTimeout(() => show(i + 1), 6000);
    } else bars[i].style.width = '100%';
    buzz(6);
  };
  app.querySelector('.prev').onclick = () => show(i - 1);
  app.querySelector('.next').onclick = () => show(i + 1);
  const key = e => { if (!document.body.contains(box)) return removeEventListener('keydown', key); if (e.key === 'ArrowRight') show(i + 1); if (e.key === 'ArrowLeft') show(i - 1); };
  addEventListener('keydown', key);
  let x0 = null;
  box.parentElement.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  box.parentElement.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) show(i + (dx < 0 ? 1 : -1)); x0 = null; });
  show(0);
}
