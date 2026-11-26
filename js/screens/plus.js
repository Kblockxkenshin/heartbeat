// Heartbeat Plus: one clean upgrade page (with a real preview of YOUR stats), easy cancel,
// restore purchases, Plus styles, Taste Match Pro and Movie Night.
// Plus status always comes from the server. Free stays complete: nothing core is ever locked.
import { cloud, keyOf, refreshMe, plain } from '../cloud.js';
import { $, esc, toast, sheet, closeSheet, empty, poster, hydratePosters, buzz, confetti } from '../ui.js';
import { S, socialReady, avatar, handle, profileHref, titlesFor } from '../social.js';
import { wrappedData } from './wrapped.js';

export const isPlus = () => !!(cloud.stats?.plus_until && Date.parse(cloud.stats.plus_until) > Date.now());

async function rpc(fn, args = {}) {
  if (!cloud.sb) throw new Error('You seem to be offline. Try again.');
  const { data, error } = await cloud.sb.rpc(fn, args);
  if (error) throw new Error(error.message || 'Something went wrong. Please try again.');
  return data;
}
export const P = {
  status: () => rpc('my_plus'),
  style: (theme, banner, frame) => rpc('set_plus_style', { p_theme: theme || null, p_banner: banner || null, p_frame: frame || null }),
  pro: user => rpc('match_pro', { p_user: user }),
  night: users => rpc('movie_night', { p_users: users }),
};
let billingReady = null;
async function billingInfo() {
  if (billingReady) return billingReady;
  billingReady = fetch('/api/billing').then(r => r.json()).catch(() => ({ ready: false }));
  return billingReady;
}
async function billing(action, plan) {
  const { data } = await cloud.sb.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Please sign in first.');
  const r = await fetch('/api/billing', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ action, plan }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong. Please try again.');
  return d;
}
const fmtDate = s => s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const lock = `<span class="plock" aria-hidden="true">💖</span>`;

export const FEATURES = [
  ['🎬', 'Heartbeat Wrapped', 'Your year as story slides: genres, decades, how you rate starts vs endings.', '#/wrapped'],
  ['🔬', 'Taste Match Pro', 'See exactly where you and a friend disagree, part by part.', null],
  ['🍿', 'Movie Night picker', 'Finds the perfect title for your whole group.', '#/movienight'],
  ['🎨', 'Profile styles', 'Animated themes, banners and avatar frames.', '#/plus/style'],
  ['💖', 'Plus badge', 'A little badge on your profile. Just for fun.', null],
];
const SOON = ['Unlimited custom lists with friends', 'Watch-party rooms', 'Streak Shield (2 repairs a month)', 'Early access to new features'];

/* =====================================================================
   #/plus  ·  #/plus/ok  ·  #/plus/style
   ===================================================================== */
export async function renderPlus(app, sub) {
  if (sub === 'style') return renderStyle(app);
  document.title = 'Heartbeat Plus';
  app.innerHTML = `<div class="screen plus"><header class="top"><h1 class="logo" style="font-size:26px;margin:0">💖 Heartbeat Plus</h1></header>
    <div id="pbody"><div class="card"><div class="rskel"></div><div class="rskel"></div></div></div></div>`;
  const body = $('#pbody', app);
  const [info, st] = await Promise.all([billingInfo(), socialReady() ? P.status().catch(() => null) : null]);
  if (sub === 'ok' && st && !st.plus) {
    // Just paid: Stripe tells our server in a few seconds. Ask once more, then refresh.
    body.innerHTML = `<div class="card">${empty('Finishing up… 💖', 'happy')}</div>`;
    for (let i = 0; i < 5 && !(await P.status().catch(() => ({}))).plus; i++) {
      if (i === 1) await billing('restore').catch(() => {});
      await new Promise(r => setTimeout(r, 1500));
    }
    await refreshMe();
    return renderPlus(app, '');
  }
  if (sub === 'ok' && st?.plus) { confetti(120); buzz([20, 40, 20]); toast('Welcome to Heartbeat Plus! 💖'); history.replaceState(null, '', '#/plus'); }
  body.innerHTML = st?.plus ? memberHTML(st) : await salesHTML(st, info);
  hydratePosters(body);
  wire(app, body, st, info);
}

