// The online account: sign-in, and saving ratings / Quick Rate / watchlist to Supabase.
// If the backend isn't set up (or you're offline), the app keeps working on this device only.
import { TITLES } from './data.js';

const SB_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const listeners = new Set();

export const cloud = {
  ready: false,      // backend configured and library loaded
  sb: null,          // Supabase client
  user: null,        // signed-in user (or null)
  profile: null,     // { username, display_name, avatar_url, bio, fav_titles, is_private, invite_code }
  requests: 0,       // friend requests waiting for me
  unreadChats: 0,    // chats with new messages
  chatRequests: 0,   // message requests from non-friends
  stats: null,       // { xp, rank, streak_count, streak_best, is_minor, plus_until }
  needsBirthdate: false,
  needsCode: false,  // 2-step sign-in is on, and this session still needs the code
  sec: null,         // { admin, aal, status, until, reason, paused, mfa, needs_code } from the server
  turnstile: '',     // Cloudflare Turnstile site key (public), if bot protection is turned on
  remote: null,      // { ratings, swipes, watchlist } loaded from the server
  error: null,
};
export const onCloud = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => { try { fn(cloud); } catch (e) { console.error(e); } });

/* ---------- title ids: app id <-> server key ('movie:27205') ---------- */
const BY_KEY = Object.fromEntries(TITLES.map(t => [`${t.type}:${t.tmdb}`, t.id]));
export function keyOf(id) {
  const t = TITLES.find(x => x.id === id);
  if (t) return `${t.type}:${t.tmdb}`;
  const m = /^tmdb-(movie|tv)-(\d+)$/.exec(id);
  return m ? `${m[1]}:${m[2]}` : null;
}
export function idOf(key) {
  if (BY_KEY[key]) return BY_KEY[key];
  const [type, n] = key.split(':');
  return `tmdb-${type}-${n}`;
}

