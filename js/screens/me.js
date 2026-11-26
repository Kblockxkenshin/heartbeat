import { BYID, BADGES } from '../data.js';
import { U, save, stats, level, streakAlive, matches, today } from '../store.js';
import { $, esc, card, row, hydratePosters, empty, toast, sheet, confetti } from '../ui.js';
import { rerender, install } from '../app.js';
import { cloud, signOut } from '../cloud.js';
import { meReviewsCardHTML, fillMeReviews } from './reviews.js';
import { avatar } from '../social.js';
import { editProfile } from './people.js';
import { mePlusCardHTML, isPlus } from './plus.js';

// Same numbers as rank_for() on the server (for the progress bar only; the server decides the rank).
export const RANKS = [['Popcorn', 0, '🍿'], ['Ticket Holder', 100, '🎟️'], ['Front Row', 300, '💺'], ['Critic', 700, '📝'], ['Top Critic', 1500, '⭐'], ["Director's Cut", 3000, '🎬'], ['Legend', 6000, '👑']];
export function rankInfo(xp, name) {
  const i = Math.max(0, RANKS.findIndex(r => r[0] === name));
  const [, lo, e] = RANKS[i], next = RANKS[i + 1];
  return { e, next: next?.[0], pct: next ? Math.round((xp - lo) / (next[1] - lo) * 100) : 100, toNext: next ? next[1] - xp : 0 };
}

