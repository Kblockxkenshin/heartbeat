// Heartbeat Plus: start a subscription, cancel (2 taps), resume, restore, manage card.
//   GET  /api/billing                      -> { ready }  (are payments set up?)
//   POST /api/billing { action, plan }     (needs the Supabase sign-in token)
//     action: 'checkout' (plan: monthly | yearly | student) -> { url } (Stripe's secure payment page)
//             'cancel' | 'resume'                           -> { plus }
//             'restore'                                     -> { found, plus }
//             'portal'                                      -> { url } (update card, see invoices)
// The browser never decides who has Plus. Only Stripe events + this server do.
import { env, PRICES, ready, HttpError, stripe, billingRow, userFrom, applySub, db, send } from './_stripe.js';

const ACTIVE = ['active', 'trialing', 'past_due'];

export default async function handler(req, res) {
  if (req.method === 'GET') return send(res, 200, { ready: ready(), student: !!PRICES().student });
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  try {
    if (!ready()) throw new HttpError(503, 'Payments are not set up yet. Everything free still works!');
    const user = await userFrom(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const origin = env('APP_URL') || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
    const row = await billingRow(user.id);

    if (body.action === 'checkout') {
      const plan = String(body.plan || '');
      const price = PRICES()[plan];
      if (!price) throw new HttpError(400, 'Pick a plan.');
      if (!user.email_confirmed_at) throw new HttpError(403, 'Please confirm your email first.');
      if (plan === 'student' && !/\.edu$/i.test(user.email || '')) throw new HttpError(403, 'The student price needs a school email that ends in .edu.');
      if (row && ACTIVE.includes(row.status) && row.period_end && Date.parse(row.period_end) > Date.now())
        throw new HttpError(409, 'You already have Heartbeat Plus. 💖');
      let customer = row?.customer_id;
      if (!customer) {
        const c = await stripe('POST', '/customers', { email: user.email, metadata: { user_id: user.id } });
        customer = c.id;
        await db('rpc/billing_apply', { method: 'POST', body: { p_user: user.id, p_customer: customer, p_sub: null, p_status: null,
          p_plan: null, p_period_end: null, p_cancel: false, p_trial: false } });
      }
      const s = await stripe('POST', '/checkout/sessions', {
        mode: 'subscription', customer, client_reference_id: user.id,
        line_items: { 0: { price, quantity: 1 } },
        subscription_data: { metadata: { user_id: user.id, plan }, trial_period_days: row?.trial_used ? undefined : 7 },
        allow_promotion_codes: 'true',
        success_url: `${origin}/#/plus/ok`, cancel_url: `${origin}/#/plus`,
      });
      return send(res, 200, { url: s.url });
    }

    if (body.action === 'cancel' || body.action === 'resume') {
      if (!row?.subscription_id) throw new HttpError(404, 'No subscription found. Try "Restore purchases".');
      const sub = await stripe('POST', '/subscriptions/' + encodeURIComponent(row.subscription_id), { cancel_at_period_end: body.action === 'cancel' ? 'true' : 'false' });
      const r = await applySub(user.id, sub);
      return send(res, 200, { plus: r?.plus, cancel_at_period_end: !!sub.cancel_at_period_end });
    }

    if (body.action === 'restore') {
      let customers = row?.customer_id ? [row.customer_id] : [];
      if (!customers.length) {
        const q = await stripe('GET', '/customers/search', { query: `metadata['user_id']:'${user.id}'`, limit: 5 });
        customers = (q.data || []).map(c => c.id);
      }
      let best = null;
      for (const c of customers) {
        const l = await stripe('GET', '/subscriptions', { customer: c, status: 'all', limit: 10 });
        for (const s of l.data || []) {
          const rank = x => (ACTIVE.includes(x.status) ? 2 : 0) + (x.created || 0) / 1e12;
          if (!best || rank(s) > rank(best)) best = s;
        }
      }
      if (!best) return send(res, 200, { found: false, plus: false });
      const r = await applySub(user.id, best);
      return send(res, 200, { found: true, plus: r?.plus });
    }

    if (body.action === 'portal') {
      if (!row?.customer_id) throw new HttpError(404, 'No billing account yet.');
      const p = await stripe('POST', '/billing_portal/sessions', { customer: row.customer_id, return_url: `${origin}/#/plus` });
      return send(res, 200, { url: p.url });
    }
    throw new HttpError(400, 'Unknown action.');
  } catch (e) {
    send(res, e.code || 500, { error: e.code ? e.message : 'Something went wrong. Please try again.' });
  }
}
