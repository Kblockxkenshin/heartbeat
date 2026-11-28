// "Your top 10": the first thing a new visitor sees (no account needed).
// Pick up to 10 favorite movies or shows → we show how many real people share that taste.
// Counts come from the server (taste_match) and are never made up. Nobody is named.
import { cloud } from '../cloud.js';
import { $, $$, esc, ic, toast } from '../ui.js';
import { CONFIG } from '../config.js';
import { reveal, countUp } from '../motion.js';

const MAX = 10, MIN = 3;
const DONE = 'hb_taste_done', PICKS = 'hb_taste', DEV = 'hb_device';
const img = p => p ? `${CONFIG.imageBase}w185${p}` : '';
const keyOf = x => `${x.type === 'tv' ? 'tv' : 'movie'}:${x.id}`;
const device = () => {
  let d = null; try { d = localStorage.getItem(DEV); } catch (e) { /* ignore */ }
  if (!d || !/^[0-9a-f-]{36}$/.test(d)) { d = crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)); try { localStorage.setItem(DEV, d); } catch (e) { /* ignore */ } }
  return d;
};
/** Should a new visitor see this first? (not signed in, never finished or skipped it) */
export const wantsTaste = () => { try { return !cloud.user && !localStorage.getItem(DONE); } catch (e) { return false; } };
const finish = () => { try { localStorage.setItem(DONE, '1'); } catch (e) { /* ignore */ } };

const st = { picks: [], list: [], q: '', seq: 0, res: null, type: 'movie', svc: '' };

export const SVCS = [['', 'Popular'], ['netflix', 'Netflix'], ['prime', 'Prime Video'], ['disney', 'Disney+'], ['max', 'Max'], ['hulu', 'Hulu'], ['apple', 'Apple TV+'], ['peacock', 'Peacock'], ['paramount', 'Paramount+'], ['hotstar', 'JioHotstar'], ['indian', 'Indian']];
const today = () => new Date().toISOString().slice(0, 10);

