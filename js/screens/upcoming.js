// Upcoming: Indian movies releasing in the next six months (TMDB discover, region IN).
//   #/upcoming   List on phone; list or month calendar on desktop.
// "Notify me" saves a reminder (server for members, this device for guests) that shows in the app on release day.
import { cloud, plain } from '../cloud.js';
import { U, toggleSave } from '../store.js';
import { $, $$, esc, ic, toast, poster, hydratePosters, wide, buzz } from '../ui.js';
import { reveal } from '../motion.js';

export const LANGS = { hi: 'Hindi', te: 'Telugu', ta: 'Tamil', ml: 'Malayalam', kn: 'Kannada', bn: 'Bengali', mr: 'Marathi', pa: 'Punjabi', gu: 'Gujarati', or: 'Odia', as: 'Assamese' };
const LOCAL = 'hb_reminders';
const st = { list: null, hype: {}, lang: '', month: '', genre: '', sort: 'date', view: 'list', cal: null, mine: new Set(), loading: null };

const idOfM = m => `tmdb-movie-${m.id}`;
const keyOfM = m => `movie:${m.id}`;
const dayMs = 864e5;
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const dateOf = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const daysTo = s => Math.round((dateOf(s) - today()) / dayMs);
export const countdown = s => { const n = daysTo(s); return n < 0 ? 'Out now' : n === 0 ? 'Out today' : n === 1 ? 'Releases tomorrow' : `Releases in ${n} days`; };
const fmtDay = s => dateOf(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const monthKey = s => s.slice(0, 7);
const monthName = k => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); };

function localRem() { try { return JSON.parse(localStorage.getItem(LOCAL) || '{}'); } catch (e) { return {}; } }
function saveLocalRem(o) { try { localStorage.setItem(LOCAL, JSON.stringify(o)); } catch (e) { /* storage full or blocked */ } }

/** Load every page once per visit (max 100 films). */
async function load() {
  if (st.list) return st.list;
  if (st.loading) return st.loading;
  st.loading = (async () => {
    try { const c = JSON.parse(sessionStorage.getItem('hb_upcoming') || 'null'); if (c && Date.now() - c.at < 3 * 3600e3) return (st.list = c.list); } catch (e) { /* ignore */ }
    const get = p => fetch(`/api/tmdb?upcoming=1&page=${p}`).then(r => r.ok ? r.json() : Promise.reject(new Error('Could not load upcoming movies.')));
    const first = await get(1);
    const rest = await Promise.all(Array.from({ length: Math.max(0, (first.total_pages || 1) - 1) }, (_, i) => get(i + 2).catch(() => ({ results: [] }))));
    const seen = new Set(), list = [];
    for (const m of [first, ...rest].flatMap(x => x.results || [])) if (m.date && !seen.has(m.id)) { seen.add(m.id); list.push(m); }
    list.sort((a, b) => a.date.localeCompare(b.date));
    try { sessionStorage.setItem('hb_upcoming', JSON.stringify({ at: Date.now(), list })); } catch (e) { /* ignore */ }
    return (st.list = list);
  })();
  try { return await st.loading; } finally { st.loading = null; }
}
async function loadHype(list) {
  if (!cloud.sb || !list.length) return;
  try { const { data } = await cloud.sb.rpc('upcoming_hype', { p_keys: list.map(keyOfM) }); st.hype = data || {}; } catch (e) { /* counts are optional */ }
}
async function loadMine() {
  st.mine = new Set(Object.keys(localRem()));
  if (cloud.user && cloud.sb) {
    try { const { data } = await cloud.sb.rpc('my_release_alerts'); (data || []).forEach(a => st.mine.add(a.key)); } catch (e) { /* ignore */ }
  }
}

function filtered() {
  let L = (st.list || []).filter(m => (!st.lang || m.lang === st.lang) && (!st.month || monthKey(m.date) === st.month) && (!st.genre || m.genres.includes(st.genre)));
  if (st.sort === 'hype') L = L.slice().sort((a, b) => (st.hype[keyOfM(b)] || 0) - (st.hype[keyOfM(a)] || 0) || a.date.localeCompare(b.date));
  return L;
}

