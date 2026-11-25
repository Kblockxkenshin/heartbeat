// Shared helpers for Heartbeat Plus payments (not a public route: files starting with "_" aren't).
// Everything about Plus is decided here on the server, never in the browser.
//
// Set these in Vercel → Settings → Environment Variables (never in the app code, never in chat):
//   STRIPE_SECRET_KEY            Stripe → Developers → API keys → Secret key (sk_test_… or sk_live_…)
//   STRIPE_WEBHOOK_SECRET        Stripe → Developers → Webhooks → your endpoint → Signing secret (whsec_…)
//   STRIPE_PRICE_MONTHLY         price id for $3.99 / month   (price_…)
//   STRIPE_PRICE_YEARLY          price id for $29.99 / year   (price_…)
//   STRIPE_PRICE_STUDENT         price id for $1.99 / month   (price_…)
//   SUPABASE_SERVICE_ROLE_KEY    Supabase → Project Settings → API keys → secret key (server only!)
// Already set: SUPABASE_URL, SUPABASE_ANON_KEY.
import crypto from 'node:crypto';

const STRIPE = (process.env.STRIPE_API_BASE || 'https://api.stripe.com') + '/v1';
export const env = k => process.env[k] || '';
export const PRICES = () => ({ monthly: env('STRIPE_PRICE_MONTHLY'), yearly: env('STRIPE_PRICE_YEARLY'), student: env('STRIPE_PRICE_STUDENT') });
export const ready = () => !!(env('STRIPE_SECRET_KEY') && env('SUPABASE_SERVICE_ROLE_KEY') && env('SUPABASE_URL') && PRICES().monthly && PRICES().yearly);

export class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

/* ---------- Stripe (plain HTTPS, no extra packages) ---------- */
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.append(key, String(v));
  }
  return out;
}
export async function stripe(method, path, params) {
  const url = STRIPE + path + (method === 'GET' && params ? '?' + form(params) : '');
  const r = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer ' + env('STRIPE_SECRET_KEY'), 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' },
    body: method === 'GET' ? undefined : form(params || {}),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, d?.error?.message || 'Payment service error.');
  return d;
}

/* ---------- Supabase ---------- */
function srHeaders() {
  const k = env('SUPABASE_SERVICE_ROLE_KEY');
  const h = { apikey: k, 'Content-Type': 'application/json' };
  if (k.startsWith('eyJ')) h.Authorization = 'Bearer ' + k;   // old-style JWT keys
  return h;
}
export async function db(path, { method = 'GET', body } = {}) {
  const r = await fetch(env('SUPABASE_URL') + '/rest/v1/' + path, { method, headers: srHeaders(), body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new HttpError(500, d?.message || 'Database error.');
  return d;
}
export const billingRow = async uid => (await db(`billing?user_id=eq.${encodeURIComponent(uid)}&select=*`))?.[0] || null;

/** Who is calling? Checks the Supabase sign-in token with Supabase itself. */
export async function userFrom(req) {
  const auth = req.headers.authorization || '';
  if (!/^Bearer [\w.-]+$/.test(auth)) throw new HttpError(401, 'Please sign in first.');
  const r = await fetch(env('SUPABASE_URL') + '/auth/v1/user', { headers: { apikey: env('SUPABASE_ANON_KEY'), Authorization: auth } });
  if (!r.ok) throw new HttpError(401, 'Please sign in again.');
  const u = await r.json();
  if (!u?.id) throw new HttpError(401, 'Please sign in again.');
  return u;
}

/* ---------- Turn a Stripe subscription into Plus status ---------- */
export function planOf(sub) {
  const m = sub?.metadata?.plan;
  if (['monthly', 'yearly', 'student'].includes(m)) return m;
  const price = sub?.items?.data?.[0]?.price?.id, P = PRICES();
  return Object.keys(P).find(k => P[k] && P[k] === price) || null;
}
export function periodEnd(sub) {
  const t = sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end;
  return t ? new Date(t * 1000).toISOString() : null;
}
export async function applySub(uid, sub) {
  return db('rpc/billing_apply', { method: 'POST', body: {
    p_user: uid, p_customer: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id || null, p_sub: sub.id,
    p_status: sub.status, p_plan: planOf(sub), p_period_end: periodEnd(sub),
    p_cancel: !!sub.cancel_at_period_end, p_trial: !!sub.trial_start,
  } });
}
/** The user a subscription belongs to (we always put it in metadata). */
export async function userOfSub(sub) {
  if (sub?.metadata?.user_id) return sub.metadata.user_id;
  const cid = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (!cid) return null;
  const c = await stripe('GET', '/customers/' + encodeURIComponent(cid));
  return c?.metadata?.user_id || null;
}

/* ---------- Webhook signature (Stripe's "v1" scheme) ---------- */
export function verifySignature(raw, header, secret, tolerance = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(String(header).split(',').map(p => p.split('=')).filter(p => p.length === 2).map(([k, v]) => [k.trim(), v]));
  const sigs = String(header).split(',').filter(p => p.trim().startsWith('v1=')).map(p => p.trim().slice(3));
  const t = +parts.t;
  if (!t || Math.abs(Date.now() / 1000 - t) > tolerance || !sigs.length) return false;
  const want = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return sigs.some(s => s.length === want.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want)));
}

export function send(res, code, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(code).json(body);
}
