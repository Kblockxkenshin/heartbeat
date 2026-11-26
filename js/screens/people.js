// Friends & social screens: Friends hub (activity, friends, requests, find, invite),
// profile pages, edit profile, invite links, and the friends row on Home.
import { TITLES, BYID } from '../data.js';
import { cloud, keyOf, refreshMe, refreshRequests, saveProfile, usernameFree, plain } from '../cloud.js';
import { search as tmdbSearch } from '../tmdb.js';
import { $, $$, esc, toast, sheet, closeSheet, empty, mascot, poster, hydratePosters, confetti, buzz, hearts, card, row } from '../ui.js';
import { miniGraph, fmt } from '../reviews.js';
import { S, socialReady, avatar, rankChip, handle, profileHref, uploadAvatar, removeAvatar, titleFor, titlesFor, inviteUrl, qrSvg, ago } from '../social.js';
import { localSearch } from './search.js';
import { rerender } from '../app.js';
import { messageUser } from './chat.js';
import { fillRecs } from './recs.js';
import { openMatchPro, styleClass, bannerHTML } from './plus.js';

const stars = o => `★ ${o != null ? (+o).toFixed(1).replace(/\.0$/, '') : '–'}`;
const pctColor = p => p >= 80 ? 'var(--pink)' : p >= 60 ? 'var(--purple)' : 'var(--muted)';
const INVITE_KEY = 'heartbeat_invite';

/* =====================================================================
   Friends hub: #/friends/<tab>
   ===================================================================== */
const TABS = [['feed', 'Activity'], ['friends', 'Friends'], ['requests', 'Requests'], ['recs', 'Recs'], ['find', 'Find'], ['invite', 'Invite']];

