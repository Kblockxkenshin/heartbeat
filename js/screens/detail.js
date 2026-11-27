import { sendTitleToChat } from './chat.js';
import { recommendSheet } from './recs.js';
import { BYID, TITLES, TAGS, TAGC, VIBEE, WORTH, BESTE } from '../data.js';
import { U, save, rate, forYou, toggleSave } from '../store.js';
import { $, $$, esc, poster, card, backdropUrl, hydratePosters, sheet, closeSheet, hearts, celebrate, toast, empty, fmtRuntime, buzz } from '../ui.js';
import { journey, heartbeatSVG, beat, argmax } from '../journey.js';
import { rerender, closeDetail } from '../app.js';
import { cloud, keyOf } from '../cloud.js';
import { reviewsSectionHTML, loadReviews, openEditor, promptReview, setReviewsChanged } from './reviews.js';

const sel = {};
const TAGE = { 'Boring': '<i class="i i-moon" aria-hidden="true"></i>', 'Amazing': '<i class="i i-flame" aria-hidden="true"></i>', 'Funny': '<i class="i i-drama" aria-hidden="true"></i>', 'Scary': '<i class="i i-ghost" aria-hidden="true"></i>', 'Sad': '<i class="i i-cloud-rain" aria-hidden="true"></i>', 'Plot twist': '<i class="i i-brain" aria-hidden="true"></i>' };

/** Titles that share genres, best first. */
export function similar(t, n = 6) {
  return TITLES.filter(x => x.id !== t.id).map(x => ({ x, s: x.genres.filter(g => t.genres.includes(g)).length * 10 + x.hype[1] }))
    .filter(o => o.s >= 10).sort((a, b) => b.s - a.s).slice(0, n).map(o => o.x);
}