function cardHTML(m) {
  const id = idOfM(m), saved = !!U.watchlist[id], on = st.mine.has(keyOfM(m)), n = st.hype[keyOfM(m)] || 0;
  const p = poster({ id, name: m.name, year: (m.first_date || m.date).slice(0, 4), type: 'movie', posterPath: m.poster_path, colors: ['#171717', '#171717'] }, { mine: false, small: true });
  return `<article class="upc">
    <a class="upc-p" href="#/t/${id}" aria-label="${esc(m.name)}">${p}</a>
    <div class="upc-b">
      <div class="upc-k"><span>${esc(LANGS[m.lang] || m.lang.toUpperCase())}</span><span class="num">${esc(fmtDay(m.date))}</span></div>
      <h3><a href="#/t/${id}">${esc(m.name)}</a></h3>
      <div class="upc-cd ${daysTo(m.date) <= 7 ? 'soon' : ''}">${countdown(m.date)}</div>
      ${m.rerelease ? `<div class="meta rerel">Re-release · first came out in ${esc(m.first_date.slice(0, 4))}</div>` : ''}
      ${m.director.length ? `<div class="meta">Director · ${esc(m.director.join(', '))}</div>` : ''}
      ${m.cast.length ? `<div class="meta clamp1">Cast · ${esc(m.cast.join(', '))}</div>` : ''}
      ${n >= 3 ? `<div class="meta">${n} people want to watch</div>` : ''}
      <div class="upc-a">
        <button class="btn sm ${on ? '' : 'ghost'}" data-notify="${m.id}" aria-pressed="${on}">${ic(on ? 'bell-off' : 'bell')} ${on ? 'Reminder on' : 'Notify me'}</button>
        <button class="btn sm ghost" data-wl="${m.id}" aria-pressed="${saved}">${ic(saved ? 'bookmark-check' : 'bookmark')} ${saved ? 'Saved' : 'Watchlist'}</button>
      </div>
    </div></article>`;
}