export function renderFriends(app, tab = 'feed') {
  document.title = 'Friends — Heartbeat';
  if (!TABS.some(t => t[0] === tab)) tab = 'feed';
  if (!socialReady()) { app.innerHTML = guestFriends(); return; }
  const n = cloud.requests || 0, nr = (cloud.profile?.new_recs || 0) + (cloud.profile?.unread_notes || 0);
  app.innerHTML = `<div class="screen friends">
    <header class="top"><h1 class="logo" style="font-size:26px;margin:0"><i class="i i-users" aria-hidden="true"></i> Friends</h1>
      <a class="btn sm" href="#/friends/invite"><i class="i i-link" aria-hidden="true"></i> Invite</a></header>
    <nav class="ftabs" aria-label="Friends sections">${TABS.map(([k, l]) => `<a href="#/friends/${k}" class="chip ${k === tab ? 'on' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${l}${k === 'requests' && n ? ` <span class="cnt">${n}</span>` : k === 'recs' && nr ? ` <span class="cnt">${nr}</span>` : ''}</a>`).join('')}</nav>
    <div id="fbody" class="fbody"><div class="card"><div class="rskel"></div><div class="rskel"></div></div></div>
  </div>`;
  const body = $('#fbody', app);
  ({ feed: fillFeed, friends: fillFriends, requests: fillRequests, find: fillFind, invite: fillInvite, recs: fillRecs })[tab](body).catch(e => {
    body.innerHTML = `<div class="card">${empty(esc(plain(e)), 'sad', '<button class="btn sm" id="retry">Try again</button>')}</div>`;
    $('#retry', body).onclick = () => rerender();
  });
}

function guestFriends() {
  const msg = !cloud.ready ? 'Friends need the online account, which isn\'t set up yet.'
    : !cloud.user ? 'Make a free account to add friends, see what they watch, and find people with your taste.'
    : 'Finish setting up your account to add friends.';
  return `<div class="screen friends"><header class="top"><h1 class="logo" style="font-size:26px;margin:0"><i class="i i-users" aria-hidden="true"></i> Friends</h1></header>
    <div class="card">${empty(msg, 'happy', cloud.ready ? (cloud.user ? '<a class="btn" href="#/welcome">Finish setup</a>'
      : '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><a class="btn" href="#/signin/up">Make an account</a><a class="btn ghost" href="#/signin">Sign in</a></div>') : '')}</div>
    <a class="card linkcard" href="#/match"><span style="font-size:34px" aria-hidden="true"><i class="i i-heart-handshake" aria-hidden="true"></i></span><div style="flex:1"><h2 class="h3">Try Taste Match</h2><div class="sub">See how close your taste is to sample movie fans.</div></div><span class="btn sm" aria-hidden="true">Go</span></a></div>`;
}

/* ---------- people rows ---------- */
function personRow(p, { right = '', sub = '' } = {}) {
  const pct = p.pct != null ? `<b class="pct" style="color:${pctColor(p.pct)}" title="Taste Match">${p.pct}%</b>` : '';
  return `<div class="person" data-uid="${esc(p.id)}">
    <a class="plink" href="${profileHref(p)}">${avatar(p, 'sm')}
      <span class="pname"><b>${esc(p.display_name || p.username)}</b><span class="meta">${handle(p)}${p.rank ? ` · ${esc(p.rank)}` : ''}${sub ? ` · ${sub}` : ''}</span></span></a>
    ${pct}${right}</div>`;
}
function relButton(p) {
  const r = p.rel || {};
  if (r.friend) return `<span class="pill2 ok"><i class="i i-check" aria-hidden="true"></i> Friends</span>`;
  if (r.req_in) return `<button class="btn sm" data-accept="${r.req_in}">Accept</button>`;
  if (r.req_out) return `<button class="btn sm ghost" data-cancel="${r.req_out}">Requested</button>`;
  return `<button class="btn sm" data-add="${esc(p.id)}"><i class="i i-plus" aria-hidden="true"></i> Add</button>`;
}

/** Buttons inside friends lists and profile pages. */
async function act(btn, after) {
  const d = btn.dataset; btn.disabled = true;
  try {
    if (d.add) { const r = await S.request(d.add); buzz(); toast(r === 'friends' ? 'You\'re friends now!' : 'Friend request sent!'); if (r === 'friends') confetti(50); }
    else if (d.accept) { await S.respond(+d.accept, true); buzz(); confetti(50); toast('You\'re friends now!'); }
    else if (d.decline) { await S.respond(+d.decline, false); toast('Request declined.'); }
    else if (d.cancel) { await S.cancel(+d.cancel); toast('Request canceled.'); }
    refreshRequests();
    await after?.();
  } catch (e) { toast(plain(e), 'sad'); btn.disabled = false; }
}
function wireActs(root, after) {
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-add],[data-accept],[data-decline],[data-cancel]');
    if (b && root.contains(b)) { e.preventDefault(); act(b, after); }
  });
}

/* ---------- Activity ---------- */
async function fillFeed(body) {
  const items = await S.feed();
  if (!items.length) {
    body.innerHTML = `<div class="card">${empty('No activity yet. Add friends to see what they rate, review and save.', 'happy',
      '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><a class="btn" href="#/friends/find"><i class="i i-search" aria-hidden="true"></i> Find people</a><a class="btn ghost" href="#/friends/invite"><i class="i i-link" aria-hidden="true"></i> Invite friends</a></div>')}</div>`;
    return;
  }
  body.innerHTML = `<div class="afeed" id="feedList"></div><div style="text-align:center"><button class="btn ghost sm" id="more" hidden>Load more</button></div>`;
  const list = $('#feedList', body), more = $('#more', body);
  await appendFeed(list, items);
  wireFeed(list);
  let last = items[items.length - 1]?.at;
  more.hidden = items.length < 20;
  more.onclick = async () => {
    more.disabled = true;
    const next = await S.feed(last).catch(() => []);
    await appendFeed(list, next); last = next[next.length - 1]?.at || last;
    more.hidden = next.length < 20; more.disabled = false;
  };
}
async function appendFeed(list, items, opts) {
  const titles = Object.fromEntries((await titlesFor([...new Set(items.map(a => a.k))])).map(t => [keyOf(t.id), t]));
  list.insertAdjacentHTML('beforeend', items.map(a => feedItemHTML(a, titles[a.k], opts)).join(''));
  hydratePosters(list);
}

export function feedItemHTML(a, t, { compact = false, noUser = false } = {}) {
  const name = t ? esc(t.name) : 'a title', href = t ? `#/t/${esc(t.id)}` : '#/';
  const d = a.data || {}, rv = a.review;
  const verb = a.kind === 'rated' ? `rated <a href="${href}">${name}</a>`
    : a.kind === 'reviewed' ? `${d.rewatch ? 'rewatched and reviewed' : 'reviewed'} <a href="${href}">${name}</a>`
    : `saved <a href="${href}">${name}</a> to watch`;
  const score = a.kind === 'rated' ? `<span class="fscore">${miniGraph(d.s, d.m, d.e, 60, 26)}<b>${stars(d.o)}</b></span>`
    : a.kind === 'reviewed' && rv ? `<span class="fscore">${miniGraph(rv.s, rv.m, rv.e, 60, 26)}<b>${stars(d.o)}</b></span>` : '';
  const text = a.kind === 'reviewed' && rv && !compact ? `<a class="fquote" href="${href}">${rv.headline ? `<b>${esc(rv.headline)}</b>` : ''}
      ${rv.spoilers ? `<span class="sub"><i class="i i-eye-off" aria-hidden="true"></i> Has spoilers. Open the title to read it.</span>` : `<span class="clamp3">${fmt(rv.body || '')}</span>`}</a>` : '';
  return `<article class="fitem ${compact ? 'compact' : ''}" data-aid="${a.id}">
    ${noUser ? '' : `<a class="fava" href="${profileHref(a.user)}" aria-label="${handle(a.user)}">${avatar(a.user, 'sm')}</a>`}
    <div class="fmain">
      <div class="fline">${noUser ? '' : `<a class="fwho" href="${profileHref(a.user)}">${esc(a.user.display_name || a.user.username)}</a> `}${verb}</div>
      ${score}${text}
      <div class="fact">
        <button type="button" class="fbtn ${a.my_like ? 'on' : ''}" data-like="${a.id}" aria-pressed="${!!a.my_like}" aria-label="Like"${a.mine ? ' disabled' : ''}>${a.my_like ? '<i class="i i-heart" aria-hidden="true"></i>' : '<i class="i i-heart" aria-hidden="true"></i>'} <span>${a.likes || ''}</span></button>
        <button type="button" class="fbtn" data-cmt="${a.id}" aria-label="Comments"><i class="i i-message-circle" aria-hidden="true"></i> <span>${a.comments || ''}</span></button>
        <span class="meta">${ago(a.at)}</span>
        ${a.kind === 'saved' && t && !compact ? `<button type="button" class="fbtn" data-save="${esc(t.id)}"><i class="i i-plus" aria-hidden="true"></i> Save too</button>` : ''}
      </div>
    </div>
    ${t ? `<a class="fposter" href="${href}" tabindex="-1" aria-hidden="true">${poster(t, { small: true, mine: false })}</a>` : ''}
  </article>`;
}
export function wireFeed(list) {
  list.addEventListener('click', async e => {
    const lk = e.target.closest('[data-like]');
    if (lk) {
      e.preventDefault(); lk.disabled = true;
      try {
        const r = await S.like(+lk.dataset.like); buzz();
        lk.classList.toggle('on', r.on); lk.setAttribute('aria-pressed', r.on);
        lk.innerHTML = `${r.on ? '<i class="i i-heart" aria-hidden="true"></i>' : '<i class="i i-heart" aria-hidden="true"></i>'} <span>${r.likes || ''}</span>`;
        if (r.on) { const b = lk.getBoundingClientRect(); hearts(b.x + 14, b.y + 10, 5); }
      } catch (err) { toast(plain(err), 'sad'); }
      lk.disabled = false; return;
    }
    const cm = e.target.closest('[data-cmt]');
    if (cm) { e.preventDefault(); openActivityComments(+cm.dataset.cmt, cm); }
  });
}

