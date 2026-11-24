// Router + tab bar. Each screen lives in js/screens/.
import { TITLES } from './data.js';
import { toggleSave, U } from './store.js';
import { hydrate, apply } from './tmdb.js';
import { $, hearts, celebrate, closeSheet, toast } from './ui.js';
import { renderHome } from './screens/home.js';
import { renderDetail } from './screens/detail.js';
import { renderQuickRate } from './screens/quickrate.js';
import { renderMe } from './screens/me.js';
import { renderSearch } from './screens/search.js';
import { renderMatch } from './screens/match.js';
import { renderList } from './screens/list.js';
import { renderFeed } from './screens/feed.js';
import { renderAbout } from './screens/about.js';

TITLES.forEach(apply); // use cached TMDB info right away

const TABS = [
  { h: '#/', k: 'home', l: 'Home', o: '⌂', f: '🏠' },
  { h: '#/search', k: 'search', l: 'Search', o: '⌕', f: '🔎' },
  { h: '#/rate', k: 'rate', l: 'Rate', o: '♥', f: '♥' },
  { h: '#/match', k: 'match', l: 'Match', o: '♡', f: '💞' },
  { h: '#/me', k: 'me', l: 'Me', o: '☺', f: '😊' },
];
const ICONS = {
  home: ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>', '<svg viewBox="0 0 24 24" fill="#ff4f9a"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>'],
  search: ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>', '<svg viewBox="0 0 24 24" fill="none" stroke="#ff4f9a" stroke-width="3" stroke-linecap="round"><circle cx="11" cy="11" r="7" fill="#ff4f9a55"/><path d="M20 20l-4-4"/></svg>'],
  rate: ['<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 21C5 16 2 12.5 2 8.6 2 5.5 4.4 3 7.4 3c1.9 0 3.6 1 4.6 2.6C13 4 14.7 3 16.6 3 19.6 3 22 5.5 22 8.6c0 3.9-3 7.4-10 12.4z"/></svg>'],
  match: ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg>', '<svg viewBox="0 0 24 24"><circle cx="9" cy="12" r="6" fill="#ff4f9a99"/><circle cx="15" cy="12" r="6" fill="#9b6bff99"/></svg>'],
  me: ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.5-6 8-6s7 1.5 8 6"/></svg>', '<svg viewBox="0 0 24 24" fill="#ff4f9a"><circle cx="12" cy="8" r="4.5"/><path d="M3.5 21c1-5 5-6.5 8.5-6.5s7.5 1.5 8.5 6.5z"/></svg>'],
};
function tabs(active) {
  $('#tabs').innerHTML = `<div class="bar">${TABS.map(t => {
    const [o, f] = ICONS[t.k]; const on = active === t.k;
    return `<a href="${t.h}" class="${t.k === 'rate' ? 'rate' : ''} ${on ? 'on' : ''}" ${on ? 'aria-current="page"' : ''} aria-label="${t.l}${t.k === 'rate' ? ' (Quick Rate)' : ''}"><span class="ic"><span class="o">${o}</span><span class="f">${f || o}</span></span>${t.k === 'rate' ? '' : t.l}</a>`;
  }).join('')}</div>`;
  $('#tabs').style.display = active === 'none' ? 'none' : '';
}

const route = () => { const p = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent); return { p: p[0] || '', a: p[1] || '', b: p[2] || '' }; };
let last = '';
export function render(keepScroll = false) {
  const r = route(), y = scrollY, key = location.hash;
  closeSheet();
  const app = $('#app');
  switch (r.p) {
    case 't': tabs(''); renderDetail(app, r.a); break;
    case 'rate': tabs('rate'); renderQuickRate(app); break;
    case 'me': tabs('me'); renderMe(app); break;
    case 'search': tabs('search'); renderSearch(app, r.a); break;
    case 'match': tabs('match'); renderMatch(app); break;
    case 'list': tabs('home'); renderList(app, r.a); break;
    case 'feed': tabs('none'); renderFeed(app, r.a, r.b); break;
    case 'about': tabs('me'); renderAbout(app); break;
    default: tabs('home'); renderHome(app);
  }
  if (keepScroll && key === last) scrollTo(0, y); else if (key !== last) scrollTo(0, 0);
  last = key;
  hydrate(TITLES, () => render(true));
}
export const rerender = () => render(true);

// One-tap watchlist on any poster, anywhere.
document.addEventListener('click', e => {
  const b = e.target.closest('[data-save]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const res = toggleSave(b.dataset.save);
  b.classList.toggle('on', res.saved); b.querySelector('span').textContent = res.saved ? '🔖' : '＋';
  b.setAttribute('aria-label', (res.saved ? 'Remove from' : 'Add to') + ' watchlist');
  if (res.saved) { const rc = b.getBoundingClientRect(); hearts(rc.x + rc.width / 2, rc.y + rc.height / 2, 6); toast('Saved to your watchlist'); }
  celebrate(res);
}, true);

addEventListener('hashchange', () => render());
render();

if ('serviceWorker' in navigator && location.protocol === 'https:' && !/claude/.test(location.host)) {
  try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* ignore */ }
}