/* ---------- start ---------- */
let started = null;
export function startCloud() {
  if (started) return started;
  started = (async () => {
    try {
      const cfg = await fetch('/api/config').then(r => r.ok ? r.json() : null).catch(() => null);
      if (!cfg?.ready) { cloud.error = cfg?.error || 'not-configured'; emit(); return; }
      cloud.turnstile = cfg.turnstileSiteKey || '';
      const { createClient } = await import(SB_LIB);
      cloud.sb = createClient(cfg.url, cfg.anonKey, {
        auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      cloud.ready = true;
      cloud.sb.auth.onAuthStateChange((evt, session) => {
        const was = cloud.user?.id;
        cloud.user = session?.user || null;
        if (cloud.user && cloud.user.id !== was) setTimeout(() => loadMe(true), 0);
        if (!cloud.user) { cloud.profile = cloud.stats = cloud.remote = null; cloud.needsBirthdate = false; }
        if (evt === 'PASSWORD_RECOVERY') location.hash = '#/signin/reset';
        emit();
      });
      const { data, error } = await cloud.sb.auth.getSession();
      if (error) cloud.error = error.message;
      cloud.user = data?.session?.user || null;
      // Clean "?code=..." off the address bar after an email link sign-in.
      if (/[?&](code|error_description)=/.test(location.search)) {
        const err = new URLSearchParams(location.search).get('error_description');
        history.replaceState(null, '', location.pathname + location.hash);
        if (err) cloud.error = err;
        else if (!cloud.user) cloud.flash = 'Email confirmed! Please sign in.';
      }
      emit();
      if (cloud.user) await loadMe(true);
    } catch (e) {
      cloud.error = 'offline'; emit();
    }
  })();
  return started;
}

/* ---------- my account data ---------- */
async function loadMe(first) {
  const sb = cloud.sb, uid = cloud.user?.id; if (!sb || !uid) return;
  await checkAal();
  if (first) {
    sb.rpc('register_device', { p_device: deviceId() }).then(() => {}, () => {});
    let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { }
    sb.rpc('set_region', { p_tz: tz }).then(() => {}, () => {});
  }
  const [p, s, priv, r, sw, w, mine, sec] = await Promise.all([
    sb.from('profiles').select('username,display_name,avatar_url').eq('id', uid).maybeSingle(),
    sb.from('user_stats').select('xp,rank,streak_count,streak_best,streak_last,is_minor,plus_until').eq('user_id', uid).maybeSingle(),
    sb.from('private_profiles').select('birthdate').eq('id', uid).maybeSingle(),
    sb.from('ratings').select('title_key,start_h,middle_h,end_h,overall,updated_at'),
    sb.from('swipes').select('title_key,kind'),
    sb.from('watchlist').select('title_key,added_at'),
    sb.rpc('my_profile').then(x => x, () => ({ data: null })),
    sb.rpc('my_security').then(x => x, () => ({ data: null })),
  ]);
  cloud.sec = sec.data || null;
  cloud.profile = p.data ? { ...p.data, ...(mine.data || {}) } : null;
  cloud.requests = +(mine.data?.requests || 0);
  cloud.unreadChats = +(mine.data?.unread_chats || 0);
  cloud.chatRequests = +(mine.data?.chat_requests || 0);
  cloud.stats = s.data || null;
  cloud.needsBirthdate = !priv.data?.birthdate;
  cloud.remote = { ratings: r.data || [], swipes: sw.data || [], watchlist: w.data || [] };
  if (first && !cloud.needsBirthdate && !cloud.needsCode && !cloud.sec?.paused) {
    const c = await sb.rpc('daily_checkin');
    if (c.data) { cloud.stats = { ...cloud.stats, xp: c.data.xp, rank: c.data.rank }; cloud.checkin = c.data; }
  }
  emit();
}
export const refreshMe = () => loadMe(false);
/** Just the friend-request count (for the red dot). */
export async function refreshRequests() {
  if (!cloud.sb || !cloud.user) return;
  const { data } = await cloud.sb.rpc('my_profile');
  if (!data) return;
  const n = [+data.requests || 0, +data.unread_chats || 0, +data.chat_requests || 0];
  const recs = [+data.new_recs || 0, +data.unread_notes || 0], p = cloud.profile || {};
  if (n[0] !== cloud.requests || n[1] !== cloud.unreadChats || n[2] !== cloud.chatRequests || recs[0] !== (p.new_recs || 0) || recs[1] !== (p.unread_notes || 0)) {
    [cloud.requests, cloud.unreadChats, cloud.chatRequests] = n;
    if (cloud.profile) cloud.profile = { ...cloud.profile, new_recs: recs[0], unread_notes: recs[1] };
    emit();
  }
}

async function refreshStats() {
  const uid = cloud.user?.id; if (!uid) return;
  const { data } = await cloud.sb.from('user_stats').select('xp,rank,streak_count,streak_best,streak_last,is_minor,plus_until').eq('user_id', uid).maybeSingle();
  if (data) { const old = cloud.stats; cloud.stats = data; if (old && old.rank !== data.rank) cloud.rankUp = data.rank; emit(); }
}

/* ---------- saving (called by store.js) ---------- */
const friendly = e => {
  const m = e?.message || String(e || '');
  if (/Slow down/.test(m)) return m;
  if (/JWT|session/i.test(m)) return 'Please sign in again.';
  return 'Could not save online. It is saved on this device.';
};
async function run(q) {
  if (!cloud.user) return { ok: false, local: true };
  const { error } = await q;
  if (error) return { ok: false, error: friendly(error) };
  refreshStats();
  return { ok: true };
}
export function pushRating(id, r) {
  const key = keyOf(id); if (!key || !cloud.user) return Promise.resolve({ ok: false, local: true });
  return run(cloud.sb.from('ratings').upsert({ user_id: cloud.user.id, title_key: key, start_h: r.start, middle_h: r.middle, end_h: r.end }, { onConflict: 'user_id,title_key' }));
}
export function pushSwipe(id, kind) {
  const key = keyOf(id); if (!key || !cloud.user) return Promise.resolve({ ok: false, local: true });
  return run(cloud.sb.from('swipes').upsert({ user_id: cloud.user.id, title_key: key, kind }, { onConflict: 'user_id,title_key' }));
}
export function pushWatch(id, on) {
  const key = keyOf(id); if (!key || !cloud.user) return Promise.resolve({ ok: false, local: true });
  return run(on ? cloud.sb.from('watchlist').upsert({ user_id: cloud.user.id, title_key: key }, { onConflict: 'user_id,title_key' })
    : cloud.sb.from('watchlist').delete().eq('user_id', cloud.user.id).eq('title_key', key));
}
/** First sign-in on this device: copy device-only ratings into the account (no XP for these). */
export async function importLocal(U) {
  if (!cloud.user) return 0;
  const items = [];
  for (const [id, r] of Object.entries(U.ratings)) { const k = keyOf(id); if (k) items.push({ t: 'rating', k, s: r.start, m: r.middle, e: r.end }); }
  for (const [id, v] of Object.entries(U.swipes)) { const k = keyOf(id); if (k) items.push({ t: 'swipe', k, v }); }
  for (const id of Object.keys(U.watchlist)) { const k = keyOf(id); if (k) items.push({ t: 'save', k }); }
  if (!items.length) return 0;
  const { data, error } = await cloud.sb.rpc('import_local', { items: items.slice(0, 300) });
  if (error) return 0;
  await loadMe(false);
  return data || 0;
}

/* ---------- device id (random, stays on this device; the server only keeps a hash) ---------- */
function deviceId() {
  try {
    let d = localStorage.getItem('hb_device');
    if (!d || !/^[A-Za-z0-9-]{16,64}$/.test(d)) { d = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36) + 'xxxxxxxx'); localStorage.setItem('hb_device', d); }
    return d;
  } catch (e) { return 'no-storage-device-id'; }
}

