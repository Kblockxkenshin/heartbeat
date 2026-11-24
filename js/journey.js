// The "journey" model: heartbeat graph, where it gets good, where people quit.
// Sample numbers are generated from each title's shape until real users rate it.
import { TAGS, TAGC } from './data.js';
import { U } from './store.js';
import { esc } from './ui.js';

const hash = s => { let h = 1779033703 ^ s.length; for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; } return h >>> 0; };
const rng = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const argmax = a => a.reduce((b, v, i) => v > a[b] ? i : b, 0);
const shapeAt = (sh, x) => { if (sh.length < 2) return sh[0] ?? .5; const p = x * (sh.length - 1), i = Math.floor(p), f = p - i; return i >= sh.length - 1 ? sh.at(-1) : sh[i] * (1 - f) + sh[i + 1] * f; };

export function timeline(t) {
  if (t.type === 'movie') { const n = Math.ceil((t.runtime || 110) / 15); return Array.from({ length: n }, (_, i) => ({ s: i * 15 + 'm', l: 'minute ' + i * 15 })); }
  const s = t.seasons || [8];
  if (s.length > 1) return s.map((_, i) => ({ s: 'S' + (i + 1), l: 'Season ' + (i + 1) }));
  return Array.from({ length: s[0] }, (_, i) => ({ s: 'E' + (i + 1), l: 'Episode ' + (i + 1) }));
}

const JC = {};
export function journey(t) {
  const k = t.id;
  if (!JC[k]) {
    const tl = timeline(t), n = tl.length, r = rng(hash(k));
    const pts = tl.map((lab, i) => {
      const x = n > 1 ? i / (n - 1) : 0, I = clamp(shapeAt(t.shape, x) + (r() - .5) * .22, 0, 1);
      const tw = (t.twists || []).some(f => Math.abs(f - x) < .5 / n), v = 20 + Math.round(r() * 40), f = t.flavor;
      const w = { 'Boring': (1 - I) ** 2 * 1.3, 'Amazing': I * I * 1.3, 'Funny': f.funny * (.3 + r() * .5), 'Scary': f.scary * (.3 + r() * .5) * (.5 + I), 'Sad': f.sad * (.2 + r() * .5) * (.4 + x), 'Plot twist': tw ? 1.4 : (I > .7 ? .15 * r() : .02) };
      const sum = Object.values(w).reduce((a, b) => a + b, 0), tags = {};
      TAGS.forEach(g => tags[g] = Math.round(w[g] / sum * v));
      return { ...lab, I, tags };
    });
    let g = pts.findIndex(p => p.I >= .62); if (g < 0) g = argmax(pts.map(p => p.I));
    const gotGood = pts.map((_, i) => Math.round(120 * Math.exp(-((i - g) ** 2) / (2 * (n > 6 ? 1.3 : .7))) * (.85 + r() * .3)));
    const quits = pts.map((p, i) => i === n - 1 ? 0 : Math.round((1 - p.I) * 34 * (1 - i / n * .65) * (.7 + r() * .6)));
    JC[k] = { pts, gotGood, quits };
  }
  const b = JC[k];
  const pts = b.pts.map(p => ({ ...p, tags: { ...p.tags } }));
  U.tags.filter(x => x.k === k).forEach(x => { if (pts[x.i]) pts[x.i].tags[x.tag]++; });
  const gotGood = b.gotGood.slice(), quits = b.quits.slice();
  if (U.gotGood[k] != null) gotGood[U.gotGood[k]]++;
  if (U.quit[k] != null) quits[U.quit[k]]++;
  return { pts, gotGood, quits, tl: timeline(t) };
}
export const beat = tg => { const tot = Object.values(tg).reduce((a, b) => a + b, 0) || 1; return (tg['Amazing'] + tg['Plot twist'] * 1.25 + tg['Funny'] * .7 + tg['Scary'] * .85 + tg['Sad'] * .65 - tg['Boring'] * 1.1) / tot; };
export const dom = tg => TAGS.reduce((b, g) => tg[g] > tg[b] ? g : b, TAGS[0]);

/** Smooth heartbeat line as SVG. Tappable columns carry data-pt. */
export function heartbeatSVG(t, J, sel) {
  const W = 360, H = 170, P = 18, top = 26, bot = H - 30, n = J.pts.length;
  const raw = J.pts.map(p => beat(p.tags)), vals = raw.map((v, i) => (raw[i - 1] ?? v) * .25 + v * .5 + (raw[i + 1] ?? v) * .25);
  const mn = Math.min(...vals) - .1, mx = Math.max(...vals) + .1;
  const xs = vals.map((_, i) => n > 1 ? P + i * (W - 2 * P) / (n - 1) : W / 2), ys = vals.map(v => bot - (v - mn) / (mx - mn) * (bot - top));
  let d = `M${xs[0]},${ys[0]}`;
  for (let i = 0; i < n - 1; i++) { const x0 = xs[i - 1] ?? xs[i], y0 = ys[i - 1] ?? ys[i], x3 = xs[i + 2] ?? xs[i + 1], y3 = ys[i + 2] ?? ys[i + 1]; d += ` C${xs[i] + (xs[i + 1] - x0) / 6},${ys[i] + (ys[i + 1] - y0) / 6} ${xs[i + 1] - (x3 - xs[i]) / 6},${ys[i + 1] - (y3 - ys[i]) / 6} ${xs[i + 1]},${ys[i + 1]}`; }
  const step = n > 1 ? (W - 2 * P) / (n - 1) : W, every = n > 12 ? 3 : n > 8 ? 2 : 1, pk = argmax(vals);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Heartbeat graph: how people felt across ${esc(t.name)}" style="display:block;font-family:Nunito,system-ui,sans-serif">
  <defs><linearGradient id="hf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff4f9a" stop-opacity=".45"/><stop offset="1" stop-color="#ff4f9a" stop-opacity="0"/></linearGradient>
  <linearGradient id="hl" x1="0" x2="1"><stop offset="0" stop-color="#ffd35c"/><stop offset=".5" stop-color="#ff4f9a"/><stop offset="1" stop-color="#9b6bff"/></linearGradient></defs>
  <path d="${d} L${xs[n - 1]},${bot} L${xs[0]},${bot} Z" fill="url(#hf)"/>
  <path d="${d}" fill="none" stroke="url(#hl)" stroke-width="3.5" stroke-linecap="round"/>
  <text x="${xs[pk]}" y="${ys[pk] - 12}" text-anchor="middle" font-size="14">🔥</text>
  ${xs.map((x, i) => `<circle cx="${x}" cy="${ys[i]}" r="${i === sel ? 8 : 4.5}" fill="${TAGC[dom(J.pts[i].tags)]}" stroke="${i === sel ? '#fff' : '#0d0b16'}" stroke-width="2.5"/>`).join('')}
  ${J.tl.map((x, i) => i % every === 0 || i === n - 1 ? `<text x="${xs[i]}" y="${bot + 18}" fill="#b4abc8" font-size="11" font-weight="800" text-anchor="middle">${esc(x.s)}</text>` : '').join('')}
  ${xs.map((x, i) => `<rect data-pt="${i}" x="${x - step / 2}" y="0" width="${step}" height="${H}" fill="transparent" style="cursor:pointer"><title>${esc(J.tl[i].l)}</title></rect>`).join('')}
  </svg>`;
}