export function renderMe(app) {
  document.title = 'Me — Heartbeat';
  const s = stats(), L = level(s.xp), streak = streakAlive();
  const days = [...Array(7)].map((_, i) => { const d = new Date(Date.now() - (6 - i) * 864e5); return { l: 'SMTWTFS'[d.getDay()], on: (U.streak.days || []).includes(today(d)) }; });
  const saved = Object.keys(U.watchlist).map(id => BYID[id]).filter(Boolean);
  const m = matches()[0];
  const maxG = Math.max(1, ...s.genres.map(g => g.score));
  const inst = install.installed() ? `<div class="sub">✅ Heartbeat is installed on this device.</div>`
    : `<div class="sub" style="margin-bottom:12px">Open it from your home screen or dock like a real app. Works offline too.</div>
       <button class="btn" id="install">📲 Install Heartbeat</button>`;
  app.innerHTML = `<div class="screen me">
  <header class="top"><h1 class="logo" style="font-size:26px;margin:0">Me</h1><a class="icon-btn" href="#/about" aria-label="Settings and about">⚙️</a></header>

  <div class="me-grid">
  ${cloud.sec?.paused ? `<a class="card linkcard pausedcard" href="#/security" role="alert"><span style="font-size:30px" aria-hidden="true">⏸️</span><div style="flex:1"><h2 class="h3">Your account is ${cloud.sec.status === 'banned' ? 'banned' : 'paused'}</h2><div class="sub">${esc(cloud.sec.reason || 'Community rules')}. Tap to learn more.</div></div></a>` : ''}
  ${cloud.user && cloud.stats ? accountCard() : guestCard(L)}

  <section class="card"><div class="flame"><span class="f" aria-hidden="true">🔥</span><div><b>${streak}</b> <span style="font-weight:900">day streak</span><div class="sub">${streak ? 'Rate one thing today to keep it alive.' : 'Rate one title to start a streak.'}</div></div></div>
    <div class="week" aria-label="This week">${days.map(d => `<span class="${d.on ? 'on' : ''}"><i>${d.on ? '🔥' : ''}</i>${d.l}</span>`).join('')}</div></section>

  <section class="card"><h2 class="h3">📊 Your stats</h2>
    <div class="stat3" style="margin:10px 0 14px"><div><b>${s.rated}</b><span>rated</span></div><div><b>${s.avg != null ? s.avg.toFixed(1) : '–'}</b><span>avg ★</span></div><div><b>${s.saved}</b><span>saved</span></div></div>
    ${s.style ? `<div class="journey-sum"><span style="font-size:28px" aria-hidden="true">${s.style.e}</span><div><b>${s.style.name}</b><div class="sub">${s.style.note} (Starts ★${s.style.start.toFixed(1)} → endings ★${s.style.end.toFixed(1)})</div></div></div>` : `<div class="sub">Rate a few titles with Start / Middle / Ending to see your journey style.</div>`}
  </section>

  <section class="card"><h2 class="h3">🎭 Favorite genres</h2>
    ${s.genres.length ? s.genres.map(g => `<div class="genre"><span>${esc(g.g)}</span><div class="track" style="height:12px"><i style="width:${g.score / maxG * 100}%;background:var(--grad)"></i></div><span class="sub">${g.n}</span></div>`).join('') : `<div class="sub">Rate a few titles and your favorite genres show up here.</div>`}
  </section>

  <section class="card span2"><h2 class="h3">🏆 Badges</h2><div class="sub" style="margin-bottom:10px">${Object.keys(U.badges).length} of ${BADGES.length} unlocked</div>
    <ul class="badges">${BADGES.map(b => `<li class="bdg ${U.badges[b.id] ? 'got' : ''}"><span class="e" aria-hidden="true">${b.e}</span>${b.name}<span class="sr-only">${U.badges[b.id] ? ' (unlocked)' : ' (locked)'}</span></li>`).join('')}</ul></section>

  ${m ? `<a class="card linkcard" href="#/match"><span style="font-size:34px" aria-hidden="true">💞</span><div style="flex:1"><h2 class="h3">${m.m.pct}% with @${esc(m.p.h)}</h2><div class="sub">Your closest movie twin so far</div></div><span class="btn sm" aria-hidden="true">Match</span></a>` : ''}

  ${cloud.user ? `<a class="card linkcard" href="#/security"><span style="font-size:30px" aria-hidden="true">🔐</span><div style="flex:1"><h2 class="h3">Security</h2><div class="sub">${cloud.sec?.mfa ? '2-step sign-in is on.' : 'Turn on 2-step sign-in to keep your account safe.'}</div></div><span class="btn sm ghost" aria-hidden="true">Open</span></a>` : ''}
  <a class="card linkcard" href="#/legal"><span style="font-size:30px" aria-hidden="true">📜</span><div style="flex:1"><h2 class="h3">Help &amp; legal</h2><div class="sub">Terms, privacy, community rules, contact us.</div></div><span class="btn sm ghost" aria-hidden="true">Open</span></a>
  ${cloud.user ? `<a class="card linkcard" href="#/screeners"><span style="font-size:30px" aria-hidden="true">🎬</span><div style="flex:1"><h2 class="h3">Screeners &amp; studios</h2><div class="sub">Screener panel invites, and <span class="nowrap">Heartbeat for Studios</span>.</div></div><span class="btn sm ghost" aria-hidden="true">Open</span></a>` : ''}
  ${cloud.sec?.admin ? `<a class="card linkcard" href="#/admin"><span style="font-size:30px" aria-hidden="true">🛡️</span><div style="flex:1"><h2 class="h3">Admin panel</h2><div class="sub">Reports, flags, held ratings and users.</div></div><span class="btn sm ghost" aria-hidden="true">Open</span></a>` : ''}

  ${cloud.user && cloud.stats ? `<a class="card linkcard" href="#/play"><span style="font-size:30px" aria-hidden="true">🏆</span><div style="flex:1"><h2 class="h3">Leagues, challenges & badges</h2><div class="sub">Your league, today's challenges, Streak Shields and badges.</div></div><span class="btn sm ghost" aria-hidden="true">Play</span></a>` : ''}

  ${mePlusCardHTML()}

  ${meReviewsCardHTML()}

  <section class="card installcard"><h2 class="h3">📲 Get the app</h2>${inst}</section>

  <section class="card"><h2 class="h3">🔔 Reminders</h2>
    <div class="toggle"><span id="remlbl">Gentle daily pick reminder</span><button class="switch ${U.settings.reminders ? 'on' : ''}" id="rem" role="switch" aria-checked="${!!U.settings.reminders}" aria-labelledby="remlbl"></button></div>
    <div class="sub">One nudge a day at most. No spam. Turn it off any time.</div></section>
  </div>

  <div class="sec"><h2>🔖 Watchlist</h2></div>
  ${saved.length ? row(saved.map(t => card(t)).join(''), 'Watchlist') : `<div class="card">${empty('Tap ＋ on any poster to save it here.')}</div>`}
  <div style="text-align:center;padding:8px"><a class="see" href="#/about">About Heartbeat & TMDB credits</a></div>
  </div>`;
  hydratePosters(app);
  fillMeReviews(app);
  const nm = $('#nm'); if (nm) nm.onchange = e => { U.name = e.target.value.trim().slice(0, 30) || 'You'; save(); rerender(); };
  const ed = $('#meedit'); if (ed) ed.onclick = () => editProfile();
  const so = $('#signout');
  if (so) so.onclick = async () => {
    await signOut();
    // Shared computer? Don't leave this account's ratings behind on this device.
    U.ratings = {}; U.swipes = {}; U.watchlist = {}; delete U.syncedUser; save();
    toast('Signed out. See you soon!'); rerender();
  };
  $('#rem').onclick = () => { U.settings.reminders = !U.settings.reminders; save(); toast(U.settings.reminders ? 'Reminders on. One gentle nudge a day.' : 'Reminders off. We won\'t bug you.'); rerender(); };
  const ib = $('#install');
  if (ib) ib.onclick = async () => {
    if (install.can()) { if (await install.prompt()) confetti(); return; }
    if (install.ios()) {
      sheet(`<h2 class="h3" style="font-size:22px;margin:0 0 6px">Add Heartbeat to your Home Screen</h2>
        <ol class="steps"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button <span aria-hidden="true">⬆️</span> at the bottom.</li><li>Scroll and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. Done! 🎉</li></ol>`);
    } else {
      sheet(`<h2 class="h3" style="font-size:22px;margin:0 0 6px">Install Heartbeat</h2>
        <ol class="steps"><li><b>Chrome or Edge on a computer:</b> click the install icon <span aria-hidden="true">⊕</span> at the right end of the address bar.</li><li><b>Android:</b> tap the menu <b>⋮</b>, then <b>Install app</b> or <b>Add to Home screen</b>.</li><li><b>Safari on Mac:</b> File → <b>Add to Dock</b>.</li></ol>
        <div class="sub">If you don't see the option, refresh the page once and try again.</div>`);
    }
  };
}

