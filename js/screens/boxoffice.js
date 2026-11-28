// Box Office (Indian cinema) — like a stock app, for movies.
//   #/boxoffice        ticker list, tabs, filters, top stats
//   #/boxoffice/<id>   one movie: revenue chart, key numbers, theatrical run
// Numbers are entered by admins (Admin → Box office). Money is in ₹ crore.
import { cloud, plain } from '../cloud.js';
import { $, $$, esc, ic, poster, hydratePosters, wide } from '../ui.js';
import { CONFIG } from '../config.js';
import { LANGS } from './upcoming.js';
import { echarts, reveal, countUp } from '../motion.js';

const st = { tab: 'theaters', lang: '', year: '', verdict: '', metric: 'ww', mode: 'cum', range: 'all', hwYear: new Date().getFullYear() };
// Final judgement, best to worst. "Superhit" is the old spelling still in some saved rows.
const VERDICTS = ['Industry hit', 'Blockbuster', 'Super hit', 'Hit', 'Average', 'Flop', 'Utter flop', 'Disaster'];
const vname = v => v === 'Superhit' ? 'Super hit' : v;
const GOOD = new Set(['Industry hit', 'Blockbuster', 'Super hit', 'Superhit', 'Hit']);
const BAD = new Set(['Flop', 'Utter flop', 'Disaster']);
const vtone = v => GOOD.has(v) ? 'up' : BAD.has(v) ? 'down' : '';
const dayMs = 864e5;
const n = v => v == null ? null : +v;
export const cr = v => v == null || isNaN(v) ? '—' : '₹' + (v >= 1000 ? Math.round(v).toLocaleString('en-IN') : v >= 100 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2)) + ' Cr';
const dt = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = s => dt(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const daysSince = s => Math.floor((Date.now() - dt(s)) / dayMs) + 1;
const langName = (() => { try { return new Intl.DisplayNames(['en'], { type: 'language' }); } catch (e) { return null; } })();
const lang = c => LANGS[c] || (c && langName ? (() => { try { return langName.of(c); } catch (e) { return c.toUpperCase(); } })() : (c || '').toUpperCase());
const img = (p, size = 'w185') => p ? `${CONFIG.imageBase}${size}${p}` : '';
const verdictPill = v => v ? `<span class="vpill ${vtone(v)}">${esc(vname(v))}</span>` : `<span class="vpill run">Running</span>`;
function change(m) {
  const a = n(m.last), b = n(m.prev);
  if (a == null || b == null || !b) return '<span class="chg">—</span>';
  const p = (a - b) / b * 100, up = p >= 0;
  return `<span class="chg ${up ? 'up' : 'down'}" aria-label="${up ? 'Up' : 'Down'} ${Math.abs(p).toFixed(1)} percent">${up ? '▲' : '▼'} ${Math.abs(p).toFixed(1)}%</span>`;
}
/** Small poster. If we don't have one yet, the row carries what we need to find it (TMDB id, title, language, year) and fillThumbs() fetches it. */
const thumb = m => {
  if (m.poster_path) return `<span class="bthumb"><img src="${esc(img(m.poster_path, 'w92'))}" alt="" loading="lazy"></span>`;
  const tid = m.kind ? (m.tmdb_id || m.tmdb || '') : (m.id || '');
  const title = m.title || m.name || '', y = m.year || String(m.date || m.release_date || '').slice(0, 4);
  return `<span class="bthumb need" data-pt="${esc(String(tid))}" data-pq="${esc(title)}" data-pl="${esc(m.lang || '')}" data-py="${esc(String(y || ''))}"><i>${esc(title.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase())}</i></span>`;
};
const TKEY = 'hb_bo_thumbs';
let thumbCache = (() => { try { return JSON.parse(localStorage.getItem(TKEY) || '{}'); } catch (e) { return {}; } })();
/** Movie page: if the big poster is missing, find one and swap it in. */
async function fixHeadPoster(app, o) {
  if (o.posterPath) return;
  const p = await posterFor(o.tid, o.name, o.lang, o.year);
  const box = $('#bom .bopost', app);
  if (!p || !box) return;
  box.innerHTML = poster({ id: o.id, name: o.name, year: String(o.year || ''), type: 'movie', posterPath: p, colors: ['#171717', '#171717'] }, { mine: false });
  hydratePosters(box);
}
/** Find a poster: TMDB id first (poster, any-language poster, or a still), then a TMDB title search. */
export async function posterFor(tid, q, lng, y) {
  const k = tid ? 't' + tid : `q|${lng}|${y}|${q}`;
  if (k in thumbCache && thumbCache[k]) return thumbCache[k];
  let p = null, id = tid;
  try {
    if (!id && q) {
      const m = await matchMovie(q, y, lng);
      if (m) { id = m.id; p = m.poster_path || m.backdrop_path || null; }
    }
    if (!p && id) { const d = await tmdbGet(`/api/tmdb?poster=${id}`); p = d.poster_path || d.backdrop_path || null; }
  } catch (e) { return null; }
  if (p) { thumbCache[k] = p; try { localStorage.setItem(TKEY, JSON.stringify(thumbCache)); } catch (e) { /* ignore */ } }
  return p;
}
let filling = false;
async function fillThumbs() {
  if (filling) return; filling = true;
  try {
    for (;;) {
      const todo = $$('.bthumb.need:not(.busy)').slice(0, 6);
      if (!todo.length) break;
      await Promise.all(todo.map(async el => {
        el.classList.add('busy');
        const p = await posterFor(el.dataset.pt, el.dataset.pq, el.dataset.pl, el.dataset.py);
        if (p) { el.innerHTML = `<img src="${esc(img(p, 'w92'))}" alt="" loading="lazy">`; el.classList.remove('need'); }
        else el.classList.add('none');
      }));
    }
  } finally { filling = false; }
}
// Any time rows are added to a box office screen, fill in their missing posters.
let thumbObs = null;
function watchThumbs(root) {
  if (thumbObs) thumbObs.disconnect();
  let t = 0;
  thumbObs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(fillThumbs, 60); });
  thumbObs.observe(root, { childList: true, subtree: true });
  setTimeout(fillThumbs, 0);
}

async function rpc(fn, args) {
  if (!cloud.sb) throw new Error('Box office numbers need the online backend, which is not set up yet.');
  const { data, error } = await cloud.sb.rpc(fn, args);
  if (error) throw new Error(plain(error));
  return data;
}

