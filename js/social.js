// Friends & social: server calls, profile photos, avatars, title lookups and QR codes.
// Every rule (who can see what, rate limits, under-18 safety) is enforced on the server.
import { cloud, idOf, refreshMe } from './cloud.js';
import { BYID } from './data.js';
import { loadTitle } from './tmdb.js';
import { esc } from './ui.js';

async function rpc(fn, args = {}) {
  if (!cloud.sb) throw new Error('You seem to be offline. Try again.');
  const { data, error } = await cloud.sb.rpc(fn, args);
  if (error) throw new Error(error.message || 'Something went wrong. Please try again.');
  return data;
}
export const S = {
  profile: u => rpc('get_profile', { p_username: u }),
  friends: () => rpc('friends_overview'),
  search: q => rpc('search_people', { p_q: q }),
  suggest: () => rpc('suggest_people', { p_limit: 12 }),
  request: id => rpc('send_friend_request', { p_user: id }),
  respond: (req, yes) => rpc('respond_friend_request', { p_id: req, p_accept: yes }),
  cancel: req => rpc('cancel_friend_request', { p_id: req }),
  unfriend: id => rpc('unfriend', { p_user: id }),
  follow: id => rpc('follow_user', { p_user: id }),
  unfollow: id => rpc('unfollow_user', { p_user: id }),
  block: id => rpc('block_user', { p_user: id }),
  unblock: id => rpc('unblock_user', { p_user: id }),
  report: (id, reason, note) => rpc('report_user', { p_user: id, p_reason: reason, p_note: note || null }),
  match: id => rpc('taste_match', { p_user: id }),
  feed: (before, user, limit = 20) => rpc('get_feed', { p_before: before || null, p_limit: limit, p_user: user || null }),
  like: id => rpc('toggle_activity_like', { p_id: id }),
  comments: id => rpc('list_activity_comments', { p_id: id }),
  comment: (id, body) => rpc('add_activity_comment', { p_id: id, p_body: body }),
  uncomment: id => rpc('delete_activity_comment', { p_id: id }),
  inviteInfo: code => rpc('invite_info', { p_code: code }),
  acceptInvite: code => rpc('accept_invite', { p_code: code }),
  resetInvite: () => rpc('reset_invite'),
  setFavorites: keys => rpc('set_favorites', { p_titles: keys }),
};

/** Is the friends system available? (signed in, set up, and the backend is ready) */
export const socialReady = () => !!(cloud.ready && cloud.user && cloud.profile?.username);

