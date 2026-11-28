// First-run tutorial: five short slides with small animated previews, shown once to every new user.
// Plus a one-time swipe hint the first time someone opens Quick Rate.
import { $, $$, esc, buzz, reduced } from './ui.js';
import { cloud } from './cloud.js';

const DONE = 'hb_tour_done', QR = 'hb_qr_coach';
const seen = k => { try { return !!localStorage.getItem(k); } catch (e) { return true; } };
const mark = k => { try { localStorage.setItem(k, '1'); } catch (e) { /* ignore */ } };

const PULSE = `<svg class="tv-pulse" viewBox="0 0 320 120" aria-hidden="true"><path d="M10 70h70l22-44 34 88 28-66 18 22h128" pathLength="1"/></svg>`;
const SLIDES = [
  { k: 'hello', t: 'Welcome to <em>Heartbeat.</em>', d: 'Rate the journey, not just the ending. A movie can start slow and end brilliant, and your rating should show that.', art: () => `<div class="tv tv-hello">${PULSE}</div>` },
  { k: 'swipe', t: 'Swipe to <em>rate.</em>', d: 'Right if you loved it. Left if it wasn’t for you. Up if you haven’t seen it. Ten movies take about thirty seconds.',
    art: () => `<div class="tv tv-swipe"><div class="tv-card"><span class="tv-stamp">LOVED</span><i></i><b></b><b class="s"></b></div>
      <div class="tv-btns"><span></span><span class="l"></span><span></span></div><div class="tv-hand" aria-hidden="true"></div></div>` },
  { k: 'journey', go: { label: 'Show me the real line graph', spot: 'heartbeat' }, t: 'See where it <em>gets good.</em>', d: 'Rate the start, the middle and the end. See the exact moment people fall in love with a show, and where they give up on it.',
    art: () => `<div class="tv tv-journey"><svg viewBox="0 0 300 140" aria-hidden="true"><path class="g" d="M10 110 C60 105 80 90 110 80 S170 30 200 40 S260 20 290 14" pathLength="1"/><circle cx="110" cy="80" r="5"/><circle cx="200" cy="40" r="5"/><circle cx="290" cy="14" r="5"/></svg>
      <div class="tv-lbl"><span>Start</span><span>Middle</span><span>End</span></div></div>` },
  { k: 'box', go: { label: 'Open a real box office graph', spot: 'boxoffice' }, t: 'Box office, <em>live.</em>', d: 'Daily earnings graphs, budgets and a verdict for every film, from Disaster to Industry Hit. Indian cinema and Hollywood.',
    art: () => `<div class="tv tv-box"><div class="tv-bars">${[38, 64, 92, 70, 55, 46, 40].map((h, i) => `<i style="--h:${h}%;--d:${i * 70}ms"></i>`).join('')}</div>
      <div class="tv-pills"><span>Flop</span><span>Hit</span><span class="on">Blockbuster</span></div></div>` },
  { k: 'find', t: 'Every movie. <em>Every service.</em>', d: 'Over 20,000 movies and 13,000 shows. Browse what’s on Netflix, Prime, Disney+, Max and more, or search anything as you type.',
    art: () => `<div class="tv tv-find"><div class="tv-search"><i class="i i-search" aria-hidden="true"></i><span class="tv-type">Interstellar</span></div>
      <div class="tv-chips">${['Netflix', 'Prime Video', 'Disney+', 'Max', 'Hulu', 'Apple TV+'].map((c, i) => `<span style="--d:${i * 90}ms">${c}</span>`).join('')}</div></div>` },
];

/** Show the tutorial if this person hasn't seen it yet (and isn't in the middle of something else). */
export function maybeTour() {
  if (seen(DONE) || document.getElementById('tour') || document.querySelector('.sheet-bg, #modal .mbg')) return;
  startTour();
}