async function openActivityComments(id, btn) {
  const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 10px"><i class="i i-message-circle" aria-hidden="true"></i> Comments</h2><div id="acl"><div class="rskel"></div></div>
    <form id="acf" class="cform" autocomplete="off"><label class="sr-only" for="acin">Add a comment</label>
      <input id="acin" maxlength="500" placeholder="Add a comment…" enterkeyhint="send"><button class="btn sm" type="submit">Send</button></form>
    <div class="sub" id="acerr" role="alert" style="color:var(--pink)"></div>`);
  const lst = $('#acl', sh);
  const load = async () => {
    const cs = await S.comments(id).catch(() => []);
    lst.innerHTML = cs.length ? cs.map(c => `<div class="cmt" data-cid="${c.cid}"><a href="${profileHref(c)}">${avatar(c, 'xs')}</a>
        <div style="flex:1;min-width:0"><a href="${profileHref(c)}"><b>${handle(c)}</b></a> <span class="meta">${ago(c.at)}</span><div class="cbody">${esc(c.body)}</div>
        ${c.can_delete ? `<div class="cact"><button type="button" class="see" data-acdel="${c.cid}">Delete</button></div>` : ''}</div></div>`).join('')
      : `<div class="sub" style="padding:6px 0 12px">No comments yet. Say something nice!</div>`;
    const n = cs.length; if (btn) btn.innerHTML = `<i class="i i-message-circle" aria-hidden="true"></i> <span>${n || ''}</span>`;
  };
  await load();
  lst.addEventListener('click', async e => {
    const d = e.target.closest('[data-acdel]'); if (!d) return;
    try { await S.uncomment(+d.dataset.acdel); await load(); } catch (err) { toast(plain(err), 'sad'); }
  });
  $('#acin', sh).addEventListener('input', () => { $('#acerr', sh).textContent = ''; });
  $('#acf', sh).onsubmit = async e => {
    e.preventDefault(); const inp = $('#acin', sh), v = inp.value.trim(); if (!v) return;
    const b = $('#acf button', sh); b.disabled = true;
    try { await S.comment(id, v); inp.value = ''; await load(); }
    catch (err) { $('#acerr', sh).textContent = plain(err); }
    b.disabled = false; inp.focus();
  };
}

/* ---------- Friends list ---------- */
async function fillFriends(body) {
  const o = await S.friends();
  body.innerHTML = `<section class="card"><h2 class="h3"><i class="i i-users" aria-hidden="true"></i> Your friends <span class="sub">(${o.friends.length})</span></h2>
      ${o.friends.length ? o.friends.map(p => personRow(p)).join('') : `<div class="sub" style="padding:8px 0">No friends yet. <a class="see" href="#/friends/find">Find people</a> or <a class="see" href="#/friends/invite">send an invite</a>.</div>`}</section>
    <section class="card"><h2 class="h3"><i class="i i-star" aria-hidden="true"></i> Following <span class="sub">(${o.following.length})</span></h2>
      ${o.following.length ? o.following.map(p => personRow(p)).join('') : `<div class="sub" style="padding:8px 0">Follow public profiles to see their activity without being friends.</div>`}
      <div class="sub" style="margin-top:8px">${o.followers} ${o.followers === 1 ? 'person follows' : 'people follow'} you.</div></section>
    ${o.friends.length ? `<a class="card linkcard" href="#/movienight"><span style="font-size:30px" aria-hidden="true"><i class="i i-popcorn" aria-hidden="true"></i></span><div style="flex:1"><h2 class="h3">Movie Night</h2><div class="sub">Pick friends and find the perfect title for everyone.</div></div><span class="btn sm ghost" aria-hidden="true"><i class="i i-heart" aria-hidden="true"></i> Plus</span></a>` : ''}`;
}

/* ---------- Requests ---------- */
async function fillRequests(body) {
  const o = await S.friends();
  body.innerHTML = `<section class="card"><h2 class="h3"><i class="i i-mail-plus" aria-hidden="true"></i> Asked to be your friend</h2>
      ${o.incoming.length ? o.incoming.map(p => personRow(p, { sub: ago(p.at), right: `<div class="pbtns"><button class="btn sm" data-accept="${p.req}">Accept</button><button class="btn sm ghost" data-decline="${p.req}" aria-label="Decline"><i class="i i-x" aria-hidden="true"></i></button></div>` })).join('')
        : `<div class="sub" style="padding:8px 0">No new requests.</div>`}</section>
    <section class="card"><h2 class="h3"><i class="i i-hourglass" aria-hidden="true"></i> You asked</h2>
      ${o.outgoing.length ? o.outgoing.map(p => personRow(p, { sub: ago(p.at), right: `<button class="btn sm ghost" data-cancel="${p.req}">Cancel</button>` })).join('')
        : `<div class="sub" style="padding:8px 0">Nothing waiting.</div>`}</section>`;
  if (!body.dataset.wired) { body.dataset.wired = 1; wireActs(body, () => fillRequests(body)); }
}

/* ---------- Find people ---------- */
async function fillFind(body) {
  body.innerHTML = `<section class="card"><label for="pq" class="h3" style="display:block;margin-bottom:8px"><i class="i i-search" aria-hidden="true"></i> Find people</label>
      <input id="pq" type="search" autocomplete="off" placeholder="Search by username or name" maxlength="40">
      <div id="pres" aria-live="polite"></div></section>
    <section class="card"><h2 class="h3"><i class="i i-heart-handshake" aria-hidden="true"></i> People with similar taste</h2><div class="sub" style="margin-bottom:6px">Based on titles you both rated.</div><div id="sugg"><div class="rskel"></div></div></section>`;
  const res = $('#pres', body), q = $('#pq', body); let timer, seq = 0;
  q.addEventListener('input', () => {
    clearTimeout(timer);
    const v = q.value.trim();
    if (v.replace(/^@/, '').length < 2) { res.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      const list = await S.search(v).catch(e => { toast(plain(e), 'sad'); return []; });
      if (my !== seq) return;
      res.innerHTML = list.length ? list.map(p => personRow(p, { right: relButton(p) })).join('') : `<div class="sub" style="padding:10px 0">No one found for “${esc(v)}”.</div>`;
    }, 250);
  });
  const sug = $('#sugg', body);
  const loadSug = async () => {
    const list = await S.suggest().catch(() => []);
    sug.innerHTML = list.length ? list.map(p => personRow(p, { sub: `${p.n} in common`, right: relButton(p) })).join('')
      : `<div class="sub" style="padding:8px 0">${cloud.stats?.is_minor ? 'Suggestions are off for accounts under 18. Add friends with an invite link instead.' : 'Rate a few more titles and we\'ll find people who love the same things.'}</div>`;
  };
  await loadSug();
  wireActs(body, async () => { await loadSug(); q.dispatchEvent(new Event('input')); });
}

/* ---------- Invite ---------- */
async function fillInvite(body) {
  const code = cloud.profile?.invite_code;
  if (!code) { body.innerHTML = `<div class="card">${empty('Invite links will work after the next update.', 'sad')}</div>`; return; }
  const url = inviteUrl(code);
  body.innerHTML = `<section class="card invite">
      <h2 class="h3"><i class="i i-link" aria-hidden="true"></i> Your invite link</h2>
      <div class="sub">Anyone who opens this link and signs in becomes your friend right away. Only share it with people you know.</div>
      <div class="qr" id="qr"></div>
      <div class="linkbox"><input id="ilink" readonly value="${esc(url)}" aria-label="Your invite link"><button class="btn sm" id="icopy">Copy</button></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn" id="ishare" style="flex:1"><i class="i i-share" aria-hidden="true"></i> Share link</button>
        <button class="btn ghost" id="ireset" style="flex:1"><i class="i i-refresh-cw" aria-hidden="true"></i> New link</button></div>
      <div class="sub" style="margin-top:8px;font-size:13px">Shared it with the wrong person? Tap “New link” and the old one stops working.</div>
    </section>`;
  $('#qr', body).innerHTML = await qrSvg(url).catch(() => '');
  $('#icopy', body).onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Link copied!'); } catch (e) { $('#ilink', body).select(); toast('Press Copy on your keyboard.'); } };
  $('#ishare', body).onclick = async () => {
    const text = `Be my friend on Heartbeat! Let's see our Taste Match!`;
    try { if (navigator.share) { await navigator.share({ title: 'Heartbeat', text, url }); return; } await navigator.clipboard.writeText(`${text} ${url}`); toast('Invite copied!'); }
    catch (e) { /* closed */ }
  };
  $('#ireset', body).onclick = async () => {
    try { await S.resetInvite(); await refreshMe(); toast('New link ready. The old one won\'t work anymore.'); fillInvite(body); }
    catch (e) { toast(plain(e), 'sad'); }
  };
}

