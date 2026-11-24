// Small shared UI pieces: escaping, posters, rows, mascot, toasts, hearts, confetti, sheets.
import { U } from './store.js';
import { CONFIG } from './config.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const wide = () => matchMedia('(min-width: 768px)').matches;
/** Small buzz on phones that support it. */
export const buzz = (ms = 12) => { try { if (!reduced()) navigator.vibrate?.(ms); } catch (e) { /* not supported */ } };

const IMG = CONFIG.imageBase;
/** Responsive poster image: w342 on phones, w500 on bigger screens. */
function posterImg(t, small) {
  if (t.posterPath) {
    if (small) return `<img src="${IMG}w185${esc(t.posterPath)}" alt="${esc(t.name)} poster" loading="lazy" decoding="async">`;
    const set = CONFIG.posterSizes.map(([s, w]) => `${IMG}${s}${esc(t.posterPath)} ${w}w`).join(', ');
    return `<img src="${IMG}w342${esc(t.posterPath)}" srcset="${set}" sizes="(min-width:1200px) 190px, (min-width:768px) 24vw, 42vw" alt="${esc(t.name)} poster" loading="lazy" decoding="async">`;
  }
  if (t.poster) return `<img src="${esc(t.poster)}" alt="${esc(t.name)} poster" loading="lazy" decoding="async">`;
  return '';
}
export const backdropUrl = t => t.backdropPath ? `${IMG}${CONFIG.backdropSize}${t.backdropPath}` : (t.posterPath ? `${IMG}w780${t.posterPath}` : null);

/* ---------- poster: shimmer while loading, gradient card if it fails ---------- */
export function poster(t, { badge = '', save = false, mine = true, small = false, hover = false } = {}) {
  const g = `linear-gradient(160deg,${t.colors[1]},${t.colors[0]} 72%)`;
  const s = U.ratings[t.id]?.overall ?? (U.swipes[t.id] === 'loved' ? '♥' : null);
  const im = posterImg(t, small);
  return `<div class="poster ${im ? '' : 'fb'}" style="--glow:${t.colors[1]}aa">
    <div class="shimmer"></div>${im}
    <div class="fbk" style="background:${g}" ${im ? 'aria-hidden="true"' : ''}>${esc(t.name)}<small>${esc(t.year)} · ${t.type === 'tv' ? 'Series' : 'Movie'}</small></div>
    ${badge ? `<span class="badge-chip">${badge}</span>` : ''}
    ${save ? `<button class="save-btn ${U.watchlist[t.id] ? 'on' : ''}" data-save="${esc(t.id)}" aria-label="${U.watchlist[t.id] ? 'Remove' : 'Add'} ${esc(t.name)} ${U.watchlist[t.id] ? 'from' : 'to'} watchlist"><span>${U.watchlist[t.id] ? '🔖' : '＋'}</span></button>` : ''}
    ${mine && s != null ? `<span class="mine">${s === '♥' ? '♥' : '★ ' + s}</span>` : ''}
    ${hover ? `<div class="hov"><button data-rate="${esc(t.id)}" aria-label="Rate ${esc(t.name)}">♥ Rate</button><button data-save="${esc(t.id)}" class="${U.watchlist[t.id] ? 'on' : ''}" aria-label="${U.watchlist[t.id] ? 'Remove from' : 'Add to'} watchlist"><span>${U.watchlist[t.id] ? '🔖 Saved' : '＋ Save'}</span></button></div>` : ''}
  </div>`;
}
export function card(t, opts = {}) {
  return `<a class="pcard" href="#/t/${esc(t.id)}" data-id="${esc(t.id)}" aria-label="${esc(t.name)}, ${esc(t.year)}">${poster(t, { save: true, hover: true, ...opts })}
    <div class="t">${esc(t.name)}</div><div class="s">${esc(opts.sub || `${t.year} · ${t.genres[0] || ''}`)}</div></a>`;
}
/** A horizontal row with ← → buttons that appear on hover (desktop). */
export function row(cards, label) {
  return `<div class="rowwrap"><button class="rarr l" data-scroll="-1" aria-label="Scroll ${esc(label)} left" tabindex="-1">‹</button>
    <div class="row" role="list" aria-label="${esc(label)}">${cards}</div>
    <button class="rarr r" data-scroll="1" aria-label="Scroll ${esc(label)} right" tabindex="-1">›</button></div>`;
}

/** Wire up image load/fail. */
export function hydratePosters(root = document) {
  $$('.poster img', root).forEach(img => {
    const box = img.closest('.poster');
    const ok = () => box.classList.add('ok');
    const bad = () => { box.classList.add('fb'); img.remove(); };
    if (img.complete) { img.naturalWidth ? ok() : bad(); } else { img.addEventListener('load', ok, { once: true }); img.addEventListener('error', bad, { once: true }); }
  });
}