export function startTour() {
  document.getElementById('tour')?.remove();
  let i = 0, x0 = null;
  const el = document.createElement('div');
  el.id = 'tour'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Quick tour of Heartbeat');
  el.innerHTML = `<div class="tour-box">
    <div class="tour-top"><span class="tour-step" aria-live="polite"></span><button class="tour-skip" id="tskip2">Skip</button></div>
    <div class="tour-stage"></div>
    <div class="tour-dots" role="tablist" aria-label="Tour steps">${SLIDES.map((s, n) => `<button role="tab" aria-label="Step ${n + 1}" data-n="${n}"></button>`).join('')}</div>
    <div class="tour-nav"><button class="btn ghost" id="tback">Back</button><button class="btn" id="tnext">Next</button></div>
  </div>`;
  document.body.appendChild(el);
  document.documentElement.classList.add('locked');
  const prevFocus = document.activeElement;
  const close = (go) => {
    mark(DONE); el.classList.add('out');
    setTimeout(() => { el.remove(); document.documentElement.classList.remove('locked'); prevFocus?.focus?.(); }, reduced() ? 0 : 220);
    document.removeEventListener('keydown', onKey);
    if (go) location.hash = go;
  };
  const draw = (dir = 0) => {
    const s = SLIDES[i], last = i === SLIDES.length - 1;
    $('.tour-stage', el).innerHTML = `<div class="tour-slide ${dir > 0 ? 'in-r' : dir < 0 ? 'in-l' : ''}" data-k="${s.k}">${s.art()}<h2 class="display">${s.t}</h2><p>${esc(s.d)}</p>${s.go ? `<button class="tour-go" data-spot="${s.go.spot}">${esc(s.go.label)} <i class="i i-arrow-right" aria-hidden="true"></i></button>` : ''}</div>`;
    $('.tour-go', el)?.addEventListener('click', e => { const k = e.currentTarget.dataset.spot; close(); showGraph(k); });
    $('.tour-step', el).textContent = `${i + 1} of ${SLIDES.length}`;
    $$('.tour-dots button', el).forEach((b, n) => { b.classList.toggle('on', n === i); b.setAttribute('aria-selected', n === i); });
    $('#tback', el).style.visibility = i ? 'visible' : 'hidden';
    const nx = $('#tnext', el);
    if (last) {
      nx.textContent = 'See the line graph';
      if (!$('#tlook', el)) $('.tour-nav', el).insertAdjacentHTML('afterend', `<div class="tour-end"><button id="trate">Start rating</button><span>·</span>${cloud.ready && !cloud.user ? '<a href="#/signin" id="tjoin">Create a free account</a><span>·</span>' : ''}<button id="tlook">Just look around</button></div>`);
      $('#trate', el).onclick = () => close('#/rate');
      $('#tlook', el).onclick = () => close();
      $('#tjoin', el)?.addEventListener('click', e => { e.preventDefault(); close('#/signin'); });
    } else { nx.textContent = 'Next'; $('.tour-end', el)?.remove(); }
    $('#tskip2', el).style.visibility = last ? 'hidden' : 'visible';
  };
  const go = d => { const n = Math.min(SLIDES.length - 1, Math.max(0, i + d)); if (n === i) return; i = n; buzz(8); draw(d); };
  $('#tnext', el).onclick = () => { if (i === SLIDES.length - 1) { close(); showGraph('heartbeat'); } else go(1); };
  $('#tback', el).onclick = () => go(-1);
  $('#tskip2', el).onclick = () => close();
  $$('.tour-dots button', el).forEach(b => b.onclick = () => { const n = +b.dataset.n; const d = n - i; i = n; draw(Math.sign(d)); });
  // Swipe between slides
  const stage = $('.tour-stage', el);
  stage.addEventListener('pointerdown', e => { x0 = e.clientX; });
  stage.addEventListener('pointerup', e => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); });
  const onKey = e => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'Tab') { const f = $$('button, a[href]', el).filter(b => b.offsetParent && b.style.visibility !== 'hidden'); if (!f.length) return; const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
  };
  document.addEventListener('keydown', onKey);
  draw();
  setTimeout(() => $('#tnext', el)?.focus(), 60);
}

/* ---------- Take people to a real line graph and point at it ---------- */
const GRAPHS = {
  heartbeat: { hash: '#/t/inter', sel: '#hb', title: 'This is the Heartbeat line', text: 'It shows how people felt from the first minute to the last. The high points are where it gets good, the dips are where people got bored. Tap any point to see what happened there. Every movie and show has one.', next: ['Rate your first movie', '#/rate'] },
  boxoffice: { hash: '#/boxoffice/tmdb-579974', sel: '.chartcard', title: 'This is the box office line', text: 'Every point is one day of earnings. The dashed lines show the budget, so you can see the exact day a film made its money back. Switch between daily and total at the top.', next: ['See this week’s box office', '#/boxoffice'] },
};
export function showGraph(k) {
  const g = GRAPHS[k]; if (!g) return;
  document.querySelectorAll('.tcall').forEach(x => x.remove()); document.querySelectorAll('.tspot').forEach(x => x.classList.remove('tspot'));
  location.hash = g.hash;
  let tries = 0;
  const find = () => {
    const el = [...document.querySelectorAll(g.sel)].find(x => x.offsetParent !== null);
    if (!el) { if (++tries < 40) setTimeout(find, 150); return; }
    const box = el.closest('section, .card') || el;
    box.classList.add('tspot');
    const call = document.createElement('div'); call.className = 'tcall'; call.setAttribute('role', 'note');
    call.innerHTML = `<b>${esc(g.title)}</b><p>${esc(g.text)}</p><div><button class="btn sm" data-a="ok">Got it</button><a class="btn sm ghost" href="${g.next[1]}">${esc(g.next[0])}</a></div>`;
    box.insertBefore(call, box.firstChild);
    const off = () => { call.remove(); box.classList.remove('tspot'); };
    call.querySelector('[data-a="ok"]').onclick = off;
    call.querySelector('a').addEventListener('click', off);
    setTimeout(() => box.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }), 120);
  };
  setTimeout(find, 250);
}

/** First time in Quick Rate: an animated hand shows the three swipes. Goes away on tap or the first swipe. */
export function qrCoach(app) {
  if (seen(QR) || !seen(DONE)) return;
  const stack = app.querySelector('.stack'); if (!stack || stack.querySelector('.qcoach')) return;
  const c = document.createElement('div'); c.className = 'qcoach'; c.setAttribute('role', 'note');
  c.innerHTML = `<div class="qc-hand" aria-hidden="true"></div>
    <div class="qc-tips"><span><b>Swipe right</b> loved it</span><span><b>Swipe left</b> not for me</span><span><b>Swipe up</b> haven’t seen it</span></div>
    <button class="btn sm">Got it</button>`;
  stack.appendChild(c);
  const done = () => { mark(QR); c.classList.add('out'); setTimeout(() => c.remove(), 200); };
  c.addEventListener('click', done);
  stack.addEventListener('pointerdown', done, { once: true });
  app.querySelectorAll('.qbtns button').forEach(b => b.addEventListener('click', done, { once: true }));
}