export function renderDetail(el, id, { modal = false } = {}) {
  const t = BYID[id];
  if (!t) { el.innerHTML = empty('Hmm, I can\'t find that one. <a class="see" href="#/">Go home</a>', 'sad'); return; }
  document.title = `Is ${t.name} worth watching? Where it gets good — Heartbeat`;
  const J = journey(t), n = J.tl.length, k = t.id;
  const s = sel[k] ?? argmax(J.pts.map(p => beat(p.tags)));
  const gIdx = argmax(J.gotGood), gPct = Math.round(J.gotGood[gIdx] / J.gotGood.reduce((a, b) => a + b, 0) * 100);
  const qIdx = argmax(J.quits), qMax = Math.max(...J.quits, 1);
  const [pred, real] = t.hype, gap = Math.round((real - pred) / pred * 100);
  const mine = U.ratings[k], fy = forYou(t);
  const p = J.pts[s], tot = Object.values(p.tags).reduce((a, b) => a + b, 0) || 1, mxT = Math.max(...Object.values(p.tags), 1);
  const vibes = Object.entries(t.vibes).sort((a, b) => b[1] - a[1]);
  const wi = argmax(t.worth), bd = backdropUrl(t), sim = similar(t);
  const len = t.type === 'tv' ? `${(t.seasons || []).length} season${(t.seasons || []).length > 1 ? 's' : ''}` : fmtRuntime(t.runtime);

  el.innerHTML = `<article class="detail ${modal ? 'in-modal' : 'screen sheetin'}" id="detail" aria-labelledby="dtitle">
  <div class="hero">
    <div class="bd" style="background:${bd ? `url('${esc(bd)}') center 20%/cover,` : ''}#121212" role="img" aria-label="${esc(t.name)} backdrop"></div>
    <span class="grab" aria-hidden="true"></span>
    <div class="hero-bar">
      <button class="icon-btn" id="back" aria-label="${modal ? 'Close' : 'Back'}">${modal ? '<i class="i i-x" aria-hidden="true"></i>' : '<i class="i i-arrow-left" aria-hidden="true"></i>'}</button>
      <div style="display:flex;gap:8px">
        <button class="icon-btn" id="share" aria-label="Share ${esc(t.name)}"><i class="i i-share" aria-hidden="true"></i></button>
        ${cloud.ready ? `<button class="icon-btn" id="sendchat" aria-label="Send ${esc(t.name)} to a friend"><i class="i i-message-circle" aria-hidden="true"></i></button>` : ''}
        <button class="icon-btn" id="wl" aria-label="${U.watchlist[k] ? 'Remove from' : 'Add to'} watchlist">${U.watchlist[k] ? '<i class="i i-bookmark-check" aria-hidden="true"></i>' : '<i class="i i-bookmark" aria-hidden="true"></i>'}</button>
      </div>
    </div>
  </div>
  <div class="dhead">${poster(t, { mine: false })}
    <div><h1 id="dtitle">${esc(t.name)}</h1><div class="meta">${esc(t.year)} · ${t.type === 'tv' ? 'Series' : 'Movie'}${len ? ' · ' + len : ''}</div><div class="meta">${esc(t.genres.join(' · '))}</div>
    <button class="btn big rate-main" id="rateBtn">${mine ? `★ ${mine.overall} · Edit my rating` : 'Rate it'} <kbd class="kbd">R</kbd></button>
    ${t.type === 'movie' && t.tmdb ? `<a class="btn ghost writebtn bolink" href="#/boxoffice/tmdb-${t.tmdb}"><i class="i i-chart-line" aria-hidden="true"></i> Box office &amp; details</a>` : ''}
    <div id="trbox" class="trbox"></div>
    ${cloud.ready ? `<div class="dbtns"><button class="btn ghost writebtn" id="writeBtn"><i class="i i-pen-line" aria-hidden="true"></i> Write a review</button><button class="btn ghost writebtn" id="recBtn" aria-label="Recommend to friends"><i class="i i-gift" aria-hidden="true"></i> Recommend</button></div><div id="hbfans" class="hbfans" aria-live="polite"></div>` : ''}</div>
  </div>
  <div class="dgrid"><div class="dmain">
  <p class="overview">${esc(t.overview)}</p>
  ${t.live ? `<div class="card note"><span class="sub">This title comes straight from TMDB. Its journey numbers are demo data until people rate it.</span></div>` : ''}

  <div class="dcards">
  <section class="card"><h2 class="h3"><i class="i i-compass" aria-hidden="true"></i> The journey</h2><div class="sub">How everyone rated each part (out of 5 hearts).</div>
    <div class="stat3" style="margin-top:12px">
      ${['Start', 'Middle', 'Ending'].map((l, i) => `<div><span>${l}</span><b>${t.journey[i].toFixed(1)}</b><span>${mine ? 'you: ' + [mine.start, mine.middle, mine.end][i] : '&nbsp;'}</span></div>`).join('')}
    </div>
    ${fy ? `<div class="journey-sum" style="margin-top:12px"><span><i class="i i-target" aria-hidden="true"></i></span><span>Your Score: <b style="color:var(--mint)"><i class="i i-star" aria-hidden="true"></i> ${fy.score}</b> — from ${fy.n} people with taste like yours</span></div>` : ''}
  </section>

  <section class="card"><h2 class="h3"><i class="i i-fast-forward" aria-hidden="true"></i> It gets good at</h2>
    <div class="bigline">${esc(J.tl[gIdx].l.replace(/^./, c => c.toUpperCase()))}</div>
    <div class="sub" style="margin:4px 0 10px">${gPct}% of people said so.</div>
    <div class="chips" role="group" aria-label="When did it get good for you?">${J.tl.map((x, i) => `<button class="chip ${U.gotGood[k] === i ? 'on' : ''}" aria-pressed="${U.gotGood[k] === i}" data-gg="${i}">${x.s}</button>`).join('')}</div>
  </section>

  <section class="card span2"><h2 class="h3"><i class="i i-heart-pulse" aria-hidden="true"></i> Heartbeat</h2><div class="sub">How people felt from start to end. Tap a point.</div>
    <div id="hb" style="margin-top:6px">${heartbeatSVG(t, J, s)}</div>
    <div class="ptpanel">
      <div style="display:flex;justify-content:space-between;font-weight:900"><span>${esc(J.tl[s].l.replace(/^./, c => c.toUpperCase()))}</span><span class="meta">${tot} reactions</span></div>
      ${TAGS.slice().sort((a, b) => p.tags[b] - p.tags[a]).slice(0, 4).map(g => `<div class="hvr" style="grid-template-columns:110px 1fr 40px;margin:6px 0"><span>${g}</span><div class="track" style="height:10px"><i style="width:${p.tags[g] / mxT * 100}%;background:${TAGC[g]}"></i></div><span class="meta">${Math.round(p.tags[g] / tot * 100)}%</span></div>`).join('')}
      <div class="sub" style="margin:10px 0 8px">How did you feel here?</div>
      <div class="chips">${TAGS.map(g => { const on = U.tags.some(x => x.k === k && x.i === s && x.tag === g); return `<button class="chip ${on ? 'on' : ''}" aria-pressed="${on}" data-tag="${g}">${TAGE[g]} ${g}</button>`; }).join('')}</div>
    </div>
  </section>

  <section class="card"><h2 class="h3"><i class="i i-door-open" aria-hidden="true"></i> Where people quit</h2><div class="sub">Most who gave up stopped at <b>${esc(J.tl[qIdx].l)}</b>.</div>
    <div class="bars" role="img" aria-label="Quit chart. Peak at ${esc(J.tl[qIdx].l)}">${J.quits.map((v, i) => `<i class="${i === qIdx ? 'hot' : ''}" style="height:${Math.max(4, v / qMax * 100)}%"></i>`).join('')}</div>
    <div class="lbls" aria-hidden="true">${J.tl.map((x, i) => `<span>${n > 10 && i % 2 ? '' : x.s}</span>`).join('')}</div>
    <div class="sub" style="margin:12px 0 8px">I stopped at…</div>
    <div class="chips">${J.tl.map((x, i) => `<button class="chip ${U.quit[k] === i ? 'on' : ''}" aria-pressed="${U.quit[k] === i}" data-quit="${i}">${x.s}</button>`).join('')}</div>
  </section>

  <section class="card"><h2 class="h3"><i class="i i-trending-down" aria-hidden="true"></i> Hype vs Reality</h2>
    <div class="bigline ${gap < 0 ? 'warm' : 'cool'}">${gap < 0 ? `Overhyped by ${-gap}%` : gap > 0 ? `Underrated by ${gap}%` : 'Lives up to the hype'}</div>
    <div class="hvr"><span>Expected</span><div class="track"><i style="width:${pred * 10}%;background:var(--purple)"></i></div><b>${pred}</b></div>
    <div class="hvr"><span>Actual</span><div class="track"><i style="width:${real * 10}%;background:${gap < 0 ? 'var(--pink)' : 'var(--mint)'}"></i></div><b>${real}</b></div>
  </section>

  <section class="vibe" aria-label="Vibe card">
      <div style="font-size:12px;font-weight:900;letter-spacing:2px;opacity:.9">VIBE CARD</div>
      <div style="font-size:22px;font-weight:900;margin:2px 0 8px">${esc(t.name)}</div>
      ${vibes.map(([v, x]) => `<div class="vrow"><span style="width:140px">${VIBEE[v] || ''} ${esc(v)}</span><div class="track"><i style="width:${Math.round(x * 100)}%"></i></div><span style="width:40px;text-align:right">${Math.round(x * 100)}%</span></div>`).join('')}
      <div class="stat3" style="grid-template-columns:1fr 1fr;margin-top:12px">
        <div style="background:rgba(0,0,0,.3)"><span style="color:#fff">Worth it?</span><b style="font-size:18px">${WORTH[wi]}</b></div>
        <div style="background:rgba(0,0,0,.3)"><span style="color:#fff">Best for</span><b style="font-size:18px">${BESTE[t.best]} ${esc(t.best)}</b></div>
      </div>
  </section>

  ${reviewsSectionHTML(t)}

  <a class="card linkcard" href="#/feed/${esc(k)}">
    <span style="font-size:34px" aria-hidden="true"><i class="i i-clapperboard" aria-hidden="true"></i></span>
    <div style="flex:1"><h2 class="h3">Video reviews</h2><div class="sub">Short TikToks, Shorts and Reels. Spoilers stay locked.</div></div>
    <span class="btn sm" aria-hidden="true">Watch</span>
  </a>
  </div></div>
  ${sim.length ? `<aside class="dside" aria-label="Similar titles"><h2 class="h3" style="margin:0 0 10px"><i class="i i-sparkles" aria-hidden="true"></i> Similar titles</h2>
    <div class="simlist">${sim.map(x => card(x, { sub: `${x.year} · ${x.genres[0]}` })).join('')}</div></aside>` : ''}
  </div>
  </article>`;
  hydratePosters(el);
  wire(el, t, k, s, modal);
}