async function salesHTML(st, info) {
  const w = await wrappedData().catch(() => null);
  const preview = w && w.n ? `<section class="card wpeek"><h2 class="h3">A peek at your Wrapped</h2>
      <div class="wpgrid">
        <div class="wpc"><b>${w.n}</b><span>titles rated${w.year ? ` in ${w.year}` : ''}</span></div>
        <div class="wpc"><b>${esc(w.genres[0]?.g || '—')}</b><span>your top genre</span></div>
        <div class="wpc blur" aria-hidden="true"><b>${esc(w.style?.name || 'Even-keeled')}</b><span>your rating style</span></div>
        <div class="wpc blur" aria-hidden="true"><b>${w.decades[0]?.d || '2010s'}</b><span>your decade</span></div>
      </div>
      <div class="sub">With Plus you get the full story: your genres, ${w.decades.length === 1 ? 'your decade' : `${w.decades.length} decades`}, rating style, journey graph and more.</div>
      <a class="btn sm ghost" href="#/wrapped" style="margin-top:10px">▶ Play the free preview</a></section>`
    : `<section class="card wpeek"><h2 class="h3">Your Wrapped is waiting</h2><div class="sub">Rate a few titles and we'll build your year in stories.</div></section>`;
  const student = st?.student_ok && info.student;
  const trial = !st?.trial_used;
  const teen = !!cloud.stats?.is_minor;
  const can = info.ready && socialReady() && !teen;
  return `
    <section class="card phero"><div class="pheart" aria-hidden="true">💖</div>
      <h2>Extra fun, extra depth, extra style.</h2>
      <p class="sub">Everything core stays <b>free forever</b>: rating, reviews, friends, chat, recommendations, Quick Rate, Taste Match, ranks, streaks and leaderboards. Plus never helps you win. No pay-to-win.</p></section>
    ${preview}
    <section class="card"><h2 class="h3">What you get</h2><ul class="pfeat">${FEATURES.map(([e, t, d]) => `<li><span class="pe" aria-hidden="true">${e}</span><div><b>${t}</b><div class="sub">${d}</div></div></li>`).join('')}</ul>
      <div class="sub" style="margin-top:10px">Coming soon to Plus: ${SOON.join(' · ')}.</div></section>
    <section class="card pplans" aria-label="Choose a plan">
      <div class="plans" role="radiogroup" aria-label="Plan">
        <button type="button" role="radio" class="plan on" data-plan="yearly" aria-checked="true"><span class="save">Save 37%</span><b>$29.99 / year</b><span class="sub">$2.50 a month</span></button>
        <button type="button" role="radio" class="plan" data-plan="monthly" aria-checked="false"><b>$3.99 / month</b><span class="sub">Cancel any time</span></button>
        ${student ? `<button type="button" role="radio" class="plan" data-plan="student" aria-checked="false"><span class="save">🎓 Student</span><b>$1.99 / month</b><span class="sub">With your .edu email</span></button>` : ''}
      </div>
      <button class="btn big" id="pbuy" ${can ? '' : 'disabled'}>${!socialReady() ? 'Sign in to get Plus' : teen ? 'Plus is for 18+' : !info.ready ? 'Payments open soon' : trial ? 'Start 7-day free trial' : 'Get Heartbeat Plus'}</button>
      ${teen ? '<p class="sub" role="note">Heartbeat Plus is for people 18 and older. Everything free still works! 💓</p>' : ''}
      <div class="sub pfine">${trial ? 'Free for 7 days, then the price above. ' : ''}Cancel in 2 taps, any time. Secure checkout by Stripe.${!student && info.student ? ' Students: sign in with your confirmed .edu email to see the $1.99 price.' : ''}</div>
      ${!socialReady() ? `<a class="btn ghost" href="#/signin" style="width:100%;margin-top:8px">Sign in</a>` : ''}
      ${socialReady() ? '<button class="btn ghost sm" id="prestore" style="margin-top:8px">Restore purchases</button>' : ''}
    </section>`;
}

