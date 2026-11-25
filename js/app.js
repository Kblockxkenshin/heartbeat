// App shell: router, responsive navigation (tabs / sidebar), search bar, detail modal,
// keyboard shortcuts, pull-to-refresh, offline banner and install prompt.
import { TITLES, BYID } from './data.js';
import { toggleSave, U, streakAlive, displayName, applyRemote, setSyncErrorHandler } from './store.js';
import { cloud, startCloud, onCloud, importLocal } from './cloud.js';
import { renderAuth, renderWelcome, needsSetup } from './screens/auth.js';
import { renderMyReviews } from './screens/reviews.js';
import { hydrate, apply, loadTitle, search as tmdbSearch } from './tmdb.js';
import { $, $$, esc, hearts, celebrate, closeSheet, sheet, toast, wide, buzz, mascot, poster, hydratePosters } from './ui.js';
import { renderHome } from './screens/home.js';
import { renderDetail, openRate } from './screens/detail.js';
import { renderQuickRate } from './screens/quickrate.js';
import { renderMe } from './screens/me.js';
import { renderSearch, localSearch } from './screens/search.js';
import { renderMatch } from './screens/match.js';
import { renderList } from './screens/list.js';
import { renderFeed } from './screens/feed.js';
import { renderAbout } from './screens/about.js';

TITLES.forEach(apply); // use cached TMDB info right away

