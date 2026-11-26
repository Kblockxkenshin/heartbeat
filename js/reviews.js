// Written reviews: talking to the server, drafts, safe text formatting, small graphics, share card.
import { cloud, keyOf, plain } from './cloud.js';
import { esc } from './ui.js';
import { CONFIG } from './config.js';

export const TAG_LIST = ['Great acting', 'Slow start', 'Amazing ending', 'Rewatchable', 'Cried 😭', 'Mind-blown 🤯',
  'Funny', 'Scary', 'Beautiful visuals', 'Great music', 'Plot twist', 'Weak ending', 'Too long', 'Comfort watch', 'Overrated', 'Underrated'];
export const MIN = 20, MAX = 5000;
export const PRIVACY = { public: ['🌍', 'Public'], friends: ['👥', 'Friends only'], private: ['🔒', 'Only me'] };

/* ---------- server calls ---------- */
async function rpc(name, args) {
  if (!cloud.sb) throw new Error('Accounts are not switched on yet.');
  const { data, error } = await cloud.sb.rpc(name, args);
  if (error) throw new Error(plain(error));
  return data;
}
export const reviewsReady = () => !!cloud.ready;
export const listReviews = (titleId, sort = 'helpful', min = 0, max = 5, offset = 0) =>
  rpc('list_reviews', { p_title: keyOf(titleId), p_sort: sort, p_min: min, p_max: max, p_limit: 20, p_offset: offset });
export const precheck = p => rpc('precheck_review', { p });
export const postReview = p => rpc('post_review', { p });
export const editReview = (id, p) => rpc('edit_review', { p_id: id, p });
export const deleteReview = id => rpc('delete_review', { p_id: id });
export const vote = (id, kind) => rpc('toggle_vote', { p_review: id, p_kind: kind });
export const listComments = id => rpc('list_comments', { p_review: id });
export const addComment = (id, body, parent = null) => rpc('add_comment', { p_review: id, p_body: body, p_parent: parent });
export const deleteComment = id => rpc('delete_comment', { p_id: id });
export const report = (reviewId, commentId, reason, note) => rpc('report_review', { p_review: reviewId, p_comment: commentId, p_reason: reason, p_note: note || null });
export const myReviews = (q = '', sort = 'new') => rpc('my_reviews', { p_q: q, p_sort: sort });
export const appealReview = (id, note) => rpc('appeal_review', { p_id: id, p_note: note || null });
export const syncReviews = () => rpc('review_status_sync');
/** Ask the server to run the AI check on my review. Returns { ai, result } (ai:false = rule check only). */
export async function aiCheck(id) {
  const { data } = await cloud.sb.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Please sign in first.');
  const r = await fetch('/api/review-check', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ id }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Could not check it right now.');
  return d;
}
export const isPublic = r => !r.ai_status || r.ai_status === 'ok' || r.ai_status === 'tips';

/* ---------- drafts: on the server when signed in, on this device as a backup ---------- */
const LK = 'heartbeat_drafts';
const localDrafts = () => { try { return JSON.parse(localStorage.getItem(LK)) || {}; } catch (e) { return {}; } };
const saveLocal = d => { try { localStorage.setItem(LK, JSON.stringify(d)); } catch (e) { /* full */ } };
export async function saveDraft(titleId, data) {
  const key = keyOf(titleId); if (!key) return;
  const d = localDrafts(); d[key] = { data, at: Date.now() }; saveLocal(d);
  if (cloud.user) {
    const { error } = await cloud.sb.from('review_drafts').upsert({ user_id: cloud.user.id, title_key: key, data, updated_at: new Date().toISOString() }, { onConflict: 'user_id,title_key' });
    if (error) throw new Error(plain(error));
  }
}
export async function loadDraft(titleId) {
  const key = keyOf(titleId); if (!key) return null;
  if (cloud.user) {
    const { data } = await cloud.sb.from('review_drafts').select('data,updated_at').eq('title_key', key).maybeSingle();
    if (data) return data.data;
  }
  return localDrafts()[key]?.data || null;
}
export async function dropDraft(titleId) {
  const key = keyOf(titleId); if (!key) return;
  const d = localDrafts(); delete d[key]; saveLocal(d);
  if (cloud.user) await cloud.sb.from('review_drafts').delete().eq('user_id', cloud.user.id).eq('title_key', key);
}
export async function allDrafts() {
  const out = {};
  for (const [k, v] of Object.entries(localDrafts())) out[k] = { data: v.data, at: v.at };
  if (cloud.user) {
    const { data } = await cloud.sb.from('review_drafts').select('title_key,data,updated_at');
    (data || []).forEach(r => { out[r.title_key] = { data: r.data, at: Date.parse(r.updated_at) }; });
  }
  return Object.entries(out).map(([key, v]) => ({ key, ...v })).sort((a, b) => b.at - a.at);
}

/* ---------- safe formatting: **bold**, *italic*, ||spoiler||, line breaks. Never raw HTML. ---------- */
export function fmt(text, { revealAll = false } = {}) {
  let h = esc(text || '');
  h = h.replace(/\|\|([\s\S]+?)\|\|/g, (_, s) => revealAll ? `<span class="spo shown">${s}</span>`
    : `<button type="button" class="spo" aria-label="Spoiler. Tap to reveal">${s}</button>`);
  h = h.replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<i>$2</i>');
  return h.replace(/\n/g, '<br>');
}
export const countChars = t => (t || '').replace(/\|\||\*\*|\*/g, '').length;