function memberHTML(st) {
  const ends = st.cancel_at_period_end || !st.status;
  const plan = { monthly: '$3.99 / month', yearly: '$29.99 / year', student: 'Student · $1.99 / month' }[st.plan] || 'Heartbeat Plus';
  return `
    <section class="card phero on"><div class="pheart" aria-hidden="true">💖</div><h2>You have Heartbeat Plus</h2>
      <p class="sub">Thank you for supporting Heartbeat! ${st.status === 'trialing' ? 'You are on your free trial.' : ''}</p></section>
    <section class="card"><h2 class="h3">Your Plus tools</h2><div class="ptools">
      ${FEATURES.filter(f => f[3]).map(([e, t, , h]) => `<a class="ptool" href="${h}"><span aria-hidden="true">${e}</span>${t}</a>`).join('')}
      <a class="ptool" href="#/friends/friends"><span aria-hidden="true">🔬</span>Taste Match Pro<small>open a friend's profile</small></a></div></section>
    <section class="card"><h2 class="h3">Your plan</h2>
      <div class="prow"><span>Plan</span><b>${esc(plan)}</b></div>
      <div class="prow"><span>${ends ? 'Plus ends' : st.status === 'trialing' ? 'Trial ends' : 'Renews'}</span><b>${fmtDate(st.period_end || st.plus_until)}</b></div>
      ${st.status === 'past_due' ? '<div class="sub" style="color:var(--pink)">Your last payment didn\'t go through. Update your card to keep Plus.</div>' : ''}
      <div class="pbtns2">
        ${st.has_billing ? '<button class="btn sm ghost" id="pportal">💳 Card & receipts</button>' : ''}
        ${st.status && ends ? '<button class="btn sm" id="presume">Keep Plus</button>' : st.status ? '<button class="btn sm ghost" id="pcancel">Cancel Plus</button>' : ''}
        <button class="btn sm ghost" id="prestore">Restore purchases</button></div>
      ${ends && st.status ? `<div class="sub" style="margin-top:8px">Canceled. You keep Plus until ${fmtDate(st.period_end)}. You won't be charged again.</div>` : ''}
    </section>`;
}

function wire(app, body, st, info) {
  let plan = 'yearly';
  body.querySelector('.plans')?.addEventListener('click', e => {
    const b = e.target.closest('[data-plan]'); if (!b) return;
    plan = b.dataset.plan;
    body.querySelectorAll('.plan').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
  });
  const on = (id, fn) => { const el = $('#' + id, body); if (el) el.onclick = async () => { el.disabled = true; try { await fn(); } catch (e) { toast(plain(e), 'sad'); } el.disabled = false; }; };
  on('pbuy', async () => { const d = await billing('checkout', plan); location.href = d.url; });
  on('prestore', async () => {
    const d = await billing('restore');
    await refreshMe();
    toast(d.found ? (d.plus ? 'Plus restored! 💖' : 'Found your account. Plus is not active right now.') : 'No purchase found for this account.', d.found ? 'happy' : 'sad');
    renderPlus(app, '');
  });
  on('pportal', async () => { const d = await billing('portal'); location.href = d.url; });
  on('presume', async () => { await billing('resume'); await refreshMe(); toast('Plus will keep going 💖'); renderPlus(app, ''); });
  // Cancel = 2 taps: "Cancel Plus" → "Yes, cancel".
  on('pcancel', async () => {
    const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 6px">Cancel Plus?</h2>
      <div class="sub" style="margin-bottom:14px">You keep Plus until ${fmtDate(st.period_end)}. After that you go back to free, and everything core keeps working. Your ratings, reviews and friends stay.</div>
      <button class="btn big ghost" id="pcyes">Yes, cancel</button><button class="btn big" id="pcno" style="margin-top:8px">Keep Plus</button>`);
    $('#pcno', sh).onclick = () => closeSheet();
    $('#pcyes', sh).onclick = async () => {
      $('#pcyes', sh).disabled = true;
      try { await billing('cancel'); closeSheet(); await refreshMe(); toast('Canceled. No more charges.'); renderPlus(app, ''); }
      catch (e) { toast(plain(e), 'sad'); $('#pcyes', sh).disabled = false; }
    };
  });
}

/* =====================================================================
   Profile styles
   ===================================================================== */