/* =====================================================================
   Invite landing: #/invite/<code>
   ===================================================================== */
export async function renderInvite(app, code) {
  document.title = 'You\'re invited — Heartbeat';
  app.innerHTML = `<div class="screen"><div class="card" style="margin-top:20px">${empty('Opening your invite…')}</div></div>`;
  if (!cloud.ready) { app.innerHTML = `<div class="screen"><div class="card" style="margin-top:20px">${empty('Loading…')}</div></div>`; return; }
  if (socialReady()) {
    try {
      const r = await S.acceptInvite(code);
      try { localStorage.removeItem(INVITE_KEY); } catch (e) { /* ignore */ }
      if (r.status === 'self') { toast('That\'s your own invite link! Share it with friends.'); location.hash = '#/friends/invite'; return; }
      confetti(); buzz([20, 40, 20]); toast(`You and @${r.user.username} are friends now!`, 'wow');
      location.replace(profileHref(r.user)); return;
    } catch (e) {
      try { localStorage.removeItem(INVITE_KEY); } catch (er) { /* ignore */ }
      app.innerHTML = `<div class="screen"><div class="card" style="margin-top:20px">${empty(esc(plain(e)), 'sad', '<a class="btn" href="#/friends">Go to Friends</a>')}</div></div>`;
      return;
    }
  }
  // Not signed in yet: remember the invite and show who sent it.
  try { localStorage.setItem(INVITE_KEY, code); } catch (e) { /* ignore */ }
  const who = await S.inviteInfo(code).catch(() => null);
  app.innerHTML = `<div class="screen"><section class="card invite-land">
    ${who ? `${avatar(who, 'lg')}<h1 class="h3" style="font-size:24px;margin:12px 0 4px">${esc(who.display_name || who.username)} invited you!</h1><div class="sub">${handle(who)} wants to be friends on Heartbeat <i class="i i-heart-handshake" aria-hidden="true"></i></div>`
      : `${mascot('sad')}<h1 class="h3">That invite link doesn't work anymore.</h1><div class="sub">Ask your friend for a new one. You can still join!</div>`}
    <p class="sub" style="margin-top:14px">Heartbeat lets you rate the <b>start, middle and ending</b> of movies and shows, and see your Taste Match with friends.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:14px">
      ${cloud.user ? '<a class="btn" href="#/welcome">Finish setup</a>' : '<a class="btn" href="#/signin/up">Make an account</a><a class="btn ghost" href="#/signin">I have an account</a>'}</div>
    ${who ? '<div class="sub" style="margin-top:10px;font-size:13px">After you sign in, you\'ll be friends automatically.</div>' : ''}
  </section></div>`;
}
/** After sign-in / setup, finish a saved invite. */
export function pendingInvite() { try { return localStorage.getItem(INVITE_KEY); } catch (e) { return null; } }

/* =====================================================================
   Profile page: #/u/<username>
   ===================================================================== */
export async function renderProfile(app, username) {
  document.title = `@${username} — Heartbeat`;
  app.innerHTML = `<div class="screen profile"><header class="top"><button class="icon-btn" id="pback" aria-label="Back"><i class="i i-arrow-left" aria-hidden="true"></i></button></header>
    <div class="card"><div class="rskel"></div><div class="rskel"></div><div class="rskel"></div></div></div>`;
  $('#pback', app).onclick = () => history.length > 1 ? history.back() : (location.hash = '#/friends');
  if (!cloud.ready) return;
  let p;
  try { p = await S.profile(username); } catch (e) { p = undefined; }
  if (location.hash.split('/')[2] && decodeURIComponent(location.hash.split('/')[2]) !== username) return; // moved on
  if (!p) {
    app.querySelector('.card').outerHTML = `<div class="card">${empty(p === null ? 'No one has that username.' : 'Could not load this profile. Check your connection.', 'sad', '<a class="btn" href="#/friends/find">Find people</a>')}</div>`;
    return;
  }
  document.title = `${p.display_name || p.username} (@${p.username}) — Heartbeat`;
  const r = p.rel || {}, c = p.counts || {}, me = p.self, signed = socialReady();
  const [favs, loved] = await Promise.all([titlesFor(p.fav_titles || []), titlesFor((p.loved || []).map(x => x.k))]);
  const lovedScore = Object.fromEntries((p.loved || []).map(x => [x.k, x.o]));
  const friendBtn = me ? `<button class="btn" id="pedit"><i class="i i-pencil" aria-hidden="true"></i> Edit profile</button><a class="btn ghost" href="#/friends/invite"><i class="i i-link" aria-hidden="true"></i> Invite</a>`
    : !signed ? `<a class="btn" href="#/signin/up"><i class="i i-plus" aria-hidden="true"></i> Add friend</a>`
    : r.blocked ? `<button class="btn ghost" id="punblock">Unblock</button>`
    : r.friend ? `<button class="btn ghost" id="punfriend" aria-label="Friends. Tap to unfriend"><i class="i i-check" aria-hidden="true"></i> Friends</button>`
    : r.req_in ? `<button class="btn" data-accept="${r.req_in}">Accept request</button><button class="btn ghost" data-decline="${r.req_in}">Decline</button>`
    : r.req_out ? `<button class="btn ghost" data-cancel="${r.req_out}">Requested · Cancel</button>`
    : `<button class="btn" data-add="${esc(p.id)}"><i class="i i-plus" aria-hidden="true"></i> Add friend</button>`;
  const followBtn = !me && signed && !r.blocked && (!p.is_private || r.friend)
    ? `<button class="btn ghost" id="pfollow">${r.following ? '✓ Following' : 'Follow'}</button>` : '';
  const t = p.taste, diff = t && t.n ? t.end - t.start : 0;
  const style = !t || !t.n ? null : diff <= -0.5 ? ['<i class="i i-glasses" aria-hidden="true"></i>', 'Tough on endings'] : diff >= 0.5 ? ['<i class="i i-activity" aria-hidden="true"></i>', 'Slow-burn lover'] : ['<i class="i i-scale" aria-hidden="true"></i>', 'Even-keeled'];
  const m = p.match;

  app.innerHTML = `<div class="screen profile">
    <header class="top"><button class="icon-btn" id="pback" aria-label="Back"><i class="i i-arrow-left" aria-hidden="true"></i></button>
      <div style="display:flex;gap:8px">${!me ? `<button class="icon-btn" id="pshare" aria-label="Share profile"><i class="i i-share" aria-hidden="true"></i></button>` : ''}${!me && signed ? `<button class="icon-btn" id="pmore" aria-label="More options">⋯</button>` : ''}</div></header>
    <section class="card phead ${styleClass(p)}">
      ${bannerHTML(p)}${avatar(p, 'lg')}
      <div class="pinfo"><h1>${esc(p.display_name || p.username)}</h1>
        <div class="sub">${handle(p)}${r.follows_me ? ' · <span class="pill2">Follows you</span>' : ''}</div>
        <div class="pchips">${rankChip(p.rank)}${p.top_critic ? '<span class="crit"><i class="i i-check" aria-hidden="true"></i> Verified Critic</span>' : ''}${p.plus ? '<span class="pluschip"><i class="i i-heart" aria-hidden="true"></i> Plus</span>' : ''}${p.streak ? `<span class="pill2"><i class="i i-flame" aria-hidden="true"></i> ${p.streak}-day streak</span>` : ''}${p.is_private ? '<span class="pill2"><i class="i i-lock" aria-hidden="true"></i> Friends only</span>' : ''}</div></div>
      ${p.bio ? `<p class="pbio">${esc(p.bio)}</p>` : ''}
      <div class="pcounts"><div><b>${c.ratings}</b><span>ratings</span></div><div><b>${c.reviews}</b><span>reviews</span></div><div><b>${c.friends}</b><span>friends</span></div><div><b>${c.followers}</b><span>followers</span></div></div>
      <div class="pbtns">${friendBtn}${followBtn}${!me && signed && !r.blocked ? '<button class="btn ghost" id="pmsg"><i class="i i-message-circle" aria-hidden="true"></i> Message</button>' : ''}</div>
    </section>

    ${m && m.pct != null ? `<button class="card matchcard" id="pmatch" type="button"><div class="mring" style="--p:${m.pct}"><b>${m.pct}%</b></div>
      <div style="flex:1;text-align:left"><h2 class="h3">Taste Match</h2><div class="sub">${m.pct >= 80 ? 'Movie twins! ' : ''}You both rated ${m.n} of the same titles. Tap to see where you agree.</div></div></button>
      ${!me && signed ? '<button class="btn sm ghost propro" id="ppro" type="button"><i class="i i-microscope" aria-hidden="true"></i> Pro compare: start, middle, ending</button>' : ''}`
      : m && !me ? `<div class="card"><h2 class="h3"><i class="i i-heart-handshake" aria-hidden="true"></i> Taste Match</h2><div class="sub">Rate ${Math.max(1, 2 - (m.n || 0))} more title${2 - (m.n || 0) === 1 ? '' : 's'} you both watched to see your match.</div></div>` : ''}

    ${p.limited ? `<div class="card">${empty(p.is_private ? 'This profile is friends-only. Become friends to see their ratings and activity.' : 'Sign in to see more.', 'happy')}</div>` : `
    ${favs.length ? `<section><div class="sec"><h2><i class="i i-heart" aria-hidden="true"></i> Favorite ${favs.length === 1 ? 'title' : `${favs.length}`}</h2></div><div class="fav4">${favs.map(x => `<a href="#/t/${esc(x.id)}" class="fav" aria-label="${esc(x.name)}">${poster(x, { mine: false })}</a>`).join('')}</div></section>` : me ? `<div class="card"><div class="sub">Pick your 4 favorite titles in <b>Edit profile</b> so friends see your taste.</div></div>` : ''}
    ${t && t.n ? `<section class="card"><h2 class="h3"><i class="i i-chart-column" aria-hidden="true"></i> Taste</h2>
      <div class="stat3" style="margin:10px 0 12px"><div><b>${t.n}</b><span>rated</span></div><div><b>${(+t.avg).toFixed(1)}</b><span>avg <i class="i i-star" aria-hidden="true"></i></span></div><div><b>${style[0]}</b><span>${style[1]}</span></div></div>
      ${[['Starts', t.start], ['Middles', t.middle], ['Endings', t.end]].map(([l, v]) => `<div class="genre"><span>${l}</span><div class="track" style="height:12px"><i style="width:${(v / 5) * 100}%;background:var(--grad)"></i></div><span class="sub">${(+v).toFixed(1)}</span></div>`).join('')}
    </section>` : ''}
    ${loved.length ? `<div class="sec"><h2><i class="i i-heart" aria-hidden="true"></i> Loved it</h2></div>${row(loved.map(x => card(x, { sub: `${stars(lovedScore[keyOf(x.id)])} from ${esc(p.username)}` })).join(''), 'Loved it')}` : ''}
    <div class="sec"><h2><i class="i i-message-circle" aria-hidden="true"></i> Recent activity</h2></div><div class="afeed card flist" id="pfeed"><div class="rskel"></div></div>`}
  </div>`;
  hydratePosters(app);
  $('#pback', app).onclick = () => history.length > 1 ? history.back() : (location.hash = '#/friends');
  const again = () => renderProfile(app, username);
  wireActs($('.screen', app), again);
  const on = (id, fn) => { const el = $('#' + id, app); if (el) el.onclick = fn; };
  on('pedit', () => editProfile());
  on('punfriend', () => confirmSheet(`Unfriend ${handle(p)}?`, 'You can add each other again later.', 'Unfriend', async () => { await S.unfriend(p.id); toast('Unfriended.'); again(); }));
  on('punblock', async () => { try { await S.unblock(p.id); toast('Unblocked.'); again(); } catch (e) { toast(plain(e), 'sad'); } });
  on('pfollow', async e => { const b = e.currentTarget; b.disabled = true; try { if (r.following) await S.unfollow(p.id); else { await S.follow(p.id); toast(`Following ${handle(p)}`); } again(); } catch (er) { toast(plain(er), 'sad'); b.disabled = false; } });
  on('pmatch', () => openMatch(p));
  on('ppro', () => openMatchPro(p));
  on('pmsg', () => messageUser(p));
  on('pshare', async () => { const url = `${location.origin}/${profileHref(p)}`; try { if (navigator.share) await navigator.share({ title: `@${p.username} on Heartbeat`, url }); else { await navigator.clipboard.writeText(url); toast('Link copied!'); } } catch (e) { /* closed */ } });
  on('pmore', () => moreSheet(p, again));
  const pf = $('#pfeed', app);
  if (pf) {
    const items = await S.feed(null, p.id, 10).catch(() => null);
    if (!items?.length) pf.innerHTML = `<div class="sub" style="padding:6px 2px">${items ? 'Nothing yet.' : signed ? 'Could not load activity.' : 'Sign in to see their activity.'}</div>`;
    else { pf.innerHTML = ''; await appendFeed(pf, items, { noUser: true }); wireFeed(pf); }
  }
}

function confirmSheet(title, text, yes, fn) {
  const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 6px">${title}</h2><div class="sub">${text}</div>
    <div style="display:flex;gap:8px;margin-top:16px"><button class="btn ghost" id="cno" style="flex:1">Cancel</button><button class="btn" id="cyes" style="flex:1">${yes}</button></div>`);
  $('#cno', sh).onclick = () => closeSheet();
  $('#cyes', sh).onclick = async e => { const b = e.currentTarget; b.disabled = true; try { await fn(); closeSheet(); } catch (er) { toast(plain(er), 'sad'); b.disabled = false; } };
}

