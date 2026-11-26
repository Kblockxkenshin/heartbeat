// Small shared UI pieces: escaping, icons, posters, rows, toasts, sheets.
import { U } from './store.js';
import { CONFIG } from './config.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Line icon. ic('heart') -> <i class="i i-heart">. */
export const ic = (n, cls = '') => `<i class="i i-${n}${cls ? ' ' + cls : ''}" aria-hidden="true"></i>`;
const EMAP = {'★':'star','💖':'heart','🎬':'clapperboard','🔥':'flame','✅':'check','💬':'message-circle','💓':'heart-pulse','🎉':'party-popper','✏️':'pencil','🔒':'lock','👥':'users','💞':'heart-handshake','🔖':'bookmark','🛡️':'shield','🔎':'search','🚩':'flag','🏆':'trophy','🎁':'gift','✨':'sparkles','🍿':'popcorn','🎟️':'ticket','🙈':'eye-off','✓':'check','✍️':'pen-line','🤖':'bot','✕':'x','📜':'scroll-text','⏸️':'pause','🙋':'hand','🔗':'link','⚖️':'scale','🗑️':'trash','♥':'heart','⭐':'star','⚡':'zap','📤':'share','👀':'eye','📬':'inbox','😴':'moon','🧭':'compass','🏅':'medal','⬇️':'download','😍':'heart','👎':'thumbs-down','👍':'thumbs-up','🚫':'ban','💌':'mail','🔬':'microscope','🤝':'handshake','💎':'gem','🚪':'door-open','🎯':'target','🔐':'lock-keyhole','🧐':'glasses','🎢':'activity','📝':'notebook-pen','🤯':'brain','🌍':'globe','🎈':'trending-down','😂':'drama','😱':'ghost','😢':'cloud-rain','🥉':'medal','🥈':'medal','🥇':'medal','⚙️':'settings','📊':'chart-column','🔔':'bell','👤':'user','💡':'lightbulb','❤️':'heart','♡':'heart','📸':'camera','🔄':'refresh-cw','📨':'mail-plus','👋':'hand','🙅':'circle-slash','⌨️':'keyboard','💺':'armchair','👑':'crown','⬆️':'arrow-up','🗓️':'calendar','🏁':'flag-triangle-right','🤔':'circle-question-mark','📅':'calendar','📲':'smartphone','🔁':'repeat','🌟':'star','⏳':'hourglass','📦':'package','🎨':'palette','📥':'download','🔕':'bell-off','➕':'plus','🔑':'key-round','💗':'heart','💕':'heart','😭':'cloud-rain','🛋️':'sofa','💘':'heart','👨‍👩‍👧':'users-round','🌙':'moon','🍕':'pizza','🌱':'sprout','🔷':'diamond','♦️':'diamond','💚':'heart','🙂':'sun','🗺️':'map','🎖️':'award','⏩':'fast-forward','🎭':'drama','🔓':'lock-open','🧮':'calculator','🐢':'turtle','📱':'smartphone','🧸':'shield-check','🕘':'clock','🖨️':'printer','📈':'trending-up','🏷️':'tag','😊':'sun','😐':'circle-dot','😕':'cloud-rain','📄':'file-text','🎓':'graduation-cap','💳':'credit-card','💣':'bomb','✋':'hand','✔️':'check','↩️':'undo-2','🚨':'siren','🐞':'bug','😮':'sparkles','✉️':'mail','➤':'send','📋':'clipboard','✔':'check','🙃':'sun','📷':'camera','🤫':'volume-x','📍':'map-pin'};
/** Turns emojis that come from the server (badges, events, prizes) into line icons. Other text is escaped. */
export const emo = s => esc(String(s ?? '')).replace(/(?:[\u{1F300}-\u{1FAFF}\u2600-\u27BF\u2B50\u2B06\u2B07\u2194-\u21FF\u23E9-\u23FA\u231A\u231B\u2328](?:\uFE0F)?(?:\u200D[\u{1F300}-\u{1FAFF}\u2600-\u27BF](?:\uFE0F)?)*)/gu, e => EMAP[e] ? ic(EMAP[e]) : EMAP[e.replace(/\uFE0F/g, '')] ? ic(EMAP[e.replace(/\uFE0F/g, '')]) : ic('sparkles'));
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