function calendarHTML(L) {
  const months = [...new Set((st.list || []).map(m => monthKey(m.date)))];
  if (!st.cal || !months.includes(st.cal)) st.cal = st.month || months[0];
  const [y, mo] = st.cal.split('-').map(Number);
  const first = new Date(y, mo - 1, 1), days = new Date(y, mo, 0).getDate(), lead = (first.getDay() + 6) % 7;
  const byDay = {};
  L.filter(m => monthKey(m.date) === st.cal).forEach(m => (byDay[+m.date.slice(8)] ||= []).push(m));
  const i = months.indexOf(st.cal), t = today();
  const cells = Array.from({ length: lead }, () => '<div class="cal-d empty"></div>').concat(Array.from({ length: days }, (_, k) => {
    const d = k + 1, ms = byDay[d] || [], isToday = t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d;
    return `<div class="cal-d ${ms.length ? 'has' : ''} ${isToday ? 'today' : ''}"><span class="num">${d}</span>${ms.slice(0, 2).map(m => `<a href="#/t/${idOfM(m)}" class="cal-m" title="${esc(m.name)} · ${esc(LANGS[m.lang] || '')}">${esc(m.name)}</a>`).join('')}${ms.length > 2 ? `<span class="meta">+${ms.length - 2} more</span>` : ''}</div>`;
  }));
  return `<div class="cal">
    <div class="cal-h"><button class="icon-btn" data-cal="-1" ${i <= 0 ? 'disabled' : ''} aria-label="Previous month">${ic('chevron-left')}</button>
      <h2>${esc(monthName(st.cal))}</h2>
      <button class="icon-btn" data-cal="1" ${i >= months.length - 1 ? 'disabled' : ''} aria-label="Next month">${ic('chevron-right')}</button></div>
    <div class="cal-g">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="cal-w">${d}</div>`).join('')}${cells.join('')}</div></div>`;
}

function draw(app) {
  const body = $('#upbody', app); if (!body) return;
  const L = filtered();
  const showCal = st.view === 'cal' && wide();
  body.innerHTML = !L.length ? `<div class="card"><div class="mascot"><div>No movies match these filters yet.</div></div></div>`
    : showCal ? calendarHTML(L) : `<div class="upgrid">${L.map(cardHTML).join('')}</div>`;
  hydratePosters(body);
  if (!showCal) reveal($$('.upc', body).slice(0, 12));
  $('#upcount', app).textContent = `${L.length} film${L.length === 1 ? '' : 's'}`;
}

function controls() {
  const L = st.list || [];
  const months = [...new Set(L.map(m => monthKey(m.date)))];
  const genres = [...new Set(L.flatMap(m => m.genres))].sort();
  const langs = Object.keys(LANGS).filter(k => L.some(m => m.lang === k));
  const sel = (id, label, all, opts, v) => `<label class="upsel"><span class="sr">${label}</span><select id="${id}">${[`<option value="">${all}</option>`, ...opts.map(([k, l]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`)].join('')}</select></label>`;
  return `<div class="upctl">
    ${sel('uplang', 'Language', 'All languages', langs.map(k => [k, LANGS[k]]), st.lang)}
    ${sel('upmonth', 'Month', 'Any month', months.map(k => [k, monthName(k)]), st.month)}
    ${sel('upgenre', 'Genre', 'All genres', genres.map(g => [g, g]), st.genre)}
    <div class="seg" role="group" aria-label="Sort">
      <button class="${st.sort === 'date' ? 'on' : ''}" data-sort="date" aria-pressed="${st.sort === 'date'}">Release date</button>
      <button class="${st.sort === 'hype' ? 'on' : ''}" data-sort="hype" aria-pressed="${st.sort === 'hype'}">Most anticipated</button></div>
    <div class="seg wide-flex" role="group" aria-label="View">
      <button class="${st.view === 'list' ? 'on' : ''}" data-view="list" aria-pressed="${st.view === 'list'}">${ic('list')} List</button>
      <button class="${st.view === 'cal' ? 'on' : ''}" data-view="cal" aria-pressed="${st.view === 'cal'}">${ic('calendar-days')} Calendar</button></div>
  </div>`;
}

export async function renderUpcoming(app) {
  document.title = 'Upcoming — Heartbeat';
  app.innerHTML = `<div class="screen upcoming">
    <header class="hhead"><p class="eyebrow">Indian cinema</p><h1 class="display">Coming <em>soon.</em></h1>
      <p class="sub uplead">Hindi, Telugu, Tamil, Malayalam, Kannada, Bengali, Marathi, Punjabi and more, in the next six months.</p></header>
    <div id="upctlbox"></div>
    <div class="sec"><h2>Releases</h2><span class="meta" id="upcount"></span></div>
    <div id="upbody"><div class="upgrid">${'<div class="upc skel"></div>'.repeat(6)}</div></div>
    <p class="meta upnote">Dates come from TMDB and can change. Reminders show up in Heartbeat on release day.</p>
  </div>`;
  try {
    await Promise.all([load(), loadMine()]);
  } catch (e) {
    $('#upbody', app).innerHTML = `<div class="card"><div class="mascot"><div>${esc(plain(e))}</div><button class="btn sm ghost" id="upretry">Try again</button></div></div>`;
    $('#upretry', app).onclick = () => renderUpcoming(app);
    return;
  }
  if (!app.querySelector('.upcoming')) return;   // the person already left this page
  await loadHype(st.list);
  const ctl = $('#upctlbox', app);
  const redraw = () => { ctl.innerHTML = controls(); wire(); draw(app); };
  function wire() {
    $('#uplang', ctl).onchange = e => { st.lang = e.target.value; draw(app); };
    $('#upmonth', ctl).onchange = e => { st.month = e.target.value; st.cal = e.target.value || st.cal; draw(app); };
    $('#upgenre', ctl).onchange = e => { st.genre = e.target.value; draw(app); };
    $$('[data-sort]', ctl).forEach(b => b.onclick = async () => { st.sort = b.dataset.sort; if (st.sort === 'hype') await loadHype(st.list); redraw(); });
    $$('[data-view]', ctl).forEach(b => b.onclick = () => { st.view = b.dataset.view; redraw(); });
  }
  redraw();
  $('#upbody', app).onclick = async e => {
    const cal = e.target.closest('[data-cal]');
    if (cal) { const months = [...new Set(st.list.map(m => monthKey(m.date)))]; st.cal = months[months.indexOf(st.cal) + +cal.dataset.cal] || st.cal; draw(app); return; }
    const wl = e.target.closest('[data-wl]');
    if (wl) { const m = st.list.find(x => x.id === +wl.dataset.wl); const r = toggleSave(idOfM(m)); buzz(); toast(r.saved ? 'Added to your watchlist' : 'Removed from your watchlist'); draw(app); return; }
    const nb = e.target.closest('[data-notify]');
    if (nb) {
      const m = st.list.find(x => x.id === +nb.dataset.notify), key = keyOfM(m);
      nb.disabled = true;
      try {
        let on;
        if (cloud.user && cloud.sb) {
          const { data, error } = await cloud.sb.rpc('toggle_release_alert', { p_key: key, p_name: m.name, p_date: m.date });
          if (error) throw error; on = !!data;
        } else {
          const o = localRem(); on = !o[key]; if (on) o[key] = { name: m.name, date: m.date }; else delete o[key]; saveLocalRem(o);
        }
        if (on) st.mine.add(key); else st.mine.delete(key);
        buzz(); toast(on ? `We'll remind you when ${m.name} comes out.` : 'Reminder removed.');
      } catch (x) { toast(plain(x), 'sad'); }
      draw(app);
    }
  };
}

/** On app start: show reminders that are due (members: from the server; guests: from this device). */
export async function checkReminders() {
  const due = [];
  const o = localRem(); let changed = false;
  for (const [k, v] of Object.entries(o)) if (v.date && daysTo(v.date) <= 0) { due.push(v.name); delete o[k]; changed = true; }
  if (changed) saveLocalRem(o);
  if (cloud.user && cloud.sb) {
    try { const { data } = await cloud.sb.rpc('claim_release_alerts'); (data || []).forEach(a => due.push(a.name)); } catch (e) { /* older databases */ }
  }
  if (due.length) toast(due.length === 1 ? `${due[0]} is out now!` : `${due.length} movies on your reminder list are out now!`, 'wow');
}
