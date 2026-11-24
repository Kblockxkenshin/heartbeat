import { BYID, BADGES } from '../data.js';
import { U, save, stats, level, streakAlive, matches, today } from '../store.js';
import { $, esc, card, row, hydratePosters, empty, toast, sheet, confetti } from '../ui.js';
import { rerender, install } from '../app.js';

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
  <section class="card"><div class="me-head">
    <div class="ava" aria-hidden="true">${esc((U.name[0] || 'Y').toUpperCase())}</div>
    <div style="flex:1"><input id="nm" value="${esc(U.name)}" aria-label="Your name" style="font-weight:900;font-size:20px;padding:6px 10px;border-radius:12px">
      <div style="display:flex;justify-content:space-between;font-weight:800;font-size:14px;margin-top:8px"><span>Level ${L.lv}</span><span class="sub" style="font-size:13px">${L.toNext} XP to next</span></div>
      <div class="lvl" role="progressbar" aria-label="Level progress" aria-valuenow="${L.pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${L.pct}%"></i></div></div>
  </div>
  <div style="margin-top:12px"><span class="chip founding">🏅 Founding Reviewer</span></div></section>

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
  $('#nm').onchange = e => { U.name = e.target.value.trim().slice(0, 30) || 'You'; save(); rerender(); };
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
