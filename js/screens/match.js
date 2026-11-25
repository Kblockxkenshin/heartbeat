import { matches, U, stats, displayName } from '../store.js';
import { $, esc, empty, toast, confetti, mascot } from '../ui.js';

export function renderMatch(app) {
  document.title = 'Taste Match — Heartbeat';
  const ms = matches(), best = ms[0];
  app.innerHTML = `<div class="screen">
  <header class="top"><div class="logo" style="font-size:24px">💞 Taste Match</div></header>
  <div class="hello">How close is your taste to someone else's?</div>
  ${best ? `<div class="card" style="text-align:center">
    <div class="sub">Your closest match</div>
    <div class="ring" id="ring" style="background:conic-gradient(#ff4f9a 0deg,#9b6bff 0deg,var(--card2) 0)"><div class="in"><b id="pct">0%</b><span class="sub">${best.m.pct >= 80 ? 'movie twins!' : 'match'}</span></div></div>
    <div style="font-weight:900;font-size:20px">You + @${esc(best.p.h)}</div>
    <div class="sub">You both rated ${best.m.shared.length} of the same titles.</div>
    <div style="display:flex;gap:10px;margin-top:14px"><button class="btn" style="flex:1" id="story">📸 Story card</button><button class="btn ghost" style="flex:1" id="inv">🔗 Invite a friend</button></div>
  </div>
  <div class="card"><h3>👥 People like you</h3>${ms.map(({ p, m }) => `<div class="person"><div class="pav" style="background:${p.c}33;color:${p.c}">${esc(p.h[0].toUpperCase())}</div><div style="flex:1"><b>@${esc(p.h)}</b><div class="meta">${m.shared.length} in common</div></div><b style="font-size:20px;color:${m.pct >= 80 ? 'var(--pink)' : 'var(--text)'}">${m.pct}%</b></div>`).join('')}</div>`
  : `<div class="card">${empty('Rate at least 2 titles and I\'ll find your movie twin!', 'happy', '<a class="btn" href="#/rate">⚡ Quick Rate</a>')}</div>`}
  </div>`;
  if (!best) return;
  // count-up animation
  const target = best.m.pct, ring = $('#ring'), pct = $('#pct'), t0 = performance.now();
  const step = now => { const k = Math.min(1, (now - t0) / 1100), e = 1 - (1 - k) ** 3, v = Math.round(target * e);
    pct.textContent = v + '%'; ring.style.background = `conic-gradient(#ff4f9a 0deg,#9b6bff ${v * 3.6}deg,var(--card2) ${v * 3.6}deg)`;
    if (k < 1) requestAnimationFrame(step); else if (target >= 80) confetti(50); };
  requestAnimationFrame(step);
  $('#inv').onclick = async () => {
    const url = location.href.split('#')[0] + '#/match', text = 'Are we movie twins? 💞 Rate a few movies on Heartbeat and see our match %.';
    try { if (navigator.share) await navigator.share({ title: 'Heartbeat Taste Match', text, url }); else { await navigator.clipboard.writeText(text + ' ' + url); toast('Invite link copied!'); } } catch (e) { toast('Share this link: ' + url); }
  };
  $('#story').onclick = () => storyCard(best);
}

/** 1080×1920 image for Instagram stories. */
function storyCard({ p, m }) {
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1920; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 1080, 1920); g.addColorStop(0, '#2a1240'); g.addColorStop(.55, '#9b6bff'); g.addColorStop(1, '#ff4f9a');
  x.fillStyle = g; x.fillRect(0, 0, 1080, 1920);
  x.textAlign = 'center'; x.fillStyle = '#fff';
  x.font = '900 64px Nunito, system-ui'; x.fillText('💓 heartbeat', 540, 220);
  x.font = '800 54px Nunito, system-ui'; x.fillText('We are', 540, 560);
  x.lineWidth = 46; x.strokeStyle = 'rgba(255,255,255,.25)'; x.beginPath(); x.arc(540, 900, 260, 0, Math.PI * 2); x.stroke();
  x.strokeStyle = '#fff'; x.lineCap = 'round'; x.beginPath(); x.arc(540, 900, 260, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * m.pct / 100); x.stroke();
  x.font = '900 200px Nunito, system-ui'; x.fillText(m.pct + '%', 540, 970);
  x.font = '900 84px Nunito, system-ui'; x.fillText(m.pct >= 80 ? 'movie twins!' : 'taste match', 540, 1300);
  x.font = '800 52px Nunito, system-ui'; x.fillText(`${displayName()} + @${p.h}`, 540, 1420);
  x.font = '700 40px Nunito, system-ui'; x.fillText('Rate the journey, not just the ending', 540, 1760);
  c.toBlob(async b => {
    const file = new File([b], 'heartbeat-taste-match.png', { type: 'image/png' });
    try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Taste Match' }); return; } } catch (e) { /* fall through */ }
    try { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); toast('Saved! Add it to your Instagram story.'); }
    catch (e) { toast('Could not save the image here.', 'sad'); }
  }, 'image/png');
}