/* Match a reported title to a tracked/TMDB title: same language, same or starting name. */
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const same = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.startsWith(y + ' ') || y.startsWith(x + ' ')); };
const range = r => r.high != null && +r.high > +r.low ? `₹${Math.round(r.low).toLocaleString('en-IN')}–${Math.round(r.high).toLocaleString('en-IN')} Cr` : cr(+r.low);
const tmdbGet = url => fetch(url).then(r => r.ok ? r.json() : Promise.reject(new Error('TMDB')));
/** Best TMDB match for a title (+ year, language). Spelling-tolerant: "Baahubali" = "Bāhubali", "KGF" = "K.G.F". Short titles ("War", "2.0") need the year and language to match. */
const skel = s => norm(s).replace(/[^a-z0-9]/g, '').replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
async function matchMovie(q, y, lng) {
  const d = await tmdbGet(`/api/tmdb?find=${encodeURIComponent(q)}${y ? `&year=${y}` : ''}`);
  const M = (d.results || []), near = x => !y || !x.year || Math.abs(+x.year - +y) <= 1, okLang = x => !lng || !x.lang || x.lang === lng;
  const k = skel(q), k1 = skel(q.split(/[:(]/)[0]);
  const loose = x => [x.name, x.original_name].some(n => { const s = skel(n); return s && (s === k || (k.length >= 6 && (s.startsWith(k) || k.startsWith(s))) || (k1.length >= 4 && skel(String(n).split(/[:(]/)[0]) === k1)); });
  return M.find(x => okLang(x) && near(x) && (same(x.name, q) || same(x.original_name, q)))
    || M.find(x => okLang(x) && near(x) && loose(x))
    || (lng && y ? (c => c.length === 1 ? c[0] : null)(M.filter(x => x.lang === lng && +x.year === +y)) : null)
    || null;
}
/** Poster + TMDB id for a reported movie (cached for this visit). */
const PKEY = 'hb_bo_posters2';
let posterCache = (() => { try { return JSON.parse(sessionStorage.getItem(PKEY) || '{}'); } catch (e) { return {}; } })();
async function findPoster(r) {
  const k = `${r.lang}|${r.year}|${r.title}`;
  if (k in posterCache) return posterCache[k];
  let hit = null;
  try {
    const m = await matchMovie(r.title, r.year, r.lang);
    if (m) hit = { tmdb: m.id, poster_path: m.poster_path };
  } catch (e) { return null; }
  posterCache[k] = hit; try { sessionStorage.setItem(PKEY, JSON.stringify(posterCache)); } catch (e) { /* ignore */ }
  return hit;
}

export async function renderBoxOffice(app, id) {
  watchThumbs(app);
  if (id && /^\d+$/.test(id)) return renderMovie(app, +id);
  if (id && /^tmdb-\d{1,9}$/.test(id)) return renderTmdbMovie(app, id.slice(5));
  document.title = 'Box Office — Heartbeat';
  app.innerHTML = `<div class="screen boxoffice">
    <header class="hhead"><p class="eyebrow">Indian box office</p><h1 class="display">The <em>numbers.</em></h1>
      <p class="sub uplead">Collections in ₹ crore, like a stock ticker for movies. Every Indian release, plus the biggest hits of all time.</p></header>
    <div class="bosearch"><label class="bsearch">${ic('search')}<input id="bosq" type="search" placeholder="Search any movie ever made…" aria-label="Search any movie for its box office" autocomplete="off"></label><div id="bosres" class="bosres" role="listbox" hidden></div></div>
    <div id="bostats" class="bostats"></div>
    <div id="boctl"></div>
    <div id="bolist"><div class="card"><div class="rskel"></div></div></div>
    <div id="boall"></div>
    <p class="meta upnote" id="bonote">Numbers are estimates from public trade reports and may change. Net = after taxes. Gross = with taxes. Movies marked "Reported" only have a worldwide total; daily charts are for tracked movies.</p>
  </div>`;
  let all, rep;
  try {
    [all, rep] = await Promise.all([rpc('box_office_summary'), rpc('box_office_reported').catch(() => [])]);
    all = all.map(m => ({ ...m, kind: 't', year: dt(m.release_date).getFullYear(), net: +m.net, gross: +m.gross, worldwide: +m.worldwide, overseas: +m.overseas, budget: n(m.budget), breakeven: n(m.breakeven), opening: n(m.opening) }));
  } catch (e) { $('#bolist', app).innerHTML = `<div class="card"><div class="mascot"><div>${esc(e.message)}</div></div></div>`; return; }
  if (!app.querySelector('.boxoffice')) return;
  // Reported totals that are not already tracked day by day.
  const reported = rep.filter(r => !all.some(m => m.lang === r.lang && Math.abs(m.year - r.year) <= 1 && same(m.title, r.title)))
    .map(r => ({ ...r, kind: 'r', worldwide: +r.low, high: n(r.high), year: +r.year }));
  // Tracked day by day but with no overseas numbers (India only): use the reported worldwide total when there is one.
  all.forEach(m => { if (m.overseas > 0) return; const r = rep.find(r => r.lang === m.lang && Math.abs(+r.year - m.year) <= 1 && same(m.title, r.title)); if (r && +r.low > m.worldwide) m.worldwide = +r.low; });
  const ranked = [...all, ...reported];
  const year = new Date().getFullYear();
  const thisYear = ranked.filter(m => m.year === year);
  // top stats
  const week = all.filter(m => daysSince(m.release_date) <= 7 && m.opening != null).sort((a, b) => b.opening - a.opening)[0];
  const top = thisYear.slice().sort((a, b) => b.worldwide - a.worldwide)[0];
  const flop = all.filter(m => m.year === year && m.breakeven && !m.running && m.worldwide < m.breakeven).sort((a, b) => (a.worldwide / a.breakeven) - (b.worldwide / b.breakeven))[0];
  const stat = (label, m, val, sub) => `<a class="card bostat" ${m?.kind === 't' ? `href="#/boxoffice/${m.id}"` : ''}><span class="eyebrow">${label}</span>${m ? `<b>${esc(m.title)}</b><span class="num big">${val}</span><span class="meta">${sub}</span>` : '<span class="meta">Not enough data yet.</span>'}</a>`;
  $('#bostats', app).innerHTML = stat('Biggest opener this week', week, week && cr(week.opening), week && `Day 1 India net · ${esc(lang(week.lang))}`)
    + stat(`Highest grosser ${year}`, top, top && (top.kind === 'r' ? range(top) : cr(top.worldwide)), top && `Worldwide gross · ${esc(lang(top.lang))}`)
    + stat(`Biggest flop ${year}`, flop, flop && `${Math.round(flop.worldwide / flop.breakeven * 100)}%`, flop && 'of break-even recovered');
  const years = [...new Set(ranked.map(m => m.year))].sort((a, b) => b - a);
  const langs = Object.keys(LANGS).filter(k => ranked.some(m => m.lang === k) || k === st.lang);
  const ctl = $('#boctl', app);
  const sel = (id, all_, opts, v) => `<label class="upsel"><select id="${id}">${[`<option value="">${all_}</option>`, ...opts.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v) ? 'selected' : ''}>${esc(l)}</option>`)].join('')}</select></label>`;
  const drawCtl = () => {
    ctl.innerHTML = `<div class="upctl"><div class="seg" role="tablist" aria-label="Which movies">${[['theaters', 'In theaters'], ['soon', 'Coming soon'], ['year', 'This year'], ['all', 'All-time'], ['hw', 'Hollywood']].map(([k, l]) => `<button role="tab" aria-selected="${st.tab === k}" class="${st.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      ${st.tab === 'hw' ? `<label class="upsel"><select id="bohwyear" aria-label="Year">${Array.from({ length: new Date().getFullYear() - 1914 }, (_, i) => new Date().getFullYear() - i).map(y => `<option value="${y}" ${y === st.hwYear ? 'selected' : ''}>${y}</option>`).join('')}</select></label>` : `${sel('bolang', 'All languages', Object.keys(LANGS).map(k => [k, LANGS[k]]), st.lang)}${st.tab === 'all' ? sel('boyear', 'Any year', years.map(y => [y, y]), st.year) : ''}${st.tab === 'soon' ? '' : sel('boverdict', 'Any verdict', [...VERDICTS, 'Running', 'Reported'].map(v => [v, v]), st.verdict)}`}</div>`;
    $$('[data-tab]', ctl).forEach(b => b.onclick = () => { st.tab = b.dataset.tab; drawCtl(); draw(); });
    const lg = $('#bolang', ctl); if (lg) lg.onchange = e => { st.lang = e.target.value; draw(); };
    const hy = $('#bohwyear', ctl); if (hy) hy.onchange = e => { st.hwYear = +e.target.value; draw(); };
    const vd = $('#boverdict', ctl); if (vd) vd.onchange = e => { st.verdict = e.target.value; draw(); };
    const y = $('#boyear', ctl); if (y) y.onchange = e => { st.year = e.target.value; draw(); };
  };
  const rowHTML = (m, i) => {
    const t = m.kind === 't';
    const href = t ? `#/boxoffice/${m.id}` : m.tmdb ? `#/boxoffice/tmdb-${m.tmdb}` : null;
    const tag = href ? 'a' : 'div', when = t && m.running ? `Day ${daysSince(m.release_date)}` : m.year;
    return `<${tag} class="trow" role="row" ${href ? `href="${href}"` : ''} data-rk="${t ? '' : esc(`${m.lang}|${m.year}|${m.title}`)}">
      <span class="tm" role="cell"><span class="rk num">${i + 1}</span>${thumb(m)}<span><b>${esc(m.title)}</b><span class="meta">${esc(lang(m.lang))} · ${when}${m.note ? ` · ${esc(m.note)}` : ''}${t ? '' : '<span class="show-s"> · Reported total</span>'}</span></span></span>
      <span class="r num" role="cell">${t ? cr(st.tab === 'theaters' ? m.net : m.worldwide) : range(m)}</span>
      <span class="r num" role="cell">${t && m.running ? change(m) : '<span class="chg">—</span>'}</span>
      <span class="r hide-s" role="cell">${t ? verdictPill(m.verdict) : '<span class="vpill">Reported</span>'}</span></${tag}>`;
  };
  // Fill in posters (and links) for reported movies, a few at a time.
  async function posters(box) {
    const rows = $$('.trow[data-rk]:not([data-rk=""])', box).slice(0, 60);
    for (let i = 0; i < rows.length; i += 4) {
      await Promise.all(rows.slice(i, i + 4).map(async row => {
        const r = reported.find(x => `${x.lang}|${x.year}|${x.title}` === row.dataset.rk); if (!r) return;
        const hit = await findPoster(r); if (!hit || !document.body.contains(row)) return;
        r.tmdb = hit.tmdb; r.poster_path = hit.poster_path;
        const fresh = document.createElement('template'); fresh.innerHTML = rowHTML(r, +$('.rk', row).textContent - 1).trim();
        row.replaceWith(fresh.content.firstChild);
      }));
      if (!document.body.contains(box)) return;
    }
  }
  const draw = () => {
    if (st.tab === 'soon') return drawSoon();
    if (st.tab === 'hw') return drawHollywood();
    let L = st.tab === 'theaters' ? all.filter(m => m.running) : st.tab === 'year' ? thisYear : ranked;
    if (st.lang) L = L.filter(m => m.lang === st.lang);
    if (st.year && st.tab === 'all') L = L.filter(m => m.year === +st.year);
    if (st.verdict) L = L.filter(m => (m.kind === 'r' ? 'Reported' : vname(m.verdict) || 'Running') === st.verdict);
    L = L.slice().sort((a, b) => st.tab === 'theaters' ? (n(b.last) || 0) - (n(a.last) || 0) : b.worldwide - a.worldwide);
    const box = $('#bolist', app);
    box.innerHTML = !L.length ? (st.tab === 'theaters' ? '' : `<div class="card"><div class="mascot"><div>No movies with numbers match these filters.</div></div></div>`)
      : `<div class="ticker" role="table" aria-label="Box office">
        <div class="trow thead" role="row"><span role="columnheader">Movie</span><span role="columnheader" class="r">${st.tab === 'theaters' ? 'India net' : 'Worldwide'}</span><span role="columnheader" class="r">Today</span><span role="columnheader" class="r hide-s">Status</span></div>
        ${L.map(rowHTML).join('')}</div>`;
    reveal($$('#bolist .trow:not(.thead)', app).slice(0, 20));
    posters(box);
    drawOthers(L);
  };
  // "This year": every other Indian release of the year, live from TMDB.
  let otherSeq = 0;
  async function drawOthers(L) {
    const box = $('#boall', app), seq = ++otherSeq;
    if (st.tab === 'all' || st.verdict) { box.innerHTML = ''; return; }
    const now = st.tab === 'theaters';
    box.innerHTML = `<div class="sec"><h2>${now ? 'Also in theaters now' : `Every other ${year} release`}</h2><span class="meta" id="bocount"></span></div><div class="ticker others" id="bolist2"></div>
      <div class="bomore"><button class="btn ghost sm" id="bomore" hidden>Show more</button></div>`;
    let page = 0, pages = 1, shown = 0;
    const list = $('#bolist2', box), more = $('#bomore', box);
    const load = async () => {
      more.disabled = true;
      try {
        const [d, soc] = await Promise.all([tmdbGet(`/api/tmdb?${now ? 'playing=1' : `released=${year}`}&page=${++page}${st.lang ? `&lang=${st.lang}` : ''}`), now ? socialAll() : []]);
        if (seq !== otherSeq) return;
        const sp = x => soc.find(r => r.tmdb_id === x.id);
        pages = d.total_pages || 1;
        $('#bocount', box).textContent = `${(d.total || 0).toLocaleString('en-IN')} ${now ? 'playing, from TMDB' : 'films on TMDB'}`;
        const rows = (d.results || []).filter(x => !L.some(m => m.tmdb_id === x.id || (m.lang === x.lang && same(m.title, x.name))));
        const hit = x => reported.find(r => r.lang === x.lang && Math.abs(r.year - +String(x.date || '').slice(0, 4)) <= 1 && same(r.title, x.name));
        list.insertAdjacentHTML('beforeend', rows.map(x => `<a class="trow" href="#/boxoffice/tmdb-${x.id}">
          <span class="tm"><span class="rk num"></span>${thumb(x)}<span><b>${esc(x.name)}</b><span class="meta">${esc(lang(x.lang))}${x.date ? ` · ${esc(fmtDate(x.date))}` : ''}${x.rerelease ? ` · Re-release (${esc(x.first_date.slice(0, 4))})` : ''}</span></span></span>
          ${sp(x) ? `<span class="r socrow"><b class="num">${esc(amt(sp(x)))}</b><span class="meta">${esc(sp(x).figure)}${sp(x).days && !/Day \d/.test(sp(x).figure) ? ` · ${sp(x).days}d` : ''}</span></span>`
            : `<span class="r ${hit(x) ? 'num' : 'meta nonum'}">${hit(x) ? range(hit(x)) : now ? 'No numbers yet' : 'No numbers reported'}</span>`}</a>`).join(''));
        shown += rows.length;
      } catch (e) { if (!list.children.length) list.innerHTML = `<div class="meta" style="padding:14px 4px">Could not load the full list right now.</div>`; }
      more.hidden = page >= pages; more.disabled = false;
    };
    more.onclick = load;
    await load();
  }
  // "Hollywood": English-language movies — in US theaters now, and the top grossers of any year (US$, from TMDB).
  async function drawHollywood() {
    const seq = ++otherSeq, box = $('#bolist', app);
    $('#boall', app).innerHTML = '';
    box.innerHTML = `<div class="sec"><h2>In US theaters now</h2><span class="meta" id="hwcount1"></span></div><div class="ticker others hwlist" id="hwnow"></div>
      <div class="bomore"><button class="btn ghost sm" id="hwmore1" hidden>Show more</button></div>
      <div class="sec"><h2>Top grossers of ${st.hwYear}</h2><span class="meta" id="hwcount2"></span></div><div class="ticker others hwlist" id="hwtop"></div>
      <div class="bomore"><button class="btn ghost sm" id="hwmore2" hidden>Show more</button></div>
      <p class="meta upnote">Hollywood numbers are worldwide gross and budget in US dollars, from TMDB. Verdict = gross ÷ (2 × budget): the studio keeps about half of the gross.</p>`;
    const row = (x, rank) => { const v = verdictFrom(x.revenue_usd, x.budget_usd, daysSince(x.date || '2000-01-01') <= 56, rank);
      return `<a class="trow" href="#/boxoffice/tmdb-${x.id}"><span class="tm"><span class="rk num">${rank || ''}</span>${thumb(x)}<span><b>${esc(x.name)}</b><span class="meta">${x.date ? esc(fmtDate(x.date)) : ''}${x.budget_usd ? ` · Budget ${usd(x.budget_usd)}` : ''}</span></span></span>
        <span class="r hwcell"><span class="${x.revenue_usd ? 'num' : 'meta nonum'}">${x.revenue_usd ? usd(x.revenue_usd) : 'No gross yet'}</span>${v ? verdictPill(v) : ''}</span></a>`; };
    const list = async (kind, el, more, count) => {
      let page = 0, pages = 1, n = 0;
      const load = async () => {
        more.disabled = true;
        try {
          const d = await tmdbGet(`/api/tmdb?hw=${kind}&page=${++page}${kind === 'top' ? `&year=${st.hwYear}` : ''}`);
          if (seq !== otherSeq || st.tab !== 'hw') return;
          pages = d.total_pages || 1;
          const rows = (d.results || []).filter(x => kind === 'now' || x.revenue_usd);
          el.insertAdjacentHTML('beforeend', rows.map(x => row(x, kind === 'top' ? ++n : 0)).join(''));
          count.textContent = kind === 'now' ? `${(d.total || 0).toLocaleString('en-US')} playing` : `${n} with a known gross`;
          if (!el.children.length) el.innerHTML = `<div class="meta" style="padding:14px 4px">Nothing found.</div>`;
        } catch (e) { if (!el.children.length) el.innerHTML = `<div class="meta" style="padding:14px 4px">Could not load this list right now.</div>`; }
        more.hidden = page >= pages; more.disabled = false;
      };
      more.onclick = load; await load();
    };
    await Promise.all([list('now', $('#hwnow', box), $('#hwmore1', box), $('#hwcount1', box)), list('top', $('#hwtop', box), $('#hwmore2', box), $('#hwcount2', box))]);
  }
  // "Coming soon": upcoming Indian releases from TMDB, soonest first.
  async function drawSoon() {
    const seq = ++otherSeq, box = $('#bolist', app);
    $('#boall', app).innerHTML = '';
    box.innerHTML = `<div class="sec"><h2>Coming soon</h2><span class="meta" id="bocount"></span></div><div class="ticker others" id="bosoon"></div>
      <div class="bomore"><button class="btn ghost sm" id="bomore" hidden>Show more</button></div>
      <p class="meta upnote">Release dates from TMDB and can change. Want a reminder? <a href="#/upcoming">Open Upcoming</a> and tap Remind me.</p>`;
    const list = $('#bosoon', box), more = $('#bomore', box);
    let page = 0, pages = 1, count = 0; const got = [];
    const load = async () => {
      more.disabled = true;
      try {
        const d = await tmdbGet(`/api/tmdb?upcoming=1&page=${++page}${st.lang ? `&lang=${st.lang}` : ''}`);
        if (seq !== otherSeq || st.tab !== 'soon') return;
        pages = d.total_pages || 1;
        // India release dates from today on, soonest first (re-releases are labelled).
        const fresh = (d.results || []).filter(x => x.date && daysSince(x.date) <= 1 && !got.some(y => y.id === x.id));
        got.push(...fresh); got.sort((p, q) => String(p.date).localeCompare(String(q.date)));
        const rows = got; count = got.length;
        $('#bocount', box).textContent = `${count}${page < pages ? '+' : ''} movies`;
        list.innerHTML = rows.map(x => {
          const to = 1 - daysSince(x.date);
          const when = to <= 0 ? 'Out today' : to === 1 ? 'Tomorrow' : `In ${to} days`;
          const who = [x.director?.[0] && `Dir. ${x.director[0]}`, (x.cast || []).slice(0, 2).join(', ')].filter(Boolean).join(' · ');
          return `<a class="trow" href="#/boxoffice/tmdb-${x.id}">
          <span class="tm"><span class="rk num"></span>${thumb(x)}<span><b>${esc(x.name)}</b><span class="meta">${esc(lang(x.lang))} · ${esc(fmtDate(x.date))}${x.rerelease ? ` · Re-release (${esc(x.first_date.slice(0, 4))})` : ''}${who ? `<span class="hide-s"> · ${esc(who)}</span>` : ''}</span></span></span>
          <span class="r num soonin">${esc(when)}</span></a>`;
        }).join('');
        if (!list.children.length) list.innerHTML = `<div class="meta" style="padding:14px 4px">No upcoming releases found for this language.</div>`;
      } catch (e) { if (!list.children.length) list.innerHTML = `<div class="meta" style="padding:14px 4px">Could not load upcoming movies right now.</div>`; }
      more.hidden = page >= pages; more.disabled = false;
    };
    more.onclick = load;
    await load();
  }
  drawCtl(); draw();
  reveal($$('.bostat', app));
  // Search any movie in TMDB → its box office page (graph, verdict, talk).
  const q = $('#bosq', app), res = $('#bosres', app); let qt = 0, qseq = 0;
  q.oninput = () => { clearTimeout(qt); const v = q.value.trim(); if (v.length < 2) { res.hidden = true; res.innerHTML = ''; return; }
    qt = setTimeout(async () => { const my = ++qseq;
      try { const d = await tmdbGet(`/api/tmdb?q=${encodeURIComponent(v)}`); if (my !== qseq) return;
        const M = (d.results || []).filter(x => x.type === 'movie').slice(0, 8);
        res.innerHTML = M.length ? M.map(x => `<a class="trow" role="option" href="#/boxoffice/tmdb-${x.id}"><span class="tm">${thumb(x)}<span><b>${esc(x.name)}</b><span class="meta">${esc(x.year || 'Year unknown')}</span></span></span></a>`).join('') : '<div class="meta" style="padding:12px">No movies found.</div>';
        res.hidden = false;
      } catch (e) { res.innerHTML = '<div class="meta" style="padding:12px">Search is not working right now.</div>'; res.hidden = false; } }, 250); };
}