/* ---------- mascot: a small happy heart ---------- */
export function mascot(mood = 'happy') {
  const mouth = mood === 'sad' ? 'M40 63 Q50 56 60 63' : mood === 'wow' ? 'M46 60 a4 5 0 1 0 8 0 a4 5 0 1 0 -8 0' : 'M39 58 Q50 70 61 58';
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="mg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7ab5"/><stop offset="1" stop-color="#9b6bff"/></linearGradient></defs>
  <path d="M50 88 C18 66 6 48 10 31 C14 15 34 9 50 26 C66 9 86 15 90 31 C94 48 82 66 50 88Z" fill="url(#mg)"/>
  <ellipse cx="30" cy="30" rx="8" ry="5" fill="#fff" opacity=".35" transform="rotate(-30 30 30)"/>
  <circle cx="38" cy="46" r="5.5" fill="#1a0f2e"/><circle cx="62" cy="46" r="5.5" fill="#1a0f2e"/>
  <circle cx="40" cy="44" r="1.8" fill="#fff"/><circle cx="64" cy="44" r="1.8" fill="#fff"/>
  <circle cx="29" cy="56" r="5" fill="#ff9fca" opacity=".7"/><circle cx="71" cy="56" r="5" fill="#ff9fca" opacity=".7"/>
  <path d="${mouth}" stroke="#1a0f2e" stroke-width="3.5" fill="${mood === 'wow' ? '#1a0f2e' : 'none'}" stroke-linecap="round"/></svg>`;
}
export function empty(text, mood = 'happy', action = '') { return `<div class="mascot">${mascot(mood)}<div>${text}</div>${action}</div>`; }

export function toast(msg, mood = 'happy') {
  $$('.toast').forEach(t => t.remove());
  const d = document.createElement('div'); d.className = 'toast'; d.setAttribute('role', 'status');
  d.innerHTML = mascot(mood) + `<span>${esc(msg)}</span>`;
  document.body.appendChild(d); setTimeout(() => d.remove(), 2600);
}

/* ---------- fun effects ---------- */
export function hearts(x, y, n = 10) {
  if (reduced()) return; const fx = $('#fx');
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span'); s.className = 'burst'; s.textContent = ['💖', '💗', '✨', '💕'][i % 4];
    const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 70;
    s.style.cssText = `left:${x - 11}px;top:${y - 11}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 30}px;--rot:${Math.random() * 90 - 45}deg`;
    fx.appendChild(s); setTimeout(() => s.remove(), 950);
  }
}
export function confetti(n = 90) {
  if (reduced()) return; const fx = $('#fx'), cols = ['#ff4f9a', '#9b6bff', '#ffd35c', '#4fe3b0', '#62b8ff', '#ff8a4c'];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('i'); c.className = 'conf';
    c.style.cssText = `left:${Math.random() * 100}vw;background:${cols[i % cols.length]};--t:${1.6 + Math.random() * 1.6}s;--dx:${Math.random() * 160 - 80}px;--rot:${Math.random() * 900}deg;animation-delay:${Math.random() * .4}s`;
    fx.appendChild(c); setTimeout(() => c.remove(), 3800);
  }
}
/** Celebrate results from store actions (streaks, badges). */
export function celebrate(res) {
  if (!res) return;
  if (res.newBadges?.length) { confetti(); buzz([20, 40, 20]); toast(`New badge: ${res.newBadges[0].e} ${res.newBadges[0].name}!`, 'wow'); }
  else if (res.streakUp) { confetti(60); toast(`🔥 ${U.streak.count}-day streak! Keep it going.`); }
}

/* ---------- bottom sheet (phone) / centered dialog (desktop) ---------- */
let lastFocus = null;
export function sheet(html, onClose) {
  closeSheet();
  lastFocus = document.activeElement;
  const bg = document.createElement('div'); bg.className = 'sheet-bg'; bg.id = 'sheet';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" tabindex="-1"><div class="handle"></div><button class="sheet-x icon-btn" aria-label="Close">✕</button>${html}</div>`;
  bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('.sheet-x')) closeSheet(); });
  const sh = bg.firstElementChild; let y0 = null;
  // swipe the sheet down to close
  sh.addEventListener('touchstart', e => { if (sh.scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
  sh.addEventListener('touchmove', e => { if (y0 == null) return; const dy = e.touches[0].clientY - y0; if (dy > 0) sh.style.transform = `translateY(${dy}px)`; }, { passive: true });
  sh.addEventListener('touchend', e => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null; if (dy > 110) closeSheet(); else sh.style.transform = ''; });
  bg._onClose = onClose;
  document.body.appendChild(bg);
  setTimeout(() => (sh.querySelector('[autofocus],button:not(.sheet-x),a,input') || sh).focus(), 30);
  return sh;
}
export function closeSheet() {
  const s = $('#sheet'); if (!s) return false;
  s.remove(); s._onClose?.(); lastFocus?.focus?.(); return true;
}
export const fmtRuntime = m => m ? `${Math.floor(m / 60)}h ${m % 60}m` : '';