export async function renderTaste(app) {
  document.title = 'Your top 10 — Heartbeat';
  try { st.picks = JSON.parse(localStorage.getItem(PICKS) || '[]').slice(0, MAX); } catch (e) { st.picks = []; }
  if (st.res) return drawResults(app);   // the page got redrawn (sign-in state changed): keep showing the results
  st.type ||= 'movie'; st.svc ??= '';
  app.innerHTML = `<div class="screen taste">
    <header class="hhead"><p class="eyebrow">Welcome to Heartbeat</p><h1 class="display">Your <em>top 10.</em></h1>
      <p class="sub uplead">Pick the movies and shows you love most. We'll show you how many people share your taste.</p></header>
    <div class="bosearch"><label class="bsearch">${ic('search')}<input id="tq" type="search" placeholder="Search any movie or show…" aria-label="Search movies and shows" autocomplete="off"></label></div>
    <div class="tpicked" id="tpicked" aria-live="polite"></div>
    <div id="tbrowse">
      <div class="regsw ttype" role="tablist" aria-label="Movies or shows">${[['movie', 'Movies'], ['tv', 'Shows']].map(([k, l]) => `<button role="tab" data-type="${k}" aria-selected="${st.type === k}" class="${st.type === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="tsvcs" role="tablist" aria-label="Where it streams">${SVCS.map(([k, l]) => `<button role="tab" data-svc="${k}" aria-selected="${st.svc === k}" class="${st.svc === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    </div>
    <div class="sec"><h2 id="tgh"></h2></div>
    <div class="tgrid" id="tgrid"></div>
    <div class="tmore" id="tmore"></div>
  </div>
  <div class="tbarb"><div class="tbarin"><span class="meta" id="tcount"></span>
      <button class="btn" id="tgo" disabled>See who shares my taste</button></div>
      <button class="tskip" id="tskip">Skip for now</button></div>`;
  $('#tskip', app).onclick = () => { finish(); location.hash = '#/'; };
  $('#tgo', app).onclick = () => showResults(app);
  let qt = 0;
  $('#tq', app).oninput = e => { clearTimeout(qt); const v = e.target.value.trim(); qt = setTimeout(() => search(app, v), 250); };
  $$('[data-type]', app).forEach(b => b.onclick = () => { st.type = b.dataset.type; $$('[data-type]', app).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); }); browse(app, true); });
  $$('[data-svc]', app).forEach(b => b.onclick = () => { st.svc = b.dataset.svc; $$('[data-svc]', app).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); }); b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); browse(app, true); });
  drawPicked(app);
  // Load the next page by itself when you scroll near the bottom.
  st.io?.disconnect();
  if ('IntersectionObserver' in window) { st.io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && !st.q) browse(app, false); }, { rootMargin: '800px' }); st.io.observe($('#tmore', app)); }
  browse(app, true);
}

/** Every movie / show that is already out (optionally on one service), most popular first, page by page. */
async function browse(app, fresh) {
  if (fresh) { st.list = []; st.page = 0; st.pages = 1; st.bseq = (st.bseq || 0) + 1; st.busy = false; }
  if (st.busy || st.page >= st.pages) return;
  const my = st.bseq; st.busy = true;
  const label = SVCS.find(x => x[0] === st.svc)?.[1] || 'Popular', what = st.type === 'tv' ? 'shows' : 'movies';
  $('#tgh', app).textContent = st.svc === '' ? `Popular ${what}` : st.svc === 'indian' ? `Indian ${what}` : `${what[0].toUpperCase() + what.slice(1)} on ${label}`;
  if (fresh) $('#tgrid', app).innerHTML = Array.from({ length: 9 }, () => '<span class="tcard"><span class="tpost tsk"></span></span>').join('');
  $('#tmore', app).innerHTML = '<span class="meta">Loading…</span>';
  let d = null;
  try { d = await fetch(`/api/tmdb?pick=${st.type}&svc=${encodeURIComponent(st.svc)}&page=${st.page + 1}`).then(r => r.ok ? r.json() : null); } catch (e) { d = null; }
  if (my !== st.bseq || !$('#tgrid', app)) return;
  st.busy = false;
  if (!d) { $('#tmore', app).innerHTML = '<button class="btn ghost" id="tretry">Couldn’t load. Try again</button>'; $('#tretry', app).onclick = () => browse(app, false); if (fresh) $('#tgrid', app).innerHTML = ''; return; }
  st.page = d.page || st.page + 1; st.pages = d.total_pages || 0;
  const seen = new Set(st.list.map(keyOf)), add = (d.results || []).filter(x => !seen.has(keyOf(x)));
  st.list = st.list.concat(add);
  if (!st.q) { if (fresh) drawGrid(app, st.list); else appendGrid(app, add, st.list); }
  $('#tmore', app).innerHTML = st.page < st.pages ? `<button class="btn ghost" id="tload">Show more</button><span class="meta">${d.total ? `${d.total.toLocaleString('en-US')} ${what}` : ''}</span>` : (st.list.length ? '<span class="meta">That’s all of them. Search for anything else.</span>' : '<span class="meta">Nothing here right now.</span>');
  $('#tload', app)?.addEventListener('click', () => browse(app, false));
}

async function search(app, v) {
  const my = ++st.seq; st.q = v.length >= 2 ? v : '';
  $('#tbrowse', app).hidden = !!st.q; $('#tmore', app).hidden = !!st.q;
  if (!st.q) { browse(app, true); return; }
  $('#tgh', app).textContent = `Results for “${v}”`;
  try {
    const d = await fetch(`/api/tmdb?q=${encodeURIComponent(v)}`).then(r => r.json());
    if (my !== st.seq) return;
    // Only things that are already out (no upcoming movies).
    const t = today();
    drawGrid(app, (d.results || []).filter(x => (x.type === 'movie' || x.type === 'tv') && (x.date ? x.date <= t : x.year && x.year < t.slice(0, 4))));
  } catch (e) { $('#tgrid', app).innerHTML = '<div class="meta" style="padding:12px">Search is not working right now.</div>'; }
}

const cardHtml = x => { const k = keyOf(x), i = st.picks.findIndex(p => p.key === k);
  return `<button class="tcard ${i >= 0 ? 'on' : ''}" data-k="${esc(k)}" aria-pressed="${i >= 0}" aria-label="${esc(x.name)}${x.year ? ` (${esc(x.year)})` : ''}${i >= 0 ? `, pick number ${i + 1}` : ''}">
      <span class="tpost">${x.poster_path ? `<img src="${esc(img(x.poster_path))}" alt="" loading="lazy">` : `<i>${esc(x.name.slice(0, 2).toUpperCase())}</i>`}${i >= 0 ? `<b class="tnum">${i + 1}</b>` : ''}</span>
      <span class="tname">${esc(x.name)}</span><span class="meta">${esc([x.type === 'tv' ? 'Show' : 'Movie', x.year].filter(Boolean).join(' · '))}</span></button>`; };
function wire(app, cards, list) { cards.forEach(b => b.onclick = () => toggle(app, list.find(x => keyOf(x) === b.dataset.k))); }
function drawGrid(app, list) {
  const g = $('#tgrid', app); if (!g) return; st.shown = list;
  g.innerHTML = list.length ? list.map(cardHtml).join('') : '<div class="meta" style="padding:12px">Nothing found. Try another name.</div>';
  wire(app, $$('.tcard', g), list);
  reveal($$('.tcard', g).slice(0, 12));
}
function appendGrid(app, add, list) {
  const g = $('#tgrid', app); if (!g || !add.length) return; st.shown = list;
  g.insertAdjacentHTML('beforeend', add.map(cardHtml).join(''));
  wire(app, $$('.tcard', g).slice(-add.length), list);
}
/** Re-number the picked cards without redrawing the grid. */
function markGrid(app) {
  $$('.tcard[data-k]', app).forEach(b => { const i = st.picks.findIndex(p => p.key === b.dataset.k), on = i >= 0;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    const post = b.querySelector('.tpost'); let n = post.querySelector('.tnum');
    if (on) { if (!n) { n = document.createElement('b'); n.className = 'tnum'; post.appendChild(n); } n.textContent = i + 1; } else n?.remove(); });
}

function toggle(app, x) {
  if (!x) return;
  const k = keyOf(x), i = st.picks.findIndex(p => p.key === k);
  if (i >= 0) st.picks.splice(i, 1);
  else if (st.picks.length >= MAX) { toast('That\'s 10! Remove one to swap it.', 'think'); return; }
  else st.picks.push({ key: k, id: x.id, type: x.type, name: x.name, year: x.year, poster_path: x.poster_path });
  try { localStorage.setItem(PICKS, JSON.stringify(st.picks)); } catch (e) { /* ignore */ }
  drawPicked(app); markGrid(app);
}

function drawPicked(app) {
  const n = st.picks.length, box = $('#tpicked', app);
  box.innerHTML = n ? st.picks.map((p, i) => `<button class="tchip" data-i="${i}" aria-label="Remove ${esc(p.name)}"><b>${i + 1}</b>${esc(p.name)} ${ic('x')}</button>`).join('') : '';
  $$('.tchip', box).forEach(b => b.onclick = () => { st.picks.splice(+b.dataset.i, 1); try { localStorage.setItem(PICKS, JSON.stringify(st.picks)); } catch (e) { /* ignore */ } drawPicked(app); markGrid(app); });
  $('#tcount', app).textContent = n < MIN ? `Pick at least ${MIN} (${n}/${MAX})` : `${n} of ${MAX} picked`;
  $('#tgo', app).disabled = n < MIN;
}

async function showResults(app) {
  const keys = st.picks.map(p => p.key), dev = device();
  const btn = $('#tgo', app); btn.disabled = true; btn.textContent = 'Finding your people…';
  let res = null;
  try {
    if (!cloud.sb) throw new Error('offline');
    await cloud.sb.rpc('taste_save', { p_device: dev, p_keys: keys });
    const { data, error } = await cloud.sb.rpc('taste_match', { p_device: dev, p_keys: keys });
    if (error) throw error;
    res = data;
  } catch (e) { btn.disabled = false; btn.textContent = 'See who shares my taste'; toast('Could not reach the server. Try again in a moment.', 'sad'); return; }
  finish(); st.res = res;
  drawResults(app);
}

function drawResults(app) {
  const res = st.res;
  const per = res.per || {}, any = +res.any || 0, three = +res.three || 0;
  const top = st.picks.slice().sort((a, b) => (per[b.key] || 0) - (per[a.key] || 0));
  app.innerHTML = `<div class="screen taste tres">
    <header class="hhead"><p class="eyebrow">Your taste</p>
      ${any ? `<h1 class="display"><span class="num" id="tany">${any.toLocaleString('en-US')}</span> <em>${any === 1 ? 'person shares' : 'people share'}</em> your taste.</h1>
        <p class="sub uplead">They love at least one of your top ${st.picks.length}.${three ? ` <b>${three.toLocaleString('en-US')}</b> ${three === 1 ? 'is a taste twin' : 'are taste twins'} — 3 or more of the same favorites.` : ''}</p>`
      : `<h1 class="display">You're one of the <em>first.</em></h1><p class="sub uplead">Nobody here has picked these yet. Sign up and invite friends to see who matches you.</p>`}
    </header>
    <section class="card run"><h2 class="h3">Your top ${st.picks.length}</h2>
      <ul class="tlist">${top.map(p => { const n = per[p.key] || 0; return `<li><a href="#/t/tmdb-${p.type === 'tv' ? 'tv' : 'movie'}-${p.id}" class="tli">
        <span class="tpost sm">${p.poster_path ? `<img src="${esc(img(p.poster_path))}" alt="" loading="lazy">` : ''}</span>
        <span><b>${esc(p.name)}</b><span class="meta">${n ? `${n.toLocaleString('en-US')} other${n === 1 ? '' : 's'} love${n === 1 ? 's' : ''} this too` : 'You\'re the first to pick this'}</span></span>
        ${n ? `<span class="tbarw"><i style="width:${Math.max(6, Math.round(n / Math.max(1, ...top.map(t => per[t.key] || 0)) * 100))}%"></i></span>` : ''}</a></li>`; }).join('')}</ul></section>
    <div class="tcta"><a class="btn big" href="#/signin">Sign up to meet them</a><a class="btn ghost big" href="#/">Keep exploring</a><button class="tskip" id="tredo">Change my picks</button></div>
    <p class="meta upnote">Counts are real people: visitors who picked these here, and members who rated them 4+ or loved them. We never show who.</p>
  </div>`;
  scrollTo(0, 0);
  $('#tredo', app).onclick = () => { st.res = null; renderTaste(app); };
  const el = $('#tany', app); if (el && countUp) countUp(el, any, v => Math.round(v).toLocaleString('en-US'));
}
