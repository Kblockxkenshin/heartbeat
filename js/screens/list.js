import { LISTS } from '../data.js';
import { card, hydratePosters, empty } from '../ui.js';
import { listTitles, listBadge, rowSub } from './home.js';

export function renderList(app, key) {
  const L = LISTS[key];
  if (!L) { app.innerHTML = empty('That list is gone. <a class="see" href="#/">Go home</a>', 'sad'); return; }
  document.title = `${L.name} — Heartbeat`;
  app.innerHTML = `<div class="screen">
    <div class="back-row"><a class="icon-btn" href="#/" aria-label="Back to home">←</a><h1>${L.emoji} ${L.name}</h1></div>
    <div class="grid" style="margin-top:14px">${listTitles(key).map(t => card(t, { badge: listBadge(key), sub: rowSub(key, t) })).join('')}</div>
  </div>`;
  hydratePosters(app);
}