function wire(el, t, k, s, modal) {
  $('#back', el).onclick = () => closeDetail();
  $('#rateBtn', el).onclick = () => openRate(t);
  const wb = $('#writeBtn', el); if (wb) wb.onclick = () => openEditor(t);
  const sc = $('#sendchat', el); if (sc) sc.onclick = () => sendTitleToChat(t);
  const rb = $('#recBtn', el); if (rb) rb.onclick = () => recommendSheet(t);
  fillFans(el, t);
  fillTrailer(el, t);
  setReviewsChanged(() => rerender());
  loadReviews(el, t);
  $('#wl', el).onclick = e => { const r = toggleSave(k); buzz(); if (r.saved) { const b = e.currentTarget.getBoundingClientRect(); hearts(b.x + 23, b.y + 23, 8); toast('Saved to your watchlist'); } celebrate(r); rerender(); };
  $('#share', el).onclick = async () => {
    const url = location.href.split('#')[0] + '#/t/' + k, text = `Is ${t.name} worth watching? See where it gets good`;
    try { if (navigator.share) { await navigator.share({ title: 'Heartbeat', text, url }); return; } await navigator.clipboard.writeText(url); toast('Link copied!'); }
    catch (e) { toast('Copy this link: ' + url); }
  };
  $('#hb', el).onclick = e => { const r = e.target.closest('[data-pt]'); if (r) { sel[k] = +r.dataset.pt; rerender(); } };
  $$('[data-tag]', el).forEach(b => b.onclick = () => { const tag = b.dataset.tag, ix = U.tags.findIndex(x => x.k === k && x.i === s && x.tag === tag); if (ix >= 0) U.tags.splice(ix, 1); else U.tags.push({ k, i: s, tag }); save(); buzz(8); rerender(); });
  $$('[data-gg]', el).forEach(b => b.onclick = () => { const i = +b.dataset.gg; if (U.gotGood[k] === i) delete U.gotGood[k]; else U.gotGood[k] = i; save(); buzz(8); rerender(); });
  $$('[data-quit]', el).forEach(b => b.onclick = () => { const i = +b.dataset.quit; if (U.quit[k] === i) delete U.quit[k]; else U.quit[k] = i; save(); buzz(8); rerender(); });
  if (modal) return;
  // Phone: swipe down from the top of the page to close.
  let y0 = null; const d = $('#detail', el);
  d.addEventListener('touchstart', e => { y0 = scrollY <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  d.addEventListener('touchmove', e => { if (y0 == null) return; const dy = e.touches[0].clientY - y0; if (dy > 0) d.style.transform = `translateY(${Math.min(dy, 220) / 2}px)`; }, { passive: true });
  d.addEventListener('touchend', e => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null; d.style.transform = ''; if (dy > 140) closeDetail(); });
}

/* ---------- the 5-second journey rating ---------- */
export function openRate(t, onDone) {
  const cur = U.ratings[t.id] ? { ...U.ratings[t.id] } : { start: 0, middle: 0, end: 0 };
  const rows = [['start', 'Start', 'the first part'], ['middle', 'Middle', 'the long stretch'], ['end', 'Ending', 'how it lands']];
  const draw = () => `
    <h2 class="h3" style="font-size:22px;margin:0">How was the ride?</h2><div class="sub">${esc(t.name)} · tap hearts for each part</div>
    ${rows.map(([key, lab, hint]) => `<div class="jrow"><div class="lab">${lab}<small>${hint}</small></div>
      <div class="hearts" role="radiogroup" aria-label="${lab} rating">${[1, 2, 3, 4, 5].map(v => `<button role="radio" aria-checked="${cur[key] === v}" aria-label="${lab}: ${v} heart${v > 1 ? 's' : ''}" class="${cur[key] >= v ? 'on' : ''}" data-k="${key}" data-v="${v}"><i class="i i-heart" aria-hidden="true"></i></button>`).join('')}</div></div>`).join('')}
    <button class="btn big" id="saveRate" ${cur.end ? '' : 'disabled'}>${cur.end ? `Save · ★ ${Math.round(((cur.start + cur.middle + cur.end * 2) / 4) * 2) / 2}` : 'Tap some hearts'}</button>
    <div class="sub kb-only" style="text-align:center;margin-top:8px">Tip: press 1–5 to rate the ending, Enter to save.</div>`;
  const sh = sheet('<div id="rs"></div>', onDone);
  const box = $('#rs', sh);
  const paint = () => { box.innerHTML = draw(); };
  paint();
  const set = (key, v, from) => {
    // Smart fill: the first tap fills the other parts too, so one tap + Save works.
    if (!cur.start && !cur.middle && !cur.end) rows.forEach(([kk]) => cur[kk] = v);
    cur[key] = v; paint(); buzz(10);
    if (from) hearts(from.x + from.width / 2, from.y + from.height / 2, 5);
    box.querySelector(`[data-k="${key}"][data-v="${v}"]`)?.focus();
  };
  const doSave = () => {
    if (!cur.end) return;
    const btn = $('#saveRate', box), r = btn.getBoundingClientRect(), res = rate(t.id, cur);
    hearts(r.x + r.width / 2, r.y, 14); buzz([15, 30, 15]);
    closeSheet();
    if (!(res.newBadges?.length || res.streakUp)) toast(`Saved! ★ ${U.ratings[t.id].overall} for ${t.name}`);
    celebrate(res);
    if (!onDone) rerender();
    promptReview(t);
  };
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-k]');
    if (b) return set(b.dataset.k, +b.dataset.v, b.getBoundingClientRect());
    if (e.target.closest('#saveRate')) doSave();
  });
  sh.addEventListener('keydown', e => {
    if (/^[1-5]$/.test(e.key)) { e.preventDefault(); set('end', +e.key); }
    else if (e.key === 'Enter' && cur.end) { e.preventDefault(); doSave(); }
  });
}