function moreSheet(p, again) {
  const r = p.rel || {};
  const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 10px">${handle(p)}</h2>
    <div class="menu">
      ${r.blocked ? '<button class="mitem" data-m="unblock"><i class="i i-check" aria-hidden="true"></i> Unblock</button>' : '<button class="mitem" data-m="block"><i class="i i-ban" aria-hidden="true"></i> Block</button>'}
      <button class="mitem" data-m="report"><i class="i i-flag" aria-hidden="true"></i> Report</button>
      <button class="mitem" data-m="copy"><i class="i i-link" aria-hidden="true"></i> Copy profile link</button></div>`);
  sh.addEventListener('click', async e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    const m = b.dataset.m;
    if (m === 'block') confirmSheet(`Block ${handle(p)}?`, 'You won\'t see each other\'s profiles, reviews or activity, and they can\'t add or follow you. They won\'t be told.', 'Block', async () => { await S.block(p.id); toast('Blocked.'); again(); });
    else if (m === 'unblock') { try { await S.unblock(p.id); closeSheet(); toast('Unblocked.'); again(); } catch (er) { toast(plain(er), 'sad'); } }
    else if (m === 'copy') { try { await navigator.clipboard.writeText(`${location.origin}/${profileHref(p)}`); toast('Link copied!'); } catch (er) { toast('Could not copy here.', 'sad'); } closeSheet(); }
    else if (m === 'report') reportSheet(p);
  });
}
function reportSheet(p) {
  const R = [['spam', 'Spam or a bot'], ['harassment', 'Bullying or harassment'], ['hate', 'Hate'], ['fake', 'Pretending to be someone'], ['underage', 'Under 13'], ['other', 'Something else']];
  const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 6px">Report ${handle(p)}</h2><div class="sub" style="margin-bottom:10px">Our team looks at every report. They won't know it was you.</div>
    <form id="rpf"><div class="menu">${R.map(([k, l], i) => `<label class="mitem"><input type="radio" name="why" value="${k}" ${i ? '' : 'checked'}> ${l}</label>`).join('')}</div>
    <label class="sr-only" for="rpn">More details</label><textarea id="rpn" maxlength="300" rows="2" placeholder="More details (optional)" style="margin-top:10px"></textarea>
    <button class="btn" style="width:100%;margin-top:12px">Send report</button></form>`);
  $('#rpf', sh).onsubmit = async e => {
    e.preventDefault();
    try { await S.report(p.id, new FormData(e.target).get('why'), $('#rpn', sh).value.trim()); closeSheet(); toast('Thanks. We\'ll take a look.'); }
    catch (er) { toast(plain(er), 'sad'); }
  };
}