/* ---------------- navigation ---------------- */
const NAV = [
  { h: '#/', k: 'home', l: 'Home', i: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>' },
  { h: '#/search', k: 'search', l: 'Search', i: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>' },
  { h: '#/rate', k: 'rate', l: 'Quick Rate', i: '<path d="M12 21C5 16 2 12.5 2 8.6 2 5.5 4.4 3 7.4 3c1.9 0 3.6 1 4.6 2.6C13 4 14.7 3 16.6 3 19.6 3 22 5.5 22 8.6c0 3.9-3 7.4-10 12.4z"/>' },
  { h: '#/match', k: 'match', l: 'Taste Match', i: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>' },
  { h: '#/me', k: 'me', l: 'Me', i: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.5-6 8-6s7 1.5 8 6"/>' },
];
const svg = (p, fill) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const LOGO = `<span class="mark" aria-hidden="true"><svg viewBox="0 0 32 32" width="24" height="24"><path d="M3 17h6l2.5-6 4 12 3-9 2 3H29" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;

function chrome(active) {
  // Phone: bottom tabs
  $('#tabs').innerHTML = `<div class="bar">${NAV.map(n => { const on = active === n.k; return `<a href="${n.h}" class="${n.k === 'rate' ? 'rate' : ''} ${on ? 'on' : ''}" ${on ? 'aria-current="page"' : ''} aria-label="${n.l}"><span class="ic">${svg(n.i, on || n.k === 'rate')}</span>${n.k === 'rate' ? '' : `<span class="lb">${n.k === 'match' ? 'Match' : n.l}</span>`}</a>`; }).join('')}</div>`;
  $('#tabs').hidden = active === 'none';
  // Tablet + desktop: sidebar
  const st = streakAlive();
  $('#side').innerHTML = `<a class="slogo" href="#/" aria-label="Heartbeat home">${LOGO}<span class="lb">heartbeat</span></a>
    <nav class="snav">${NAV.map(n => { const on = active === n.k; return `<a href="${n.h}" class="sitem ${n.k === 'rate' ? 'srate' : ''} ${on ? 'on' : ''}" ${on ? 'aria-current="page"' : ''} title="${n.l}" aria-label="${n.l}"><span class="ic">${svg(n.i, on || n.k === 'rate')}</span><span class="lb">${n.l}</span></a>`; }).join('')}</nav>
    <div class="sfoot">
      <button class="sitem" id="helpBtn" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts"><span class="ic">⌨️</span><span class="lb">Shortcuts <kbd class="kbd">?</kbd></span></button>
      ${cloud.ready && !cloud.user ? `<a class="sitem ssign" href="#/signin" aria-label="Sign in"><span class="ic">🔑</span><span class="lb">Sign in</span></a>` : ''}
      <a class="sme" href="#/me" aria-label="${esc(displayName())}, ${st}-day streak"><span class="ava sm" aria-hidden="true">${esc((displayName()[0] || 'Y').toUpperCase())}</span><span class="lb"><b>${esc(displayName())}</b><small>${cloud.stats ? esc(cloud.stats.rank) + ' · ' : ''}🔥 ${st}-day streak</small></span></a>
    </div>`;
  $('#side').hidden = active === 'none';
  $('#topbar').hidden = active === 'none';
}

/* ---------------- top search bar (tablet + desktop) ---------------- */
function topbar() {
  $('#topbar').innerHTML = `<div class="tb">
    <div class="tsearch" role="combobox" aria-expanded="false" aria-owns="gdrop" aria-haspopup="listbox">
      <span aria-hidden="true">🔎</span><input id="gq" type="search" autocomplete="off" placeholder="Search movies & series…" aria-label="Search movies and series" aria-controls="gdrop">
      <kbd class="kbd" aria-hidden="true">/</kbd>
      <div id="gdrop" role="listbox" hidden></div>
    </div>
    <button class="icon-btn" id="helpTop" aria-label="Keyboard shortcuts">?</button></div>`;
  const q = $('#gq'), drop = $('#gdrop'); let timer, live = [], idx = -1;
  const items = () => $$('[role=option]', drop);
  const draw = () => {
    const v = q.value.trim();
    if (!v) { drop.hidden = true; q.parentElement.setAttribute('aria-expanded', 'false'); return; }
    const loc = localSearch(v).slice(0, 6);
    const extra = live.filter(x => !loc.some(t => t.name.toLowerCase() === x.name.toLowerCase())).slice(0, 6);
    const rowHtml = (t, href, meta) => `<a role="option" class="dres" href="${href}">${poster({ ...t, colors: t.colors || ['#262036', '#ff4f9a'] }, { mine: false, small: true })}<span><b>${esc(t.name)}</b><span class="meta">${esc(meta)}</span></span></a>`;
    drop.innerHTML = (loc.map(t => rowHtml(t, `#/t/${t.id}`, `${t.year} · ${t.type === 'tv' ? 'Series' : 'Movie'}`)).join('')
      + extra.map(x => rowHtml({ ...x, posterPath: x.posterPath, year: x.year }, `#/t/tmdb-${x.type}-${x.id}`, `${x.year || ''} · ${x.type === 'tv' ? 'Series' : 'Movie'} · TMDB`)).join(''))
      || `<div class="dempty">${mascot('sad')}<span>No match for “${esc(v)}” yet.</span></div>`;
    drop.hidden = false; q.parentElement.setAttribute('aria-expanded', 'true'); idx = -1; hydratePosters(drop);
  };
  q.addEventListener('input', () => { draw(); clearTimeout(timer); timer = setTimeout(async () => { live = await tmdbSearch(q.value); if (q.value.trim()) draw(); }, 260); });
  q.addEventListener('keydown', e => {
    const it = items();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!it.length) return; idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + it.length) % it.length; it.forEach((a, i) => a.classList.toggle('act', i === idx)); it[idx].scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') { const a = it[idx] || it[0]; if (a) { e.preventDefault(); location.hash = a.getAttribute('href'); q.value = ''; draw(); q.blur(); } }
    else if (e.key === 'Escape') { q.value = ''; draw(); q.blur(); }
  });
  drop.addEventListener('click', () => { setTimeout(() => { q.value = ''; draw(); }, 0); });
  document.addEventListener('click', e => { if (!e.target.closest('.tsearch')) drop.hidden = true; });
  $('#helpTop').onclick = showHelp;
}

/* ---------------- router ---------------- */
const route = () => { const p = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent); return { p: p[0] || '', a: p[1] || '', b: p[2] || '' }; };
let baseHash = null, baseRendered = null, modalFromBase = false, lastKey = '';
const PAGES = { '': ['home', renderHome], rate: ['rate', renderQuickRate], me: ['me', renderMe], search: ['search', a => renderSearch($('#app'), a)], match: ['match', renderMatch], list: ['home', null], feed: ['none', null], about: ['me', renderAbout], signin: ['none', null], welcome: ['none', renderWelcome], myreviews: ['me', renderMyReviews] };

