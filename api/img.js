// Vercel function: gives a TMDB poster from our own site, so the "share as image" card can use it.
// Only real TMDB poster paths and sizes are allowed.
const SIZES = new Set(['w185', 'w342', 'w500']);
export default async function handler(req, res) {
  const { path, size = 'w500' } = req.query;
  if (!SIZES.has(size) || typeof path !== 'string' || !/^\/[A-Za-z0-9_-]{5,64}\.(jpg|png)$/.test(path)) {
    return res.status(400).send('Bad image');
  }
  try {
    const r = await fetch(`https://image.tmdb.org/t/p/${size}${path}`);
    if (!r.ok) return res.status(404).send('Not found');
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.status(200).send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(502).send('Image error');
  }
}