async function openMatch(p) {
  const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 10px"><i class="i i-heart-handshake" aria-hidden="true"></i> You + ${handle(p)}</h2><div id="mbody"><div class="rskel"></div></div>`);
  const d = await S.match(p.id).catch(() => null);
  const body = $('#mbody', sh); if (!d) { body.innerHTML = '<div class="sub">Could not load this right now.</div>'; return; }
  const all = await titlesFor([...d.agree, ...d.disagree].map(x => x.k));
  const T = Object.fromEntries(all.map(t => [keyOf(t.id), t]));
  const line = x => T[x.k] ? `<a class="mline" href="#/t/${esc(T[x.k].id)}">${poster(T[x.k], { small: true, mine: false })}<span><b>${esc(T[x.k].name)}</b><span class="meta">You ${stars(x.me)} · them ${stars(x.them)}</span></span></a>` : '';
  body.innerHTML = `<div class="mring big" style="--p:${d.pct || 0}"><b>${d.pct ?? '–'}%</b></div>
    <h3 class="h3" style="margin-top:12px"><i class="i i-handshake" aria-hidden="true"></i> You agree on</h3>${d.agree.length ? d.agree.slice(0, 8).map(line).join('') : '<div class="sub">Nothing yet.</div>'}
    <h3 class="h3" style="margin-top:12px"><i class="i i-sun" aria-hidden="true"></i> You disagree on</h3>${d.disagree.length ? d.disagree.slice(0, 8).map(line).join('') : '<div class="sub">You never really disagree. Cute!</div>'}`;
  hydratePosters(body);
  body.addEventListener('click', e => { if (e.target.closest('a')) closeSheet(); });
}