function renderBase(r, keepScroll) {
  const app = $('#app'), y = scrollY, key = location.hash || '#/';
  const [tab] = PAGES[r.p] || PAGES[''];
  chrome(tab);
  if (r.p === 'signin') renderAuth(app, r.a);
  else if (r.p === 'list') renderList(app, r.a);
  else if (r.p === 'feed') renderFeed(app, r.a, r.b);
  else if (r.p === 'search') renderSearch(app, r.a);
  else (PAGES[r.p] || PAGES[''])[1](app);
  baseHash = key; baseRendered = key;
  if (keepScroll) scrollTo(0, y); else scrollTo(0, 0);
  afterRender(app);
}

export async function render(keepScroll = false) {
  const r = route(), key = location.hash || '#/';
  if (r.p === 't') {
    if (!BYID[r.a]) { if (!(await loadTitle(r.a))) { closeModal(); chrome('home'); $('#app').innerHTML = `<div class="mascot">${mascot('sad')}<div>I can't find that title right now.<br><a class="see" href="#/">Go home</a></div></div>`; return; } }
    if (wide()) {
      // Desktop/tablet: big centered modal on top of the page you were on.
      modalFromBase = lastKey === baseHash && !!baseHash;
      if (!baseRendered) renderBase({ p: '' }, false);
      openModal(r.a);
    } else {
      closeModal(true);
      chrome('');
      renderDetail($('#app'), r.a);
      if (!(keepScroll && key === lastKey)) scrollTo(0, 0);
      baseRendered = null;
    }
  } else {
    const wasModal = !!$('#modal').firstElementChild;
    closeModal(true);
    closeSheet();
    renderBase(r, (keepScroll && key === lastKey) || (wasModal && key === baseHash));
  }
  lastKey = key;
  hydrate(TITLES, () => render(true));
}
export const rerender = () => render(true);

function openModal(id) {
  const m = $('#modal'), open = !!m.firstElementChild;
  if (!open) {
    m.innerHTML = `<div class="mbg"><div class="mbox" role="dialog" aria-modal="true" aria-label="Title details"><div id="mdet"></div></div></div>`;
    m.querySelector('.mbg').addEventListener('mousedown', e => { if (e.target.classList.contains('mbg')) closeDetail(); });
    document.documentElement.classList.add('locked');
  }
  const box = $('.mbox', m), y = open ? box.scrollTop : 0;
  renderDetail($('#mdet'), id, { modal: true });
  box.scrollTop = open && m.dataset.id === id ? y : 0;
  m.dataset.id = id;
  if (!open) setTimeout(() => $('#back', m)?.focus(), 20);
}
function closeModal(silent) {
  const m = $('#modal'); if (!m.firstElementChild) return;
  m.innerHTML = ''; delete m.dataset.id; document.documentElement.classList.remove('locked');
}
/** Close the detail page or modal and go back to where you were. */
export function closeDetail() {
  if (closeSheet()) return;
  if (wide() && $('#modal').firstElementChild) {
    if (modalFromBase) history.back(); else location.hash = baseHash || '#/';
    return;
  }
  if (history.length > 1) history.back(); else location.hash = '#/';
}

/* ---------------- after each render ---------------- */
function afterRender(root) {
  // Mouse wheel / trackpad scrolling on rows (desktop): vertical wheel moves the row sideways while it can.
  // Hide the ← → buttons on rows that already fit on screen.
  requestAnimationFrame(() => $$('.rowwrap', root).forEach(w => { const r = w.querySelector('.row'); w.classList.toggle('fits', r.scrollWidth <= r.clientWidth + 2); }));
  if (matchMedia('(hover: hover) and (min-width: 768px)').matches) {
    $$('.row', root).forEach(r => r.addEventListener('wheel', e => {
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const max = r.scrollWidth - r.clientWidth;
      if ((e.deltaY > 0 && r.scrollLeft < max - 2) || (e.deltaY < 0 && r.scrollLeft > 2)) { r.scrollLeft += e.deltaY; e.preventDefault(); }
    }, { passive: false }));
  }
}