/* ---------- poster: quiet placeholder while loading, plain card if it fails ---------- */
export function poster(t, { badge = '', save = false, mine = true, small = false, hover = false } = {}) {
  const g = '#171717';
  const s = U.ratings[t.id]?.overall ?? (U.swipes[t.id] === 'loved' ? '<i class="i i-heart" aria-hidden="true"></i>' : null);
  const im = posterImg(t, small);
  return `<div class="poster ${im ? '' : 'fb'}">
    <div class="shimmer"></div>${im}
    <div class="fbk" style="background:${g}" ${im ? 'aria-hidden="true"' : ''}>${esc(t.name)}<small>${esc(t.year)} · ${t.type === 'tv' ? 'Series' : 'Movie'}</small></div>
    ${badge ? `<span class="badge-chip">${badge}</span>` : ''}
    ${save ? `<button class="save-btn ${U.watchlist[t.id] ? 'on' : ''}" data-save="${esc(t.id)}" aria-label="${U.watchlist[t.id] ? 'Remove' : 'Add'} ${esc(t.name)} ${U.watchlist[t.id] ? 'from' : 'to'} watchlist"><span>${U.watchlist[t.id] ? '<i class="i i-bookmark-check" aria-hidden="true"></i>' : '<i class="i i-bookmark" aria-hidden="true"></i>'}</span></button>` : ''}
    ${mine && s != null ? `<span class="mine">${s === '<i class="i i-heart" aria-hidden="true"></i>' ? '<i class="i i-heart" aria-hidden="true"></i>' : '<i class="i i-star" aria-hidden="true"></i> ' + s}</span>` : ''}
    ${hover ? `<div class="hov"><button data-rate="${esc(t.id)}" aria-label="Rate ${esc(t.name)}"><i class="i i-heart" aria-hidden="true"></i> Rate</button><button data-save="${esc(t.id)}" class="${U.watchlist[t.id] ? 'on' : ''}" aria-label="${U.watchlist[t.id] ? 'Remove from' : 'Add to'} watchlist"><span>${U.watchlist[t.id] ? 'Saved' : '<i class="i i-plus" aria-hidden="true"></i> Save'}</span></button></div>` : ''}
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

/* ---------- quiet feedback (no mascots, no confetti) ---------- */
const MOOD_IC = { happy: 'check', wow: 'sparkles', sad: 'info', think: 'circle-question-mark', sleepy: 'moon' };
export function mascot(mood = 'happy') { return ic(MOOD_IC[mood] || 'check'); }
export function empty(text, mood = 'happy', action = '') { return `<div class="mascot"><div>${text}</div>${action}</div>`; }

export function toast(msg, mood = 'happy') {
  $$('.toast').forEach(t => t.remove());
  const d = document.createElement('div'); d.className = 'toast' + (mood === 'sad' ? ' bad' : ''); d.setAttribute('role', 'status');
  d.innerHTML = mascot(mood) + `<span>${esc(msg)}</span>`;
  document.body.appendChild(d); setTimeout(() => d.remove(), 2600);
}
/* The old celebration effects are kept as no-ops so existing calls stay safe. */
export function hearts() { }
export function confetti() { }
/** Celebrate results from store actions (streaks, badges). */
export function celebrate(res) {
  if (!res) return;
  if (res.newBadges?.length) { confetti(); buzz([20, 40, 20]); toast(`New badge: ${res.newBadges[0].name}!`, 'wow'); }
  else if (res.streakUp) { confetti(60); toast(`${U.streak.count}-day streak! Keep it going.`); }
}

/* ---------- bottom sheet (phone) / centered dialog (desktop) ---------- */
let lastFocus = null;
export function sheet(html, onClose) {
  closeSheet();
  lastFocus = document.activeElement;
  const bg = document.createElement('div'); bg.className = 'sheet-bg'; bg.id = 'sheet';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" tabindex="-1"><div class="handle"></div><button class="sheet-x icon-btn" aria-label="Close"><i class="i i-x" aria-hidden="true"></i></button>${html}</div>`;
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