/* ---------------- one movie ---------------- */
async function renderMovie(app, id) {
  app.innerHTML = `<div class="screen boxoffice"><header class="top"><a class="icon-btn" href="#/boxoffice" aria-label="Back to Box Office">${ic('arrow-left')}</a><span></span></header><div id="bom"><div class="card"><div class="rskel"></div></div></div></div>`;
  let D;
  try { D = await rpc('box_office_movie', { p_id: id }); } catch (e) { $('#bom', app).innerHTML = `<div class="card"><div class="mascot"><div>${esc(e.message)}</div></div></div>`; return; }
  if (!D) { $('#bom', app).innerHTML = `<div class="card"><div class="mascot"><div>We can't find that movie.</div></div></div>`; return; }
  const m = D.movie, days = D.days.map(d => ({ ...d, net: +d.net, gross: +d.gross, overseas: +d.overseas }));
  document.title = `${m.title} box office — Heartbeat`;
  const sum = k => days.reduce((a, d) => a + d[k], 0);
  const net = sum('net'), gross = sum('gross'), overseas = sum('overseas');
  // No overseas numbers (India only): the worldwide figure is the reported total if there is one, never India alone.
  const indiaOnly = overseas === 0;
  const rp = indiaOnly ? (await reportedAll()).find(r => r.lang === m.lang && Math.abs(+r.year - +String(m.release_date).slice(0, 4)) <= 1 && same(r.title, m.title)) : null;
  const ww = indiaOnly ? (rp ? +rp.low : null) : gross + overseas;
  if (indiaOnly && st.metric === 'ww') { st.metric = 'net'; st.wwOff = true; }
  else if (!indiaOnly && st.wwOff) { st.metric = 'ww'; st.wwOff = false; }
  if (!document.body.contains(app) || !$('#bom', app)) return;
  const budget = n(m.budget_cr), be = n(m.breakeven);
  const first = k => days.filter(d => d.day <= k).reduce((a, d) => a + d.net, 0);
  const wkEnd = (() => { const r = dt(m.release_date).getDay(); return Math.max(1, r === 0 ? 1 : 8 - r); })(); // through the first Sunday
  const mv = m.verdict || verdictFrom(ww, budget, m.running);
  const inTheaters = m.running ? daysSince(m.release_date) : (days.length ? days[days.length - 1].day : 0);
  const card = (l, v, s = '', raw = null) => `<div class="card kn"><span class="eyebrow">${l}</span><span class="num big" ${raw != null ? `data-count="${raw}"` : ''}>${v}</span>${s ? `<span class="meta">${s}</span>` : ''}</div>`;
  $('#bom', app).innerHTML = `
    <section class="bohead">
      <div class="bopost">${poster({ id: 'bo' + m.id, name: m.title, year: String(m.release_date).slice(0, 4), type: 'movie', posterPath: m.poster_path, colors: ['#171717', '#171717'] }, { mine: false })}</div>
      <div class="bohinfo">
        <p class="eyebrow">${esc(lang(m.lang))} · ${esc(fmtDate(m.release_date))}</p>
        <h1 class="display sm">${esc(m.title)}</h1>
        <div class="meta">${[m.certificate, m.runtime ? `${Math.floor(m.runtime / 60)}h ${m.runtime % 60}m` : '', budget != null ? `Budget ${cr(budget)}` : ''].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="bigverdict ${mv ? vtone(mv) : 'run'}">${esc(mv ? vname(mv) + (m.verdict ? '' : ' (our math)') : m.running ? 'Running' : 'Out of theaters')}</div>
        ${m.tmdb_id ? `<a class="see" href="#/t/tmdb-movie-${m.tmdb_id}">Ratings &amp; journey ${ic('arrow-right')}</a>` : ''}
      </div>
    </section>
    <section class="card chartcard">
      <div class="chtop">
        <div><span class="eyebrow" id="chlabel"></span><div class="num huge" id="chtotal"></div></div>
        <div class="chctl">
          <div class="seg" role="group" aria-label="Total or daily">${[['cum', 'Cumulative total'], ['daily', 'Daily collection']].map(([k, l]) => `<button data-mode="${k}" class="${st.mode === k ? 'on' : ''}" aria-pressed="${st.mode === k}">${l}</button>`).join('')}</div>
          <div class="seg" role="group" aria-label="Which number">${[['net', 'India Net'], ['gross', 'India Gross'], ['ww', 'Worldwide Gross']].filter(([k]) => !(indiaOnly && k === 'ww')).map(([k, l]) => `<button data-metric="${k}" class="${st.metric === k ? 'on' : ''}" aria-pressed="${st.metric === k}">${l}</button>`).join('')}</div>
        </div>
      </div>
      <div class="chwrap" id="chwrap"></div>
      <div class="chbottom"><div class="seg" role="group" aria-label="Time range">${[['7', '1W'], ['14', '2W'], ['30', '1M'], ['all', 'ALL']].map(([k, l]) => `<button data-range="${k}" class="${st.range === k ? 'on' : ''}" aria-pressed="${st.range === k}">${l}</button>`).join('')}</div>
        <span class="meta chlegend"><span class="lg dash"></span>Budget${be ? ' <span class="lg dash be"></span>Break-even (est.)' : ''}</span></div>
    </section>
    <section class="kgrid">
      ${card('Budget', cr(budget))}${card('Opening day', cr(first(1)), 'India net', first(1))}${card('Opening weekend', cr(first(wkEnd)), `First ${wkEnd} day${wkEnd > 1 ? 's' : ''}`, first(wkEnd))}
      ${card('First week', cr(first(7)), 'India net', first(7))}${card('Lifetime India net', cr(net), m.running ? 'So far' : '', net)}${indiaOnly ? card('Worldwide gross', ww ? cr(ww) : '—', ww ? 'Reported total' : 'Overseas not reported') : card('Worldwide gross', cr(ww), '', ww)}
      ${card('Overseas', indiaOnly ? '—' : cr(overseas), indiaOnly ? 'Not reported' : '', indiaOnly ? null : overseas)}
      ${card('Days in theaters', inTheaters || '—')}${card('Screens', m.screens ? Number(m.screens).toLocaleString('en-IN') : '—', 'Opening count')}
    </section>
    ${runHTML(m, days)}
    <div id="boextra"></div>
    <p class="meta upnote">${m.source ? `Source: ${esc(m.source)}. ` : ''}Estimates; gross is net + 18% GST when not reported. Updated ${esc(fmtDate(m.updated_at))}.</p>`;
  // Summary, public talk and "worth it?" from TMDB + our research (added when it loads).
  if (m.tmdb_id) Promise.all([tmdbGet(`/api/tmdb?bo=${m.tmdb_id}`), talkAll()]).then(([d, TK]) => {
    const box = $('#boextra', app); if (!box) return;
    const t = (TK || []).find(x => x.tmdb_id === d.id);
    box.innerHTML = summaryHTML(d) + talkHTML(d, t) + worthHTML(d, t, !!m.running, false);
  }).catch(() => {});
  hydratePosters($('#bom', app));
  fixHeadPoster(app, { posterPath: m.poster_path, tid: m.tmdb_id, name: m.title, lang: m.lang, year: String(m.release_date).slice(0, 4), id: 'bo' + m.id });
  reveal($$('#bom .kgrid .card, #bom .run', app));
  $$('#bom [data-count]', app).forEach(el => countUp(el, +el.dataset.count, cr));
  const est = days.filter(d => d.est).length;
  if (est) $('#bom .chbottom .chlegend').insertAdjacentHTML('afterbegin', `<span class="lg dot"></span>Reported day · ${est} of ${days.length} days estimated `);
  const wrap = $('#chwrap', app);
  const redraw = () => { drawChart(wrap, m, days, { ww, be, budget }); $$('#bom [data-mode],#bom [data-metric],#bom [data-range]').forEach(b => { const on = st[b.dataset.mode ? 'mode' : b.dataset.metric ? 'metric' : 'range'] === (b.dataset.mode || b.dataset.metric || b.dataset.range); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }); };
  $$('[data-mode]', app).forEach(b => b.onclick = () => { st.mode = b.dataset.mode; redraw(); });
  $$('[data-metric]', app).forEach(b => b.onclick = () => { st.metric = b.dataset.metric; redraw(); });
  $$('[data-range]', app).forEach(b => b.onclick = () => { st.range = b.dataset.range; redraw(); });
  redraw();
}