export const THEMES = [['sunset', 'Sunset'], ['ocean', 'Ocean'], ['aurora', 'Aurora ✨'], ['midnight', 'Midnight'], ['candy', 'Candy'], ['forest', 'Forest']];
export const BANNERS = [['stars', 'Stars'], ['waves', 'Waves'], ['hearts', 'Hearts'], ['film', 'Film strip'], ['neon', 'Neon'], ['confetti', 'Confetti']];
export const FRAMES = [['glow', 'Glow'], ['rainbow', 'Rainbow ✨'], ['gold', 'Gold'], ['hearts', 'Hearts'], ['neon', 'Neon']];
/** Classes for a profile card with Plus styles (only filled while the person has Plus). */
export const styleClass = p => `${p?.theme ? 'th-' + p.theme : ''} ${p?.banner ? 'has-banner' : ''}`;
export const bannerHTML = p => p?.banner ? `<div class="pbanner bn-${esc(p.banner)}" aria-hidden="true"></div>` : '';

async function renderStyle(app) {
  document.title = 'Profile styles — Heartbeat Plus';
  app.innerHTML = `<div class="screen plus"><header class="top"><a class="icon-btn" href="#/plus" aria-label="Back">←</a><h1 class="logo" style="font-size:22px;margin:0">🎨 Profile styles</h1><span></span></header>
    <div id="sbody"><div class="card"><div class="rskel"></div></div></div></div>`;
  const body = $('#sbody', app);
  if (!socialReady()) { body.innerHTML = `<div class="card">${empty('Sign in to style your profile.', 'happy', '<a class="btn" href="#/signin">Sign in</a>')}</div>`; return; }
  const st = await P.status().catch(() => null);
  const plus = !!st?.plus, cur = { theme: st?.style?.theme || '', banner: st?.style?.banner || '', frame: st?.style?.frame || '' };
  const me = { ...(cloud.profile || {}) };
  const group = (k, label, list) => `<section class="card"><h2 class="h3">${label}</h2><div class="stylegrid" data-k="${k}">
      <button type="button" class="sty ${!cur[k] ? 'on' : ''}" data-v="" aria-pressed="${!cur[k]}">Default</button>
      ${list.map(([v, n]) => `<button type="button" class="sty sw-${k}-${v} ${cur[k] === v ? 'on' : ''}" data-v="${v}" aria-pressed="${cur[k] === v}">${plus ? '' : lock}${n}</button>`).join('')}</div></section>`;
  const paint = () => {
    const prev = $('#sprev', body), p = { ...me, ...cur };
    prev.className = `card phead sprev ${styleClass(p)}`;
    prev.innerHTML = `${bannerHTML(p)}${avatar(p, 'lg')}<div class="pinfo"><h1>${esc(me.display_name || me.username || 'You')}</h1><div class="sub">@${esc(me.username || 'you')}</div><div class="pchips"><span class="pluschip">💖 Plus</span></div></div>`;
  };
  body.innerHTML = `<div class="card phead sprev" id="sprev"></div>
    ${plus ? '' : `<div class="card pnote">${lock} Try them on here. Saving styles needs <a class="see" href="#/plus">Heartbeat Plus</a>.</div>`}
    ${group('theme', 'Theme', THEMES)}${group('banner', 'Banner', BANNERS)}${group('frame', 'Avatar frame', FRAMES)}
    <button class="btn big" id="ssave">${plus ? 'Save my style' : '💖 Get Plus to save'}</button>`;
  paint();
  body.addEventListener('click', e => {
    const b = e.target.closest('.sty'); if (!b) return;
    const k = b.parentElement.dataset.k; cur[k] = b.dataset.v;
    b.parentElement.querySelectorAll('.sty').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    buzz(8); paint();
  });
  $('#ssave', body).onclick = async () => {
    if (!plus) { location.hash = '#/plus'; return; }
    try { await P.style(cur.theme, cur.banner, cur.frame); await refreshMe(); toast('Style saved! ✨'); }
    catch (e) { toast(plain(e), 'sad'); }
  };
}

/* =====================================================================
   Taste Match Pro (sheet from a profile)
   ===================================================================== */