function guestCard(L) {
  return `<section class="card"><div class="me-head">
    <div class="ava" aria-hidden="true">${esc((U.name[0] || 'Y').toUpperCase())}</div>
    <div style="flex:1"><input id="nm" value="${esc(U.name)}" aria-label="Your name" style="font-weight:900;font-size:20px;padding:6px 10px;border-radius:12px">
      <div style="display:flex;justify-content:space-between;font-weight:800;font-size:14px;margin-top:8px"><span>Level ${L.lv}</span><span class="sub" style="font-size:13px">${L.toNext} XP to next</span></div>
      <div class="lvl" role="progressbar" aria-label="Level progress" aria-valuenow="${L.pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${L.pct}%"></i></div></div>
  </div>
  ${cloud.ready ? `<div class="signcta"><div class="sub">Saved on this device only. Make a free account to keep your ratings everywhere, earn ranks and add friends.</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><a class="btn sm" href="#/signin/up">Make an account</a><a class="btn sm ghost" href="#/signin">Sign in</a></div></div>`
    : `<div style="margin-top:12px"><span class="chip founding">🏅 Founding Reviewer</span></div>`}</section>`;
}
function accountCard() {
  const p = cloud.profile || {}, st = cloud.stats, R = rankInfo(st.xp, st.rank);
  const name = p.username || 'you';
  return `<section class="card"><div class="me-head">
    ${avatar({ ...p, rank: st.rank, frame: isPlus() ? p.frame : null }, '')}
    <div style="flex:1;min-width:0"><div style="font-weight:900;font-size:21px;overflow-wrap:anywhere">${esc(p.display_name || name)}</div>
      <div class="sub">@${esc(name)}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;font-weight:800;font-size:14px;margin-top:8px"><span><span class="rankchip">${R.e} ${esc(st.rank)}</span>${isPlus() ? ' <span class="pluschip">💖 Plus</span>' : ''}</span><span class="sub" style="font-size:13px">${R.next ? `${R.toNext} XP to ${esc(R.next)}` : 'Top rank!'}</span></div>
      <div class="lvl" role="progressbar" aria-label="Rank progress" aria-valuenow="${R.pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${R.pct}%"></i></div>
      <div class="sub" style="font-size:13px;margin-top:4px">${st.xp} XP · checked by the server 🔒</div></div>
  </div>
  ${p.bio ? `<p class="sub" style="margin:12px 0 0;overflow-wrap:anywhere">${esc(p.bio)}</p>` : ''}
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><a class="btn sm" href="#/u/${encodeURIComponent(name)}">👤 My profile</a><button class="btn sm ghost" id="meedit">✏️ Edit profile</button><a class="btn sm ghost" href="#/friends">👥 Friends${cloud.requests ? ` (${cloud.requests})` : ''}</a></div>
  <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-top:12px"><span class="chip founding">🏅 Founding Reviewer</span>
    <button class="btn sm ghost" id="signout">Sign out</button></div>
  <div class="sub" style="font-size:13px;margin-top:8px;overflow-wrap:anywhere">Signed in as ${esc(cloud.user.email || '')}</div></section>`;
}
