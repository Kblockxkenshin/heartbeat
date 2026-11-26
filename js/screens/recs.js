// Recommendations: "Recommend to..." sheet on every title, the Recs tab in Friends
// (Inbox / Sent / Best Recommender), and notifications when a friend rates your pick.
// All rules (friends only, no repeats, limits, points) live on the server.
import { cloud, keyOf, refreshRequests, plain } from '../cloud.js';
import { U, save } from '../store.js';
import { $, esc, toast, sheet, closeSheet, empty, poster, hydratePosters, buzz, confetti } from '../ui.js';
import { socialReady, avatar, handle, profileHref, titleFor, titlesFor, ago } from '../social.js';
import { openRate } from './detail.js';

async function rpc(fn, args = {}) {
  if (!cloud.sb) throw new Error('You seem to be offline. Try again.');
  const { data, error } = await cloud.sb.rpc(fn, args);
  if (error) throw new Error(error.message || 'Something went wrong. Please try again.');
  return data;
}
export const R = {
  send: (title, users, note) => rpc('recommend', { p_title: title, p_users: users, p_note: note || null }),
  targets: title => rpc('rec_targets', { p_title: title }),
  list: folder => rpc('my_recs', { p_folder: folder, p_limit: 60 }),
  respond: (id, status) => rpc('respond_rec', { p_id: id, p_status: status }),
  board: () => rpc('rec_leaderboard'),
  notes: () => rpc('my_notifications', { p_limit: 30 }),
  readNotes: () => rpc('mark_notifications_read'),
};
const nameOf = p => p?.display_name || (p?.username ? '@' + p.username : 'Someone');
const stars = o => `★ ${(+o).toFixed(1).replace(/\.0$/, '')}`;
const WHY = { 'already sent': 'Already sent', 'already rated it': 'Already watched', 'not friends': 'Not friends', 'that is you': 'That\'s you' };

/* =====================================================================
   "Recommend to..." sheet
   ===================================================================== */