/* =====================================================================
   Edit profile (sheet)
   ===================================================================== */
export async function editProfile() {
  const p = cloud.profile || {}, minor = !!cloud.stats?.is_minor;
  let favs = (await titlesFor(p.fav_titles || [])).map(t => ({ key: keyOf(t.id), t }));
  const sh = sheet(`<h2 class="h3" style="font-size:22px;margin:0 0 12px"><i class="i i-pencil" aria-hidden="true"></i> Edit profile</h2>
    <form id="epf" novalidate>
      <div class="eavatar">${avatar(p, 'lg')}<div style="display:flex;flex-direction:column;gap:8px">
        <label class="btn sm" for="efile"><i class="i i-camera" aria-hidden="true"></i> ${p.avatar_url ? 'Change photo' : 'Add photo'}</label><input id="efile" type="file" accept="image/*" class="sr-only">
        ${p.avatar_url ? '<button type="button" class="btn sm ghost" id="eremove">Remove photo</button>' : ''}</div></div>
      <label class="flabel" for="ename">Name</label><input id="ename" maxlength="40" value="${esc(p.display_name || '')}" autocomplete="nickname">
      <label class="flabel" for="euser">Username</label><div class="atwrap"><span aria-hidden="true">@</span><input id="euser" maxlength="20" value="${esc(p.username || '')}" autocapitalize="none" autocomplete="username" spellcheck="false"></div>
      <div class="sub" id="euhint" style="font-size:13px">3–20 letters, numbers, . or _</div>
      <label class="flabel" for="ebio">Bio</label><textarea id="ebio" maxlength="160" rows="3" placeholder="What do you love to watch?">${esc(p.bio || '')}</textarea>
      <div class="sub" style="text-align:right;font-size:13px"><span id="ebn">${(p.bio || '').length}</span>/160</div>
      <div class="flabel"><i class="i i-heart" aria-hidden="true"></i> Favorite 4</div><div class="fav4 edit" id="efavs"></div>
      <div class="toggle" style="margin-top:14px"><span id="eplbl"><i class="i i-lock" aria-hidden="true"></i> Friends-only profile</span><button type="button" class="switch ${p.is_private || minor ? 'on' : ''}" id="epriv" role="switch" aria-checked="${!!(p.is_private || minor)}" aria-labelledby="eplbl" ${minor ? 'disabled' : ''}></button></div>
      <div class="sub" style="font-size:13px">${minor ? 'Profiles of people under 18 are always friends-only. This keeps you safe.' : 'When on, only friends see your ratings, favorites and activity. Your public reviews stay public.'}</div>
      <div class="sub" id="eerr" role="alert" style="color:var(--pink);min-height:20px;margin-top:8px"></div>
      <button class="btn" style="width:100%" id="esave">Save</button>
    </form>`);
  const err = $('#eerr', sh), favBox = $('#efavs', sh);
  const drawFavs = () => {
    favBox.innerHTML = [0, 1, 2, 3].map(i => favs[i]
      ? `<div class="fav">${poster(favs[i].t, { mine: false })}<button type="button" class="favx" data-fx="${i}" aria-label="Remove ${esc(favs[i].t.name)}"><i class="i i-x" aria-hidden="true"></i></button></div>`
      : `<button type="button" class="fav empty" data-fadd="${i}" aria-label="Add a favorite"><i class="i i-plus" aria-hidden="true"></i></button>`).join('');
    hydratePosters(favBox);
  };
  drawFavs();
  favBox.onclick = e => {
    const x = e.target.closest('[data-fx]'); if (x) { favs.splice(+x.dataset.fx, 1); drawFavs(); return; }
    if (e.target.closest('[data-fadd]')) pickTitle(sh, t => { if (!favs.some(f => f.key === keyOf(t.id))) favs.push({ key: keyOf(t.id), t }); favs = favs.slice(0, 4); drawFavs(); });
  };
  $('#ebio', sh).oninput = e => { $('#ebn', sh).textContent = e.target.value.length; err.textContent = ''; };
  $('#epriv', sh).onclick = e => { const b = e.currentTarget, v = !b.classList.contains('on'); b.classList.toggle('on', v); b.setAttribute('aria-checked', v); };
  $('#efile', sh).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    err.textContent = 'Uploading…';
    try { await uploadAvatar(f); $('.eavatar .ava', sh).outerHTML = avatar(cloud.profile, 'lg'); err.textContent = ''; toast('Looking good!'); }
    catch (er) { err.textContent = plain(er); }
  };
  const rm = $('#eremove', sh); if (rm) rm.onclick = async () => { try { await removeAvatar(); closeSheet(); editProfile(); rerender(); } catch (er) { err.textContent = plain(er); } };
  $('#epf', sh).onsubmit = async e => {
    e.preventDefault(); err.textContent = '';
    const u = $('#euser', sh).value.trim().toLowerCase().replace(/^@/, '');
    if (!/^[a-z0-9_.]{3,20}$/.test(u)) { err.textContent = 'Usernames are 3–20 letters, numbers, . or _'; return; }
    const btn = $('#esave', sh); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (u !== p.username && !(await usernameFree(u))) throw new Error('That username is taken. Try another one.');
      const fields = { display_name: $('#ename', sh).value.trim() || null, bio: $('#ebio', sh).value.trim() || null, username: u };
      if (!minor) fields.is_private = $('#epriv', sh).classList.contains('on');
      await saveProfile(fields);
      await S.setFavorites(favs.map(f => f.key));
      await refreshMe();
      closeSheet(); toast('Profile saved!'); buzz();
      if (/^#\/u\//.test(location.hash) && u !== p.username) location.hash = `#/u/${u}`; else rerender();
    } catch (er) { err.textContent = plain(er); btn.disabled = false; btn.textContent = 'Save'; }
  };
}

