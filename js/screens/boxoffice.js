// Box Office (Indian cinema) — like a stock app, for movies.
//   #/boxoffice        ticker list, tabs, filters, top stats
//   #/boxoffice/<id>   one movie: revenue chart, key numbers, theatrical run
// Numbers are entered by admins (Admin → Box office). Money is in ₹ crore.
import { cloud, plain } from '../cloud.js';
import { $, $$, esc, ic, poster, hydratePosters, wide } from '../ui.js';
import { CONFIG } from '../config.js';
import { LANGS } from './upcoming.js';
import { echarts, reveal, countUp } from '../motion.js';

const st = { tab: 'theaters', lang: '', year: '', verdict: '', metric: 'ww', mode: 'cum', range: 'all' };
const VERDICTS = ['Blockbuster', 'Superhit', 'Hit', 'Average', 'Flop', 'Disaster'];
const GOOD = new Set(['Blockbuster', 'Superhit', 'Hit']);
const dayMs = 864e5;
const n = v => v == null ? null : +v;
export const cr = v => v == null || isNaN(v) ? '—' : '₹' + (v >= 1000 ? Math.round(v).toLocaleString('en-IN') : v >= 100 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2)) + ' Cr';
const dt = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = s => dt(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const daysSince = s => Math.floor((Date.now() - dt(s)) / dayMs) + 1;
const lang = c => LANGS[c] || (c || '').toUpperCase();
const img = (p, size = 'w185') => p ? `${CONFIG.imageBase}${size}${p}` : '';
const verdictPill = v => v ? `<span class="vpill ${GOOD.has(v) ? 'up' : v === 'Average' ? '' : 'down'}">${esc(v)}</span>` : `<span class="vpill run">Running</span>`;
function change(m) {
  const a = n(m.last), b = n(m.prev);
  if (a == null || b == null || !b) return '<span class="chg">—</span>';
  const p = (a - b) / b * 100, up = p >= 0;
  return `<span class="chg ${up ? 'up' : 'down'}" aria-label="${up ? 'Up' : 'Down'} ${Math.abs(p).toFixed(1)} percent">${up ? '▲' : '▼'} ${Math.abs(p).toFixed(1)}%</span>`;
}
const thumb = m => `<span class="bthumb">${m.poster_path ? `<img src="${esc(img(m.poster_path, 'w92'))}" alt="" loading="lazy">` : ''}</span>`;

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
/** Poster + TMDB id for a reported movie (cached for this visit). */
const PKEY = 'hb_bo_posters';
let posterCache = (() => { try { return JSON.parse(sessionStorage.getItem(PKEY) || '{}'); } catch (e) { return {}; } })();
async function findPoster(r) {
  const k = `${r.lang}|${r.year}|${r.title}`;
  if (k in posterCache) return posterCache[k];
  let hit = null;
  try {
    const d = await tmdbGet(`/api/tmdb?q=${encodeURIComponent(r.title)}`);
    const m = (d.results || []).find(x => x.type === 'movie' && Math.abs((+x.year || 0) - r.year) <= 1 && same(x.name, r.title)) || (d.results || []).find(x => x.type === 'movie' && +x.year === r.year);
    if (m) hit = { tmdb: m.id, poster_path: m.poster_path };
  } catch (e) { return null; }
  posterCache[k] = hit; try { sessionStorage.setItem(PKEY, JSON.stringify(posterCache)); } catch (e) { /* ignore */ }
  return hit;
}

export async function renderBoxOffice(app, id) {
  if (id && /^\d+$/.test(id)) return renderMovie(app, +id);
  document.title = 'Box Office — Heartbeat';
  app.innerHTML = `<div class="screen boxoffice">
    <header class="hhead"><p class="eyebrow">Indian box office</p><h1 class="display">The <em>numbers.</em></h1>
      <p class="sub uplead">Collections in ₹ crore, like a stock ticker for movies. Every Indian release, plus the biggest hits of all time.</p></header>
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
    ctl.innerHTML = `<div class="upctl"><div class="seg" role="tablist" aria-label="Which movies">${[['theaters', 'In theaters'], ['year', 'This year'], ['all', 'All-time']].map(([k, l]) => `<button role="tab" aria-selected="${st.tab === k}" class="${st.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      ${sel('bolang', 'All languages', Object.keys(LANGS).map(k => [k, LANGS[k]]), st.lang)}${st.tab === 'all' ? sel('boyear', 'Any year', years.map(y => [y, y]), st.year) : ''}${sel('boverdict', 'Any verdict', [...VERDICTS, 'Running', 'Reported'].map(v => [v, v]), st.verdict)}</div>`;
    $$('[data-tab]', ctl).forEach(b => b.onclick = () => { st.tab = b.dataset.tab; drawCtl(); draw(); });
    $('#bolang', ctl).onchange = e => { st.lang = e.target.value; draw(); };
    $('#boverdict', ctl).onchange = e => { st.verdict = e.target.value; draw(); };
    const y = $('#boyear', ctl); if (y) y.onchange = e => { st.year = e.target.value; draw(); };
  };
  const rowHTML = (m, i) => {
    const t = m.kind === 't';
    const href = t ? `#/boxoffice/${m.id}` : m.tmdb ? `#/t/tmdb-movie-${m.tmdb}` : null;
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
    let L = st.tab === 'theaters' ? all.filter(m => m.running) : st.tab === 'year' ? thisYear : ranked;
    if (st.lang) L = L.filter(m => m.lang === st.lang);
    if (st.year && st.tab === 'all') L = L.filter(m => m.year === +st.year);
    if (st.verdict) L = L.filter(m => (m.kind === 'r' ? 'Reported' : m.verdict || 'Running') === st.verdict);
    L = L.slice().sort((a, b) => st.tab === 'theaters' ? (n(b.last) || 0) - (n(a.last) || 0) : b.worldwide - a.worldwide);
    const box = $('#bolist', app);
    box.innerHTML = !L.length ? `<div class="card"><div class="mascot"><div>No movies with numbers match these filters.</div></div></div>`
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
    if (st.tab !== 'year' || st.verdict) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="sec"><h2>Every other ${year} release</h2><span class="meta" id="bocount"></span></div><div class="ticker others" id="bolist2"></div>
      <div class="bomore"><button class="btn ghost sm" id="bomore" hidden>Show more</button></div>`;
    let page = 0, pages = 1, shown = 0;
    const list = $('#bolist2', box), more = $('#bomore', box);
    const load = async () => {
      more.disabled = true;
      try {
        const d = await tmdbGet(`/api/tmdb?released=${year}&page=${++page}${st.lang ? `&lang=${st.lang}` : ''}`);
        if (seq !== otherSeq) return;
        pages = d.total_pages || 1;
        $('#bocount', box).textContent = `${(d.total || 0).toLocaleString('en-IN')} films on TMDB`;
        const rows = (d.results || []).filter(x => !L.some(m => m.lang === x.lang && same(m.title, x.name)));
        list.insertAdjacentHTML('beforeend', rows.map(x => `<a class="trow" href="#/t/tmdb-movie-${x.id}">
          <span class="tm"><span class="rk num"></span>${thumb(x)}<span><b>${esc(x.name)}</b><span class="meta">${esc(lang(x.lang))}${x.date ? ` · ${esc(fmtDate(x.date))}` : ''}</span></span></span>
          <span class="r meta nonum">No numbers reported</span></a>`).join(''));
        shown += rows.length;
      } catch (e) { if (!list.children.length) list.innerHTML = `<div class="meta" style="padding:14px 4px">Could not load the full list right now.</div>`; }
      more.hidden = page >= pages; more.disabled = false;
    };
    more.onclick = load;
    await load();
  }
  drawCtl(); draw();
  reveal($$('.bostat', app));
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
  const net = sum('net'), gross = sum('gross'), overseas = sum('overseas'), ww = gross + overseas;
  const budget = n(m.budget_cr), be = n(m.breakeven);
  const first = k => days.filter(d => d.day <= k).reduce((a, d) => a + d.net, 0);
  const wkEnd = (() => { const r = dt(m.release_date).getDay(); return Math.max(1, r === 0 ? 1 : 8 - r); })(); // through the first Sunday
  const roi = budget ? Math.round((ww / 2 - budget) / budget * 100) : null;   // producer share ≈ half of gross
  const inTheaters = m.running ? daysSince(m.release_date) : (days.length ? days[days.length - 1].day : 0);
  const card = (l, v, s = '', raw = null) => `<div class="card kn"><span class="eyebrow">${l}</span><span class="num big" ${raw != null ? `data-count="${raw}"` : ''}>${v}</span>${s ? `<span class="meta">${s}</span>` : ''}</div>`;
  $('#bom', app).innerHTML = `
    <section class="bohead">
      <div class="bopost">${poster({ id: 'bo' + m.id, name: m.title, year: String(m.release_date).slice(0, 4), type: 'movie', posterPath: m.poster_path, colors: ['#171717', '#171717'] }, { mine: false })}</div>
      <div class="bohinfo">
        <p class="eyebrow">${esc(lang(m.lang))} · ${esc(fmtDate(m.release_date))}</p>
        <h1 class="display sm">${esc(m.title)}</h1>
        <div class="meta">${[m.certificate, m.runtime ? `${Math.floor(m.runtime / 60)}h ${m.runtime % 60}m` : '', budget != null ? `Budget ${cr(budget)}` : ''].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="bigverdict ${m.verdict ? (GOOD.has(m.verdict) ? 'up' : m.verdict === 'Average' ? '' : 'down') : 'run'}">${esc(m.verdict || 'Running')}</div>
        ${m.tmdb_id ? `<a class="see" href="#/t/tmdb-movie-${m.tmdb_id}">Ratings &amp; journey ${ic('arrow-right')}</a>` : ''}
      </div>
    </section>
    <section class="card chartcard">
      <div class="chtop">
        <div><span class="eyebrow" id="chlabel"></span><div class="num huge" id="chtotal"></div></div>
        <div class="chctl">
          <div class="seg" role="group" aria-label="Total or daily">${[['cum', 'Cumulative total'], ['daily', 'Daily collection']].map(([k, l]) => `<button data-mode="${k}" class="${st.mode === k ? 'on' : ''}" aria-pressed="${st.mode === k}">${l}</button>`).join('')}</div>
          <div class="seg" role="group" aria-label="Which number">${[['net', 'India Net'], ['gross', 'India Gross'], ['ww', 'Worldwide Gross']].map(([k, l]) => `<button data-metric="${k}" class="${st.metric === k ? 'on' : ''}" aria-pressed="${st.metric === k}">${l}</button>`).join('')}</div>
        </div>
      </div>
      <div class="chwrap" id="chwrap"></div>
      <div class="chbottom"><div class="seg" role="group" aria-label="Time range">${[['7', '1W'], ['14', '2W'], ['30', '1M'], ['all', 'ALL']].map(([k, l]) => `<button data-range="${k}" class="${st.range === k ? 'on' : ''}" aria-pressed="${st.range === k}">${l}</button>`).join('')}</div>
        <span class="meta chlegend"><span class="lg dash"></span>Budget${be ? ' <span class="lg dash be"></span>Break-even (est.)' : ''}</span></div>
    </section>
    <section class="kgrid">
      ${card('Budget', cr(budget))}${card('Opening day', cr(first(1)), 'India net', first(1))}${card('Opening weekend', cr(first(wkEnd)), `First ${wkEnd} day${wkEnd > 1 ? 's' : ''}`, first(wkEnd))}
      ${card('First week', cr(first(7)), 'India net', first(7))}${card('Lifetime India net', cr(net), m.running ? 'So far' : '', net)}${card('Worldwide gross', cr(ww), '', ww)}
      ${card('Overseas', cr(overseas), '', overseas)}${card('ROI', roi == null ? '—' : `${roi > 0 ? '+' : ''}${roi}%`, 'Producer share ≈ 50% of gross')}
      ${card('Days in theaters', inTheaters || '—')}${card('Screens', m.screens ? Number(m.screens).toLocaleString('en-IN') : '—', 'Opening count')}
    </section>
    ${runHTML(m, days)}
    <p class="meta upnote">${m.source ? `Source: ${esc(m.source)}. ` : ''}Estimates; gross is net + 18% GST when not reported. Updated ${esc(fmtDate(m.updated_at))}.</p>`;
  hydratePosters($('#bom', app));
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
function series(m, days, { ww, be, budget }) {
  const key = st.metric === 'net' ? 'net' : st.metric === 'gross' ? 'gross' : 'ww';
  const daily = days.map(d => key === 'ww' ? d.gross + d.overseas : d[key]);
  let run = 0; const cum = daily.map(v => (run += v));
  const lim = st.range === 'all' ? days.length : Math.min(days.length, +st.range);
  const D = days.slice(0, lim), V = (st.mode === 'cum' ? cum : daily).slice(0, lim);
  const label = { net: 'India net', gross: 'India gross', ww: 'Worldwide gross' }[key] + (st.mode === 'cum' ? ' · total' : ' · per day');
  const refs = st.mode === 'cum' ? [budget != null && { v: budget, c: 'Budget' }, key === 'ww' && be && { v: be, c: 'Break-even (est.)' }].filter(Boolean) : [];
  const color = ww >= (be || Infinity) ? '#C6F432' : !m.running ? '#E5484D' : '#8A8A8A';
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
  const color = ww >= (be || Infinity) ? 'var(--accent)' : !m.running ? 'var(--red)' : '#8A8A8A';
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
