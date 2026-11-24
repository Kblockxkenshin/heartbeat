import { TITLES, BYID, BADGES } from '../data.js';
import { U, save, stats, level, streakAlive, matches, today } from '../store.js';
import { $, esc, card, hydratePosters, empty, toast } from '../ui.js';
import { rerender } from '../app.js';

export function renderMe(app) {
  document.title = 'Me — Heartbeat';
  const s = stats(), L = level(s.xp), streak = streakAlive();
  const days = [...Array(7)].map((_, i) => { const d = new Date(Date.now() - (6 - i) * 864e5); return { l: 'SMTWTFS'[d.getDay()], on: (U.streak.days || []).includes(today(d)) }; });
  const saved = Object.keys(U.watchlist).map(id => BYID[id]).filter(Boolean);
  const m = matches()[0];
  const maxG = Math.max(1, ...s.genres.map(g => g.score));
  app.innerHTML = `<div class="screen">
  <header class="top"><div class="logo" style="font-size:24px">Me</div><a class="icon-btn" href="#/about" aria-label="Settings and about">⚙️</a></header>

  <div class="card"><div class="me-head">
    <div class="ava" aria-hidden="true">${esc((U.name[0] || 'Y').toUpperCase())}</div>
    <div style="flex:1"><input id="nm" value="${esc(U.name)}" aria-label="Your name" style="font-weight:900;font-size:20px;padding:6px 10px;border-radius:12px">
      <div style="display:flex;justify-content:space-between;font-weight:800;font-size:14px;margin-top:8px"><span>Level ${L.lv}</span><span class="sub" style="font-size:13px">${L.toNext} XP to next</span></div>
      <div class="lvl"><i style="width:${L.pct}%"></i></div></div>
  </div>
  <div style="margin-top:12px"><span class="chip" style="background:linear-gradient(90deg,#ffd35c,#ff8a4c);color:#2a1400;border:0">🏅 Founding Reviewer</span></div></div>

  <div class="card"><div class="flame"><span class="f" aria-hidden="true">🔥</span><div><b>${streak}</b> <span style="font-weight:900">day streak</span><div class="sub">${streak ? 'Rate one thing today to keep it alive.' : 'Rate one title to start a streak.'}</div></div></div>
    <div class="week">${days.map(d => `<span class="${d.on ? 'on' : ''}"><i>${d.on ? '🔥' : ''}</i>${d.l}</span>`).join('')}</div></div>

  <div class="card"><h3>📊 Your stats</h3>
    <div class="stat3" style="margin:10px 0 14px"><div><b>${s.rated}</b><span>rated</span></div><div><b>${s.avg != null ? s.avg.toFixed(1) : '–'}</b><span>avg ★</span></div><div><b>${s.saved}</b><span>saved</span></div></div>
    ${s.style ? `<div class="journey-sum"><span style="font-size:28px">${s.style.e}</span><div><b>${s.style.name}</b><div class="sub">${s.style.note} (Starts ★${s.style.start.toFixed(1)} → endings ★${s.style.end.toFixed(1)})</div></div></div>` : `<div class="sub">Rate a few titles with Start / Middle / Ending to see your journey style.</div>`}
    ${s.genres.length ? `<div class="sub" style="margin:14px 0 6px;font-weight:800">Favorite genres</div>${s.genres.map(g => `<div class="genre"><span>${esc(g.g)}</span><div class="track" style="height:12px"><i style="width:${g.score / maxG * 100}%;background:var(--grad)"></i></div><span class="sub">${g.n}</span></div>`).join('')}` : ''}
  </div>

  <div class="card"><h3>🏆 Badges</h3><div class="sub" style="margin-bottom:10px">${Object.keys(U.badges).length} of ${BADGES.length} unlocked</div>
    <div class="badges">${BADGES.map(b => `<div class="bdg ${U.badges[b.id] ? 'got' : ''}"><span class="e" aria-hidden="true">${b.e}</span>${b.name}${U.badges[b.id] ? '' : '<span class="sr-only"> (locked)</span>'}</div>`).join('')}</div></div>

  ${m ? `<a class="card" href="#/match" style="display:flex;align-items:center;gap:14px"><span style="font-size:34px">💞</span><div style="flex:1"><h3>${m.m.pct}% with @${esc(m.p.h)}</h3><div class="sub">Your closest movie twin so far</div></div><span class="btn sm">Match</span></a>` : ''}

  <div class="sec"><h2>🔖 Watchlist</h2></div>
  ${saved.length ? `<div class="row">${saved.map(t => card(t)).join('')}</div>` : `<div class="card">${empty('Tap ＋ on any poster to save it here.')}</div>`}

  <div class="card" style="margin-top:6px"><h3>🔔 Reminders</h3>
    <div class="toggle"><span>Gentle daily pick reminder</span><button class="switch ${U.settings.reminders ? 'on' : ''}" id="rem" role="switch" aria-checked="${!!U.settings.reminders}" aria-label="Daily reminder"></button></div>
    <div class="sub">One nudge a day at most. No spam. Turn it off any time.</div></div>
  <div style="text-align:center;padding:8px"><a class="see" href="#/about">About Heartbeat & TMDB credits</a></div>
  </div>`;
  hydratePosters(app);
  $('#nm').onchange = e => { U.name = e.target.value.trim().slice(0, 30) || 'You'; save(); rerender(); };
  $('#rem').onclick = () => { U.settings.reminders = !U.settings.reminders; save(); toast(U.settings.reminders ? 'Reminders on. One gentle nudge a day.' : 'Reminders off. We won\'t bug you.'); rerender(); };
}
