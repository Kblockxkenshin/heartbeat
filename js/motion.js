// Quiet motion: slow fades, count-ups and a gentle poster tilt.
// Anime.js (MIT) and Apache ECharts (Apache-2.0) load from jsDelivr only when a page needs them.
// Everything still works without them (offline, blocked, or "reduce motion" turned on).
import { reduced } from './ui.js';

export const ANIME_URL = 'https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.esm.min.js';
export const ECHARTS_URL = 'https://cdn.jsdelivr.net/npm/echarts@6.1.0/dist/echarts.esm.min.mjs';
let animeP = null, chartsP = null;
const load = url => import(url);
export const anime = () => (animeP ||= load(ANIME_URL).catch(() => { animeP = null; return null; }));
export const echarts = () => (chartsP ||= load(ECHARTS_URL).catch(() => { chartsP = null; return null; }));

/** Fade and lift items in, one after another (like a page settling). */
export async function reveal(items) {
  const els = [...items].filter(Boolean);
  if (!els.length || reduced()) return;
  els.forEach(e => { e.style.opacity = '0'; });
  const A = await anime();
  if (!A) { els.forEach(e => { e.style.opacity = ''; }); return; }
  const done = () => els.forEach(e => { e.style.opacity = ''; e.style.transform = ''; });
  A.animate(els, { opacity: [0, 1], translateY: [10, 0], duration: 620, delay: A.stagger(45, { start: 40 }), ease: 'outQuad', onComplete: done });
  // Safety: background tabs pause animations, so never leave content hidden.
  setTimeout(done, 700 + els.length * 45 + 400);
}

/** Count a number up from zero. fmt turns the number into text. */
export async function countUp(el, value, fmt) {
  if (!el || value == null || isNaN(value)) return;
  if (reduced() || document.hidden) { el.textContent = fmt(value); return; }
  const A = await anime();
  if (!A) { el.textContent = fmt(value); return; }
  const o = { v: 0 };
  A.animate(o, { v: value, duration: 1100, ease: 'outExpo', onUpdate: () => { el.textContent = fmt(o.v); }, onComplete: () => { el.textContent = fmt(value); } });
}

/* ---------- gentle tilt on posters (mouse only, never on touch) ---------- */
const MAX = 6;
let tilted = null;
function onMove(e) {
  const card = e.target.closest?.('.pcard .poster, .upc-p .poster, .bopost .poster');
  if (tilted && tilted !== card) { tilted.style.transform = ''; tilted.classList.remove('tilting'); tilted = null; }
  if (!card) return;
  const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
  card.classList.add('tilting'); tilted = card;
  card.style.transform = `perspective(700px) rotateX(${(-y * MAX).toFixed(2)}deg) rotateY(${(x * MAX).toFixed(2)}deg) scale(1.02)`;
}
export function startTilt() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches || reduced()) return;
  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerleave', () => { if (tilted) { tilted.style.transform = ''; tilted = null; } });
}