function runHTML(m, days) {
  if (!days.length) return '';
  const weeks = [];
  days.forEach(d => { const w = Math.ceil(d.day / 7); (weeks[w - 1] ||= { w, net: 0, n: 0 }); weeks[w - 1].net += d.net; weeks[w - 1].n++; });
  const ott = m.ott_date ? `${esc(fmtDate(m.ott_date))}${m.ott_platform ? ` on ${esc(m.ott_platform)}` : ''}` : 'Not announced';
  return `<section class="card run"><h2 class="h3">Theatrical run</h2>
    <div class="runfacts"><div><span class="eyebrow">Status</span><b>${m.running ? 'In theaters' : 'Run ended'}</b></div><div><span class="eyebrow">Weeks</span><b class="num">${weeks.length}</b></div><div><span class="eyebrow">Streaming (OTT)</span><b>${ott}</b></div></div>
    <table class="wtable"><thead><tr><th>Week</th><th class="r">India net</th><th class="r">Change</th></tr></thead><tbody>
    ${weeks.filter(Boolean).map((w, i, a) => { const p = i ? (w.net - a[i - 1].net) / a[i - 1].net * 100 : null; return `<tr><td>Week ${w.w}${w.n < 7 ? ` <span class="meta">(${w.n} day${w.n > 1 ? 's' : ''})</span>` : ''}</td><td class="r num">${cr(w.net)}</td><td class="r num">${p == null ? '—' : `<span class="chg ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(1)}%</span>`}</td></tr>`; }).join('')}
    </tbody></table></section>`;
}

