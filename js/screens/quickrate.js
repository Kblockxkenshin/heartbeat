// Tinder-style stack: right = loved, left = didn't like, up = haven't seen.
import { TITLES } from '../data.js';
import { U, swipe, myScore } from '../store.js';
import { $, esc, poster, hydratePosters, hearts, celebrate, toast, empty, confetti, buzz } from '../ui.js';
import { rerender } from '../app.js';
import { SVCS } from './taste.js';
import { BYID } from '../data.js';
import { idOf } from '../cloud.js';

let session = 0;
/* ---------- The deck: every released movie and show, shuffled with a taste-aware algorithm ----------
   1. Titles come from random pages of the "already released, most popular" lists (pages near the top
      are more likely, so most cards are things people have actually seen, but deep cuts show up too).
   2. Each card gets a score = how popular it is + how much it matches the genres you loved (minus the
      genres you disliked) + a random shake. The deck is sorted by that score.
   3. A fresh random shake every time you open Quick Rate, so the order is never the same twice. */
const Q = { type: 'all', svc: '', pool: [], used: { movie: new Set(), tv: new Set() }, pages: { movie: 1, tv: 1 }, busy: false, seq: 0, err: false, score: new Map(), order: [] };
const types = () => Q.type === 'all' ? ['movie', 'tv'] : [Q.type];
const fresh = t => myScore(t.id) == null && !U.swipes[t.id];
/** How much you like each genre, from your loves (+1) and dislikes (-1) and ratings. */
function taste() {
  const w = {};
  const add = (id, v) => (BYID[id]?.genres || []).forEach(g => { w[g] = (w[g] || 0) + v; });
  for (const [id, k] of Object.entries(U.swipes || {})) add(id, k === 'loved' ? 1 : k === 'disliked' ? -1 : 0);
  for (const [id, r] of Object.entries(U.ratings || {})) if (r?.overall != null) add(id, (r.overall - 3) / 2);
  const top = Math.max(1, ...Object.values(w).map(Math.abs));
  for (const g in w) w[g] /= top;   // -1 … 1
  return w;
}
function scoreOf(t, w, pop) {
  const g = (t.genres || []).reduce((a, x) => a + (w[x] || 0), 0) / Math.max(1, (t.genres || []).length);
  return pop * 0.9 + g * 0.8 + Math.random() * 1.1;   // popular + your taste + a random shake
}
/** Pick a page we haven't used yet: mostly near the top, sometimes deeper. */
function nextPage(k) {
  const max = Math.max(1, Q.pages[k]);
  for (let cap = Math.min(max, 25); ; cap = Math.min(max, cap * 2)) {
    const free = []; for (let p = 1; p <= cap; p++) if (!Q.used[k].has(p)) free.push(p);
    if (free.length) return free[Math.floor(Math.pow(Math.random(), 1.7) * free.length)];
    if (cap >= max) return 0;
  }
}
function addToDeck(list, popOf) {
  const w = taste();
  for (const t of list) if (!Q.score.has(t.id)) Q.score.set(t.id, scoreOf(t, w, popOf(t)));
  // Keep the two cards on screen where they are; sort the rest by score.
  const live = Q.order.filter(id => { const t = BYID[id]; return t && fresh(t); });
  const head = live.slice(0, 2), rest = new Set(live.slice(2));
  for (const t of list) if (!head.includes(t.id)) rest.add(t.id);
  Q.order = [...head, ...[...rest].sort((a, b) => Q.score.get(b) - Q.score.get(a))];
}
const queue = () => Q.order.map(id => BYID[id]).filter(t => t && fresh(t) && (Q.type === 'all' || t.type === Q.type));
async function more() {
  if (Q.busy) return; const my = Q.seq; Q.busy = true; Q.err = false;
  try {
    const got = await Promise.all(types().map(k => [k, nextPage(k)]).filter(([, p]) => p).map(([k, p]) =>
      fetch(`/api/tmdb?pick=${k}&svc=${encodeURIComponent(Q.svc)}&page=${p}`).then(r => r.ok ? r.json() : Promise.reject(r.status)).then(d => {
        Q.used[k].add(p); Q.pages[k] = d.total_pages || 0;
        return (d.results || []).map((x, i) => ({ ...x, _pop: Math.max(0, 1 - ((p - 1) * 20 + i) / 600) }));
      })));
    if (my !== Q.seq) return;
    const batch = [];
    for (const x of got.flat()) {
      const id = idOf(`${x.type}:${x.id}`) || `tmdb-${x.type}-${x.id}`;
      const t = BYID[id] || { id, tmdb: x.id, type: x.type, name: x.name, year: +x.year || '', genres: x.genres || [], posterPath: x.poster_path, backdropPath: x.backdrop_path, overview: x.overview || '' };
      if (!BYID[id]) BYID[id] = t;
      t._pop = x._pop; batch.push(t); Q.pool.push(t);
    }
    addToDeck(batch, t => t._pop || 0);
  } catch (e) { if (my === Q.seq) Q.err = true; }
  finally { if (my === Q.seq) Q.busy = false; }
}
const done = () => types().every(k => !nextPage(k));
// Start (or restart) a deck: our own picks + a fresh random shake.
function start() {
  Q.score = new Map(); Q.order = [];
  addToDeck([...(Q.svc === '' ? TITLES : []), ...Q.pool].filter((t, i, a) => a.indexOf(t) === i), t => t._pop ?? 0.85);
}