/* ---------- small journey graph (Start / Middle / Ending) ---------- */
export function miniGraph(s, m, e, w = 74, h = 30) {
  const y = v => h - 4 - (v - 1) / 4 * (h - 8), x = [5, w / 2, w - 5], v = [s, m, e];
  return `<svg class="mini" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Start ${s}, middle ${m}, ending ${e} hearts">
    <polyline points="${x.map((xx, i) => `${xx},${y(v[i])}`).join(' ')}" fill="none" stroke="url(#mgg)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <defs><linearGradient id="mgg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${w}" y2="0"><stop offset="0" stop-color="#ff4f9a"/><stop offset="1" stop-color="#9b6bff"/></linearGradient></defs>
    ${x.map((xx, i) => `<circle cx="${xx}" cy="${y(v[i])}" r="3.5" fill="#fff"/>`).join('')}</svg>`;
}
export const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');
export function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ---------- share card (1080×1350 image) ---------- */
function loadImg(src) {
  return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}
function wrap(x, text, maxW, maxLines) {
  const words = text.split(/\s+/), lines = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (x.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
  return lines;
}
/** Draws a pretty card: poster + quote + journey graph. Spoilers are never shown. */
export async function shareCard(t, r) {
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1350; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 1080, 1350); g.addColorStop(0, '#2a0f3d'); g.addColorStop(1, '#0d0b16'); x.fillStyle = g; x.fillRect(0, 0, 1080, 1350);
  // poster through our own server so the image can be saved
  const img = t.posterPath ? await loadImg(`/api/img?size=w500&path=${encodeURIComponent(t.posterPath)}`) : null;
  x.save(); x.beginPath(); x.roundRect(80, 90, 360, 540, 32); x.clip();
  if (img) x.drawImage(img, 80, 90, 360, 540); else { const pg = x.createLinearGradient(80, 90, 440, 630); pg.addColorStop(0, t.colors[1]); pg.addColorStop(1, t.colors[0]); x.fillStyle = pg; x.fillRect(80, 90, 360, 540); }
  x.restore();
  x.fillStyle = '#fff'; x.font = '900 64px Nunito, system-ui, sans-serif';
  wrap(x, t.name, 540, 3).forEach((l, i) => x.fillText(l, 480, 170 + i * 72));
  x.font = '800 34px Nunito, system-ui, sans-serif'; x.fillStyle = '#b4abc8'; x.fillText(`${t.year} · ${t.type === 'tv' ? 'Series' : 'Movie'}`, 480, 420);
  x.fillStyle = '#ffd35c'; x.font = '900 56px Nunito, system-ui, sans-serif'; x.fillText(`★ ${r.overall}`, 480, 510);
  // journey graph
  const gx = [480, 730, 980], gy = v => 620 - (v - 1) / 4 * 80, vals = [r.start_h, r.middle_h, r.end_h];
  const lg = x.createLinearGradient(480, 0, 980, 0); lg.addColorStop(0, '#ff4f9a'); lg.addColorStop(1, '#9b6bff');
  x.strokeStyle = lg; x.lineWidth = 10; x.lineCap = 'round'; x.lineJoin = 'round'; x.beginPath(); gx.forEach((xx, i) => i ? x.lineTo(xx, gy(vals[i])) : x.moveTo(xx, gy(vals[i]))); x.stroke();
  x.fillStyle = '#fff'; gx.forEach((xx, i) => { x.beginPath(); x.arc(xx, gy(vals[i]), 12, 0, 7); x.fill(); });
  x.font = '800 26px Nunito, system-ui, sans-serif'; x.fillStyle = '#b4abc8'; ['Start', 'Middle', 'Ending'].forEach((l, i) => x.fillText(l, gx[i] - 30, 670));
  // quote (spoilers removed)
  const quote = (r.headline ? r.headline + ' — ' : '') + (r.body || '').replace(/\|\|[\s\S]+?\|\|/g, '[spoiler]').replace(/\*\*|\*/g, '').replace(/\s+/g, ' ');
  x.fillStyle = '#ff4f9a'; x.font = '900 140px Georgia, serif'; x.fillText('“', 70, 840);
  x.fillStyle = '#f7f4ff'; x.font = '700 46px Nunito, system-ui, sans-serif';
  wrap(x, r.has_spoilers && !/\|\|/.test(r.body) ? 'This review has spoilers. Read it on Heartbeat.' : quote, 900, 6).forEach((l, i) => x.fillText(l, 100, 860 + i * 64));
  x.fillStyle = '#b4abc8'; x.font = '800 36px Nunito, system-ui, sans-serif'; x.fillText(`— @${r.username || 'me'}`, 100, 1270);
  const bg = x.createLinearGradient(700, 1220, 1000, 1290); bg.addColorStop(0, '#ff4f9a'); bg.addColorStop(1, '#9b6bff');
  x.fillStyle = bg; x.beginPath(); x.roundRect(700, 1220, 300, 70, 35); x.fill(); x.fillStyle = '#fff'; x.font = '900 36px Nunito, system-ui, sans-serif'; x.fillText('💓 heartbeat', 730, 1268);
  return new Promise(res => c.toBlob(b => res(b), 'image/png'));
}
export async function shareReviewImage(t, r) {
  const blob = await shareCard(t, r); if (!blob) throw new Error('Could not make the image.');
  const file = new File([blob], `heartbeat-${(t.name || 'review').replace(/\W+/g, '-').toLowerCase()}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: `${t.name} on Heartbeat` }); return 'shared'; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000); return 'downloaded';
}
export const imgUrl = (path, size = 'w342') => path ? CONFIG.imageBase + size + path : null;