/* ---------- avatars ---------- */
const COLORS = [['#ff4f9a', '#9b6bff'], ['#62b8ff', '#9b6bff'], ['#ffd35c', '#ff8a4c'], ['#4fe3b0', '#3fb6c9'], ['#ff8a4c', '#ff4f9a'], ['#9b6bff', '#62b8ff']];
const hue = s => [...String(s || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length;
/** Round avatar: the photo if there is one, otherwise a colored circle with the first letter. */
export function avatar(p, size = 'sm', extra = '') {
  const name = p?.display_name || p?.username || '?';
  const [a, b] = COLORS[hue(p?.username)];
  const letter = esc((name[0] || '?').toUpperCase());
  const img = p?.avatar_url && /^https:\/\//.test(p.avatar_url)
    ? `<img src="${esc(p.avatar_url)}" alt="" loading="lazy" decoding="async">` : '';
  const fr = p?.frame && /^[a-z]+$/.test(p.frame) ? ` fr-${p.frame}` : '';
  return `<span class="ava ${size} ${extra}${fr}" aria-hidden="true" style="background:linear-gradient(135deg,${a},${b})"><i>${letter}</i>${img}</span>`;
}
// A photo that fails to load falls back to the letter underneath.
document.addEventListener('error', e => { if (e.target?.matches?.('.ava img')) e.target.remove(); }, true);
export const RANK_E = { 'Popcorn': '🍿', 'Ticket Holder': '🎟️', 'Front Row': '💺', 'Critic': '📝', 'Top Critic': '⭐', "Director's Cut": '🎬', 'Legend': '👑' };
export const rankChip = r => r ? `<span class="rankchip sm">${RANK_E[r] || '🍿'} ${esc(r)}</span>` : '';
export const handle = p => `@${esc(p?.username || 'someone')}`;
export const profileHref = p => `#/u/${encodeURIComponent(p?.username || '')}`;

/* ---------- profile photo upload ---------- */
/** Center-crop to a 320×320 square and shrink, so uploads are small and safe. */
async function squareImage(file) {
  if (!/^image\/(png|jpe?g|webp|gif|heic|heif)$/i.test(file.type)) throw new Error('Please pick a photo (JPG, PNG or WebP).');
  if (file.size > 15e6) throw new Error('That photo is too big. Pick one under 15 MB.');
  const bmp = await createImageBitmap(file).catch(() => { throw new Error('Could not open that photo. Try another one.'); });
  const s = Math.min(bmp.width, bmp.height), N = 320;
  const c = document.createElement('canvas'); c.width = c.height = N;
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, N, N);
  bmp.close?.();
  const blob = await new Promise(r => c.toBlob(r, 'image/webp', 0.85));
  if (blob && blob.type === 'image/webp') return { blob, ext: 'webp', type: 'image/webp' };
  const jpg = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85)); // Safari can't make WebP
  return { blob: jpg, ext: 'jpg', type: 'image/jpeg' };
}
export async function uploadAvatar(file) {
  const uid = cloud.user?.id; if (!uid) throw new Error('Please sign in first.');
  const { blob, ext, type } = await squareImage(file);
  if (blob.size > 1e6) throw new Error('That photo is still too big. Try another one.');
  const bucket = cloud.sb.storage.from('avatars');
  const path = `${uid}/${Date.now().toString(36)}.${ext}`;
  const up = await bucket.upload(path, blob, { contentType: type, cacheControl: '31536000', upsert: false });
  if (up.error) throw new Error(/row-level|policy|not allowed/i.test(up.error.message) ? 'Please finish setting up your account first.' : 'Could not upload the photo. Try again.');
  const url = bucket.getPublicUrl(path).data.publicUrl;
  const { error } = await cloud.sb.from('profiles').update({ avatar_url: url }).eq('id', uid);
  if (error) throw new Error(error.message);
  await cleanupOld(path);
  await refreshMe();
  return url;
}
export async function removeAvatar() {
  const uid = cloud.user?.id; if (!uid) return;
  const { error } = await cloud.sb.from('profiles').update({ avatar_url: null }).eq('id', uid);
  if (error) throw new Error(error.message);
  await cleanupOld(null);
  await refreshMe();
}
async function cleanupOld(keep) {
  try {
    const uid = cloud.user.id, bucket = cloud.sb.storage.from('avatars');
    const { data } = await bucket.list(uid, { limit: 50 });
    const old = (data || []).map(f => `${uid}/${f.name}`).filter(p => p !== keep);
    if (old.length) await bucket.remove(old);
  } catch (e) { /* not important */ }
}

/* ---------- titles from server keys ('movie:27205') ---------- */
/** Get the title object for a server key. Loads from TMDB when it isn't in the local catalog. */
export async function titleFor(key) {
  if (!/^(movie|tv):\d+$/.test(key || '')) return null;
  const id = idOf(key);
  return BYID[id] || await loadTitle(id).catch(() => null);
}
export async function titlesFor(keys) {
  const list = await Promise.all((keys || []).map(titleFor));
  return list.filter(Boolean);
}

/* ---------- invite links + QR ---------- */
export const inviteUrl = code => `${location.origin}/#/invite/${encodeURIComponent(code)}`;
let QR = null;
/** QR code as an SVG string (dark dots on white so every camera can read it). */
export async function qrSvg(text) {
  QR = QR || (await import('./vendor/qrcode.js')).default;
  const q = QR(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), m = 2; let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n + m * 2} ${n + m * 2}" role="img" aria-label="QR code for your invite link" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#1a0f2e"/></svg>`;
}

export const ago = iso => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
