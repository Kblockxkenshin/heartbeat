import { BYID, TAGS, TAGC, VIBEE, WORTH, BESTE } from '../data.js';
import { U, save, rate, forYou, toggleSave } from '../store.js';
import { $, $$, esc, poster, hydratePosters, sheet, closeSheet, hearts, celebrate, toast, empty, fmtRuntime, confetti } from '../ui.js';
import { journey, heartbeatSVG, beat, argmax } from '../journey.js';
import { rerender } from '../app.js';

const sel = {};
const H = n => '💖'.repeat(Math.round(n)) || '—';

export function renderDetail(app, id) {
  const t = BYID[id];
  if (!t) { app.innerHTML = empty('Hmm, I can\'t find that one. <a class="see" href="#/">Go home</a>', 'sad'); return; }
  document.title = `Is ${t.name} worth watching? Where it gets good — Heartbeat`;
  const J = journey(t), n = J.tl.length, k = t.id;
  const s = sel[k] ?? argmax(J.pts.map(p => beat(p.tags)));
  const gIdx = argmax(J.gotGood), gPct = Math.round(J.gotGood[gIdx] / J.gotGood.reduce((a, b) => a + b, 0) * 100);
  const qIdx = argmax(J.quits), qMax = Math.max(...J.quits, 1);
  const [pred, real] = t.hype, gap = Math.round((real - pred) / pred * 100);
  const mine = U.ratings[k], fy = forYou(t);
  const p = J.pts[s], tot = Object.values(p.tags).reduce((a, b) => a + b, 0) || 1, mxT = Math.max(...Object.values(p.tags), 1);
  const vibes = Object.entries(t.vibes).sort((a, b) => b[1] - a[1]);
  const wi = argmax(t.worth);
  const bd = t.backdrop || t.poster;
  const len = t.type === 'tv' ? `${(t.seasons || []).length} season${(t.seasons || []).length > 1 ? 's' : ''}` : fmtRuntime(t.runtime);

  app.innerHTML = `<div class="screen" id="detail">
  <div class="hero">
    <div class="bd" style="background:${bd ? `url('${esc(bd)}') center/cover,` : ''}linear-gradient(160deg,${t.colors[1]},${t.colors[0]})"></div>
    <span class="grab" aria-hidden="true"></span>
    <div class="hero-bar">
      <button class="icon-btn" id="back" aria-label="Back">←</button>
      <div style="display:flex;gap:8px">
        <button class="icon-btn" id="share" aria-label="Share">📤</button>
        <button class="icon-btn" id="wl" aria-label="${U.watchlist[k] ? 'Remove from' : 'Add to'} watchlist">${U.watchlist[k] ? '🔖' : '＋'}</button>
      </div>
    </div>
  </div>
  <div class="dhead">${poster(t, { mine: false })}
    <div><h1>${esc(t.name)}</h1><div class="meta">${t.year} · ${t.type === 'tv' ? 'Series' : 'Movie'}${len ? ' · ' + len : ''}</div><div class="meta">${esc(t.genres.join(' · '))}</div></div>
  </div>
  <div class="actions">
    <button class="btn big" id="rateBtn">${mine ? `★ ${mine.overall} · Edit my rating` : '💖 Rate it'}</button>
  </div>
  <p class="overview">${esc(t.overview)}</p>

  <div class="card"><h3>🧭 The journey</h3><div class="sub">How everyone rated each part (out of 5 hearts).</div>
    <div class="stat3" style="margin-top:12px">
      ${['Start', 'Middle', 'Ending'].map((l, i) => `<div><span>${l}</span><b>${t.journey[i].toFixed(1)}</b><span>${mine ? 'you: ' + [mine.start, mine.middle, mine.end][i] : '&nbsp;'}</span></div>`).join('')}
    </div>
    ${fy ? `<div class="journey-sum" style="margin-top:12px">🎯 <span>Your Score: <b style="color:var(--mint)">★ ${fy.score}</b> — from ${fy.n} people with taste like yours</span></div>` : ''}
  </div>

  <div class="card"><h3>💓 Heartbeat</h3><div class="sub">How people felt from start to end. Tap a point.</div>
    <div id="hb" style="margin-top:6px">${heartbeatSVG(t, J, s)}</div>
    <div style="background:var(--card2);border-radius:16px;padding:12px;margin-top:8px">
      <div style="display:flex;justify-content:space-between;font-weight:900"><span>${esc(J.tl[s].l.replace(/^./, c => c.toUpperCase()))}</span><span class="meta">${tot} reactions</span></div>
      ${TAGS.slice().sort((a, b) => p.tags[b] - p.tags[a]).slice(0, 4).map(g => `<div class="hvr" style="grid-template-columns:110px 1fr 40px;margin:6px 0"><span>${g}</span><div class="track" style="height:10px"><i style="width:${p.tags[g] / mxT * 100}%;background:${TAGC[g]}"></i></div><span class="meta">${Math.round(p.tags[g] / tot * 100)}%</span></div>`).join('')}
      <div class="sub" style="margin:10px 0 8px">How did you feel here?</div>
      <div class="chips">${TAGS.map(g => `<button class="chip ${U.tags.some(x => x.k === k && x.i === s && x.tag === g) ? 'on' : ''}" data-tag="${g}">${{ 'Boring': '😴', 'Amazing': '🔥', 'Funny': '😂', 'Scary': '😱', 'Sad': '😢', 'Plot twist': '🤯' }[g]} ${g}</button>`).join('')}</div>
    </div>
  </div>

  <div class="card"><h3>⏩ It gets good at</h3>
    <div class="bigline">${esc(J.tl[gIdx].l.replace(/^./, c => c.toUpperCase()))}</div>
    <div class="sub" style="margin:4px 0 10px">${gPct}% of people said so.</div>
    <div class="chips" role="group" aria-label="When did it get good for you?">${J.tl.map((x, i) => `<button class="chip ${U.gotGood[k] === i ? 'on' : ''}" data-gg="${i}">${x.s}</button>`).join('')}</div>
  </div>

  <div class="card"><h3>🚪 Where people quit</h3><div class="sub">Most who gave up stopped at <b>${esc(J.tl[qIdx].l)}</b>.</div>
    <div class="bars">${J.quits.map((v, i) => `<i class="${i === qIdx ? 'hot' : ''}" style="height:${Math.max(4, v / qMax * 100)}%" title="${J.tl[i].s}: ${v}"></i>`).join('')}</div>
    <div class="lbls">${J.tl.map((x, i) => `<span>${n > 10 && i % 2 ? '' : x.s}</span>`).join('')}</div>
    <div class="sub" style="margin:12px 0 8px">I stopped at…</div>
    <div class="chips">${J.tl.map((x, i) => `<button class="chip ${U.quit[k] === i ? 'on' : ''}" data-quit="${i}">${x.s}</button>`).join('')}</div>
  </div>

  <div class="card"><h3>🎈 Hype vs Reality</h3>
    <div class="bigline" style="${gap < 0 ? 'background:linear-gradient(90deg,#ff8a4c,#ff4f9a);-webkit-background-clip:text;background-clip:text' : 'background:linear-gradient(90deg,#4fe3b0,#62b8ff);-webkit-background-clip:text;background-clip:text'}">${gap < 0 ? `Overhyped by ${-gap}%` : gap > 0 ? `Underrated by ${gap}%` : 'Lives up to the hype'}</div>
    <div class="hvr"><span>Expected</span><div class="track"><i style="width:${pred * 10}%;background:var(--purple)"></i></div><b>${pred}</b></div>
    <div class="hvr"><span>Actual</span><div class="track"><i style="width:${real * 10}%;background:${gap < 0 ? 'var(--pink)' : 'var(--mint)'}"></i></div><b>${real}</b></div>
  </div>

  <div class="card" style="padding:0;border:0;background:none">
    <div class="vibe" style="background:linear-gradient(135deg,${t.colors[0]},${t.colors[1]} 65%,#9b6bff)">
      <div style="font-size:12px;font-weight:900;letter-spacing:2px;opacity:.85">VIBE CARD</div>
      <div style="font-size:22px;font-weight:900;margin:2px 0 8px">${esc(t.name)}</div>
      ${vibes.map(([v, x]) => `<div class="vrow"><span style="width:140px">${VIBEE[v]} ${v}</span><div class="track"><i style="width:${Math.round(x * 100)}%"></i></div><span style="width:40px;text-align:right">${Math.round(x * 100)}%</span></div>`).join('')}
      <div class="stat3" style="grid-template-columns:1fr 1fr;margin-top:12px">
        <div style="background:rgba(0,0,0,.28)"><span>Worth it?</span><b style="font-size:18px">${WORTH[wi]}</b></div>
        <div style="background:rgba(0,0,0,.28)"><span>Best for</span><b style="font-size:18px">${BESTE[t.best]} ${t.best}</b></div>
      </div>
    </div>
  </div>

  <a class="card" href="#/feed/${k}" style="display:flex;align-items:center;gap:14px">
    <span style="font-size:34px" aria-hidden="true">🎬</span>
    <div style="flex:1"><h3>Video reviews</h3><div class="sub">Short TikToks, Shorts and Reels. Spoilers stay locked.</div></div>
    <span class="btn sm" aria-hidden="true">Watch</span>
  </a>
  </div>`;
  hydratePosters(app);
  wire(app, t, k, s);
}