export function renderQuickRate(app) {
  document.title = 'Quick Rate — Heartbeat';
  // Just opened Quick Rate (not a redraw after a swipe)? Shuffle a new deck.
  if (!app.querySelector('.qr')) start();
  const q = queue();
  // Running low? Fetch the next page in the background.
  if (q.length < 6 && !done() && !Q.busy && !Q.err) more().then(() => { if (location.hash.startsWith('#/rate')) rerender(); });
  const goal = Math.ceil((session + 1) / 10) * 10;
  const chip = (attr, k, l, on) => `<button data-${attr}="${k}" class="${on ? 'on' : ''}" aria-pressed="${on}">${l}</button>`;
  app.innerHTML = `<div class="screen qr">
    <div class="qr-top"><div><h1 style="margin:0;font-size:clamp(26px,3vw,34px);font-weight:900"><i class="i i-zap" aria-hidden="true"></i> Quick Rate</h1><div class="sub">${session ? `${session} rated this round` : 'Seen it? Swipe it.'}</div></div>
      <a class="icon-btn" href="#/" aria-label="Close"><i class="i i-x" aria-hidden="true"></i></a></div>
    <div class="qfilt"><div class="tsvcs qtypes">${[['all', 'All'], ['movie', 'Movies'], ['tv', 'Shows']].map(([k, l]) => chip('qtype', k, l, Q.type === k)).join('')}<span class="qsep" aria-hidden="true"></span>${SVCS.map(([k, l]) => chip('qsvc', k, k ? l : 'Everywhere', Q.svc === k)).join('')}</div></div>
    <div class="lvl" style="margin-top:12px" aria-label="${session} of ${goal} toward your next goal"><i style="width:${(session % 10) / 10 * 100}%"></i></div>
    ${q.length ? `<div class="stack" id="stack">
      ${q.slice(0, 2).reverse().map((t, i, a) => `<div class="qcard ${i === a.length - 1 ? 'front' : 'back'}" data-id="${t.id}">
        ${t.posterPath ? `<div class="qblur" style="background-image:url('https://image.tmdb.org/t/p/w185${esc(t.posterPath)}')" aria-hidden="true"></div>` : ''}
        ${poster(t, { mine: false }).replace(/ sizes="[^"]*"/, ' sizes="(min-width:768px) 400px, 92vw"')}
        <span class="stamp love">LOVED</span><span class="stamp nope">NOPE</span><span class="stamp unseen">NOT SEEN</span>
        <div class="info"><h3>${esc(t.name)}</h3><div class="meta" style="color:#ddd">${esc([t.year, t.type === 'tv' ? 'Show' : 'Movie', ...(t.genres || []).slice(0, 2)].filter(Boolean).join(' · '))}</div></div>
      </div>`).join('')}
    </div>
    <div class="qbtns">
      <button data-act="disliked" class="nope" aria-label="Didn't like it (swipe left)"><i class="i i-thumbs-down" aria-hidden="true"></i></button>
      <button data-act="loved" class="love" aria-label="Loved it (swipe right)"><i class="i i-heart-fill" aria-hidden="true"></i></button>
      <button data-act="unseen" class="unsee" aria-label="Haven't seen it (swipe up)"><i class="i i-eye-off" aria-hidden="true"></i></button>
    </div>
    <div class="qhint">Swipe or use your keyboard: <kbd class="kbd">←</kbd> nope · <kbd class="kbd">→</kbd> loved · <kbd class="kbd">↑</kbd> haven't seen</div>`
    : Q.err ? empty('Couldn’t load more titles.', 'sad', '<button class="btn" id="qretry">Try again</button>')
    : !done() ? `<div class="stack"><div class="qcard front qload"><div class="poster"><div class="shimmer"></div></div><div class="info"><h3>Loading more…</h3></div></div></div>`
    : empty(`You rated everything here! ${session ? `That's ${session} in one go.` : ''}<br>Try another service above.`, 'wow', `<a class="btn" href="#/me">See my stats</a>`)}
  </div>`;
  app.querySelectorAll('[data-qtype]').forEach(b => b.onclick = () => { Q.type = b.dataset.qtype; reset(); });
  app.querySelectorAll('[data-qsvc]').forEach(b => b.onclick = () => { Q.svc = b.dataset.qsvc; reset(); });
  app.querySelector('#qretry')?.addEventListener('click', () => { Q.err = false; rerender(); });
  if (!matchMedia('(min-width: 768px)').matches) app.querySelector('.qfilt .on[data-qsvc]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  hydratePosters(app);
  fit(app); requestAnimationFrame(() => fit(app)); setTimeout(() => fit(app), 400);
  if (!q.length) return;
  // Warm up the next posters so swiping feels instant
  q.slice(2, 5).forEach(t => { if (t.posterPath) { const im = new Image(); im.src = `https://image.tmdb.org/t/p/w500${t.posterPath}`; } });
  const card = $('.qcard.front', app);
  app.querySelectorAll('[data-act]').forEach(b => b.onclick = () => fling(card, b.dataset.act));
  drag(card);
  document.onkeydown = e => { if (!$('.qcard.front')) { document.onkeydown = null; return; } const m = { ArrowRight: 'loved', ArrowLeft: 'disliked', ArrowUp: 'unseen' }[e.key]; if (m) { e.preventDefault(); fling($('.qcard.front'), m); } };
}

/** Size the card so the whole poster fits between the header and the buttons, on any screen. */
const INFO = 74;
function fit(app) {
  const st = app.querySelector('.stack'); if (!st) return;
  const tabs = document.querySelector('#tabs'), bar = tabs && !tabs.hidden && getComputedStyle(tabs).display !== 'none' ? tabs.querySelector('.bar') : null;
  const bottom = bar ? bar.getBoundingClientRect().top - 8 : innerHeight - 12;
  const btns = app.querySelector('.qbtns'), bh = btns ? btns.offsetHeight + 26 : 0;
  const top = st.getBoundingClientRect().top + scrollY - scrollY;
  const h = Math.max(250, Math.min(660, bottom - top - bh));
  const w = Math.min(st.parentElement.clientWidth, Math.round((h - INFO) * 2 / 3), 460);
  st.style.height = h + 'px'; st.style.width = w + 'px';
}
addEventListener('resize', () => { const a = document.querySelector('.qr'); if (a) fit(a.parentElement); });

function reset() { Q.seq++; Q.pool = []; Q.used = { movie: new Set(), tv: new Set() }; Q.pages = { movie: 1, tv: 1 }; Q.busy = false; Q.err = false; start(); rerender(); }

function drag(card) {
  let x0, y0, dx = 0, dy = 0, on = false;
  const stamps = k => card.querySelectorAll('.stamp').forEach(s => s.style.opacity = s.classList.contains(k) ? Math.min(1, (k === 'unseen' ? -dy : Math.abs(dx)) / 90) : 0);
  // Grab anywhere on the card (poster included): stop the browser from dragging/saving the picture instead.
  card.addEventListener('dragstart', e => e.preventDefault());
  card.querySelectorAll('img').forEach(im => { im.draggable = false; });
  card.addEventListener('contextmenu', e => e.preventDefault());
  card.addEventListener('pointerdown', e => { on = true; x0 = e.clientX; y0 = e.clientY; card.setPointerCapture(e.pointerId); card.style.transition = 'none'; });
  card.addEventListener('pointermove', e => {
    if (!on) return; dx = e.clientX - x0; dy = e.clientY - y0;
    card.style.transform = `translate(${dx}px,${dy}px) rotate(${dx / 14}deg)`;
    stamps(-dy > Math.abs(dx) ? 'unseen' : dx > 0 ? 'love' : 'nope');
  });
  const end = () => {
    if (!on) return; on = false; card.style.transition = '';
    if (dx > 110) fling(card, 'loved'); else if (dx < -110) fling(card, 'disliked'); else if (dy < -110) fling(card, 'unseen');
    else { card.style.transform = ''; card.querySelectorAll('.stamp').forEach(s => s.style.opacity = 0); }
    dx = dy = 0;
  };
  card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end);
}