/* ---------------- global clicks ---------------- */
document.addEventListener('click', e => {
  const sv = e.target.closest('[data-save]');
  if (sv) {
    e.preventDefault(); e.stopPropagation();
    const res = toggleSave(sv.dataset.save); buzz();
    if (res.saved) { const rc = sv.getBoundingClientRect(); hearts(rc.x + rc.width / 2, rc.y + rc.height / 2, 6); toast('Saved to your watchlist'); }
    celebrate(res); rerender(); return;
  }
  const rt = e.target.closest('[data-rate]');
  if (rt) { e.preventDefault(); e.stopPropagation(); const t = BYID[rt.dataset.rate]; if (t) openRate(t, () => rerender()); return; }
  const sc = e.target.closest('[data-scroll]');
  if (sc) { const r = sc.parentElement.querySelector('.row'); r.scrollBy({ left: +sc.dataset.scroll * r.clientWidth * .85, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); return; }
  if (e.target.closest('#helpBtn')) showHelp();
}, true);
$('#skip').onclick = () => $('#app').focus();

/* ---------------- keyboard shortcuts ---------------- */
function showHelp() {
  const keys = [['/', 'Search'], ['R', 'Rate this title (or the card you\'re on)'], ['← → ↑ ↓', 'Move between posters'], ['Enter', 'Open the poster'], ['Esc', 'Close'], ['1–5', 'Rate the ending (in the rating box)'], ['→ ← ↑', 'Quick Rate: loved · nope · haven\'t seen'], ['?', 'This help']];
  sheet(`<h2 class="h3" style="font-size:22px;margin:0 0 12px">⌨️ Keyboard shortcuts</h2><dl class="keys">${keys.map(([k, d]) => `<dt><kbd class="kbd">${k}</kbd></dt><dd>${d}</dd>`).join('')}</dl>`);
}
const typing = el => el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
function moveFocus(cur, dir) {
  const scope = $('#modal').firstElementChild ? $$('#modal .pcard') : $$('#app .pcard');
  if (dir === 'left' || dir === 'right') {
    const sib = dir === 'right' ? cur.nextElementSibling : cur.previousElementSibling;
    if (sib?.classList.contains('pcard')) return sib;
    return null;
  }
  const r0 = cur.getBoundingClientRect(), cx = r0.x + r0.width / 2;
  const cands = scope.filter(c => { const r = c.getBoundingClientRect(); return dir === 'down' ? r.top > r0.bottom - 4 : r.bottom < r0.top + 4; });
  if (!cands.length) return null;
  const rowY = dir === 'down' ? Math.min(...cands.map(c => c.getBoundingClientRect().top)) : Math.max(...cands.map(c => c.getBoundingClientRect().top));
  const sameRow = cands.filter(c => Math.abs(c.getBoundingClientRect().top - rowY) < 30);
  return sameRow.sort((a, b) => Math.abs(a.getBoundingClientRect().x + a.offsetWidth / 2 - cx) - Math.abs(b.getBoundingClientRect().x + b.offsetWidth / 2 - cx))[0];
}
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  const a = document.activeElement;
  if (e.key === 'Escape') {
    if (closeSheet()) { e.preventDefault(); return; }
    if ($('#modal').firstElementChild || route().p === 't') { e.preventDefault(); closeDetail(); }
    return;
  }
  if (typing(a) || $('#sheet')) return;
  if (e.key === '/') {
    e.preventDefault();
    if (wide()) $('#gq').focus(); else location.hash = '#/search';
  } else if (e.key === '?') { e.preventDefault(); showHelp(); }
  else if (e.key === 'r' || e.key === 'R') {
    const r = route(), id = r.p === 't' ? r.a : a?.closest?.('.pcard')?.dataset.id;
    if (id && BYID[id]) { e.preventDefault(); openRate(BYID[id], r.p === 't' ? undefined : () => rerender()); }
  } else if (a?.classList?.contains('pcard') && e.key.startsWith('Arrow')) {
    const nx = moveFocus(a, e.key.slice(5).toLowerCase());
    if (nx) { e.preventDefault(); nx.focus(); nx.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); }
  }
});