/* ---------------- the stock-style chart (Apache ECharts, with a plain SVG fallback) ---------------- */
let chartInst = null;
/** Line colour: green for a hit, red for a flop, grey when we can't tell (no verdict and no break-even). */
function lineTone(m, ww, be) {
  if (m.verdict) return vtone(m.verdict);
  if (!be || ww == null) return '';
  return ww >= be ? 'up' : !m.running ? 'down' : '';
}
function series(m, days, { ww, be, budget }) {
  const key = st.metric === 'net' ? 'net' : st.metric === 'gross' ? 'gross' : 'ww';
  const daily = days.map(d => key === 'ww' ? d.gross + d.overseas : d[key]);
  let run = 0; const cum = daily.map(v => (run += v));
  const lim = st.range === 'all' ? days.length : Math.min(days.length, +st.range);
  const D = days.slice(0, lim), V = (st.mode === 'cum' ? cum : daily).slice(0, lim);
  const label = { net: 'India net', gross: 'India gross', ww: 'Worldwide gross' }[key] + (st.mode === 'cum' ? ' · total' : ' · per day');
  const refs = st.mode === 'cum' ? [budget != null && { v: budget, c: 'Budget' }, key === 'ww' && be && { v: be, c: 'Break-even (est.)' }].filter(Boolean) : [];
  const color = lineTone(m, ww, be) === 'up' ? '#C6F432' : lineTone(m, ww, be) === 'down' ? '#E5484D' : '#8A8A8A';
  return { key, daily, cum, lim, D, V, label, refs, color };
}
async function drawChart(wrap, m, days, info) {
  const S = series(m, days, info);
  $('#chlabel').textContent = S.label;
  const total = st.mode === 'cum' ? S.V[S.V.length - 1] : S.cum[S.lim - 1];
  const tEl = $('#chtotal'); if (tEl.dataset.v !== String(total)) { tEl.dataset.v = total; countUp(tEl, total, cr); }
  const E = await echarts();
  if (!E || !document.body.contains(wrap)) { if (chartInst) { chartInst.dispose(); chartInst = null; } return drawSvgChart(wrap, m, days, info); }
  if (!chartInst || chartInst.getDom() !== wrap) {
    if (chartInst) chartInst.dispose();
    wrap.innerHTML = ''; wrap.classList.add('ec');
    chartInst = E.init(wrap, null, { renderer: 'svg' });
    const ro = new ResizeObserver(() => chartInst && !chartInst.isDisposed() && chartInst.resize()); ro.observe(wrap);
  }
  const ottDay = m.ott_date ? Math.round((dt(m.ott_date) - dt(m.release_date)) / dayMs) : null;
  const wkEnd = (() => { const r = dt(m.release_date).getDay(); return r === 0 ? 1 : 8 - r; })();
  const marks = [[0, 'Opening day']];
  if (wkEnd > 1 && wkEnd <= S.D.length) marks.push([wkEnd - 1, 'First weekend']);
  S.D.forEach((d, i) => { if (d.note && i) marks.push([i, d.note]); });
  const mono = '"Geist Mono", ui-monospace, monospace';
  chartInst.setOption({
    animationDuration: 900, animationEasing: 'cubicOut', animationDurationUpdate: 600, animationEasingUpdate: 'cubicOut',
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    textStyle: { fontFamily: mono },
    xAxis: { type: 'category', boundaryGap: false, data: S.D.map(d => 'D' + d.day), axisLine: { lineStyle: { color: '#1F1F1F' } }, axisTick: { show: false },
      axisLabel: { color: '#5E5E5E', fontSize: 11, hideOverlap: true } },
    yAxis: { type: 'value', name: '₹ Cr', nameTextStyle: { color: '#5E5E5E', fontSize: 11, align: 'right' }, splitLine: { lineStyle: { color: '#1A1A1A' } },
      axisLabel: { color: '#5E5E5E', fontSize: 11, formatter: v => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v } },
    tooltip: { trigger: 'axis', backgroundColor: '#0A0A0A', borderColor: '#1F1F1F', borderWidth: 1, padding: [8, 10], textStyle: { color: '#F5F5F5', fontSize: 12, fontFamily: mono },
      axisPointer: { type: 'cross', lineStyle: { color: '#3A3A3A' }, crossStyle: { color: '#3A3A3A' }, label: { backgroundColor: '#1F1F1F', color: '#F5F5F5', fontFamily: mono } },
      formatter: p => { const i = p[0].dataIndex, d = S.D[i];
        return `<b>Day ${d.day}</b> · ${esc(fmtDate(d.date))}${d.note ? ` · ${esc(d.note)}` : ''}<br><span style="color:#8A8A8A">Daily</span> ${cr(S.daily[i])}<br><span style="color:#8A8A8A">Total</span> ${cr(S.cum[i])}${d.est ? '<br><span style="color:#8A8A8A">Estimated (filled in between reports)</span>' : ''}`; } },
    series: [{
      type: 'line', data: S.V.map((v, i) => ({ value: +v.toFixed(2), symbolSize: S.D[i].est ? 0 : 5 })), showSymbol: true, symbol: 'circle', smooth: 0.15,
      lineStyle: { width: 2, color: S.color }, itemStyle: { color: '#0A0A0A', borderColor: S.color, borderWidth: 1.5 },
      emphasis: { focus: 'none', scale: 1.6 },
      markLine: { symbol: 'none', silent: true, label: { color: '#8A8A8A', fontSize: 11, position: 'insideEndTop', formatter: x => x.name + ' ' + cr(x.value) },
        data: [...S.refs.map(r => ({ name: r.c, yAxis: r.v, lineStyle: { color: r.c === 'Budget' ? '#5E5E5E' : '#8A8A8A', type: 'dashed', width: 1 } })),
          ...(ottDay != null && ottDay >= 0 && ottDay < S.D.length ? [{ name: 'OTT', xAxis: ottDay, label: { formatter: 'OTT', position: 'end' }, lineStyle: { color: '#3A3A3A', type: 'dotted', width: 1 } }] : [])] },
      markPoint: { symbol: 'circle', symbolSize: 7, itemStyle: { color: '#0A0A0A', borderColor: '#F5F5F5', borderWidth: 1.5 }, label: { show: false },
        tooltip: { show: false }, data: marks.map(([i, l]) => ({ name: l, coord: [i, +S.V[i].toFixed(2)] })) },
    }],
  }, { notMerge: true });
  wrap.setAttribute('aria-label', `${S.label}: ${cr(total)} over ${S.D.length} days`); wrap.setAttribute('role', 'img');
  let sr = wrap.nextElementSibling?.classList.contains('chmarks') ? wrap.nextElementSibling : null;
  if (!sr) { sr = document.createElement('ul'); sr.className = 'chmarks sr'; wrap.after(sr); }
  sr.innerHTML = marks.map(([i, l]) => `<li>${esc(l)}: day ${S.D[i].day}, ${cr(S.V[i])}</li>`).join('') + (ottDay != null ? `<li>OTT release: day ${ottDay + 1}</li>` : '');
}

function drawSvgChart(wrap, m, days, { ww, be, budget }) {
  const key = st.metric === 'net' ? 'net' : st.metric === 'gross' ? 'gross' : 'ww';
  const daily = days.map(d => key === 'ww' ? d.gross + d.overseas : d[key]);
  let run = 0; const cum = daily.map(v => (run += v));
  const lim = st.range === 'all' ? days.length : Math.min(days.length, +st.range);
  const D = days.slice(0, lim), V = (st.mode === 'cum' ? cum : daily).slice(0, lim);
  const label = { net: 'India net', gross: 'India gross', ww: 'Worldwide gross' }[key] + (st.mode === 'cum' ? ' · total' : ' · per day');
  $('#chlabel').textContent = label;
  $('#chtotal').textContent = cr(st.mode === 'cum' ? V[V.length - 1] : cum[lim - 1]);
  if (!D.length) { wrap.innerHTML = '<div class="mascot"><div>No daily numbers yet.</div></div>'; return; }
  // Lines: budget (any total view) and break-even (worldwide total view).
  const refs = st.mode === 'cum' ? [budget != null && { v: budget, c: 'bud', l: 'Budget' }, key === 'ww' && be && { v: be, c: 'be', l: 'Break-even' }].filter(Boolean) : [];
  const W = 800, H = 300, L = 56, R = 16, T = 18, B = 30;
  const max = Math.max(...V, ...refs.map(r => r.v)) * 1.08 || 1;
  const x = i => L + (D.length > 1 ? i * (W - L - R) / (D.length - 1) : (W - L - R) / 2);
  const y = v => T + (1 - v / max) * (H - T - B);
  const color = lineTone(m, ww, be) === 'up' ? 'var(--accent)' : lineTone(m, ww, be) === 'down' ? 'var(--red)' : '#8A8A8A';
  const path = V.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const ticks = [0, .25, .5, .75, 1].map(f => max / 1.08 * f);
  const every = Math.max(1, Math.ceil(D.length / 8));
  // Special points: opening day, end of first weekend, festivals/holidays, OTT date.
  const wkEnd = (() => { const r = dt(m.release_date).getDay(); return r === 0 ? 1 : 8 - r; })();
  const marks = [[0, 'Opening']];
  if (wkEnd > 1 && wkEnd <= D.length) marks.push([wkEnd - 1, 'Weekend']);
  D.forEach((d, i) => { if (d.note) marks.push([i, d.note]); });
  const ottDay = m.ott_date ? Math.round((dt(m.ott_date) - dt(m.release_date)) / dayMs) : null;
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(label)} over ${D.length} days">
    ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end" class="ax">${t >= 100 ? Math.round(t) : t.toFixed(t >= 10 ? 0 : 1)}</text>`).join('')}
    <text x="${L - 8}" y="${T - 6}" text-anchor="end" class="ax">₹ Cr</text>
    ${D.map((d, i) => i % every === 0 || i === D.length - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="ax">D${d.day}</text>` : '').join('')}
    ${refs.map(r => `<line x1="${L}" x2="${W - R}" y1="${y(r.v)}" y2="${y(r.v)}" class="ref ${r.c}"/><text x="${W - R}" y="${y(r.v) - 6}" text-anchor="end" class="ax">${r.l} ${cr(r.v)}</text>`).join('')}
    ${ottDay != null && ottDay >= 0 && ottDay < D.length ? `<line x1="${x(ottDay)}" x2="${x(ottDay)}" y1="${T}" y2="${H - B}" class="ref ott"/><text x="${x(ottDay) + 4}" y="${T + 10}" class="ax">OTT</text>` : ''}
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${marks.map(([i, l]) => `<circle cx="${x(i)}" cy="${y(V[i])}" r="3.5" fill="#0A0A0A" stroke="${color}" stroke-width="1.5"><title>${esc(l)}</title></circle>`).join('')}
    <g id="xh" style="display:none"><line id="xhl" y1="${T}" y2="${H - B}" class="xhair"/><circle id="xhd" r="4.5" fill="${color}"/></g>
    <rect x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent" id="chhit"/>
  </svg><div class="chtip" id="chtip" hidden></div>`;
  const svg = wrap.querySelector('svg'), hit = $('#chhit', wrap), tip = $('#chtip', wrap), xh = $('#xh', wrap);
  const show = ev => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * W;
    const i = Math.max(0, Math.min(D.length - 1, Math.round((px - L) / ((W - L - R) / Math.max(1, D.length - 1)))));
    const d = D[i];
    xh.style.display = ''; $('#xhl', wrap).setAttribute('x1', x(i)); $('#xhl', wrap).setAttribute('x2', x(i)); $('#xhd', wrap).setAttribute('cx', x(i)); $('#xhd', wrap).setAttribute('cy', y(V[i]));
    tip.hidden = false;
    tip.innerHTML = `<b>Day ${d.day}</b> · ${esc(fmtDate(d.date))}${d.note ? ` · ${esc(d.note)}` : ''}<br><span class="meta">Daily</span> <span class="num">${cr(daily[i])}</span><br><span class="meta">Total</span> <span class="num">${cr(cum[i])}</span>`;
    const left = x(i) / W * r.width; tip.style.left = Math.min(Math.max(0, left - 90), r.width - 180) + 'px';
  };
  const hide = () => { xh.style.display = 'none'; tip.hidden = true; };
  hit.addEventListener('pointermove', show); hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide); hit.addEventListener('pointercancel', hide);
}

