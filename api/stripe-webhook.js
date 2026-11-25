// Stripe → Heartbeat: Stripe calls this when a subscription starts, renews, changes or ends.
// In Stripe → Developers → Webhooks, add endpoint  https://<your site>/api/stripe-webhook
// with events: checkout.session.completed, customer.subscription.created,
// customer.subscription.updated, customer.subscription.deleted.
// Every call is checked with STRIPE_WEBHOOK_SECRET, and we re-read the subscription from Stripe,
// so a fake or old message can't give anyone Plus.
import { env, ready, stripe, verifySignature, userOfSub, applySub, send } from './_stripe.js';

export const config = { api: { bodyParser: false } };

// Read the exact bytes Stripe sent (needed for the signature). Don't touch req.body before this.
async function rawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  if (!ready() || !env('STRIPE_WEBHOOK_SECRET')) return send(res, 503, { error: 'Not set up.' });
  const raw = await rawBody(req);
  if (!verifySignature(raw, req.headers['stripe-signature'], env('STRIPE_WEBHOOK_SECRET'))) return send(res, 400, { error: 'Bad signature.' });
  let ev;
  try { ev = JSON.parse(raw); } catch (e) { return send(res, 400, { error: 'Bad body.' }); }
  try {
    const obj = ev?.data?.object || {};
    let subId = null;
    if (ev.type === 'checkout.session.completed' && obj.mode === 'subscription') subId = obj.subscription;
    else if (/^customer\.subscription\./.test(ev.type)) subId = obj.id;
    if (!subId) return send(res, 200, { ok: true, ignored: ev.type });
    const sub = await stripe('GET', '/subscriptions/' + encodeURIComponent(subId));   // fresh copy from Stripe
    const uid = await userOfSub(sub);
    if (!uid) return send(res, 200, { ok: true, ignored: 'no user' });
    const r = await applySub(uid, sub);
    return send(res, 200, { ok: true, plus: r?.plus });
  } catch (e) {
    return send(res, 500, { error: 'Try again.' });   // Stripe retries later
  }
}
