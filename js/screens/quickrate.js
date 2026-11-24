// Tinder-style stack: right = loved, left = didn't like, up = haven't seen.
import { TITLES } from '../data.js';
import { U, swipe, myScore } from '../store.js';
import { $, esc, poster, hydratePosters, hearts, celebrate, toast, empty, confetti, buzz } from '../ui.js';
import { rerender } from '../app.js';

let session = 0;
const queue = () => TITLES.filter(t => myScore(t.id) == null && !U.swipes[t.id]);

export function renderQuickRate(app) {
  document.title = 'Quick Rate — Heartbeat';
  const q = queue();
  const done = TITLES.length - q.length;
  app.innerHTML = `<div class="screen qr">
    <div class="qr-top"><div><h1 style="margin:0;font-size:clamp(26px,3vw,34px);font-weight:900">⚡ Quick Rate</h1><div class="sub">${session ? `${session} rated this round` : 'Seen it? Swipe it.'}</div></div>
      <a class="icon-btn" href="#/" aria-label="Close">✕</a></div>
    <div class="lvl" style="margin-top:12px" aria-label="${done} of ${TITLES.length} rated"><i style="width:${done / TITLES.length * 100}%"></i></div>
    ${q.length ? `<div class="stack" id="stack">
      ${q.slice(0, 2).reverse().map((t, i, a) => `<div class="qcard ${i === a.length - 1 ? 'front' : 'back'}" data-id="${t.id}">
        ${poster(t, { mine: false })}
        <span class="stamp love">LOVED</span><span class="stamp nope">NOPE</span><span class="stamp unseen">NOT SEEN</span>
        <div class="info"><h3>${esc(t.name)}</h3><div class="meta" style="color:#ddd">${t.year} · ${esc(t.genres.join(' · '))}</div></div>
      </div>`).join('')}
    </div>
    <div class="qbtns">
      <button data-act="disliked" aria-label="Didn't like it (swipe left)">👎</button>
      <button data-act="loved" class="love" aria-label="Loved it (swipe right)">💖</button>
      <button data-act="unseen" aria-label="Haven't seen it (swipe up)">🙈</button>
    </div>
    <div class="qhint">Swipe or use your keyboard: <kbd class="kbd">←</kbd> nope · <kbd class="kbd">→</kbd> loved · <kbd class="kbd">↑</kbd> haven't seen</div>`
    : empty(`You rated everything here! ${session ? `That's ${session} in one go. 🎉` : ''}<br>Come back tomorrow for more.`, 'wow', `<a class="btn" href="#/me">See my stats</a>`)}
  </div>`;
  hydratePosters(app);
  if (!q.length) return;
  const card = $('.qcard.front', app);
  app.querySelectorAll('[data-act]').forEach(b => b.onclick = () => fling(card, b.dataset.act));
  drag(card);
  document.onkeydown = e => { if (!$('.qcard.front')) { document.onkeydown = null; return; } const m = { ArrowRight: 'loved', ArrowLeft: 'disliked', ArrowUp: 'unseen' }[e.key]; if (m) { e.preventDefault(); fling($('.qcard.front'), m); } };
}

function drag(card) {
  let x0, y0, dx = 0, dy = 0, on = false;
  const stamps = k => card.querySelectorAll('.stamp').forEach(s => s.style.opacity = s.classList.contains(k) ? Math.min(1, (k === 'unseen' ? -dy : Math.abs(dx)) / 90) : 0);
  card.addEventListener('pointerdown', e => { on = true; x0 = e.clientX; y0 = e.clientY; card.setPointerCapture(e.pointerId); card.style.transition = 'none'; });
  card.addEventListener('pointermove', e => {
    if (!on) return; dx = e.clientX - x0; dy = e.clientY - y0;
    card.style.transform = `translate(${dx}px,${dy}px) rotate(${dx / 14}deg)`;
    stamps(-dy > Math.abs(dx) ? 'unseen' : dx > 0 ? 'love' : 'nope');
  });
  const end = () => {
    if (!on) return; on = false; card.style.transition = '';
    if (dx > 110) fling(card, 'loved'); else if (dx < -110) fling(card, 'disliked'); else if (dy < -110) fling(card, 'unseen');
    else { card.style.transform = ''; card.querySelectorAll('.stamp').forEach(s => s.style.opacity = 0); }
    dx = dy = 0;
  };
  card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end);
}

function fling(card, kind) {
  if (!card || card.dataset.gone) return; card.dataset.gone = 1;
  const id = card.dataset.id, t = TITLES.find(x => x.id === id);
  const to = { loved: 'translate(140%,-10%) rotate(24deg)', disliked: 'translate(-140%,-10%) rotate(-24deg)', unseen: 'translate(0,-130%)' }[kind];
  card.querySelectorAll('.stamp').forEach(s => s.style.opacity = s.classList.contains({ loved: 'love', disliked: 'nope', unseen: 'unseen' }[kind]) ? 1 : 0);
  card.style.transition = 'transform .35s ease-in'; card.style.transform = to;
  if (kind === 'loved') { const r = card.getBoundingClientRect(); hearts(r.x + r.width / 2, r.y + r.height / 2, 12); }
  buzz(kind === 'loved' ? [12, 30, 12] : 12);
  const res = swipe(id, kind);
  if (kind !== 'unseen') session++;
  setTimeout(() => {
    rerender();
    if ([5, 10, 15].includes(session) && !(res.newBadges?.length)) { confetti(); toast(`${session} rated! You're on fire.`, 'wow'); }
    else celebrate(res);
  }, 320);
}