export async function recommendSheet(t) {
  if (!socialReady()) { toast(cloud.user ? 'Finish setting up your account first.' : 'Sign in to recommend titles to friends.'); return; }
  const key = keyOf(t.id);
  const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 4px"><i class="i i-gift" aria-hidden="true"></i> Recommend “${esc(t.name)}”</h2>
    <div class="sub" style="margin-bottom:10px">Pick friends. If they love it, you earn Good Taste points <i class="i i-heart" aria-hidden="true"></i></div>
    <div id="rcl" class="nclist rcpick"><div class="rskel"></div></div>
    <label class="sr-only" for="rcn">Add a note</label>
    <textarea id="rcn" maxlength="300" rows="2" placeholder="Why should they watch it? (optional)"></textarea>
    <button class="btn big" id="rcgo" disabled>Pick a friend</button>`);
  const list = $('#rcl', sh), go = $('#rcgo', sh), picked = new Set();
  let people = [];
  try { people = await R.targets(key); }
  catch (e) { list.innerHTML = `<div class="sub">${esc(plain(e))}</div>`; return; }
  if (!people.length) {
    list.innerHTML = `<div class="sub">Add friends first, then you can recommend titles to them. <a class="see" href="#/friends/find">Find people</a></div>`;
    go.hidden = true; return;
  }
  list.innerHTML = people.map(p => `<button type="button" class="ncrow" data-u="${esc(p.id)}" ${p.why ? 'disabled' : ''} aria-pressed="false">
    ${avatar(p, 'sm')}<span class="pname"><b>${esc(p.display_name || p.username)}</b><span class="meta">${handle(p)}</span></span>
    ${p.why ? `<span class="pill2">${esc(WHY[p.why] || p.why)}</span>` : '<span class="tick" aria-hidden="true"></span>'}</button>`).join('');
  const paint = () => {
    go.disabled = !picked.size;
    go.textContent = picked.size ? `Send to ${picked.size} friend${picked.size > 1 ? 's' : ''}` : 'Pick a friend';
  };
  list.onclick = e => {
    const b = e.target.closest('[data-u]'); if (!b || b.disabled) return;
    const u = b.dataset.u;
    if (picked.has(u)) picked.delete(u); else picked.add(u);
    b.classList.toggle('on', picked.has(u)); b.setAttribute('aria-pressed', picked.has(u));
    buzz(8); paint();
  };
  go.onclick = async () => {
    go.disabled = true;
    try {
      const r = await R.send(key, [...picked], $('#rcn', sh).value.trim());
      closeSheet();
      if (r.sent) { buzz([15, 30, 15]); confetti(40); toast(`Sent to ${r.sent} friend${r.sent > 1 ? 's' : ''}!`); }
      else toast(r.skipped?.[0] ? `Not sent: ${WHY[r.skipped[0].why] || r.skipped[0].why}` : 'Nothing sent.', 'sad');
    } catch (e) { toast(plain(e), 'sad'); paint(); }
  };
}

/* =====================================================================
   Friends → 🎁 Recs tab
   ===================================================================== */
let sub = null;
export async function fillRecs(body) {
  if (!sub) sub = (cloud.profile?.new_recs || 0) === 0 && (cloud.profile?.unread_notes || 0) > 0 ? 'sent' : 'inbox';
  const nIn = cloud.profile?.new_recs || 0, nNotes = cloud.profile?.unread_notes || 0;
  const tabs = [['inbox', 'For me', nIn], ['sent', 'I sent', nNotes], ['top', 'Leaders', 0]];
  body.innerHTML = `<div class="rcsub" role="tablist" aria-label="Recommendations">${tabs.map(([k, l, n]) =>
      `<button type="button" role="tab" class="chip ${k === sub ? 'on' : ''}" aria-selected="${k === sub}" data-sub="${k}">${l}${n ? ` <span class="cnt">${n}</span>` : ''}</button>`).join('')}</div>
    <div id="rbody"><div class="card"><div class="rskel"></div><div class="rskel"></div></div></div>`;
  body.querySelector('.rcsub').onclick = e => {
    const b = e.target.closest('[data-sub]'); if (!b || b.dataset.sub === sub) return;
    sub = b.dataset.sub; fillRecs(body);
  };
  const box = $('#rbody', body);
  try { await ({ inbox: fillInbox, sent: fillSent, top: fillBoard })[sub](box); }
  catch (e) { box.innerHTML = `<div class="card">${empty(esc(plain(e)), 'sad')}</div>`; }
}

async function withTitles(items) {
  const ts = await titlesFor([...new Set(items.map(x => x.title_key))]);
  const by = Object.fromEntries(ts.map(t => [keyOf(t.id), t]));
  return items.map(x => ({ ...x, t: by[x.title_key] })).filter(x => x.t);
}

/* ---------- Inbox ---------- */
async function fillInbox(box) {
  const items = await withTitles(await R.list('inbox'));
  if (!items.length) {
    box.innerHTML = `<div class="card">${empty('No recommendations yet. When a friend picks something for you, it shows up here.', 'happy',
      '<a class="btn" href="#/search"><i class="i i-search" aria-hidden="true"></i> Find something to recommend</a>')}</div>`;
    return;
  }
  box.innerHTML = `<div class="rlist">${items.map(inboxCard).join('')}</div>`;
  hydratePosters(box);
  box.onclick = async e => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const card = b.closest('[data-rec]'), it = items.find(x => x.id === +card.dataset.rec);
    const act = b.dataset.act;
    if (act === 'rate') { openRate(it.t, () => { refreshRequests(); fillInbox(box); }); return; }
    b.disabled = true;
    try {
      await R.respond(it.id, act);
      if (act === 'saved' && !U.watchlist[it.t.id]) { U.watchlist[it.t.id] = Date.now(); save(); }
      if (act === 'watched') { buzz(); openRate(it.t, () => { refreshRequests(); fillInbox(box); }); }
      else toast(act === 'saved' ? 'Added to your watchlist' : 'Got it. We told nobody.');
      if (it.status === 'new') dropCount(box.parentElement);
      it.status = act; card.outerHTML = inboxCard(it); hydratePosters(box);
      refreshRequests();
    } catch (er) { toast(plain(er), 'sad'); b.disabled = false; }
  };
}
/** One less "new" one: update the little numbers on the tabs right away. */
function dropCount(root) {
  for (const c of [root?.querySelector('[data-sub="inbox"] .cnt'), document.querySelector('.ftabs a[href="#/friends/recs"] .cnt')]) {
    if (!c) continue;
    const n = (+c.textContent || 1) - 1;
    if (n > 0) c.textContent = n; else c.remove();
  }
  if (cloud.profile?.new_recs) cloud.profile.new_recs--;
}
function inboxCard(x) {
  const t = x.t, rated = U.ratings[t.id];
  const state = x.rated_at || rated ? `<span class="pill2 ok"><i class="i i-check" aria-hidden="true"></i> You rated it ${stars(x.rated_overall ?? rated.overall)}</span>`
    : x.status === 'watched' ? `<button class="btn sm" data-act="rate"><i class="i i-heart" aria-hidden="true"></i> Rate it</button>`
    : x.status === 'saved' ? `<span class="pill2"><i class="i i-bookmark" aria-hidden="true"></i> On your watchlist</span><button class="btn sm ghost" data-act="watched"><i class="i i-check" aria-hidden="true"></i> Watched it</button>`
    : x.status === 'nope' ? `<span class="pill2"><i class="i i-circle-slash" aria-hidden="true"></i> Not for you</span>`
    : `<button class="btn sm" data-act="watched"><i class="i i-check" aria-hidden="true"></i> Watched it</button><button class="btn sm ghost" data-act="saved"><i class="i i-plus" aria-hidden="true"></i> Watchlist</button><button class="btn sm ghost" data-act="nope"><i class="i i-circle-slash" aria-hidden="true"></i> Not for me</button>`;
  return `<article class="card rccard ${x.status === 'new' ? 'isnew' : ''}" data-rec="${x.id}">
    <a class="rposter" href="#/t/${esc(t.id)}" aria-label="Open ${esc(t.name)}">${poster(t, { small: true, mine: false })}</a>
    <div class="rinfo">
      <div class="rfrom"><a href="${profileHref(x.user)}">${avatar(x.user, 'xs')}</a><span><a href="${profileHref(x.user)}"><b>${esc(nameOf(x.user))}</b></a> picked this for you · ${ago(x.created_at)}</span>${x.status === 'new' ? '<span class="newdot" aria-label="New"></span>' : ''}</div>
      <a class="rctitle" href="#/t/${esc(t.id)}"><b>${esc(t.name)}</b><span class="meta">${esc(t.year)} · ${t.type === 'tv' ? 'Series' : 'Movie'}</span></a>
      ${x.note ? `<blockquote class="rnote">“${esc(x.note)}”</blockquote>` : ''}
      <div class="rbtns">${state}</div>
    </div></article>`;
}

/* ---------- Sent (+ updates) ---------- */
async function fillSent(box) {
  const [itemsRaw, notes] = await Promise.all([R.list('sent'), R.notes().catch(() => [])]);
  const items = await withTitles(itemsRaw);
  const unread = notes.filter(n => !n.read);
  const nt = await withTitles(unread);
  const updates = nt.length ? `<section class="card rupd"><h2 class="h3"><i class="i i-bell" aria-hidden="true"></i> New</h2>${nt.map(n => `<div class="rupdrow">
      ${avatar(n.actor, 'sm')}<span><b>${esc(nameOf(n.actor))}</b> rated <a href="#/t/${esc(n.t.id)}">${esc(n.t.name)}</a> ${stars(n.data.overall)}
      ${n.data.loved ? `<b class="rcgt"><i class="i i-heart" aria-hidden="true"></i> Loved it! +${n.data.points} Good Taste</b>` : '<span class="meta">Not their thing this time.</span>'}</span>
      <span class="meta">${ago(n.created_at)}</span></div>`).join('')}</section>` : '';
  if (unread.length) R.readNotes().then(() => refreshRequests()).catch(() => {});
  if (!items.length) {
    box.innerHTML = updates + `<div class="card">${empty('You haven\'t recommended anything yet. Open any movie or series and tap “Recommend”.', 'happy',
      '<a class="btn" href="#/search"><i class="i i-search" aria-hidden="true"></i> Find a title</a>')}</div>`;
    return;
  }
  const pts = items.reduce((s, x) => s + (x.points || 0), 0);
  box.innerHTML = updates + `<div class="sub" style="margin:2px 2px 10px">You have <b class="rcgt">${pts} Good Taste</b> points. Each pick a friend loves = +10.</div>
    <div class="rlist">${items.map(sentCard).join('')}</div>`;
  hydratePosters(box);
}
function sentCard(x) {
  const t = x.t;
  const st = x.rated_at ? (x.loved ? `<span class="pill2 rclove">Rated ${stars(x.rated_overall)} · <i class="i i-heart" aria-hidden="true"></i> +${x.points}</span>` : `<span class="pill2">Rated ${stars(x.rated_overall)}</span>`)
    : { new: '<span class="pill2"><i class="i i-inbox" aria-hidden="true"></i> Not opened yet</span>', saved: '<span class="pill2"><i class="i i-bookmark" aria-hidden="true"></i> On their watchlist</span>', watched: '<span class="pill2"><i class="i i-check" aria-hidden="true"></i> Watched, not rated yet</span>', nope: '<span class="pill2"><i class="i i-circle-slash" aria-hidden="true"></i> Not for them</span>' }[x.status];
  return `<article class="card rccard" data-rec="${x.id}">
    <a class="rposter" href="#/t/${esc(t.id)}" aria-label="Open ${esc(t.name)}">${poster(t, { small: true, mine: false })}</a>
    <div class="rinfo">
      <div class="rfrom"><a href="${profileHref(x.user)}">${avatar(x.user, 'xs')}</a><span>To <a href="${profileHref(x.user)}"><b>${esc(nameOf(x.user))}</b></a> · ${ago(x.created_at)}</span></div>
      <a class="rctitle" href="#/t/${esc(t.id)}"><b>${esc(t.name)}</b><span class="meta">${esc(t.year)} · ${t.type === 'tv' ? 'Series' : 'Movie'}</span></a>
      ${x.note ? `<blockquote class="rnote">“${esc(x.note)}”</blockquote>` : ''}
      <div class="rbtns">${st}</div>
    </div></article>`;
}

/* ---------- Best Recommender ---------- */
async function fillBoard(box) {
  const rows = await R.board();
  if (rows.length < 2) {
    box.innerHTML = `<div class="card">${empty('Add friends to compete for Best Recommender!', 'happy', '<a class="btn" href="#/friends/find"><i class="i i-search" aria-hidden="true"></i> Find people</a>')}</div>`;
    return;
  }
  const medal = i => ['<i class="i i-medal" aria-hidden="true"></i>', '<i class="i i-medal" aria-hidden="true"></i>', '<i class="i i-medal" aria-hidden="true"></i>'][i] || `<span class="rk">${i + 1}</span>`;
  box.innerHTML = `<section class="card"><h2 class="h3"><i class="i i-trophy" aria-hidden="true"></i> Best Recommender</h2>
    <div class="sub">Among you and your friends. +10 points each time a friend loves your pick (4<i class="i i-star" aria-hidden="true"></i> or more).</div>
    <ol class="board">${rows.map((p, i) => `<li class="${p.me ? 'me' : ''}">
      <span class="medal" aria-label="Place ${i + 1}">${medal(i)}</span>
      <a class="plink" href="${profileHref(p)}">${avatar(p, 'sm')}<span class="pname"><b>${esc(p.display_name || p.username)}${p.me ? ' (you)' : ''}</b>
        <span class="meta">${p.sent} sent · ${p.loved} loved${p.hit_rate != null ? ` · ${p.hit_rate}% hit rate` : ''}</span></span></a>
      <b class="rcgt">${p.points}</b></li>`).join('')}</ol></section>`;
}
