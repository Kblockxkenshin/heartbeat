// Vercel function: tells the app where the Supabase backend is.
// These two values are PUBLIC by design (the "anon" key only allows what Row Level Security allows).
// Set them in Vercel → Settings → Environment Variables:
//   SUPABASE_URL        e.g. https://abcd1234.supabase.co
//   SUPABASE_ANON_KEY   the "anon public" key (NOT the service_role key)
export default function handler(req, res) {
  const url = process.env.SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || '';
  res.setHeader('Cache-Control', 'public, max-age=300');
  if (!url || !anonKey) return res.status(200).json({ ready: false });
  // Safety: never send a service_role key to browsers, even if it was pasted by mistake.
  try {
    const payload = JSON.parse(Buffer.from(anonKey.split('.')[1] || '', 'base64').toString() || '{}');
    if (payload.role && payload.role !== 'anon') return res.status(200).json({ ready: false, error: 'wrong-key' });
  } catch (e) { /* new-style publishable keys are not JWTs: fine */ }
  if (anonKey.startsWith('sb_secret_')) return res.status(200).json({ ready: false, error: 'wrong-key' });
  // Optional bot check on sign-up / sign-in: Cloudflare Turnstile SITE key (public). The secret key goes in
  // Supabase → Authentication → Attack Protection (never here).
  res.status(200).json({ ready: true, url, anonKey, turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '' });
}