export async function openMatchPro(p) {
  if (!isPlus()) {
    const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 6px">🔬 Taste Match Pro</h2>
      <div class="sub" style="margin-bottom:12px">See every title you both rated, part by part: who loved the start, who hated the ending, and where you split the most.</div>
      <a class="btn big" href="#/plus" id="mpgo">💖 See Heartbeat Plus</a>`);
    $('#mpgo', sh).onclick = () => closeSheet();
    return;
  }
  const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 6px">🔬 You vs ${esc(p.display_name || p.username)}</h2><div id="mpb"><div class="rskel"></div><div class="rskel"></div></div>`);
  const box = $('#mpb', sh);
  try {
    const d = await P.pro(p.id);
    const ts = Object.fromEntries((await titlesFor(d.titles.map(x => x.k))).map(t => [keyOf(t.id), t]));
    const parts = ['Start', 'Middle', 'Ending'];
    const bar = (v, cls) => `<i class="${cls}" style="width:${(v || 0) / 5 * 100}%"></i>`;
    box.innerHTML = `<div class="sub" style="margin-bottom:10px">${d.pct != null ? `<b class="rcgt">${d.pct}% match</b> · ` : ''}${d.titles.length} titles you both rated. <span class="key"><i class="kme"></i>you <i class="kth"></i>${esc(p.display_name || p.username)}</span></div>
      ${d.parts.n ? `<div class="mpparts">${parts.map((l, i) => `<div class="mppart"><span>${l}s</span><div class="mpbars">${bar(d.parts.me[i], 'kme')}${bar(d.parts.them[i], 'kth')}</div><span class="sub">${(+d.parts.me[i]).toFixed(1)} / ${(+d.parts.them[i]).toFixed(1)}</span></div>`).join('')}</div>` : ''}
      <h3 class="h3" style="margin:14px 0 6px">Biggest splits first</h3>
      <div class="mplist">${d.titles.filter(x => ts[x.k]).map(x => { const t = ts[x.k]; return `<a class="mprow" href="#/t/${esc(t.id)}">${poster(t, { small: true, mine: false })}
        <div class="mpinfo"><b>${esc(t.name)}</b>
          <table class="mptab"><thead><tr><th></th><th>Start</th><th>Middle</th><th>End</th></tr></thead><tbody>
            <tr><th>You</th>${[0, 1, 2].map(i => `<td class="${x.me[i] !== x.them[i] ? 'diff' : ''}">${x.me[i]}</td>`).join('')}</tr>
            <tr><th>${esc((p.display_name || p.username).split(' ')[0])}</th>${[0, 1, 2].map(i => `<td>${x.them[i]}</td>`).join('')}</tr></tbody></table>
          <div class="sub">★ ${x.me[3]} vs ★ ${x.them[3]}${+x.gap >= 1.5 ? ' · <b class="rcgt">big split</b>' : +x.gap <= 0.5 ? ' · 🤝 same page' : ''}</div></div></a>`; }).join('') || '<div class="sub">Rate the same titles with Start / Middle / Ending to compare.</div>'}</div>`;
    hydratePosters(box);
  } catch (e) { box.innerHTML = `<div class="sub">${esc(plain(e))}</div>`; }
}

/* =====================================================================
   #/movienight
   ===================================================================== */