/* ---------------- phone: pull down to refresh ---------------- */
(() => {
  let y0 = null, dy = 0; const ptr = $('#ptr');
  addEventListener('touchstart', e => { y0 = (!wide() && scrollY <= 0 && !$('#sheet') && !['t', 'rate', 'feed'].includes(route().p)) ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  addEventListener('touchmove', e => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); ptr.style.transform = `translate(-50%, ${Math.min(dy, 120) - 60}px) rotate(${dy * 3}deg)`; ptr.classList.toggle('ready', dy > 80); }, { passive: true });
  addEventListener('touchend', () => {
    if (y0 == null) return; y0 = null; ptr.style.transform = ''; ptr.classList.remove('ready');
    if (dy > 80) { buzz(10); hydrate(TITLES, () => render(true), true); render(true); toast('Refreshed!'); }
  });
})();

/* ---------------- offline banner ---------------- */
function netBanner() {
  const n = $('#net');
  if (navigator.onLine) { n.hidden = true; return; }
  n.innerHTML = `${mascot('sad')}<span><b>You're offline.</b> Showing what's saved on this device.</span>`; n.hidden = false;
}
addEventListener('online', () => { netBanner(); toast('Back online!'); render(true); });
addEventListener('offline', netBanner);

/* ---------------- install prompt ---------------- */
let bip = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); bip = e; if (route().p === 'me') rerender(); });
addEventListener('appinstalled', () => { bip = null; toast('Heartbeat is installed! 🎉', 'wow'); rerender(); });
export const install = {
  installed: () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  ios: () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  can: () => !!bip,
  async prompt() { if (!bip) return false; bip.prompt(); const c = await bip.userChoice; bip = null; return c.outcome === 'accepted'; },
};

/* ---------------- account (Supabase) ---------------- */
setSyncErrorHandler(msg => toast(msg, 'sad'));
let lastUser = null, lastRank = null, lastReady = false;
onCloud(async c => {
  const uid = c.user?.id || null;
  if (uid && c.remote && U.syncedUser !== uid && !c.needsBirthdate) {
    U.syncedUser = uid; // guard against running twice
    const n = await importLocal(U);
    applyRemote(c.remote, uid);
    if (n) toast(`Moved ${n} ratings from this device into your account.`);
  }
  if (c.stats?.rank && lastRank && c.stats.rank !== lastRank) { confettiSafe(); toast(`New rank: ${c.stats.rank}! 🎉`, 'wow'); }
  if (c.stats?.rank) lastRank = c.stats.rank;
  if (c.checkin?.xp_gained) { toast(`+${c.checkin.xp_gained} XP for showing up today!`); c.checkin = null; }
  if (uid && needsSetup() && c.profile !== undefined && !/^#\/(welcome|signin)/.test(location.hash) && (c.profile || c.stats)) location.hash = '#/welcome';
  const becameReady = c.ready && !lastReady; lastReady = c.ready;
  if (becameReady || uid !== lastUser || route().p === 'me' || route().p === 'welcome' || route().p === 'signin') { lastUser = uid; render(true); }
  else chrome(PAGES[route().p]?.[0] || 'home');
});
function confettiSafe() { import('./ui.js').then(m => m.confetti()); }

/* ---------------- start ---------------- */
addEventListener('hashchange', () => render());
let wasWide = wide();
addEventListener('resize', () => { if (wide() !== wasWide) { wasWide = wide(); baseRendered = null; render(true); } });
topbar();
netBanner();
render();
startCloud();

if ('serviceWorker' in navigator && location.protocol === 'https:' && !/claude/.test(location.host)) {
  addEventListener('load', () => { try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* ignore */ } });
}