/* Trailer (from TMDB) + quick reactions. Reactions help studios see the hype (counted, never named). */
const RX = [['fire', '<i class="i i-flame" aria-hidden="true"></i>', "Can't wait"], ['love', '<i class="i i-heart" aria-hidden="true"></i>', 'Love it'], ['meh', '<i class="i i-circle-question-mark" aria-hidden="true"></i>', 'Not sure'], ['nope', '<i class="i i-thumbs-down" aria-hidden="true"></i>', 'Not for me']];
async function fillTrailer(el, t) {
  const box = $('#trbox', el), k = keyOf(t.id);
  if (!box || !k) return;
  const [type, id] = k.split(':');
  const d = await fetch(`/api/tmdb?type=${type}&id=${id}`).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!box.isConnected || !d) return;
  const soon = d.release_date && new Date(d.release_date + 'T12:00') > new Date();
  box.innerHTML = `${soon ? `<span class="pill2 soonpill"><i class="i i-calendar" aria-hidden="true"></i> Coming ${esc(new Date(d.release_date + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))}</span>` : ''}
    ${d.trailer ? `<button class="btn ghost trbtn" id="trBtn"><i class="i i-play" aria-hidden="true"></i> Watch the trailer</button>` : ''}`;
  if (d.trailer) $('#trBtn', box).onclick = () => openTrailer(t, k, d.trailer);
}
async function openTrailer(t, k, yt) {
  const sh = sheet(`<h2 class="h3" style="font-size:20px;margin:0 0 10px"><i class="i i-play" aria-hidden="true"></i> ${esc(t.name)}</h2>
    <div class="trvid"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}?rel=0" title="${esc(t.name)} trailer" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>
    <div class="sub" style="margin:12px 0 6px;font-weight:800">How does it look?</div>
    <div class="trrx" id="trrx" role="group" aria-label="Your reaction">${RX.map(([kk, e, l]) => `<button type="button" class="chip" data-rx="${kk}" aria-pressed="false"><span aria-hidden="true">${e}</span> ${l} <b class="trn"></b></button>`).join('')}</div>`);
  const draw = c => { $$('[data-rx]', sh).forEach(b => { const on = c?.mine === b.dataset.rx; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.querySelector('.trn').textContent = c?.[b.dataset.rx] ? c[b.dataset.rx] : ''; }); };
  let cur = null;
  if (cloud.sb) cloud.sb.rpc('trailer_counts', { p_title: k }).then(({ data }) => { cur = data; draw(cur); }, () => {});
  $$('[data-rx]', sh).forEach(b => b.onclick = async () => {
    if (!cloud.user) { toast('Make a free account to react to trailers.'); return; }
    const kind = cur?.mine === b.dataset.rx ? null : b.dataset.rx;
    const { data, error } = await cloud.sb.rpc('react_trailer', { p_title: k, p_kind: kind });
    if (error) { toast(error.message, 'sad'); return; }
    cur = data; draw(cur); if (kind) buzz(8);
  });
}

/* Heartbeat members' score for this title (held ratings and banned accounts are left out on the server). */
async function fillFans(el, t) {
  const box = $('#hbfans', el), k = keyOf(t.id);
  if (!box || !cloud.sb || !k) return;
  const { data: d } = await cloud.sb.rpc('title_scores', { p_title: k }).then(x => x, () => ({}));
  if (!box.isConnected || !d || !d.n) return;
  box.innerHTML = `<span class="hbf1"><i class="i i-heart-pulse" aria-hidden="true"></i> Heartbeat fans <b><i class="i i-star" aria-hidden="true"></i> ${(+d.overall).toFixed(1)}</b> <span class="meta">from ${d.n} ${d.n === 1 ? 'rating' : 'ratings'}</span></span>
    <span class="meta">Start ${(+d.start).toFixed(1)} · Middle ${(+d.middle).toFixed(1)} · Ending ${(+d.end).toFixed(1)}</span>
    ${d.held ? `<span class="meta"><i class="i i-shield" aria-hidden="true"></i> ${d.held} new ${d.held === 1 ? 'rating is' : 'ratings are'} being checked before they count.</span>` : ''}`;
}