/* ---------- 2-step sign-in (an authenticator app code) ---------- */
async function checkAal() {
  try {
    const { data } = await cloud.sb.auth.mfa.getAuthenticatorAssuranceLevel();
    cloud.needsCode = data?.nextLevel === 'aal2' && data?.currentLevel !== 'aal2';
  } catch (e) { cloud.needsCode = false; }
}
export async function mfaList() {
  const { data, error } = await cloud.sb.auth.mfa.listFactors();
  if (error) throw error;
  return (data?.all || []).filter(f => f.factor_type === 'totp');
}
export async function mfaStart() {
  for (const f of await mfaList()) if (f.status !== 'verified') await cloud.sb.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
  const { data, error } = await cloud.sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Heartbeat ' + new Date().toISOString().slice(0, 10) });
  if (error) throw error;
  return data;   // { id, totp: { qr_code, secret, uri } }
}
export async function mfaVerify(factorId, code) {
  const { error } = await cloud.sb.auth.mfa.challengeAndVerify({ factorId, code: String(code).replace(/\D/g, '') });
  if (error) throw new Error(/invalid|code/i.test(error.message || '') ? 'That code didn\'t work. Check the newest code in your app and try again.' : error.message);
  cloud.needsCode = false;
  await loadMe(false);
}
export async function mfaOff(factorId) {
  const { error } = await cloud.sb.auth.mfa.unenroll({ factorId });
  if (error) throw error;
  await loadMe(false);
}

/* ---------- auth actions ---------- */
const site = () => location.origin + '/';
export async function signUp({ email, password, username, birthdate, captchaToken }) {
  const { data, error } = await cloud.sb.auth.signUp({
    email, password,
    options: { emailRedirectTo: site(), data: { username, birthdate, display_name: username }, captchaToken },
  });
  if (error) throw error;
  return data;
}
export async function signIn(email, password, captchaToken) {
  const { error } = await cloud.sb.auth.signInWithPassword({ email, password, options: captchaToken ? { captchaToken } : undefined });
  if (error) throw error;
}
export async function signInGoogle() {
  const { error } = await cloud.sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: site() } });
  if (error) throw error;
}
export async function resendEmail(email) {
  const { error } = await cloud.sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: site() } });
  if (error) throw error;
}
export async function sendReset(email, captchaToken) {
  const { error } = await cloud.sb.auth.resetPasswordForEmail(email, { redirectTo: site(), captchaToken });
  if (error) throw error;
}
export async function setNewPassword(password) {
  const { error } = await cloud.sb.auth.updateUser({ password });
  if (error) throw error;
}
export async function signOut() { await cloud.sb?.auth.signOut(); }

export async function setBirthdate(b) {
  const { error } = await cloud.sb.rpc('set_birthdate', { b });
  if (error) throw error;
  await loadMe(true);
}
export async function saveProfile(fields) {
  const { error } = await cloud.sb.from('profiles').update(fields).eq('id', cloud.user.id);
  if (error) throw error;
  await loadMe(false);
}
export async function usernameFree(u) {
  const { data } = await cloud.sb.from('profiles').select('id').eq('username', u.toLowerCase()).maybeSingle();
  return !data || data.id === cloud.user?.id;
}

/** Turn Supabase error messages into short, plain English. */
export function plain(e) {
  const m = (e?.message || String(e || '')).toLowerCase();
  if (m.includes('13 or older')) return 'You must be 13 or older to use Heartbeat.';
  if (m.includes('invalid login')) return 'That email or password is not right.';
  if (m.includes('email not confirmed')) return 'Please confirm your email first. Check your inbox.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'That email already has an account. Try signing in.';
  if (m.includes('password') && m.includes('characters')) return 'Your password needs at least 8 characters.';
  if (m.includes('captcha')) return 'Please finish the "I\'m not a robot" check and try again.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many tries. Please wait a minute.';
  if (m.includes('profiles_username') || m.includes('duplicate key')) return 'That username is taken. Try another one.';
  if (m.includes('fetch') || m.includes('network')) return 'You seem to be offline. Try again.';
  return e?.message || 'Something went wrong. Please try again.';
}