/* ---------------- any movie in TMDB: details + a line graph modeled from its reported total ---------------- */
let sumP = null, repP = null, socP = null, budP = null;
const budgetAll = () => (budP ||= rpc('box_office_budget').catch(() => { budP = null; return []; }));
// Numbers posted on X / Instagram for movies in theaters (who posted it + link). First row per movie is the headline one.
const socialAll = () => (socP ||= rpc('box_office_social').catch(() => { socP = null; return []; }));
const amt = r => { const f = v => v < 1 ? `₹${Math.round(v * 100)} lakh` : cr(v).replace(' Cr', ''); const hi = r.high != null && +r.high > +r.low;
  return `${f(+r.low)}${hi ? `–${f(+r.high).replace('₹', '')}` : ''}${+r.low >= 1 || hi && +r.high >= 1 ? ' Cr' : ''}${r.plus ? '+' : ''}`; };
const socShort = r => `${amt(r)} · ${r.figure}${r.days && !/Day \d/.test(r.figure) ? ` · ${r.days} day${r.days === 1 ? '' : 's'}` : ''}`;
const safeUrl = u => /^https:\/\/(x\.com|www\.instagram\.com|www\.koimoi\.com|www\.sacnilk\.com|filmibeat\.com|www\.gulte\.com)\//.test(u) ? u : '#';
function socialHTML(S) {
  return `<section class="card run bosoc"><h2 class="h3">Reported on social media</h2>
    <p class="meta">Numbers posted on X and Instagram. Each one shows who posted it. We have not checked them.</p>
    <ul class="soclist">${S.map(r => `<li><span class="num socamt">${esc(amt(r))}</span>
      <span class="socfig">${esc(r.figure)}${r.days && !/Day \d/.test(r.figure) ? ` · ${r.days} day${r.days === 1 ? '' : 's'}` : ''} · as of ${esc(fmtDate(r.as_of))}</span>
      <span class="socsrc"><span class="soctag t-${esc(r.source_type.split(' ')[0].toLowerCase())}">${esc(r.source_type)}</span>
      <a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener nofollow">${esc(r.source_name)} ${ic('arrow-right')}</a></span></li>`).join('')}</ul></section>`;
}
const tracked = () => (sumP ||= rpc('box_office_summary').catch(() => { sumP = null; return []; }));
const reportedAll = () => (repP ||= rpc('box_office_reported').catch(() => { repP = null; return []; }));
const usd = v => v == null ? '—' : v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)}M` : `$${Math.round(v).toLocaleString('en-US')}`;
const WEEKDAY = [1.55, 0.75, 0.75, 0.75, 0.75, 1.0, 1.35];   // Sun..Sat: weekends earn more

/** Spread a total over the run: each day earns a bit less than the day before, weekends more. Returns daily amounts. */
export function modelRun(total, startISO, nDays) {
  const start = dt(startISO), w = [];
  for (let d = 0; d < nDays; d++) w.push(Math.pow(0.93, d) * WEEKDAY[(start.getDay() + d) % 7]);
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map(x => x / sum * total);
}
// ---- Fitted curve. Daily money D(t) = A·e^(−k·t)·f(weekday). Total so far C(T) = D(0)+…+D(T−1) (the integral, added day by day).
// Posted numbers pin the curve: two posts on different days give k (solved by bisection), then A comes from least squares.
export const LIFE = 56, K0 = 0.08;
export const wts = (startISO, k, n = LIFE) => { const s = dt(startISO).getDay(), w = []; for (let d = 0; d < n; d++) w.push(Math.exp(-k * d) * WEEKDAY[(s + d) % 7]); return w; };
const cumW = (w, t) => { let a = 0; for (let i = 0; i < t && i < w.length; i++) a += w[i]; return a; };
const scopeOf = f => /^Worldwide/i.test(f) ? 'Worldwide gross' : /India net/i.test(f) ? 'India net' : /India gross/i.test(f) ? 'India gross' : f.replace(/,.*$/, '');
const dayNo = f => { const m = /Day (\d+)/.exec(f); return m ? +m[1] : null; };
export function fitRun(S, date) {
  if (!date || !S || !S.length) return null;
  const all = S.map(r => { const one = dayNo(r.figure), t = one || r.days || Math.round((dt(r.as_of) - dt(date)) / 864e5) + 1;
    return { scope: scopeOf(r.figure), single: !!one, t: Math.min(LIFE, Math.max(1, t)), v: (+r.low + (r.high != null && +r.high > +r.low ? +r.high : +r.low)) / 2 }; }).filter(a => a.v > 0);
  if (!all.length) return null;
  const pref = ['Worldwide gross', 'India net', 'India gross'], cnt = {};
  all.forEach(a => cnt[a.scope] = (cnt[a.scope] || 0) + 1);
  const scope = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || ((pref.indexOf(a) + 1) || 9) - ((pref.indexOf(b) + 1) || 9))[0];
  const A = all.filter(a => a.scope === scope).sort((x, y) => x.t - y.t);
  const at = (w, a) => a.single ? w[a.t - 1] : cumW(w, a.t);
  let k = K0, solved = false;
  const a1 = A[0], a2 = A[A.length - 1];
  if (a2.t - a1.t >= 2) {   // ratio g(k) = model(a2)/model(a1) falls as k grows: bisection
    const R = a2.v / a1.v, g = kk => { const w = wts(date, kk); return at(w, a2) / at(w, a1) - R; };
    let lo = 0.01, hi = 0.4;
    // If the posts disagree (no k fits), keep the typical drop rate and let least squares split the difference.
    if (g(lo) > 0 && g(hi) < 0) { for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; g(m) > 0 ? lo = m : hi = m; } k = (lo + hi) / 2; solved = true; }
  }
  const w = wts(date, k);
  let num = 0, den = 0; A.forEach(a => { const m = at(w, a); num += a.v * m; den += m * m; });
  const amp = den ? num / den : 0;
  return { scope, k, solved, daily: w.map(x => x * amp), anchors: A, total: cumW(w, LIFE) * amp };
}
// Typical 8-week total for movies in one language (from the fitted posts). Used when a movie has no posted numbers.
export function typicalLife(SO, lng) {
  const by = {}; (SO || []).forEach(r => (by[r.tmdb_id] ||= []).push(r));
  const fits = Object.values(by).map(rs => ({ lang: rs[0].lang, f: fitRun(rs, rs[0].release_date) })).filter(x => x.f && x.f.total > 0);
  const med = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
  const same = fits.filter(x => x.lang === lng).map(x => x.f.total);
  return same.length >= 2 ? { total: med(same), n: same.length, lang: true } : { total: med(fits.map(x => x.f.total)) || 1, n: fits.length, lang: false };
}
/** Final judgement from worldwide gross vs budget. The producer keeps about half the gross, so r = gross ÷ (2 × budget):
 *  r ≥ 3 Blockbuster (Industry hit if it is also the #1 grosser of its year in its language), ≥ 2 Super hit, ≥ 1.25 Hit, ≥ 1 Average,
 *  ≥ 0.75 Flop, ≥ 0.5 Utter flop, below that Disaster. A movie still running only gets a verdict once it reaches Average or better. */
export const verdictFrom = (total, budget, running, rank = null) => {
  if (!total || !budget) return null;
  const r = total / (budget * 2);
  if (r >= 3) return rank === 1 || r >= 8 ? 'Industry hit' : 'Blockbuster';
  return r >= 2 ? 'Super hit' : r >= 1.25 ? 'Hit' : r >= 1 ? 'Average' : running ? null : r >= 0.75 ? 'Flop' : r >= 0.5 ? 'Utter flop' : 'Disaster';
};

async function renderTmdbMovie(app, tid) {
  app.innerHTML = `<div class="screen boxoffice"><header class="top"><a class="icon-btn" href="#/boxoffice" aria-label="Back to Box Office">${ic('arrow-left')}</a><span></span></header><div id="bom"><div class="card"><div class="rskel"></div></div></div></div>`;
  let d, T, R, SO, BU, TK;
  try { [d, T, R, SO, BU, TK] = await Promise.all([tmdbGet(`/api/tmdb?bo=${tid}`), tracked(), reportedAll(), socialAll(), budgetAll(), talkAll()]); }
  catch (e) { $('#bom', app).innerHTML = `<div class="card"><div class="mascot"><div>We couldn't load this movie right now.</div></div></div>`; return; }
  if (!document.body.contains(app) || !$('#bom', app)) return;
  const indian = !!LANGS[d.lang], hw = d.lang === 'en';
  const date = (hw ? d.us_release || d.release_date : d.india_release || d.release_date) || d.release_date, year = date ? +date.slice(0, 4) : null;
  // Movies we track day by day open their full page instead.
  const tr = T.find(m => m.tmdb_id === d.id || (m.lang === d.lang && Math.abs(dt(m.release_date).getFullYear() - (year || 0)) <= 1 && (same(m.title, d.name) || same(m.title, d.original_name))));
  if (tr) { location.replace(`#/boxoffice/${tr.id}`); return; }
  const S = (SO || []).filter(r => r.tmdb_id === d.id);
  const rp = R.find(r => r.lang === d.lang && Math.abs(+r.year - (year || 0)) <= 1 && (same(r.title, d.name) || same(r.title, d.original_name)));
  const B = (BU || []).find(b => b.tmdb_id === d.id);
  document.title = `${d.name} box office — Heartbeat`;
  // Pick the total: the Indian trade figure (₹) first, then TMDB's worldwide figure (US$).
  const cur = rp ? '₹' : d.revenue_usd ? '$' : null;
  const total = date && daysSince(date) < 1 ? null : rp ? +rp.low : d.revenue_usd;
  const fmt = cur === '₹' ? cr : usd;
  const age = date ? daysSince(date) : null, soon = age != null && age < 1, running = age != null && age >= 1 && age <= (hw ? 56 : 42) && d.status === 'Released';
  const released = age != null && age >= 1;
  const today = released ? Math.min(LIFE, age) : 0;
  // The graph. Every released movie gets one:
  //  1) a reported total → spread over the run (modeled shape);
  //  2) numbers posted online → a decay curve fitted through them;
  //  3) a recent Indian movie with nothing posted → a rough guess from similar movies in theaters now;
  //  4) anything else with no money numbers anywhere → the typical shape of a run, in % of the final total (no made-up money).
  let G = null, F = null;
  if (released && total) G = { kind: 'total', daily: running ? (w => { const c = w.slice(0, Math.max(1, today)).reduce((x, y) => x + y, 0); return w.map(x => x / c * total); })(wts(date, -Math.log(0.93))) : modelRun(total, date, LIFE), label: cur === '₹' ? 'Gross' : 'Worldwide gross', fmt,
    note: 'Modeled line: the total is reported, but the day-by-day shape is our estimate (big opening, slow drop, weekend bumps).' };
  else if (released && S.length) { F = fitRun(S, date); if (F && F.total > 0) G = { kind: 'fit', daily: F.daily, label: F.scope, fmt: cr, anchors: F.anchors,
    note: `Estimate: a curve fitted through the ${F.anchors.length} number${F.anchors.length > 1 ? 's' : ''} posted online (dots). Each day earns e<sup>−${F.k.toFixed(3)}</sup> × the day before, with weekend bumps${F.solved ? ' — the drop rate comes from the posts' : ' — the drop rate is a typical one'}. Dashed part = where it is heading.` }; }
  if (released && !G && indian && age <= 120) { const TY = typicalLife(SO, d.lang), w = wts(date, K0), sw = w.reduce((a, b) => a + b, 0);
    G = { kind: 'rough', daily: w.map(x => x / sw * TY.total), label: 'Gross', fmt: cr,
      note: `Rough estimate — no real numbers were posted for this movie. This line is the typical run of ${TY.n} ${TY.lang ? esc(lang(d.lang)) + ' ' : ''}movie${TY.n === 1 ? '' : 's'} in theaters now, not this movie's real money.` }; }
  if (released && !G) { const w = wts(date, K0), sw = w.reduce((a, b) => a + b, 0);
    G = { kind: 'shape', daily: w.map(x => x / sw * 100), label: 'Share of final total', fmt: v => `${v >= 10 ? Math.round(v) : v.toFixed(1)}%`,
      note: 'No money numbers exist anywhere for this movie (not on TMDB, trade sites or social media). So this graph shows the typical shape of a run instead: how much of the final total comes in by each day. It is not this movie\'s real money.' }; }
  // Final judgement.
  const bud = cur === '₹' ? (B ? +B.low : null) : cur === '$' ? d.budget_usd : null;
  let verdict = verdictFrom(total, bud, running, d.year_rank), projected = false;
  if (!verdict && G && G.kind === 'fit' && B && /gross/i.test(G.label)) { verdict = verdictFrom(F.total, +B.low, false); projected = !!verdict; }
  const verdictWhy = verdict ? (projected ? `Projected from the fitted line (${cr(F.total)} after 8 weeks) vs the ${cr(+B.low)} budget.` : `${fmt(total)} gross vs ${cur === '₹' ? cr(bud) : usd(bud)} budget. The producer keeps about half the gross, so this is ${(total / (2 * bud)).toFixed(1)}× the money back.${verdict === 'Industry hit' ? ' Also the top grosser of its year in its language.' : ''}`)
    : soon ? 'Not out yet.' : running ? 'Too early to call — still in theaters.' : 'No verdict: we need both the budget and the gross, and one of them was never reported.';
  const gTodayCum = G ? G.daily.slice(0, Math.max(1, today)).reduce((a, b) => a + b, 0) : 0;
  const card = (l, v, s = '') => `<div class="card kn"><span class="eyebrow">${l}</span><span class="num big">${v}</span>${s ? `<span class="meta">${s}</span>` : ''}</div>`;
  const fact = (l, v) => v ? `<div><span class="eyebrow">${l}</span><b>${esc(v)}</b></div>` : '';
  const srcNote = rp ? `Total: ${esc(rp.source)}.` : d.revenue_usd ? 'Total and budget: TMDB (worldwide, US dollars).' : '';
  const talk = (TK || []).find(t => t.tmdb_id === d.id);
  $('#bom', app).innerHTML = `
    <section class="bohead">
      <div class="bopost">${poster({ id: 'tm' + d.id, name: d.name, year: String(year || ''), type: 'movie', posterPath: d.poster_path, colors: ['#171717', '#171717'] }, { mine: false })}</div>
      <div class="bohinfo">
        <p class="eyebrow">${esc(lang(d.lang))}${date ? ` · ${esc(fmtDate(date))}` : ''}</p>
        <h1 class="display sm">${esc(d.name)}</h1>
        <div class="meta">${[d.certificate, d.runtime ? `${Math.floor(d.runtime / 60)}h ${d.runtime % 60}m` : '', d.genres.slice(0, 3).join(', ')].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="bigverdict ${verdict ? vtone(verdict) : 'run'}">${esc(verdict ? verdict + (projected ? ' (projected)' : '') : soon ? (age === 0 ? 'Out tomorrow' : 'Coming soon') : running ? 'In theaters' : 'No verdict')}</div>
        <p class="meta vwhy">${esc(verdictWhy)}</p>
        <a class="see" href="#/t/tmdb-movie-${d.id}">Ratings &amp; journey ${ic('arrow-right')}</a>
      </div>
    </section>
    ${summaryHTML(d)}
    ${G ? `<section class="card chartcard${G.kind === 'rough' || G.kind === 'shape' ? ' rough' : ''}">
      <div class="chtop"><div><span class="eyebrow" id="chlabel"></span><div class="num huge" id="chtotal">${G.kind === 'total' ? fmt(total) : G.kind === 'shape' ? G.fmt(gTodayCum) : `${G.kind === 'rough' ? '~' : ''}${G.fmt(gTodayCum)}`}</div>${G.kind !== 'total' ? `<span class="meta">${G.kind === 'shape' ? 'of the final total by now (typical)' : G.kind === 'rough' ? 'Rough estimate so far' : 'Our estimate so far'}</span>` : ''}</div>
        <div class="chctl"><div class="seg" role="group" aria-label="Total or daily">${[['cum', 'Cumulative total'], ['daily', 'Daily (modeled)']].map(([k, l]) => `<button data-mode="${k}" class="${st.mode === k ? 'on' : ''}" aria-pressed="${st.mode === k}">${l}</button>`).join('')}</div></div></div>
      <div class="chwrap" id="chwrap"></div>
      <p class="meta chmodel">${G.note}</p>
    </section>` : soon ? `<section class="card"><div class="mascot"><div>Releases on ${esc(fmtDate(date))} – ${1 - age === 1 ? 'tomorrow' : `${1 - age} days to go`}.<br>The box office graph shows up here after it comes out.<br><a href="#/upcoming">Set a reminder in Upcoming</a></div></div></section>` : `<section class="card"><div class="mascot"><div>TMDB has no release date for this movie, so we can't draw its graph.</div></div></section>`}
    ${S.length ? socialHTML(S) : ''}
    <section class="kgrid">
      ${!total && S.find(r => /^Worldwide/.test(r.figure)) ? card('Worldwide gross', esc(amt(S.find(r => /^Worldwide/.test(r.figure)))), 'Posted online, see below') : card('Worldwide gross', total ? fmt(total) : '—', rp && rp.high != null && +rp.high > +rp.low ? `Reports go up to ${fmt(+rp.high)}` : cur === '$' ? 'US dollars' : '')}
      ${B ? card('Budget', esc(amt(B)), `<a href="${esc(safeUrl(B.url))}" target="_blank" rel="noopener nofollow">${esc(B.source_name)}</a>`) : card('Budget', d.budget_usd ? usd(d.budget_usd) : '—', d.budget_usd ? 'TMDB' : '')}
      ${card('Release', date ? esc(fmtDate(date)) : '—', hw && d.us_release ? 'US' : d.india_release ? 'India' : '')}
      ${card('Runtime', d.runtime ? `${d.runtime} min` : '—')}
    </section>
    ${talkHTML(d, talk)}
    ${worthHTML(d, talk, running, soon)}
    <section class="card run"><h2 class="h3">Details</h2>
      <div class="runfacts bofacts">${fact('Director', d.director.join(', '))}${fact('Cast', d.cast.join(', '))}${fact('Music', d.music.join(', '))}${fact('Studios', d.companies.join(', '))}${fact('Countries', d.countries.join(', '))}${fact('Original title', d.original_name !== d.name ? d.original_name : '')}</div>
    </section>
    <p class="meta upnote">${srcNote} Movie details, audience score and reviews from TMDB. Verdicts are worked out from budget and gross when both are known.</p>`;
  hydratePosters($('#bom', app));
  fixHeadPoster(app, { posterPath: d.poster_path, tid: d.id, name: d.name, lang: d.lang, year, id: 'tm' + d.id });
  reveal($$('#bom .kgrid .card, #bom .run', app));
  if (!G) return;
  const wrap = $('#chwrap', app);
  const color = verdict && GOOD.has(verdict) ? '#C6F432' : BAD.has(verdict) ? '#E5484D' : '#8A8A8A';
  const draw = () => { drawModeled(wrap, date, G.daily, G.fmt, d.name, G.kind === 'total' ? color : G.kind === 'rough' || G.kind === 'shape' ? '#5E5E5E' : '#8A8A8A', { label: G.label, today, anchors: G.anchors, kind: G.kind }); $$('#bom [data-mode]').forEach(b => { const on = st.mode === b.dataset.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }); };
  $$('[data-mode]', app).forEach(b => b.onclick = () => { st.mode = b.dataset.mode; draw(); });
  draw();
}

/* ---------- Summary, public talk, and "is it worth it?" (shown on every movie page) ---------- */
let talkP = null;
const talkAll = () => (talkP ||= rpc('box_office_talk').catch(() => { talkP = null; return []; }));
const anyUrl = u => /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\//i.test(u || '') ? u : '#';
function summaryHTML(d) {
  if (!d.overview && !d.tagline) return '';
  return `<section class="card run bosum"><h2 class="h3">Summary</h2>${d.tagline ? `<p class="serif bom-tag">“${esc(d.tagline)}”</p>` : ''}${d.overview ? `<p class="sub">${esc(d.overview)}</p>` : ''}</section>`;
}
function talkHTML(d, t) {
  const score = d.score != null && d.votes >= 5 ? `<div class="tscore"><span class="num big">${d.score.toFixed(1)}<small>/10</small></span><span class="meta">Audience score on TMDB · ${d.votes.toLocaleString('en-US')} vote${d.votes === 1 ? '' : 's'}</span><span class="tbar"><i style="width:${Math.round(d.score * 10)}%"></i></span></div>` : '';
  const ours = t ? `<p class="sub">${esc(t.talk)}</p><p class="meta">Pulled together by us from: ${(t.sources || []).map(x => `<a href="${esc(anyUrl(x.url))}" target="_blank" rel="noopener nofollow">${esc(x.name)}</a>`).join(', ')} · as of ${esc(fmtDate(t.as_of))}</p>` : '';
  const revs = (d.reviews || []).filter(r => r.text).map(r => `<li><p>“${esc(r.text)}${r.text.length >= 220 ? '…' : ''}”</p><span class="meta">${esc(r.author)}${r.rating != null ? ` · ${esc(String(r.rating))}/10` : ''}${r.url ? ` · <a href="${esc(r.url)}" target="_blank" rel="noopener nofollow">Read on TMDB</a>` : ''}</span></li>`).join('');
  if (!score && !ours && !revs) return `<section class="card run botalk"><h2 class="h3">Public talk</h2><p class="meta">No public talk found yet — no audience score or reviews on TMDB, and nothing we could find on X, Instagram or news sites.</p></section>`;
  return `<section class="card run botalk"><h2 class="h3">Public talk</h2>${ours}${score}${revs ? `<ul class="trev">${revs}</ul>` : ''}</section>`;
}
const WORTH = { go: ['Yes — go see it in theaters', 'up'], maybe: ['Maybe — a one-time watch', ''], wait: ['Wait for streaming (OTT)', 'down'], skip: ['Skip it', 'down'], home: ['Worth watching (now at home)', 'up'] };
function worthHTML(d, t, running, soon) {
  let k, why;
  if (t && t.worth) { k = t.worth; why = t.worth_why || 'Based on the public talk above.'; }
  else if (soon) { k = null; why = 'It is not out yet. Check back after the first reviews come in.'; }
  else if (d.score == null || d.votes < 15) { k = null; why = 'Too few ratings so far to say.'; }
  else {
    const s = d.score, g = (d.genres[0] || 'this kind of movie').toLowerCase();
    k = s >= 7.3 ? 'go' : s >= 6.3 ? 'maybe' : running ? 'wait' : 'skip';
    why = `Audience score ${s.toFixed(1)}/10 from ${d.votes.toLocaleString('en-US')} votes. ${s >= 7.3 ? 'People like it a lot.' : s >= 6.3 ? `Fine if you enjoy ${g}.` : 'Most people were not impressed.'}`;
    if (!running && k === 'go') k = 'home';
  }
  const w = k ? WORTH[k] : ['Not sure yet', 'run'];
  return `<section class="card run boworth"><h2 class="h3">${running || soon ? 'Worth going to the movies?' : 'Worth watching?'}</h2><div class="bigverdict sm ${w[1]}">${esc(w[0])}</div><p class="meta">${esc(why)}</p></section>`;
}

async function drawModeled(wrap, date, daily, fmt, name, color = '#8A8A8A', o = {}) {
  const kind = o.kind || 'total', label = o.label || 'Worldwide gross', n = daily.length;
  const cut = Math.max(1, Math.min(n, o.today || n));   // days 1..cut are "so far" (solid); the rest is the projection (dashed)
  let run = 0; const cum = daily.map(v => (run += v)), cumMode = st.mode === 'cum', V = cumMode ? cum : daily;
  const est = kind === 'total' ? '(modeled)' : kind === 'rough' ? '(rough estimate)' : kind === 'shape' ? '(typical shape, not real money)' : '(estimate)';
  $('#chlabel').textContent = `${label} · ${cumMode ? 'total' : 'per day'} ${est}`;
  const days = daily.map((_, i) => { const x = dt(date); x.setDate(x.getDate() + i); return x; });
  const pts = (o.anchors || []).filter(a => cumMode ? !a.single : a.single).map(a => [a.t - 1, +a.v.toFixed(4)]);
  const E = await echarts();
  if (!document.body.contains(wrap)) return;
  if (!E) {   // simple fallback: plain SVG line
    const W = 800, H = 260, max = Math.max(...V, ...pts.map(p => p[1])) * 1.08 || 1, x = i => 40 + i * (W - 56) / Math.max(1, V.length - 1), y = v => 14 + (1 - v / max) * (H - 40);
    const path = (a, z) => V.slice(a, z).map((v, i) => `${i ? 'L' : 'M'}${x(a + i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(name)}: ${esc(fmt(cum[cut - 1]))} so far ${est}"><path d="${path(0, cut)}" fill="none" stroke="${color}" stroke-width="2"/>${cut < n ? `<path d="${path(cut - 1, n)}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="5 5" opacity=".7"/>` : ''}${pts.map(p => `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="4" fill="#C6F432"/>`).join('')}</svg>`;
    return;
  }
  if (!chartInst || chartInst.getDom() !== wrap) {
    if (chartInst) chartInst.dispose();
    wrap.innerHTML = ''; wrap.classList.add('ec');
    chartInst = E.init(wrap, null, { renderer: 'svg' });
    new ResizeObserver(() => chartInst && !chartInst.isDisposed() && chartInst.resize()).observe(wrap);
  }
  const mono = '"Geist Mono", ui-monospace, monospace', r4 = v => +v.toFixed(4);
  const how = kind === 'total' ? 'Modeled from the reported total' : kind === 'rough' ? 'Rough estimate, no real numbers posted' : kind === 'shape' ? 'Typical shape of a run, not real money' : 'Fitted to numbers posted online';
  chartInst.setOption({
    animationDuration: 900, animationEasing: 'cubicOut', grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true }, textStyle: { fontFamily: mono },
    xAxis: { type: 'category', boundaryGap: false, data: V.map((_, i) => 'D' + (i + 1)), axisLine: { lineStyle: { color: '#1F1F1F' } }, axisTick: { show: false }, axisLabel: { color: '#5E5E5E', fontSize: 11, hideOverlap: true } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#1A1A1A' } }, axisLabel: { color: '#5E5E5E', fontSize: 11, formatter: v => fmt(v).replace(' Cr', '') } },
    tooltip: { trigger: 'axis', backgroundColor: '#0A0A0A', borderColor: '#1F1F1F', borderWidth: 1, textStyle: { color: '#F5F5F5', fontSize: 12, fontFamily: mono },
      axisPointer: { type: 'cross', lineStyle: { color: '#3A3A3A' }, crossStyle: { color: '#3A3A3A' }, label: { backgroundColor: '#1F1F1F', color: '#F5F5F5', fontFamily: mono } },
      formatter: p => { const i = p[0].dataIndex, posted = (o.anchors || []).filter(a => a.t - 1 === i);
        return `<b>Day ${i + 1}</b> · ${esc(days[i].toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))}${i >= cut ? ' <span style="color:#8A8A8A">(ahead)</span>' : ''}<br><span style="color:#8A8A8A">Daily</span> ${fmt(daily[i])}<br><span style="color:#8A8A8A">Total</span> ${fmt(cum[i])}${posted.map(a => `<br><span style="color:#C6F432">Posted</span> ${fmt(a.v)}${a.single ? ' that day' : ' total'}`).join('')}<br><span style="color:#8A8A8A">${how}</span>`; } },
    series: [
      { type: 'line', data: V.map((v, i) => i < cut ? r4(v) : null), showSymbol: false, smooth: 0.15, lineStyle: { width: 2, color, type: kind === 'rough' ? 'dotted' : 'solid' } },
      { type: 'line', data: V.map((v, i) => i >= cut - 1 && cut < n ? r4(v) : null), showSymbol: false, smooth: 0.15, lineStyle: { width: 2, color, type: 'dashed', opacity: 0.6 } },
      ...(pts.length ? [{ type: 'scatter', data: pts, symbolSize: 9, itemStyle: { color: '#C6F432' }, z: 5 }] : []),
    ],
  }, { notMerge: true });
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', `${name}: ${fmt(cum[cut - 1])} so far, ${label} ${est}`);
}