function wire(app, t, k, s) {
  const back = () => history.length > 1 ? history.back() : (location.hash = '#/');
  $('#back').onclick = back;
  $('#rateBtn').onclick = () => openRate(t);
  $('#wl').onclick = e => { const r = toggleSave(k); e.currentTarget.textContent = r.saved ? '🔖' : '＋'; if (r.saved) { const b = e.currentTarget.getBoundingClientRect(); hearts(b.x + 23, b.y + 23, 8); toast('Saved to your watchlist'); } celebrate(r); };
  $('#share').onclick = async () => {
    const url = location.href.split('#')[0] + '#/t/' + k, text = `Is ${t.name} worth watching? See where it gets good 💓`;
    try { if (navigator.share) { await navigator.share({ title: 'Heartbeat', text, url }); return; } await navigator.clipboard.writeText(url); toast('Link copied!'); }
    catch (e) { toast('Copy this link: ' + url); }
  };
  $('#hb').onclick = e => { const r = e.target.closest('[data-pt]'); if (r) { sel[k] = +r.dataset.pt; rerender(); } };
  $$('[data-tag]', app).forEach(b => b.onclick = () => { const tag = b.dataset.tag, ix = U.tags.findIndex(x => x.k === k && x.i === s && x.tag === tag); if (ix >= 0) U.tags.splice(ix, 1); else U.tags.push({ k, i: s, tag }); save(); rerender(); });
  $$('[data-gg]', app).forEach(b => b.onclick = () => { const i = +b.dataset.gg; if (U.gotGood[k] === i) delete U.gotGood[k]; else U.gotGood[k] = i; save(); rerender(); });
  $$('[data-quit]', app).forEach(b => b.onclick = () => { const i = +b.dataset.quit; if (U.quit[k] === i) delete U.quit[k]; else U.quit[k] = i; save(); rerender(); });
  // Swipe down from the top of the page to close.
  let y0 = null;
  const d = $('#detail');
  d.addEventListener('touchstart', e => { y0 = scrollY <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  d.addEventListener('touchmove', e => { if (y0 == null) return; const dy = e.touches[0].clientY - y0; if (dy > 0) d.style.transform = `translateY(${Math.min(dy, 200) / 2}px)`; }, { passive: true });
  d.addEventListener('touchend', e => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null; d.style.transform = ''; if (dy > 140) back(); });
}

/* ---------- the 5-second journey rating ---------- */
export function openRate(t, onDone) {
  const cur = U.ratings[t.id] ? { ...U.ratings[t.id] } : { start: 0, middle: 0, end: 0 };
  const rows = [['start', 'Start', 'the first part'], ['middle', 'Middle', 'the long stretch'], ['end', 'Ending', 'how it lands']];
  const draw = () => `
    <h3>How was the ride?</h3><div class="sub">${esc(t.name)} · tap hearts for each part</div>
    ${rows.map(([key, lab, hint]) => `<div class="jrow"><div class="lab">${lab}<small>${hint}</small></div>
      <div class="hearts" role="radiogroup" aria-label="${lab} rating">${[1, 2, 3, 4, 5].map(v => `<button role="radio" aria-checked="${cur[key] === v}" aria-label="${v} heart${v > 1 ? 's' : ''}" class="${cur[key] >= v ? 'on' : ''}" data-k="${key}" data-v="${v}">💖</button>`).join('')}</div></div>`).join('')}
    <button class="btn big" id="saveRate" ${cur.end ? '' : 'disabled style="opacity:.5"'}>${cur.end ? `Save · ★ ${Math.round(((cur.start + cur.middle + cur.end * 2) / 4) * 2) / 2}` : 'Tap some hearts'}</button>`;
  const sh = sheet('<div id="rs"></div>', onDone);
  const box = $('#rs', sh);
  const paint = () => { box.innerHTML = draw(); };
  paint();
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-k]');
    if (b) {
      const v = +b.dataset.v, key = b.dataset.k;
      // Smart fill: the first tap fills the other parts too, so one tap + Save works.
      if (!cur.start && !cur.middle && !cur.end) rows.forEach(([kk]) => cur[kk] = v);
      const r = b.getBoundingClientRect();
      cur[key] = v; paint();
      hearts(r.x + r.width / 2, r.y + r.height / 2, 5);
      return;
    }
    if (e.target.closest('#saveRate') && cur.end) {
      const r = e.target.closest('#saveRate').getBoundingClientRect(); const res = rate(t.id, cur);
      hearts(r.x + r.width / 2, r.y, 14);
      closeSheet();
      if (!(res.newBadges?.length || res.streakUp)) toast(`Saved! ★ ${U.ratings[t.id].overall} for ${t.name}`);
      celebrate(res);
      if (!onDone) rerender();
    }
  });
}