function fling(card, kind) {
  if (!card || card.dataset.gone) return; card.dataset.gone = 1;
  const id = card.dataset.id;
  const to = { loved: 'translate(140%,-10%) rotate(24deg)', disliked: 'translate(-140%,-10%) rotate(-24deg)', unseen: 'translate(0,-130%)' }[kind];
  card.querySelectorAll('.stamp').forEach(s => s.style.opacity = s.classList.contains({ loved: 'love', disliked: 'nope', unseen: 'unseen' }[kind]) ? 1 : 0);
  card.style.transition = 'transform .35s ease-in'; card.style.transform = to;
  if (kind === 'loved') { const r = card.getBoundingClientRect(); hearts(r.x + r.width / 2, r.y + r.height / 2, 12); }
  buzz(kind === 'loved' ? [12, 30, 12] : 12);
  const btn = document.querySelector(`.qbtns [data-act="${kind}"]`); if (btn) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
  const res = swipe(id, kind);
  if (kind !== 'unseen') session++;
  setTimeout(() => {
    rerender();
    if ([5, 10, 15].includes(session) && !(res.newBadges?.length)) { confetti(); toast(`${session} rated! You're on fire.`, 'wow'); }
    else celebrate(res);
  }, 320);
}

/** For tests: the ids in the deck, in order. */
export const __deck = () => queue().map(t => t.id);