export async function renderMovieNight(app) {
  document.title = 'Movie Night — Heartbeat Plus';
  app.innerHTML = `<div class="screen plus"><header class="top"><h1 class="logo" style="font-size:24px;margin:0">🍿 Movie Night</h1></header>
    <div id="mnb"><div class="card"><div class="rskel"></div></div></div></div>`;
  const body = $('#mnb', app);
  if (!socialReady()) { body.innerHTML = `<div class="card">${empty('Sign in and add friends to plan a movie night.', 'happy', '<a class="btn" href="#/signin">Sign in</a>')}</div>`; return; }
  if (!isPlus()) {
    body.innerHTML = `<section class="card phero"><div class="pheart" aria-hidden="true">🍿</div><h2>Can't agree what to watch?</h2>
      <p class="sub">Pick your friends and Movie Night finds a title most of you haven't seen, that someone saved or loved, and nobody hated.</p>
      <a class="btn big" href="#/plus">💖 Part of Heartbeat Plus</a></section>`;
    return;
  }
  const fr = await S.friends().then(x => x.friends).catch(() => []);
  if (!fr.length) { body.innerHTML = `<div class="card">${empty('Add friends first, then pick who\'s coming.', 'happy', '<a class="btn" href="#/friends/find">Find people</a>')}</div>`; return; }
  const picked = new Set();
  body.innerHTML = `<section class="card"><h2 class="h3">Who's watching?</h2><div class="sub" style="margin-bottom:8px">You + up to 7 friends.</div>
      <div class="nclist rcpick" id="mnf">${fr.map(p => `<button type="button" class="ncrow" data-u="${esc(p.id)}" aria-pressed="false">${avatar(p, 'sm')}<span class="pname"><b>${esc(p.display_name || p.username)}</b><span class="meta">${handle(p)}</span></span><span class="tick" aria-hidden="true"></span></button>`).join('')}</div>
      <button class="btn big" id="mngo" disabled>Pick friends</button></section><div id="mnres"></div>`;
  const go = $('#mngo', body);
  $('#mnf', body).onclick = e => {
    const b = e.target.closest('[data-u]'); if (!b) return;
    const u = b.dataset.u;
    if (picked.has(u)) picked.delete(u); else if (picked.size < 7) picked.add(u); else return toast('Up to 7 friends.', 'sad');
    b.classList.toggle('on', picked.has(u)); b.setAttribute('aria-pressed', picked.has(u));
    go.disabled = !picked.size; go.textContent = picked.size ? `🍿 Find our movie (${picked.size + 1} people)` : 'Pick friends';
  };
  go.onclick = async () => {
    go.disabled = true;
    const res = $('#mnres', body);
    res.innerHTML = `<div class="card"><div class="rskel"></div><div class="rskel"></div></div>`;
    try {
      const d = await P.night([...picked]);
      const ts = Object.fromEntries((await titlesFor(d.picks.map(x => x.k))).map(t => [keyOf(t.id), t]));
      const picks = d.picks.filter(x => ts[x.k]);
      const name = id => { const p = d.people.find(x => x.id === id); return esc(p?.display_name || p?.username || ''); };
      const avgPct = d.pairs.filter(x => x.pct != null);
      res.innerHTML = !picks.length ? `<div class="card">${empty('No match yet. Ask everyone to save a few titles to their watchlist, then try again!', 'sad')}</div>` : `
        <section class="card mntop"><div class="sub">Tonight's pick</div>${mnCard(picks[0], ts, true)}</section>
        ${picks.length > 1 ? `<section class="card"><h2 class="h3">Also great</h2>${picks.slice(1, 6).map(x => mnCard(x, ts)).join('')}</section>` : ''}
        ${avgPct.length ? `<section class="card"><h2 class="h3">💞 Group taste</h2>${avgPct.map(x => `<div class="prow"><span>${name(x.a)} + ${name(x.b)}</span><b>${x.pct}%</b></div>`).join('')}</section>` : ''}`;
      hydratePosters(res); confetti(40);
    } catch (e) { res.innerHTML = `<div class="card">${empty(esc(plain(e)), 'sad')}</div>`; }
    go.disabled = false;
  };
}
function mnCard(x, ts, big) {
  const t = ts[x.k];
  const why = [x.saved ? `${x.saved} saved it` : '', x.loved ? `${x.loved} loved it` : '', `${x.unseen} haven't seen it`].filter(Boolean).join(' · ');
  return `<a class="mncard ${big ? 'big' : ''}" href="#/t/${esc(t.id)}">${poster(t, { small: !big, mine: false })}
    <div><b>${esc(t.name)}</b><div class="meta">${esc(t.year)} · ${t.type === 'tv' ? 'Series' : 'Movie'}</div><div class="sub">${why}</div>
    <div class="fans">${x.fans.slice(0, 6).map(p => avatar(p, 'xs')).join('')}</div></div></a>`;
}

/* ---------- small Plus card for the Me page (never a pop-up) ---------- */
export function mePlusCardHTML() {
  if (isPlus()) return `<a class="card linkcard plusme on" href="#/plus"><span style="font-size:30px" aria-hidden="true">💖</span><div style="flex:1"><h2 class="h3">Heartbeat Plus</h2><div class="sub">Wrapped, Movie Night, styles and more.</div></div><span class="btn sm" aria-hidden="true">Open</span></a>`;
  return `<a class="card linkcard plusme" href="#/plus"><span style="font-size:30px" aria-hidden="true">🎬</span><div style="flex:1"><h2 class="h3">Your Heartbeat Wrapped</h2><div class="sub">See your year in stories. Free preview, full story with Plus.</div></div><span class="btn sm ghost" aria-hidden="true">Peek</span></a>`;
}
