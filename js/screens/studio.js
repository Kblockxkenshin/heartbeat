// Heartbeat for Studios (Part 8)
//   #/studios                     → what it is + "Talk to sales"
//   #/studio[/<id>[/<tab|title>]] → the studio dashboard (team members with 2-step sign-in)
//   #/screeners                   → screener panel invites for critics
// Studios only ever see counts and averages. The server enforces every rule (see supabase/010_studios.sql).
import { cloud, keyOf, idOf, plain } from '../cloud.js';
import { $, $$, esc, toast, sheet, closeSheet, empty, poster, hydratePosters, confetti } from '../ui.js';
import { avatar, profileHref, titlesFor } from '../social.js';
import { tagLabel } from '../reviews.js';

async function rpc(fn, args = {}) {
  if (!cloud.sb) throw new Error('Accounts are not switched on yet.');
  const { data, error } = await cloud.sb.rpc(fn, args);
  if (error) throw new Error(error.message || 'Something went wrong.');
  return data;
}
const num = (x, d = 1) => x == null ? '–' : (+x).toFixed(d);
const day = s => s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const RANKS = ['Critic', 'Top Critic', "Director's Cut", 'Legend'];
let REGION = null;
try { REGION = new Intl.DisplayNames(undefined, { type: 'region' }); } catch (e) { /* old browser */ }
const regionName = r => /^[A-Z]{2}$/.test(r) && REGION ? (REGION.of(r) || r) : r;
async function names(keys) {
  const ts = await titlesFor([...new Set(keys)]).catch(() => []);
  return Object.fromEntries(ts.map(t => [keyOf(t.id), t]));
}
/** YouTube / Vimeo link → a safe embed address (or null). */
export function embedUrl(u) {
  let m = /^https:\/\/(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([\w-]{6,20})/.exec(u || '') || /^https:\/\/youtu\.be\/([\w-]{6,20})/.exec(u || '');
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0`;
  m = /^https:\/\/(?:www\.)?vimeo\.com\/(\d{3,12})(?:\/([\w]{6,20}))?/.exec(u || '');
  if (m) return `https://player.vimeo.com/video/${m[1]}${m[2] ? '?h=' + m[2] : ''}`;
  return null;
}

/* =====================================================================
   #/studios — the page studios see first
   ===================================================================== */
const FEATURES = [
  ['<i class="i i-compass" aria-hidden="true"></i>', 'The full journey', 'See how people rate the start, middle and ending, and where they lose interest.'],
  ['<i class="i i-message-circle" aria-hidden="true"></i>', 'What people say', 'Sentiment over time, top themes, and an AI summary of checked reviews.'],
  ['<i class="i i-users" aria-hidden="true"></i>', 'Who watches', 'Age ranges and regions. Only grouped and anonymous — small groups stay hidden.'],
  ['<i class="i i-flame" aria-hidden="true"></i>', 'Hype tracker', 'Watchlist adds, trailer reactions and the "Most anticipated" ranking.'],
  ['<i class="i i-ticket" aria-hidden="true"></i>', 'Screener panels', 'Get feedback on trailers or early cuts from top critics who said yes.'],
  ['<i class="i i-shield" aria-hidden="true"></i>', 'Numbers you can trust', 'Only verified, AI-checked, non-bot data, with a data quality score. Export to CSV or PDF.'],
];
export async function renderStudios(app) {
  document.title = 'Heartbeat for Studios';
  app.innerHTML = `<div class="screen studio-land">
    <section class="card sthero"><div class="stbadge"><i class="i i-clapperboard" aria-hidden="true"></i> Heartbeat for Studios</div>
      <h1>See the journey,<br>not just the box office.</h1>
      <p class="sub">Audience insights for producers, directors and marketing teams — built on real fans rating the start, middle and ending.</p>
      <div id="stme"></div></section>
    <div class="stfeat">${FEATURES.map(([i, h, p]) => `<section class="card"><div class="stic" aria-hidden="true">${i}</div><h2 class="h3">${h}</h2><p class="sub">${p}</p></section>`).join('')}</div>
    <section class="card stprivacy"><h2 class="h3"><i class="i i-lock" aria-hidden="true"></i> Our privacy promise</h2><ul class="safelist">
      <li>Studios only see totals and averages — never names, profiles, single ratings or messages.</li>
      <li>Groups smaller than 10 people are hidden. People under 18 are never counted.</li>
      <li>Every member can opt out in Me → Security, any time.</li>
      <li>Screener panels are opt-in. Answers go to studios without names.</li></ul>
      <p class="sub">We follow GDPR and CCPA. Data is only shared in this grouped, anonymous way.</p></section>
    <section class="card"><h2 class="h3">Plans</h2><div class="stplans">
      ${[['Pilot', 'Up to 10 titles · 1 team'], ['Pro', 'Up to 50 titles · panels · exports'], ['Enterprise', 'Unlimited titles · custom reports']].map(([n, d]) => `<div class="stplan"><b>${n}</b><span class="sub">${d}</span></div>`).join('')}</div>
      <p class="sub" style="margin-top:8px">Prices are set by our sales team. Tell us about your studio and we'll reach out.</p></section>
    <section class="card" id="sales"><h2 class="h3"><i class="i i-mail" aria-hidden="true"></i> Talk to sales</h2><div id="salesb"></div></section></div>`;
  const me = $('#stme', app), sb = $('#salesb', app);
  if (!cloud.user) {
    me.innerHTML = `<a class="btn" href="#sales">Talk to sales</a>`;
    sb.innerHTML = `<p class="sub">Please sign in (or make a free account) first, so we know who to reply to.</p><a class="btn" href="#/signin">Sign in</a>`;
    return;
  }
  let my = null;
  try { my = await rpc('my_studios'); } catch (e) { sb.innerHTML = `<p class="errmsg">${esc(plain(e))}</p>`; return; }
  if (my?.studios?.length) me.innerHTML = `<div class="stbtns">${my.studios.map(s => `<a class="btn" href="#/studio/${s.id}">Open ${esc(s.name)} dashboard</a>`).join('')}</div>`;
  else me.innerHTML = `<a class="btn" href="#sales">Talk to sales</a>`;
  if (my?.request?.status === 'open') { sb.innerHTML = `<p class="okmsg" role="status">Thanks! We got your request for <b>${esc(my.request.company)}</b>. Our team will email you soon. <i class="i i-inbox" aria-hidden="true"></i></p>`; return; }
  sb.innerHTML = `<form id="sf" novalidate>
      <label class="fld"><span>Company or studio</span><input id="sfc" maxlength="80" required autocomplete="organization"></label>
      <label class="fld"><span>Your job</span><input id="sfj" maxlength="80" placeholder="Producer, marketing lead…" autocomplete="organization-title"></label>
      <label class="fld"><span>Work email</span><input id="sfe" type="email" maxlength="120" required autocomplete="email"></label>
      <label class="fld"><span>Website (optional)</span><input id="sfw" maxlength="200" placeholder="https://"></label>
      <label class="fld"><span>What do you want to learn? (optional)</span><textarea id="sfm" rows="3" maxlength="1000"></textarea></label>
      <p class="errmsg" id="sferr" role="alert" hidden></p>
      <button class="btn big" id="sfgo">Send</button></form>`;
  $('#sf', sb).onsubmit = async e => {
    e.preventDefault(); const b = $('#sfgo', sb); b.disabled = true;
    try {
      await rpc('studio_request', { p_company: $('#sfc', sb).value.trim(), p_job: $('#sfj', sb).value.trim(), p_email: $('#sfe', sb).value.trim(),
        p_website: $('#sfw', sb).value.trim(), p_message: $('#sfm', sb).value.trim() });
      sb.innerHTML = `<p class="okmsg" role="status">Thanks! Our team will email you soon. <i class="i i-inbox" aria-hidden="true"></i></p>`; toast('Request sent!');
    } catch (x) { const er = $('#sferr', sb); er.textContent = plain(x); er.hidden = false; b.disabled = false; }
  };
}

/* =====================================================================
   #/studio — the dashboard
   ===================================================================== */
const TABS = [['titles', 'Titles'], ['hype', 'Hype'], ['panels', 'Panels'], ['team', 'Team']];
export async function renderStudio(app, a, b) {
  document.title = 'Studio dashboard — Heartbeat';
  if (!cloud.user) { app.innerHTML = `<div class="screen"><div class="card">${empty('Sign in to open your studio dashboard.', 'happy', '<a class="btn" href="#/signin">Sign in</a>')}</div></div>`; return; }
  let sid = +a;
  if (!sid) {
    const my = await rpc('my_studios').catch(() => null);
    if (my?.studios?.length) { location.hash = `#/studio/${my.studios[0].id}`; return; }
    location.hash = '#/studios'; return;
  }
  app.innerHTML = `<div class="screen studio"><div class="card"><div class="rskel"></div><div class="rskel"></div></div></div>`;
  let home;
  try { home = await rpc('studio_home', { p_studio: sid }); }
  catch (e) {
    const need2 = /2-step/.test(e.message);
    app.innerHTML = `<div class="screen"><div class="card">${empty(esc(e.message), need2 ? 'happy' : 'sad', need2 ? '<a class="btn" href="#/security">Set up 2-step sign-in</a>' : '<a class="btn" href="#/studios">Heartbeat for Studios</a>')}</div></div>`;
    return;
  }
  const isTitle = /^(movie|tv):\d+$/.test(b), tab = isTitle ? 'titles' : (TABS.some(t => t[0] === b) ? b : 'titles');
  app.innerHTML = `<div class="screen studio">
    <header class="sthead"><div><div class="stbadge"><i class="i i-clapperboard" aria-hidden="true"></i> Studio dashboard</div><h1 class="logo" style="font-size:26px;margin:2px 0 0">${esc(home.name)}</h1>
      <div class="meta">${esc(home.plan[0].toUpperCase() + home.plan.slice(1))} plan · ${home.titles.length}/${home.title_limit} titles</div></div></header>
    <nav class="ftabs noprint" aria-label="Studio sections">${TABS.map(([k, l]) => `<a href="#/studio/${sid}/${k}" class="chip ${k === tab ? 'on' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    <div id="stb"></div></div>`;
  const box = $('#stb', app);
  try {
    if (isTitle) await insights(box, sid, b, home);
    else await ({ titles, hype, panels, team })[tab](box, sid, home);
  } catch (e) { box.innerHTML = `<div class="card">${empty(esc(plain(e)), 'sad')}</div>`; }
}

/* ---------- Titles ---------- */
async function titles(box, sid, home) {
  const ts = await names(home.titles.map(t => t.title_key));
  box.innerHTML = `<section class="card"><h2 class="h3">Your titles</h2>
      ${home.titles.length ? `<div class="sttitles">${home.titles.map(x => { const t = ts[x.title_key]; return `<a class="sttitle" href="#/studio/${sid}/${esc(x.title_key)}">
        ${t ? poster(t, { small: true }) : '<div class="stnoposter"><i class="i i-clapperboard" aria-hidden="true"></i></div>'}<div><b>${esc(t?.name || x.title_key)}</b>
        <div class="meta">${x.n ? `★ ${num(x.overall)} · ${x.n} trusted ratings` : 'No trusted ratings yet'}</div>
        <div class="meta"><i class="i i-bookmark" aria-hidden="true"></i> ${x.watch_30d} watchlist adds (30 days)</div></div></a>`; }).join('')}</div>`
      : `<p class="sub">Add the titles you want to follow. You can add any movie or series.</p>`}</section>
    <section class="card noprint"><h2 class="h3">Add a title</h2>
      <form id="stq" class="stsearch"><input id="stqi" type="search" placeholder="Search movies and series" aria-label="Search movies and series" autocomplete="off"><button class="btn sm">Search</button></form>
      <div id="stqr" class="stqr"></div></section>`;
  hydratePosters(box);
  $('#stq', box).onsubmit = async e => {
    e.preventDefault(); const q = $('#stqi', box).value.trim(); if (!q) return;
    const out = $('#stqr', box); out.innerHTML = '<div class="rskel"></div>';
    const d = await fetch('/api/tmdb?q=' + encodeURIComponent(q)).then(r => r.json()).catch(() => ({ results: [] }));
    const res = (d.results || []).slice(0, 8);
    out.innerHTML = res.length ? res.map(r => { const k = `${r.type}:${r.id}`, on = home.titles.some(x => x.title_key === k);
      return `<div class="stqrow"><span><b>${esc(r.name)}</b> <span class="meta">${esc(r.year || '')} · ${r.type === 'tv' ? 'Series' : 'Movie'}</span></span>
        <button class="btn sm ${on ? 'ghost' : ''}" data-k="${esc(k)}" ${on ? 'disabled' : ''}>${on ? 'Added' : '<i class="i i-plus" aria-hidden="true"></i> Add'}</button></div>`; }).join('')
      : '<p class="sub">Nothing found.</p>';
    $$('[data-k]', out).forEach(bt => bt.onclick = async () => {
      try { await rpc('studio_track', { p_studio: sid, p_title: bt.dataset.k, p_on: true }); toast('Added!'); location.hash = `#/studio/${sid}/${bt.dataset.k}`; }
      catch (x) { toast(plain(x), 'sad'); }
    });
  };
}

/* ---------- Insights for one title ---------- */
function bars(rows, max, fmt = v => v) {
  return `<div class="stbars">${rows.map(([l, v, extra = '']) => `<div class="stbar"><span class="stbl">${l}</span><span class="stbt"><i style="width:${max && v != null ? Math.max(v ? 2 : 0, 100 * v / max) : 0}%"></i></span><span class="stbv">${v == null ? '–' : fmt(v)}${extra}</span></div>`).join('')}</div>`;
}
function lineChart(weeks) {
  if (!weeks.length) return '<p class="sub">No ratings in the last 26 weeks.</p>';
  const W = 600, H = 170, P = 26, n = weeks.length, maxN = Math.max(...weeks.map(w => w.n));
  const x = i => P + (n === 1 ? (W - 2 * P) / 2 : i * (W - 2 * P) / (n - 1)), y = v => H - P - ((v - 1) / 4) * (H - 2 * P);
  const pts = weeks.map((w, i) => `${x(i).toFixed(1)},${y(+w.avg).toFixed(1)}`).join(' ');
  return `<svg class="stline" viewBox="0 0 ${W} ${H}" role="img" aria-label="Average rating per week">
    ${[1, 2, 3, 4, 5].map(v => `<line x1="${P}" x2="${W - P}" y1="${y(v)}" y2="${y(v)}" class="stgrid"/><text x="4" y="${y(v) + 4}" class="stax">${v}<i class="i i-star" aria-hidden="true"></i></text>`).join('')}
    ${weeks.map((w, i) => `<rect x="${x(i) - 6}" width="12" y="${H - P - 30 * w.n / maxN}" height="${30 * w.n / maxN}" class="stvol"><title>${w.n} ratings</title></rect>`).join('')}
    <polyline points="${pts}" class="stpl"/>${weeks.map((w, i) => `<circle cx="${x(i)}" cy="${y(+w.avg)}" r="4" class="stdot"><title>Week of ${day(w.week)}: <i class="i i-star" aria-hidden="true"></i>${w.avg} from ${w.n}</title></circle>`).join('')}
  </svg><div class="meta">Line: average rating each week. Bars: how many ratings.</div>`;
}
async function insights(box, sid, key, home) {
  const [I, ts] = await Promise.all([rpc('studio_insights', { p_studio: sid, p_title: key }), names([key, ...home.titles.map(t => t.title_key)])]);
  const t = ts[key], J = I.journey, Q = I.quality, H = I.hype, name = t?.name || key;
  const qColor = Q.score == null ? '' : Q.score >= 80 ? 'good' : Q.score >= 60 ? 'ok' : 'low';
  const tr = H.trailer || {}, trTotal = (tr.fire || 0) + (tr.love || 0) + (tr.meh || 0) + (tr.nope || 0);
  box.innerHTML = `<div class="sreport">
    <section class="card sthero2"><a class="see noprint" href="#/studio/${sid}/titles">← All titles</a>
      <div class="sthrow">${t ? poster(t, { small: true }) : ''}<div><h2 class="h3" style="font-size:24px">${esc(name)}</h2>
      <div class="meta">Audience report · ${esc(day(new Date().toISOString()))} · only trusted Heartbeat members (18+)</div>
      <div class="stbtns noprint"><button class="btn sm" id="csv"><i class="i i-download" aria-hidden="true"></i> CSV</button><button class="btn sm ghost" id="pdf"><i class="i i-printer" aria-hidden="true"></i> PDF</button>
        <a class="btn sm ghost" href="#/t/${esc(t?.id || idOf(key))}">Open title</a><button class="btn sm ghost" id="untrack">Remove</button></div></div></div></section>
    <div class="stgrid2">
    <section class="card"><h2 class="h3"><i class="i i-shield" aria-hidden="true"></i> Data quality</h2>
      <div class="stq ${qColor}"><b>${Q.score ?? '–'}</b><span>/100</span></div>
      <p class="sub">${Q.used} of ${Q.all} ratings passed every check (confirmed email, older account, not a bot or review-bombing wave).</p>
      ${bars([['Used', Q.used], ['Held (bot / wave)', Q.held], ['New or unconfirmed', Q.new_or_unconfirmed], ['Flagged or paused', Q.flagged_or_paused]], Q.all)}
      <p class="meta">${Q.reviews_ai_checked} of ${Q.reviews} public reviews were checked by our AI.</p></section>
    <section class="card"><h2 class="h3"><i class="i i-compass" aria-hidden="true"></i> The journey</h2>
      ${J.enough ? `${bars([['Start', +J.start], ['Middle', +J.middle], ['Ending', +J.end]], 5, v => '<i class="i i-star" aria-hidden="true"></i> ' + num(v))}
        <p class="stbig"><i class="i i-star" aria-hidden="true"></i> ${num(J.overall)} <span class="meta">overall · ${J.n} ratings</span></p>
        <p class="sub">${J.weakest ? `People lose interest in the <b>${J.weakest}</b>. ` : 'No big drop between parts. '}${J.lost_middle_pct}% rated the middle lower than the start; ${J.lost_end_pct}% rated the ending lower than the middle.</p>
        <div class="sub" style="font-weight:800;margin-top:8px">Star spread</div>${bars(J.stars.map((c, i) => [`${i + 1}★`, c]), Math.max(...J.stars))}`
      : `<p class="sub">Not enough trusted ratings yet (${J.n} of 5 needed).</p>`}</section>
    <section class="card span2"><h2 class="h3"><i class="i i-trending-up" aria-hidden="true"></i> Sentiment over time</h2>${lineChart(I.weeks)}</section>
    <section class="card span2" id="aisum"></section>
    <section class="card"><h2 class="h3"><i class="i i-tag" aria-hidden="true"></i> Top tags in reviews</h2>${I.tags.length ? bars(I.tags.map(x => [esc(tagLabel(x.tag)), x.n]), I.tags[0].n) : '<p class="sub">No tagged reviews yet.</p>'}</section>
    <section class="card"><h2 class="h3"><i class="i i-users" aria-hidden="true"></i> Age ranges</h2>${I.ages.length ? bars(I.ages.map(x => [x.range, x.n, x.hidden ? '' : ` · ★${num(x.avg)}`]), Math.max(...I.ages.map(x => x.n || 0)), v => v) + (I.ages.some(x => x.hidden) ? `<p class="meta">"–" = fewer than ${I.k} people, so it's hidden.</p>` : '') : '<p class="sub">No data yet.</p>'}</section>
    <section class="card"><h2 class="h3"><i class="i i-globe" aria-hidden="true"></i> Regions</h2>${I.regions.length ? bars(I.regions.map(x => [esc(regionName(x.region)), x.n, x.hidden ? '' : ` · ★${num(x.avg)}`]), Math.max(...I.regions.map(x => x.n || 0))) + `<p class="meta">Regions with fewer than ${I.k} people are grouped in "Other" or hidden.</p>` : '<p class="sub">No data yet.</p>'}</section>
    <section class="card"><h2 class="h3"><i class="i i-flame" aria-hidden="true"></i> Hype</h2>
      <div class="sthype"><div><b>${H.watchlist}</b><span>on watchlists</span></div><div><b>${H.recs_30d}</b><span>friend recs (30 days)</span></div><div><b>${H.swipes.loved}</b><span>quick-rate loves</span></div></div>
      ${H.watch_weeks.length ? `<div class="sub" style="font-weight:800;margin-top:8px">Watchlist adds per week</div>${bars(H.watch_weeks.map(w => [day(w.week).replace(/, \d{4}$/, ''), w.n]), Math.max(...H.watch_weeks.map(w => w.n)))}` : ''}
      <div class="sub" style="font-weight:800;margin-top:8px">Trailer reactions (${trTotal})</div>
      ${bars([['Can\'t wait', tr.fire || 0], ['Love it', tr.love || 0], ['Not sure', tr.meh || 0], ['Not for me', tr.nope || 0]], Math.max(1, tr.fire || 0, tr.love || 0, tr.meh || 0, tr.nope || 0))}</section>
    <section class="card span2"><h2 class="h3"><i class="i i-scale" aria-hidden="true"></i> Compare</h2>
      <div class="sttable"><table><thead><tr><th>Title</th><th>Ratings</th><th>Start</th><th>Middle</th><th>Ending</th><th>Overall</th></tr></thead><tbody>
      ${I.compare.map(c => `<tr class="${c.title_key === key ? 'me' : ''}"><td>${esc(ts[c.title_key]?.name || c.title_key)}</td><td>${c.n}</td><td>${num(c.start)}</td><td>${num(c.middle)}</td><td>${num(c.end)}</td><td><i class="i i-star" aria-hidden="true"></i> ${num(c.overall)}</td></tr>`).join('')}
      <tr class="avg"><td>Heartbeat average</td><td>${I.average.n}</td><td>${num(I.average.start)}</td><td>${num(I.average.middle)}</td><td>${num(I.average.end)}</td><td><i class="i i-star" aria-hidden="true"></i> ${num(I.average.overall)}</td></tr>
      </tbody></table></div><p class="meta">Your titles with 5+ trusted ratings, and the average of all titles on Heartbeat.</p></section>
    </div>
    <p class="meta stfoot">Privacy: these are totals and averages from Heartbeat members 18+ who did not opt out. No names, single ratings or messages are ever shared. Groups under ${I.k} people are hidden.</p></div>`;
  hydratePosters(box);
  drawSummary($('#aisum', box), sid, key, I.summary, I.quality.reviews);
  $('#csv', box).onclick = () => downloadCsv(name, I, ts);
  $('#pdf', box).onclick = () => { document.body.classList.add('printing'); setTimeout(() => { window.print(); document.body.classList.remove('printing'); }, 50); };
  $('#untrack', box).onclick = () => {
    const sh = sheet(`<h2 class="h3" style="font-size:20px">Remove ${esc(name)}?</h2><p class="sub">You can add it again any time. Nothing is deleted.</p>
      <div class="aibtns"><button class="btn" id="rmy">Remove</button><button class="btn ghost" id="rmn">Keep it</button></div>`);
    $('#rmn', sh).onclick = () => closeSheet();
    $('#rmy', sh).onclick = async () => { try { await rpc('studio_track', { p_studio: sid, p_title: key, p_on: false }); closeSheet(); location.hash = `#/studio/${sid}/titles`; } catch (e) { toast(plain(e), 'sad'); } };
  };
}
function drawSummary(el, sid, key, s, nReviews) {
  const FEEL = { positive: '<i class="i i-sun" aria-hidden="true"></i>', mixed: '<i class="i i-circle-dot" aria-hidden="true"></i>', negative: '<i class="i i-cloud-rain" aria-hidden="true"></i>' };
  const d = s?.data;
  el.innerHTML = `<h2 class="h3"><i class="i i-bot" aria-hidden="true"></i> What people say (AI summary)</h2>
    ${d ? `<p class="stbig2">${esc(d.headline)}</p>
      <div class="stgrid2 inner"><div><div class="sub" style="font-weight:800"><i class="i i-thumbs-up" aria-hidden="true"></i> Loved</div><ul class="stul">${(d.loved || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
        <div><div class="sub" style="font-weight:800"><i class="i i-thumbs-down" aria-hidden="true"></i> Didn't like</div><ul class="stul">${(d.disliked || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></div>
      ${(d.themes || []).length ? `<div class="stthemes">${d.themes.map(x => `<div class="sttheme ${esc(x.feeling)}"><b>${FEEL[x.feeling] || ''} ${esc(x.name)}</b> <span class="meta">~${x.share}% of reviews</span><div class="sub">${esc(x.about)}</div></div>`).join('')}</div>` : ''}
      ${d.ending ? `<p class="sub"><b>The ending:</b> ${esc(d.ending)}</p>` : ''}${d.who_likes_it ? `<p class="sub"><b>Who likes it:</b> ${esc(d.who_likes_it)}</p>` : ''}
      <p class="meta">Made ${esc(day(s.at))} from ${s.n_reviews} checked reviews. AI can make mistakes.</p>` : `<p class="sub">${nReviews >= 5 ? 'Get a short summary of the main themes in checked reviews.' : `A summary needs at least 5 checked public reviews (now ${nReviews}).`}</p>`}
    ${nReviews >= 5 ? `<button class="btn sm noprint" id="mksum">${d ? 'Refresh summary' : 'Make AI summary'}</button>` : ''}`;
  const btn = $('#mksum', el); if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'Reading reviews…';
    try {
      const { data } = await cloud.sb.auth.getSession();
      const r = await fetch('/api/studio-summary', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data?.session?.access_token }, body: JSON.stringify({ studio: sid, title: key }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not make the summary.');
      drawSummary(el, sid, key, j.summary, nReviews); toast(j.cached ? 'This summary is up to date.' : 'Summary ready!');
    } catch (e) { toast(e.message, 'sad'); btn.disabled = false; btn.textContent = d ? 'Refresh summary' : 'Make AI summary'; }
  };
}
function downloadCsv(name, I, ts) {
  const rows = [['section', 'item', 'value', 'extra']], add = (...r) => rows.push(r);
  const Q = I.quality, J = I.journey, H = I.hype;
  add('title', 'name', name, I.title_key);
  add('quality', 'score', Q.score, ''); add('quality', 'ratings used', Q.used, `of ${Q.all}`); add('quality', 'held', Q.held, '');
  add('quality', 'new or unconfirmed', Q.new_or_unconfirmed, ''); add('quality', 'flagged or paused', Q.flagged_or_paused, '');
  add('quality', 'reviews ai-checked', Q.reviews_ai_checked, `of ${Q.reviews}`);
  if (J.enough) {
    ['start', 'middle', 'end', 'overall'].forEach(k => add('journey', k, J[k], ''));
    add('journey', 'lost interest in middle %', J.lost_middle_pct, ''); add('journey', 'lost interest at ending %', J.lost_end_pct, '');
    J.stars.forEach((c, i) => add('stars', `${i + 1} star`, c, ''));
  } else add('journey', 'ratings', J.n, 'not enough (need 5)');
  I.weeks.forEach(w => add('week', w.week, w.avg, `${w.n} ratings`));
  I.tags.forEach(x => add('tag', x.tag, x.n, ''));
  I.ages.forEach(x => add('age', x.range, x.hidden ? 'hidden (<' + I.k + ')' : x.n, x.hidden ? '' : x.avg));
  I.regions.forEach(x => add('region', regionName(x.region), x.hidden ? 'hidden (<' + I.k + ')' : x.n, x.hidden ? '' : x.avg));
  add('hype', 'watchlist', H.watchlist, ''); add('hype', 'friend recs 30 days', H.recs_30d, '');
  Object.entries(H.trailer || {}).forEach(([k, v]) => add('trailer reaction', k, v, ''));
  H.watch_weeks.forEach(w => add('watchlist adds', w.week, w.n, ''));
  I.compare.forEach(c => add('compare', ts[c.title_key]?.name || c.title_key, c.overall, `${c.n} ratings; start ${c.start} middle ${c.middle} end ${c.end}`));
  add('compare', 'Heartbeat average', I.average.overall, `${I.average.n} ratings`);
  const cell = v => { const s = String(v ?? ''); return /[",\n]|^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob(['﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `heartbeat-${name.replace(/[^\w]+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  toast('CSV downloaded');
}

/* ---------- Hype ---------- */
async function hype(box, sid) {
  const h = await rpc('studio_hype', { p_studio: sid });
  const ts = await names([...h.top.map(x => x.title_key), ...h.mine.map(x => x.title_key)]);
  const row = x => `<div class="sthrank"><span class="stpos">${x.pos ? '#' + x.pos : '–'}</span><span class="sthn"><b>${esc(ts[x.title_key]?.name || x.title_key)}</b>
    <span class="meta"><i class="i i-bookmark" aria-hidden="true"></i> ${x.adds} adds · <i class="i i-flame" aria-hidden="true"></i> ${x.fire} · <i class="i i-heart" aria-hidden="true"></i> ${x.love}</span></span><span class="stbv">${x.score}</span></div>`;
  box.innerHTML = `<section class="card"><h2 class="h3"><i class="i i-star" aria-hidden="true"></i> Your titles</h2>${h.mine.length ? h.mine.map(row).join('') : '<p class="sub">Add titles to see where they rank.</p>'}</section>
    <section class="card"><h2 class="h3"><i class="i i-flame" aria-hidden="true"></i> Most anticipated on Heartbeat</h2><p class="sub">Last 30 days. Score = watchlist adds + 2 × <i class="i i-flame" aria-hidden="true"></i> + <i class="i i-heart" aria-hidden="true"></i> − <i class="i i-thumbs-down" aria-hidden="true"></i> trailer reactions, from trusted members.</p>
      ${h.top.length ? h.top.map(row).join('') : '<p class="sub">No hype yet.</p>'}</section>`;
}

/* ---------- Panels ---------- */
async function panels(box, sid, home) {
  const [P, ts] = await Promise.all([rpc('studio_panels', { p_studio: sid }), names(home.titles.map(t => t.title_key))]);
  box.innerHTML = `<section class="card"><div class="revtop"><h2 class="h3"><i class="i i-ticket" aria-hidden="true"></i> Early Screener Panels</h2><button class="btn sm" id="newp" ${home.titles.length ? '' : 'disabled'}><i class="i i-plus" aria-hidden="true"></i> New panel</button></div>
    <p class="sub">Ask top critics about a trailer or an early cut. Only critics who said yes to panels are invited. Answers come without names, and show after 3 people finish.</p>
    ${P.length ? P.map(p => `<button type="button" class="stpanel" data-p="${p.id}"><b>${esc(p.name)}</b><span class="meta">${esc(ts[p.title_key]?.name || p.title_key)} · ${p.kind === 'early_cut' ? 'Early cut' : 'Trailer'} · ${p.status === 'open' ? `open until ${esc(day(p.closes_at))}` : 'closed'}</span>
      <span class="meta">${p.invited} invited · ${p.accepted} said yes · <b>${p.done} answered</b></span></button>`).join('') : '<p class="sub">No panels yet.</p>'}</section><div id="pres"></div>`;
  $$('[data-p]', box).forEach(b => b.onclick = () => panelResults($('#pres', box), sid, +b.dataset.p, ts, () => panels(box, sid, home)));
  const nb = $('#newp', box); if (nb) nb.onclick = () => newPanel(sid, home, ts, () => panels(box, sid, home));
}
async function panelResults(el, sid, pid, ts, reload) {
  el.innerHTML = '<div class="card"><div class="rskel"></div></div>';
  const R = await rpc('studio_panel_results', { p_studio: sid, p_panel: pid });
  el.innerHTML = `<section class="card"><h2 class="h3">${esc(R.name)} <span class="meta">· ${esc(ts[R.title_key]?.name || '')}</span></h2>
    <p class="sub">${R.done} ${R.done === 1 ? 'critic' : 'critics'} answered.</p>
    ${R.questions.map((q, i) => `<div class="stqa"><b>${i + 1}. ${esc(q.q)}</b>${q.type === 'stars' ? `<div class="stbig"><i class="i i-star" aria-hidden="true"></i> ${R.averages?.[i] != null ? num(R.averages[i]) : '–'} <span class="meta">average</span></div>` : ''}
      ${R.done >= R.min ? `<ul class="stul">${R.answers.map(a => `<li><span class="meta">${esc(a.label)} (${esc(a.rank)}):</span> ${q.type === 'stars' ? '<i class="i i-star" aria-hidden="true"></i>'.repeat(+a.answers[i] || 0) : esc(a.answers[i])}</li>`).join('')}</ul>` : ''}</div>`).join('')}
    ${R.done < R.min ? `<p class="meta">Single answers show after ${R.min} critics finish, so nobody can be recognized.</p>` : ''}
    <button class="btn sm ghost" id="pclose">Close this panel</button></section>`;
  $('#pclose', el).onclick = async () => { try { await rpc('studio_close_panel', { p_studio: sid, p_panel: pid }); toast('Panel closed.'); reload(); } catch (e) { toast(plain(e), 'sad'); } };
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function newPanel(sid, home, ts, after) {
  const qRow = (q = '', type = 'text') => `<div class="stqrow2"><input class="pq" maxlength="200" value="${esc(q)}" placeholder="Your question" aria-label="Question"><select class="pt" aria-label="Answer type"><option value="text" ${type === 'text' ? 'selected' : ''}>Words</option><option value="stars" ${type === 'stars' ? 'selected' : ''}>1–5 stars</option></select></div>`;
  const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 8px"><i class="i i-ticket" aria-hidden="true"></i> New screener panel</h2>
    <label class="fld"><span>Title</span><select id="pt">${home.titles.map(t => `<option value="${esc(t.title_key)}">${esc(ts[t.title_key]?.name || t.title_key)}</option>`).join('')}</select></label>
    <label class="fld"><span>Panel name</span><input id="pn" maxlength="80" placeholder="Teaser A"></label>
    <label class="fld"><span>What are they watching?</span><select id="pk"><option value="trailer">A trailer</option><option value="early_cut">An early cut</option></select></label>
    <label class="fld"><span>Video link (YouTube or Vimeo, can be unlisted)</span><input id="pv" maxlength="300" placeholder="https://www.youtube.com/watch?v=…"></label>
    <label class="fld"><span>Short note for critics (optional)</span><textarea id="pi" rows="2" maxlength="500"></textarea></label>
    <div class="sub" style="font-weight:800">Questions (up to 6)</div><div id="pqs">${qRow('How excited are you to watch this?', 'stars')}${qRow('What stood out to you?')}</div>
    <button type="button" class="see linkbtn" id="addq"><i class="i i-plus" aria-hidden="true"></i> Add a question</button>
    <div class="stgrid3"><label class="fld"><span>Critics</span><input id="ps" type="number" min="1" max="50" value="20"></label>
      <label class="fld"><span>Lowest rank</span><select id="pr">${RANKS.map(r => `<option>${r}</option>`).join('')}</select></label>
      <label class="fld"><span>Open for (days)</span><input id="pd" type="number" min="1" max="30" value="7"></label></div>
    <p class="errmsg" id="perr" role="alert" hidden></p>
    <button class="btn big" id="pgo">Start panel</button>`);
  $('#addq', sh).onclick = () => { if ($$('.stqrow2', sh).length < 6) $('#pqs', sh).insertAdjacentHTML('beforeend', qRow()); };
  $('#pgo', sh).onclick = async () => {
    const b = $('#pgo', sh); b.disabled = true;
    const p = { title_key: $('#pt', sh).value, name: $('#pn', sh).value.trim(), kind: $('#pk', sh).value, video_url: $('#pv', sh).value.trim(), intro: $('#pi', sh).value.trim(),
      questions: $$('.stqrow2', sh).map(r => ({ q: $('.pq', r).value.trim(), type: $('.pt', r).value })).filter(x => x.q), seats: +$('#ps', sh).value, min_rank: $('#pr', sh).value, days: +$('#pd', sh).value };
    try { const r = await rpc('studio_create_panel', { p_studio: sid, p }); closeSheet(); toast(`Panel started! ${r.invited} critics invited.`); after(); }
    catch (e) { const er = $('#perr', sh); er.textContent = plain(e); er.hidden = false; b.disabled = false; }
  };
}

/* ---------- Team ---------- */
async function team(box, sid, home) {
  const owner = home.role === 'owner';
  box.innerHTML = `<section class="card"><h2 class="h3"><i class="i i-users" aria-hidden="true"></i> Team</h2>
    ${home.team.map(p => `<div class="stmember"><a href="${profileHref(p)}">${avatar(p, 'sm')} <b>${esc(p.display_name || p.username)}</b> <span class="meta">@${esc(p.username)}</span></a>
      <span class="pill2">${p.role}</span>${owner && p.role !== 'owner' ? `<button class="btn sm ghost" data-rm="${esc(p.username)}">Remove</button>` : ''}</div>`).join('')}
    ${owner ? `<form id="tm" class="stsearch" style="margin-top:10px"><input id="tmu" placeholder="Heartbeat username" aria-label="Username to add" autocomplete="off"><button class="btn sm">Add</button></form>
      <p class="meta">Teammates need a Heartbeat account (18+) and 2-step sign-in. Up to 10 people.</p>` : ''}</section>
    <section class="card"><h2 class="h3"><i class="i i-file-text" aria-hidden="true"></i> Plan</h2><p class="sub">${esc(home.plan[0].toUpperCase() + home.plan.slice(1))} · up to ${home.title_limit} titles.</p>
      <p class="sub">Want more titles or custom reports? <a class="see" href="#/studios">Talk to our sales team</a>.</p></section>`;
  const f = $('#tm', box);
  if (f) f.onsubmit = async e => { e.preventDefault(); try { await rpc('studio_member', { p_studio: sid, p_username: $('#tmu', box).value.trim(), p_on: true }); toast('Added!'); renderStudio($('#app'), sid, 'team'); } catch (x) { toast(plain(x), 'sad'); } };
  $$('[data-rm]', box).forEach(b => b.onclick = async () => { try { await rpc('studio_member', { p_studio: sid, p_username: b.dataset.rm, p_on: false }); renderStudio($('#app'), sid, 'team'); } catch (x) { toast(plain(x), 'sad'); } });
}

/* =====================================================================
   #/screeners — invites for critics
   ===================================================================== */
export async function renderScreeners(app) {
  document.title = 'Screener panels — Heartbeat';
  app.innerHTML = `<div class="screen"><header class="top"><a class="icon-btn" href="#/me" aria-label="Back"><i class="i i-arrow-left" aria-hidden="true"></i></a><h1 class="logo" style="font-size:24px;margin:0"><i class="i i-ticket" aria-hidden="true"></i> Screener panels</h1><span></span></header><div id="scb"><div class="card"><div class="rskel"></div></div></div></div>`;
  const box = $('#scb', app);
  if (!cloud.user) { box.innerHTML = `<div class="card">${empty('Sign in to see screener invites.', 'happy', '<a class="btn" href="#/signin">Sign in</a>')}</div>`; return; }
  const [L, pv] = await Promise.all([rpc('my_screeners').catch(() => []), rpc('my_privacy').catch(() => ({}))]);
  const ts = await names(L.map(x => x.title_key));
  box.innerHTML = `<section class="card"><p class="sub">Studios ask top critics to watch trailers or early cuts and share what they think. Your answers go to the studio <b>without your name</b>. You get <b>+50 XP</b> for each panel you finish.</p>
      ${pv.panels_opt_in ? '<p class="okmsg"><i class="i i-check" aria-hidden="true"></i> You can get panel invites.</p>' : `<p class="sub">${pv.panel_ready ? 'You are not getting invites right now.' : 'Invites go to members ranked Critic or higher (18+, confirmed email).'} <a class="see" href="#/security">Change in Security</a></p>`}
      <p class="meta">Work at a studio? <a class="see" href="#/studios">Heartbeat for Studios →</a></p></section>
    ${L.length ? L.map(x => scCard(x, ts[x.title_key])).join('') : `<div class="card">${empty('No invites yet. Keep writing great reviews!', 'happy')}</div>`}`;
  $$('[data-yes]', box).forEach(b => b.onclick = async () => {
    try { await rpc('respond_screener', { p_panel: +b.dataset.yes, p_yes: b.dataset.v === '1' }); renderScreeners(app); } catch (e) { toast(plain(e), 'sad'); }
  });
  $$('form[data-sub]', box).forEach(f => f.onsubmit = async e => {
    e.preventDefault(); const pid = +f.dataset.sub, x = L.find(y => y.panel === pid);
    const ans = x.questions.map((q, i) => q.type === 'stars' ? +(f.querySelector(`input[name="q${i}"]:checked`)?.value || 0) : f.querySelector(`[name="q${i}"]`).value.trim());
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try { const r = await rpc('submit_screener', { p_panel: pid, p_answers: ans }); confetti(60); toast(`Thanks! +${r.xp} XP`); renderScreeners(app); }
    catch (er) { const m = f.querySelector('.errmsg'); m.textContent = plain(er); m.hidden = false; btn.disabled = false; }
  });
}
function scCard(x, t) {
  const head = `<h2 class="h3">${esc(x.name)}</h2><div class="meta">${esc(x.studio)} · ${esc(t?.name || x.title_key)} · ${x.kind === 'early_cut' ? 'Early cut' : 'Trailer'} · until ${esc(day(x.closes_at))}</div>
    ${x.intro ? `<p class="sub">${esc(x.intro)}</p>` : ''}`;
  if (x.status === 'done') return `<section class="card">${head}<p class="okmsg"><i class="i i-check" aria-hidden="true"></i> You answered. Thank you!</p></section>`;
  if (!x.open) return `<section class="card">${head}<p class="sub">This panel is closed.</p></section>`;
  if (x.status === 'invited') return `<section class="card">${head}<p class="sub">Want to join? You'll watch the video and answer ${x.questions.length} short ${x.questions.length === 1 ? 'question' : 'questions'}.</p>
    <div class="aibtns"><button class="btn" data-yes="${x.panel}" data-v="1">Yes, I'm in</button><button class="btn ghost" data-yes="${x.panel}" data-v="0">No thanks</button></div></section>`;
  const src = embedUrl(x.video_url);
  return `<section class="card">${head}
    ${src ? `<div class="trvid"><iframe src="${esc(src)}" title="${esc(x.name)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>` : ''}
    <p class="meta">Please don't share this video. It's only for this panel.</p>
    <form data-sub="${x.panel}" novalidate>${x.questions.map((q, i) => `<fieldset class="stqa"><legend><b>${i + 1}. ${esc(q.q)}</b></legend>
      ${q.type === 'stars' ? `<div class="ststars">${[1, 2, 3, 4, 5].map(v => `<label><input type="radio" name="q${i}" value="${v}"><span>${'<i class="i i-star" aria-hidden="true"></i>'.repeat(v)}</span></label>`).join('')}</div>`
        : `<textarea name="q${i}" rows="3" maxlength="1000" aria-label="${esc(q.q)}"></textarea>`}</fieldset>`).join('')}
      <p class="errmsg" role="alert" hidden></p><button class="btn big" type="submit">Send my answers</button></form></section>`;
}