/** Small title picker (local catalog + TMDB search). */
function pickTitle(parentSheet, onPick) {
  const host = document.createElement('div'); host.className = 'picker';
  host.innerHTML = `<div class="pickbox" role="dialog" aria-modal="true" aria-label="Pick a favorite"><div style="display:flex;gap:8px;align-items:center">
    <input id="pkq" type="search" placeholder="Search movies & series…" autocomplete="off" aria-label="Search titles"><button type="button" class="icon-btn" id="pkx" aria-label="Close"><i class="i i-x" aria-hidden="true"></i></button></div>
    <div id="pkr" class="pkr"></div></div>`;
  parentSheet.appendChild(host);
  const q = $('#pkq', host), res = $('#pkr', host); let timer, live = [];
  const close = () => host.remove();
  const draw = () => {
    const v = q.value.trim();
    const loc = v ? localSearch(v).slice(0, 8) : TITLES.slice(0, 8);
    const extra = live.filter(x => !loc.some(t => t.name.toLowerCase() === x.name.toLowerCase())).slice(0, 8);
    res.innerHTML = loc.map(t => `<button type="button" class="dres" data-id="${esc(t.id)}">${poster(t, { small: true, mine: false })}<span><b>${esc(t.name)}</b><span class="meta">${esc(t.year)}</span></span></button>`).join('')
      + extra.map(x => `<button type="button" class="dres" data-id="tmdb-${x.type}-${x.id}">${poster({ ...x, colors: ['#262036', '#ff4f9a'] }, { small: true, mine: false })}<span><b>${esc(x.name)}</b><span class="meta">${esc(x.year || '')}</span></span></button>`).join('');
    hydratePosters(res);
  };
  draw(); setTimeout(() => q.focus(), 30);
  q.oninput = () => { draw(); clearTimeout(timer); timer = setTimeout(async () => { live = await tmdbSearch(q.value); draw(); }, 260); };
  $('#pkx', host).onclick = close;
  res.onclick = async e => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    const t = BYID[b.dataset.id] || await titleFor(keyOf(b.dataset.id));
    if (t) onPick(t); close();
  };
  host.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
}

/* =====================================================================
   Home: "From your friends"
   ===================================================================== */
export function homeFriendsHTML() {
  if (!socialReady()) return '';
  return `<section id="hfriends" aria-labelledby="hfh"><div class="sec"><h2 id="hfh"><i class="i i-heart-handshake" aria-hidden="true"></i> From your friends</h2><a class="see" href="#/friends">See all</a></div><div class="card flist" id="hflist"><div class="rskel"></div></div></section>`;
}
export async function fillHomeFriends(root) {
  const el = $('#hflist', root); if (!el) return;
  const items = await S.feed(null, null, 4).catch(() => null);
  if (!el.isConnected) return;
  if (!items) { $('#hfriends', root).remove(); return; }
  if (!items.length) {
    el.innerHTML = `<div class="hfempty"><span style="font-size:30px" aria-hidden="true"><i class="i i-hand" aria-hidden="true"></i></span><div style="flex:1"><b>Watch with friends</b><div class="sub">Add friends to see what they rate and save.</div></div><a class="btn sm" href="#/friends/invite">Invite</a></div>`;
    return;
  }
  el.innerHTML = ''; await appendFeed(el, items, { compact: true }); wireFeed(el);
}
