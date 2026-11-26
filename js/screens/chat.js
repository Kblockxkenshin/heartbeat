// Chat: chat list (Inbox / Requests), chat room with live messages, new chat, settings,
// and "send this title to a friend". Every rule (who can message whom, filters, limits) is on the server.
import { BYID, TITLES } from '../data.js';
import { cloud, keyOf, refreshRequests, plain } from '../cloud.js';
import { U, toggleSave } from '../store.js';
import { search as tmdbSearch } from '../tmdb.js';
import { $, esc, toast, sheet, closeSheet, empty, poster, hydratePosters, buzz, hearts, emo } from '../ui.js';
import { S, socialReady, avatar, handle, profileHref, titleFor, ago } from '../social.js';
import { localSearch } from './search.js';

/* ---------------- server calls ---------------- */
async function rpc(fn, args = {}) {
  if (!cloud.sb) throw new Error('You seem to be offline. Try again.');
  const { data, error } = await cloud.sb.rpc(fn, args);
  if (error) throw new Error(error.message || 'Something went wrong. Please try again.');
  return data;
}
export const C = {
  list: folder => rpc('my_chats', { p_folder: folder }),
  info: id => rpc('chat_info', { p_chat: id }),
  messages: (id, after = null, before = null, limit = 40) => rpc('list_messages', { p_chat: id, p_before: before, p_after: after, p_limit: limit }),
  send: (id, body, title = null) => rpc('send_message', { p_chat: id, p_body: body || null, p_title: title }),
  dm: user => rpc('start_dm', { p_user: user }),
  group: (title, users) => rpc('create_group', { p_title: title || null, p_users: users }),
  add: (id, users) => rpc('add_to_group', { p_chat: id, p_users: users }),
  remove: (id, user) => rpc('remove_from_group', { p_chat: id, p_user: user }),
  leave: id => rpc('leave_chat', { p_chat: id }),
  rename: (id, t) => rpc('rename_group', { p_chat: id, p_title: t }),
  read: id => rpc('mark_read', { p_chat: id }),
  accept: id => rpc('accept_chat', { p_chat: id }),
  decline: (id, block) => rpc('decline_chat', { p_chat: id, p_block: !!block }),
  react: (msg, e) => rpc('toggle_reaction', { p_msg: msg, p_emoji: e }),
  del: msg => rpc('delete_message', { p_msg: msg }),
  report: (msg, reason, note) => rpc('report_message', { p_msg: msg, p_reason: reason, p_note: note || null }),
  mute: (id, hours) => rpc('mute_chat', { p_chat: id, p_hours: hours }),
  settings: () => rpc('my_chat_settings'),
  setSettings: (rr, allow) => rpc('set_chat_settings', { p_read_receipts: rr, p_allow_requests: allow }),
};
const EMOJI = ['❤️', '😂', '😮', '😢', '👍', '🔥'];  // stored values (the server only accepts these)
const EMOJI_NAME = { '❤️': 'Love', '😂': 'Funny', '😮': 'Wow', '😢': 'Sad', '👍': 'Like', '🔥': 'Fire' };
const nameOf = p => p?.display_name || (p?.username ? '@' + p.username : 'Someone');
const chatName = c => c.title || (c.members || []).map(nameOf).join(', ') || 'Just you';
const timeOf = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayOf = iso => {
  const d = new Date(iso), t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};
function groupAvatar(c) {
  const m = c.members || [];
  if (c.kind === 'dm' || m.length < 2) return avatar(m[0] || { username: c.title || '?' }, 'sm');
  return `<span class="gava" aria-hidden="true">${avatar(m[0], 'xs')}${avatar(m[1], 'xs')}</span>`;
}

/* =====================================================================
   Chat list: #/chat  and  #/chat/requests
   ===================================================================== */
let listTimer = null;
export function renderChats(app, folder = 'inbox') {
  document.title = 'Chat — Heartbeat';
  clearInterval(listTimer);
  if (!socialReady()) {
    app.innerHTML = `<div class="screen"><header class="top"><h1 class="logo" style="font-size:26px;margin:0"><i class="i i-message-circle" aria-hidden="true"></i> Chat</h1></header>
      <div class="card">${empty(!cloud.ready ? 'Chat needs the online account, which isn\'t set up yet.' : cloud.user ? 'Finish setting up your account to chat.' : 'Make a free account to chat with friends about movies and shows.', 'happy',
        cloud.ready ? (cloud.user ? '<a class="btn" href="#/welcome">Finish setup</a>' : '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><a class="btn" href="#/signin/up">Make an account</a><a class="btn ghost" href="#/signin">Sign in</a></div>') : '')}</div></div>`;
    return;
  }
  const req = cloud.chatRequests || 0;
  app.innerHTML = `<div class="screen chats">
    <header class="top"><h1 class="logo" style="font-size:26px;margin:0"><i class="i i-message-circle" aria-hidden="true"></i> Chat</h1>
      <div style="display:flex;gap:8px"><button class="icon-btn" id="csettings" aria-label="Chat settings"><i class="i i-settings" aria-hidden="true"></i></button><button class="btn sm" id="cnew"><i class="i i-pencil" aria-hidden="true"></i> New chat</button></div></header>
    <nav class="ftabs" aria-label="Chat folders"><a href="#/chat" class="chip ${folder !== 'requests' ? 'on' : ''}" ${folder !== 'requests' ? 'aria-current="page"' : ''}><i class="i i-download" aria-hidden="true"></i> Inbox</a>
      <a href="#/chat/requests" class="chip ${folder === 'requests' ? 'on' : ''}" ${folder === 'requests' ? 'aria-current="page"' : ''}><i class="i i-mail-plus" aria-hidden="true"></i> Requests${req ? ` <span class="cnt">${req}</span>` : ''}</a></nav>
    <div class="card clist" id="clist"><div class="rskel"></div><div class="rskel"></div></div>
  </div>`;
  $('#cnew', app).onclick = () => newChat();
  $('#csettings', app).onclick = () => chatSettings();
  const box = $('#clist', app);
  const load = async () => {
    let list;
    try { list = await C.list(folder === 'requests' ? 'requests' : 'inbox'); } catch (e) {
      if (box.isConnected && !box.querySelector('.crow')) box.innerHTML = empty(esc(plain(e)), 'sad');
      return;
    }
    if (!box.isConnected) { clearInterval(listTimer); return; }
    box.innerHTML = list.length ? list.map(chatRow).join('')
      : folder === 'requests' ? `<div class="sub" style="padding:14px 4px">No message requests. When someone who isn't your friend messages you, it shows up here first.</div>`
      : empty('No chats yet. Start one with a friend and send them a movie!', 'happy', '<button class="btn" id="cnew2"><i class="i i-pencil" aria-hidden="true"></i> New chat</button>');
    const n2 = $('#cnew2', box); if (n2) n2.onclick = () => newChat();
  };
  load();
  listTimer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 8000);
  refreshRequests();
}
function chatRow(c) {
  const l = c.last, me = l?.mine;
  const prev = !l ? '' : l.deleted ? 'Message deleted' : l.hidden ? 'Message hidden' : l.kind === 'system' ? l.body
    : l.kind === 'title' ? `${me ? 'You' : nameOf(l.user)} sent a title` : `${me ? 'You: ' : c.kind === 'group' ? nameOf(l.user) + ': ' : ''}${l.body}`;
  return `<a class="crow ${c.unread ? 'unread' : ''}" href="#/chat/${c.id}">${groupAvatar(c)}
    <span class="cmain"><span class="cname"><b>${esc(chatName(c))}</b>${c.kind === 'group' ? `<span class="meta"> · ${c.count}</span>` : ''}${c.muted ? ' <span aria-label="Muted"><i class="i i-bell-off" aria-hidden="true"></i></span>' : ''}</span>
      <span class="cprev">${esc(prev)}</span></span>
    <span class="cside"><span class="meta">${ago(c.at)}</span>${c.unread ? `<span class="cnt2" aria-label="${c.unread} new">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}</span></a>`;
}

/* ---------------- new chat ---------------- */
async function newChat() {
  const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 6px"><i class="i i-pencil" aria-hidden="true"></i> New chat</h2><div class="sub">Pick one friend for a 1-on-1 chat, or a few for a group (up to 19).</div>
    <div id="ncl" class="nclist"><div class="rskel"></div></div>
    <div id="ngroup" hidden><label class="flabel" for="ngt">Group name (optional)</label><input id="ngt" maxlength="40" placeholder="Movie night <i class="i i-popcorn" aria-hidden="true"></i>"></div>
    <div class="sub" id="nerr" role="alert" style="color:var(--pink);min-height:20px"></div>
    <button class="btn" id="ngo" style="width:100%" disabled>Start chat</button>`);
  let friends = [];
  try { friends = (await S.friends()).friends; } catch (e) { $('#ncl', sh).innerHTML = `<div class="sub">${esc(plain(e))}</div>`; return; }
  const list = $('#ncl', sh), go = $('#ngo', sh);
  list.innerHTML = friends.length ? friends.map(p => `<label class="ncrow">${avatar(p, 'sm')}<span class="pname"><b>${esc(p.display_name || p.username)}</b><span class="meta">${handle(p)}</span></span>
      <input type="checkbox" value="${esc(p.id)}" aria-label="${esc(p.display_name || p.username)}"></label>`).join('')
    : `<div class="sub" style="padding:10px 0">Add friends first, then you can chat. <a class="see" href="#/friends/find">Find people</a></div>`;
  const picked = () => [...list.querySelectorAll('input:checked')].map(i => i.value);
  list.onchange = () => {
    const n = picked().length;
    $('#ngroup', sh).hidden = n < 2; go.disabled = !n;
    go.textContent = n > 1 ? `Start group (${n + 1} people)` : 'Start chat';
    if (n > 19) { $('#nerr', sh).textContent = 'Groups can have up to 20 people.'; go.disabled = true; } else $('#nerr', sh).textContent = '';
  };
  go.onclick = async () => {
    const ids = picked(); go.disabled = true;
    try {
      const id = ids.length === 1 ? await C.dm(ids[0]) : await C.group($('#ngt', sh).value.trim(), ids);
      closeSheet(); location.hash = `#/chat/${id}`;
    } catch (e) { $('#nerr', sh).textContent = plain(e); go.disabled = false; }
  };
}

/* ---------------- settings ---------------- */
async function chatSettings() {
  const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 12px"><i class="i i-settings" aria-hidden="true"></i> Chat settings</h2><div id="csb"><div class="rskel"></div></div>`);
  let s; try { s = await C.settings(); } catch (e) { $('#csb', sh).innerHTML = `<div class="sub">${esc(plain(e))}</div>`; return; }
  $('#csb', sh).innerHTML = `<div class="toggle"><span id="rrl"><i class="i i-eye" aria-hidden="true"></i> Read receipts</span><button type="button" class="switch ${s.read_receipts ? 'on' : ''}" id="rr" role="switch" aria-checked="${s.read_receipts}" aria-labelledby="rrl"></button></div>
    <div class="sub" style="font-size:13px;margin-bottom:14px">When off, people won't see when you read their messages, and you won't see theirs.</div>
    <div class="flabel"><i class="i i-mail" aria-hidden="true"></i> Who can message me</div>
    ${s.is_minor ? `<div class="sub">Only your friends can message you. This keeps people under 18 safe.</div>` : `<div class="menu">
      <label class="mitem"><input type="radio" name="ar" value="everyone" ${s.allow_requests === 'everyone' ? 'checked' : ''}> Everyone <small class="hint">(non-friends go to Requests)</small></label>
      <label class="mitem"><input type="radio" name="ar" value="friends" ${s.allow_requests === 'friends' ? 'checked' : ''}> Friends only</label></div>`}
    <button class="btn" id="css" style="width:100%;margin-top:14px">Save</button>`;
  $('#rr', sh).onclick = e => { const b = e.currentTarget, v = !b.classList.contains('on'); b.classList.toggle('on', v); b.setAttribute('aria-checked', v); };
  $('#css', sh).onclick = async () => {
    try {
      await C.setSettings($('#rr', sh).classList.contains('on'), sh.querySelector('input[name=ar]:checked')?.value || s.allow_requests);
      closeSheet(); toast('Saved!');
    } catch (e) { toast(plain(e), 'sad'); }
  };
}

/* =====================================================================
   Chat room: #/chat/<id>
   ===================================================================== */
let room = null; // the open room (one at a time)
export function leaveRoom() {
  if (!room) return;
  clearInterval(room.poll); clearInterval(room.slow); clearTimeout(room.typingHide);
  try { room.ch && cloud.sb?.removeChannel(room.ch); } catch (e) { /* ignore */ }
  document.body.classList.remove('inroom');
  room = null;
  refreshRequests();
}

export async function renderRoom(app, id) {
  leaveRoom(); clearInterval(listTimer);
  id = +id;
  document.body.classList.add('inroom');
  app.innerHTML = `<div class="room"><header class="rhead"><a class="icon-btn" href="#/chat" aria-label="Back to chats"><i class="i i-arrow-left" aria-hidden="true"></i></a><div class="rwhohd"><div class="rskel" style="width:140px"></div></div></header>
    <div class="msgs" id="msgs" role="log" aria-live="polite" aria-label="Messages"></div></div>`;
  if (!socialReady()) { if (cloud.ready) renderChats(app); return; }
  const r = room = { id, msgs: new Map(), last: 0, first: null, info: null, typing: {}, live: false };
  let info;
  try { info = await C.info(id); } catch (e) { info = null; }
  if (room !== r) return;
  if (!info) { app.innerHTML = `<div class="screen"><div class="card">${empty('This chat isn\'t available.', 'sad', '<a class="btn" href="#/chat">Back to chats</a>')}</div></div>`; return; }
  r.info = info;
  drawShell(app, r);
  await loadOlder(r, true);
  startLive(r);
  markRead(r);
}

function roomTitle(info) {
  if (info.kind === 'dm') return info.other ? nameOf(info.other) : 'Chat';
  return info.title || info.members.map(nameOf).slice(0, 3).join(', ') || 'Group';
}
function drawShell(app, r) {
  const i = r.info, o = i.other;
  const sub = i.kind === 'dm' ? (o ? `${handle(o)}${o.friend ? ' · Friends' : ''}` : '') : `${i.members.length + 1} people`;
  const canSend = i.status === 'active' && (i.kind === 'group' || (o && o.can_send && o.status !== 'declined'));
  document.title = `${roomTitle(i)} — Chat`;
  app.innerHTML = `<div class="room">
    <header class="rhead"><a class="icon-btn" href="#/chat" aria-label="Back to chats"><i class="i i-arrow-left" aria-hidden="true"></i></a>
      ${i.kind === 'dm' && o ? `<a href="${profileHref(o)}" class="rwhohd">${avatar(o, 'sm')}<span><b>${esc(roomTitle(i))}</b><span class="meta" id="rsub">${esc(sub)}</span></span></a>`
        : `<div class="rwhohd">${groupAvatar({ kind: 'group', members: i.members })}<span><b>${esc(roomTitle(i))}</b><span class="meta" id="rsub">${esc(sub)}</span></span></div>`}
      <button class="icon-btn" id="rmore" aria-label="Chat options">⋯</button></header>
    ${i.status === 'request' ? `<div class="reqbar"><div><b>${esc(nameOf(o || i.members[0]))}</b> wants to chat. You're not friends yet. They won't know you saw this until you accept.</div>
      <div class="pbtns"><button class="btn sm" id="racc">Accept</button><button class="btn sm ghost" id="rdec">Delete</button><button class="btn sm ghost" id="rblk">Block</button></div></div>` : ''}
    <div class="msgs" id="msgs" role="log" aria-live="polite" aria-label="Messages"><div class="morewrap"><button class="btn ghost sm" id="older" style="display:none">Load older</button></div><div id="mlist"></div><div class="typing" id="typing" aria-live="polite"></div></div>
    ${canSend ? `<form class="composer" id="comp" autocomplete="off">
        <button type="button" class="icon-btn" id="ctitle" aria-label="Send a movie or series"><i class="i i-clapperboard" aria-hidden="true"></i></button>
        <label class="sr-only" for="cin">Message</label><textarea id="cin" rows="1" maxlength="2000" placeholder="Message…" enterkeyhint="send"></textarea>
        <button class="sendbtn" id="csend" type="submit" aria-label="Send"><i class="i i-send" aria-hidden="true"></i></button></form>
      <div class="cerr" id="cerr" role="alert"></div>`
      : i.status === 'request' ? '' : `<div class="cnote">${esc(o?.why || (o?.status === 'declined' ? 'They didn\'t accept your message request.' : 'You can\'t send messages here.'))}</div>`}
  </div>`;
  $('#rmore', app).onclick = () => roomMenu(r);
  $('#older', app).onclick = () => loadOlder(r, false);
  if (i.status === 'request') {
    $('#racc', app).onclick = async () => { try { await C.accept(r.id); toast('Accepted! Say hi'); renderRoom($('#app'), r.id); } catch (e) { toast(plain(e), 'sad'); } };
    $('#rdec', app).onclick = async () => { try { await C.decline(r.id, false); toast('Request deleted.'); location.hash = '#/chat/requests'; } catch (e) { toast(plain(e), 'sad'); } };
    $('#rblk', app).onclick = async () => { try { await C.decline(r.id, true); toast('Blocked. They can\'t message you anymore.'); location.hash = '#/chat/requests'; } catch (e) { toast(plain(e), 'sad'); } };
  }
  const comp = $('#comp', app);
  if (comp) {
    const inp = $('#cin', app);
    const grow = () => { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 140) + 'px'; };
    inp.addEventListener('input', () => { grow(); $('#cerr', app).textContent = ''; sendTyping(r); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); comp.requestSubmit(); } });
    comp.onsubmit = async e => {
      e.preventDefault(); const v = inp.value.trim(); if (!v) return;
      const b = $('#csend', app); b.disabled = true;
      try { const m = await C.send(r.id, v); inp.value = ''; grow(); addMsgs(r, [m]); buzz(6); }
      catch (er) { $('#cerr', app).textContent = plain(er); }
      b.disabled = false; inp.focus();
    };
    $('#ctitle', app).onclick = () => pickTitle(async t => {
      try { const m = await C.send(r.id, null, keyOf(t.id)); addMsgs(r, [m]); buzz(6); } catch (er) { toast(plain(er), 'sad'); }
    });
  }
  const list = $('#mlist', app);
  list.addEventListener('click', e => onMsgClick(e, r));
  list.addEventListener('keydown', e => { const b = e.target.closest('.bubble'); if (b && e.target === b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); msgActions(r, +b.closest('.msg').dataset.id); } });
  list.addEventListener('contextmenu', e => { const b = e.target.closest('.bubble'); if (b) { e.preventDefault(); msgActions(r, +b.closest('.msg').dataset.id); } });
}

async function loadOlder(r, first) {
  let ms;
  try { ms = await C.messages(r.id, null, first ? null : r.first, 40); } catch (e) { toast(plain(e), 'sad'); return; }
  if (room !== r) return;
  const box = $('#msgs'), h0 = box.scrollHeight;
  ms.forEach(m => r.msgs.set(m.id, m));
  if (ms.length) { r.first = Math.min(r.first ?? Infinity, ms[0].id); r.last = Math.max(r.last, ms[ms.length - 1].id); }
  $('#older').style.display = ms.length < 40 ? 'none' : '';
  draw(r);
  if (first) box.scrollTop = box.scrollHeight; else box.scrollTop = box.scrollHeight - h0;
}
function addMsgs(r, ms) {
  if (!ms.length || room !== r) return;
  const box = $('#msgs'); const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  ms.forEach(m => { r.msgs.set(m.id, m); r.last = Math.max(r.last, m.id); if (r.first == null) r.first = m.id; });
  ms.forEach(m => { if (m.user && r.typing[m.user.id]) delete r.typing[m.user.id]; });
  draw(r); drawTyping(r);
  if (atEnd || ms.some(m => m.mine)) box.scrollTop = box.scrollHeight;
  if (ms.some(m => !m.mine)) markRead(r);
}

/* ---------- drawing ---------- */
function draw(r) {
  const list = $('#mlist'); if (!list) return;
  const ms = [...r.msgs.values()].sort((a, b) => a.id - b.id);
  const lastMine = [...ms].reverse().find(m => m.mine && !m.deleted && m.kind !== 'system');
  let html = '', prevDay = '', prev = null;
  for (const m of ms) {
    const d = dayOf(m.at);
    if (d !== prevDay) { html += `<div class="dayline"><span>${d}</span></div>`; prevDay = d; prev = null; }
    if (m.kind === 'system') { html += `<div class="sysmsg">${esc(m.body || '')}</div>`; prev = null; continue; }
    const same = prev && prev.user?.id === m.user?.id && (Date.parse(m.at) - Date.parse(prev.at)) < 5 * 60e3;
    html += msgHTML(r, m, same, m === lastMine);
    prev = m;
  }
  list.innerHTML = html || `<div class="sub" style="text-align:center;padding:30px 10px">No messages yet. Say hi <i class="i i-hand" aria-hidden="true"></i> or tap <i class="i i-clapperboard" aria-hidden="true"></i> to send a movie!</div>`;
  hydratePosters(list);
  fillTitles(list);
}
function msgHTML(r, m, same, isLastMine) {
  const group = r.info.kind === 'group';
  const body = m.deleted ? `<i class="gone">Message deleted</i>` : m.hidden ? `<i class="gone">Hidden after reports</i>`
    : m.kind === 'title' ? `<div class="tcard" data-tk="${esc(m.title_key)}"><div class="tcp"></div><div class="tci"><b>Loading…</b></div></div>${m.body ? `<div class="tnote">${esc(m.body)}</div>` : ''}`
    : esc(m.body || '').replace(/\n/g, '<br>');
  const reacts = (m.reactions || []).length ? `<div class="reacts">${m.reactions.map(x => `<button type="button" class="rchip ${x.mine ? 'on' : ''}" data-react="${esc(x.e)}" aria-label="${esc(EMOJI_NAME[x.e] || 'Reaction')} ${x.n}${x.mine ? ', you reacted' : ''}">${emo(x.e)}${x.n > 1 ? ` ${x.n}` : ''}</button>`).join('')}</div>` : '';
  let seen = '';
  if (isLastMine && r.info.receipts) {
    const readers = r.info.members.filter(p => p.read_at && Date.parse(p.read_at) >= Date.parse(m.at));
    if (readers.length) seen = `<div class="seen">${group ? `Seen by ${readers.length}` : 'Seen'}</div>`;
  }
  return `<div class="msg ${m.mine ? 'own' : ''} ${same ? 'same' : ''}" data-id="${m.id}">
    ${!m.mine && group && !same ? `<a class="mwho" href="${profileHref(m.user)}">${esc(nameOf(m.user))}</a>` : ''}
    <div class="mrow">${!m.mine && group ? (same ? '<span class="avsp"></span>' : `<a href="${profileHref(m.user)}" tabindex="-1" aria-hidden="true">${avatar(m.user, 'xs')}</a>`) : ''}
      <div class="bubble ${m.kind === 'title' ? 'tbub' : ''}" tabindex="0" title="Tap for options"><span class="sr-only">${m.mine ? 'You' : esc(nameOf(m.user))}, ${timeOf(m.at)}: </span><span class="btext">${body}</span><span class="mtime" aria-hidden="true">${timeOf(m.at)}</span></div></div>
    ${reacts}${seen}</div>`;
}
async function fillTitles(list) {
  for (const el of list.querySelectorAll('.tcard[data-tk]:not([data-done])')) {
    el.dataset.done = 1;
    const t = await titleFor(el.dataset.tk);
    if (!el.isConnected) continue;
    if (!t) { el.querySelector('.tci').innerHTML = '<b>Title not found</b>'; continue; }
    const saved = !!U.watchlist[t.id];
    el.querySelector('.tcp').innerHTML = poster(t, { small: true, mine: false });
    el.querySelector('.tci').innerHTML = `<b>${esc(t.name)}</b><span class="meta">${esc(t.year)} · ${t.type === 'tv' ? 'Series' : 'Movie'}</span>
      <span class="tcbtns"><a class="btn sm ghost" href="#/t/${esc(t.id)}" data-open>Open</a><span role="button" tabindex="0" class="btn sm ${saved ? 'ghost' : ''}" data-csave="${esc(t.id)}">${saved ? 'Saved' : 'Watchlist'}</span></span>`;
    hydratePosters(el);
  }
}
function drawTyping(r) {
  const el = $('#typing'); if (!el) return;
  const names = Object.values(r.typing).map(x => x.name);
  el.textContent = !names.length ? '' : names.length === 1 ? `${names[0]} is typing…` : `${names.length} people are typing…`;
}

/* ---------- message actions ---------- */
async function onMsgClick(e, r) {
  const sv = e.target.closest('[data-csave]');
  if (sv) {
    e.preventDefault(); e.stopPropagation();
    const res = toggleSave(sv.dataset.csave); buzz();
    sv.textContent = res.saved ? 'Saved' : 'Watchlist'; sv.classList.toggle('ghost', res.saved);
    if (res.saved) { const b = sv.getBoundingClientRect(); hearts(b.x + b.width / 2, b.y, 6); toast('Saved to your watchlist'); }
    return;
  }
  if (e.target.closest('[data-open]')) return;
  const rc = e.target.closest('[data-react]');
  if (rc) { e.preventDefault(); return react(r, +rc.closest('.msg').dataset.id, rc.dataset.react); }
  const b = e.target.closest('.bubble');
  if (b) msgActions(r, +b.closest('.msg').dataset.id);
}
async function react(r, id, emo) {
  try { const reactions = await C.react(id, emo); const m = r.msgs.get(id); if (m) { m.reactions = reactions; draw(r); } buzz(6); }
  catch (e) { toast(plain(e), 'sad'); }
}
function msgActions(r, id) {
  const m = r.msgs.get(id); if (!m || m.deleted || m.kind === 'system') return;
  const can = r.info.status === 'active';
  const sh = sheet(`<h2 class="sr-only">Message options</h2>
    ${can && !m.hidden ? `<div class="emorow" role="group" aria-label="React">${EMOJI.map(x => `<button type="button" class="emo" data-e="${x}" aria-label="React ${EMOJI_NAME[x]}">${emo(x)}</button>`).join('')}</div>` : ''}
    <div class="menu">${m.body ? '<button class="mitem" data-a="copy"><i class="i i-clipboard" aria-hidden="true"></i> Copy text</button>' : ''}
      ${m.mine ? '<button class="mitem danger" data-a="del"><i class="i i-trash" aria-hidden="true"></i> Delete for everyone</button>' : '<button class="mitem danger" data-a="rep"><i class="i i-flag" aria-hidden="true"></i> Report message</button>'}</div>`);
  sh.addEventListener('click', async e => {
    const em = e.target.closest('[data-e]');
    if (em) { closeSheet(); return react(r, id, em.dataset.e); }
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'copy') { try { await navigator.clipboard.writeText(m.body); toast('Copied!'); } catch (er) { toast('Could not copy here.', 'sad'); } closeSheet(); }
    else if (a === 'del') { try { await C.del(id); m.deleted = true; m.body = null; m.reactions = []; draw(r); closeSheet(); } catch (er) { toast(plain(er), 'sad'); } }
    else if (a === 'rep') reportMsg(id);
  });
}
function reportMsg(id) {
  const R = [['harassment', 'Bullying or harassment'], ['scam', 'Scam or asking for money'], ['spam', 'Spam'], ['sexual', 'Sexual content'], ['hate', 'Hate'], ['other', 'Something else']];
  const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 6px"><i class="i i-flag" aria-hidden="true"></i> Report message</h2><div class="sub" style="margin-bottom:10px">Our team looks at every report. They won't know it was you.</div>
    <form id="rmf"><div class="menu">${R.map(([k, l], i) => `<label class="mitem"><input type="radio" name="why" value="${k}" ${i ? '' : 'checked'}> ${l}</label>`).join('')}</div>
    <label class="sr-only" for="rmn">More details</label><textarea id="rmn" maxlength="300" rows="2" placeholder="More details (optional)" style="margin-top:10px"></textarea>
    <button class="btn" style="width:100%;margin-top:12px">Send report</button></form>`);
  $('#rmf', sh).onsubmit = async e => {
    e.preventDefault();
    try { await C.report(id, new FormData(e.target).get('why'), $('#rmn', sh).value.trim()); closeSheet(); toast('Thanks. We\'ll take a look. You can also block them from the ⋯ menu.'); }
    catch (er) { toast(plain(er), 'sad'); }
  };
}

function roomMenu(r) {
  const i = r.info, o = i.other, group = i.kind === 'group', owner = i.role === 'owner';
  const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 10px">${esc(roomTitle(i))}</h2>
    ${group ? `<div class="flabel"><i class="i i-users" aria-hidden="true"></i> People (${i.members.length + 1})</div><div class="nclist">${i.members.map(p => `<div class="ncrow"><a href="${profileHref(p)}" class="plink">${avatar(p, 'sm')}<span class="pname"><b>${esc(nameOf(p))}</b><span class="meta">${handle(p)}${p.role === 'owner' ? ' · Owner' : ''}</span></span></a>
        ${owner ? `<button class="btn sm ghost" data-rm="${esc(p.id)}" aria-label="Remove ${esc(nameOf(p))}">Remove</button>` : ''}</div>`).join('')}</div>` : ''}
    <div class="menu" style="margin-top:10px">
      ${group && i.status === 'active' ? '<button class="mitem" data-a="add"><i class="i i-plus" aria-hidden="true"></i> Add friends</button><button class="mitem" data-a="ren"><i class="i i-pencil" aria-hidden="true"></i> Rename group</button>' : ''}
      <button class="mitem" data-a="mute">${i.muted ? 'Unmute' : 'Mute notifications'}</button>
      ${!group && o ? `<a class="mitem" href="${profileHref(o)}"><i class="i i-user" aria-hidden="true"></i> View profile</a>
        <button class="mitem danger" data-a="${o.blocked_by_me ? 'unblock' : 'block'}">${o.blocked_by_me ? 'Unblock' : 'Block'} ${esc(nameOf(o))}</button>
        <button class="mitem danger" data-a="repu"><i class="i i-flag" aria-hidden="true"></i> Report ${esc(nameOf(o))}</button>` : ''}
      ${group ? '<button class="mitem danger" data-a="leave"><i class="i i-door-open" aria-hidden="true"></i> Leave group</button>' : '<button class="mitem danger" data-a="leave"><i class="i i-trash" aria-hidden="true"></i> Delete chat</button>'}
    </div>`);
  sh.addEventListener('click', async e => {
    const rm = e.target.closest('[data-rm]');
    try {
      if (rm) { await C.remove(r.id, rm.dataset.rm); closeSheet(); toast('Removed.'); return renderRoom($('#app'), r.id); }
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      if (a === 'mute') { await C.mute(r.id, i.muted ? 0 : null); closeSheet(); toast(i.muted ? 'Unmuted.' : 'Muted. You won\'t get a red dot for this chat.'); i.muted = !i.muted; }
      else if (a === 'block') { await S.block(o.id); closeSheet(); toast('Blocked. They can\'t message you.'); renderRoom($('#app'), r.id); }
      else if (a === 'unblock') { await S.unblock(o.id); closeSheet(); toast('Unblocked.'); renderRoom($('#app'), r.id); }
      else if (a === 'repu') { closeSheet(); location.hash = profileHref(o); }
      else if (a === 'leave') { await C.leave(r.id); closeSheet(); toast(group ? 'You left the group.' : 'Chat deleted.'); location.hash = '#/chat'; }
      else if (a === 'ren') renameSheet(r);
      else if (a === 'add') addSheet(r);
    } catch (er) { toast(plain(er), 'sad'); }
  });
}
function renameSheet(r) {
  const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 10px"><i class="i i-pencil" aria-hidden="true"></i> Rename group</h2><input id="rnt" maxlength="40" value="${esc(r.info.title || '')}" placeholder="Group name">
    <button class="btn" id="rns" style="width:100%;margin-top:12px">Save</button>`);
  $('#rns', sh).onclick = async () => { try { await C.rename(r.id, $('#rnt', sh).value.trim()); closeSheet(); renderRoom($('#app'), r.id); } catch (e) { toast(plain(e), 'sad'); } };
}
async function addSheet(r) {
  const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 10px"><i class="i i-plus" aria-hidden="true"></i> Add friends</h2><div id="adl" class="nclist"><div class="rskel"></div></div><button class="btn" id="ads" style="width:100%;margin-top:12px">Add</button>`);
  const inChat = new Set(r.info.members.map(m => m.id));
  const fr = (await S.friends().catch(() => ({ friends: [] }))).friends.filter(p => !inChat.has(p.id));
  $('#adl', sh).innerHTML = fr.length ? fr.map(p => `<label class="ncrow">${avatar(p, 'sm')}<span class="pname"><b>${esc(p.display_name || p.username)}</b><span class="meta">${handle(p)}</span></span><input type="checkbox" value="${esc(p.id)}"></label>`).join('')
    : '<div class="sub">All your friends are already here!</div>';
  $('#ads', sh).onclick = async () => {
    const ids = [...sh.querySelectorAll('#adl input:checked')].map(x => x.value); if (!ids.length) return closeSheet();
    try { await C.add(r.id, ids); closeSheet(); renderRoom($('#app'), r.id); } catch (e) { toast(plain(e), 'sad'); }
  };
}

/* ---------- live updates ---------- */
function markRead(r) {
  clearTimeout(r.readT);
  r.readT = setTimeout(async () => { if (room === r && document.visibilityState === 'visible') { await C.read(r.id).catch(() => {}); refreshRequests(); } }, 800);
}
async function pullNew(r) {
  if (room !== r) return;
  const ms = await C.messages(r.id, r.last || null, null, 100).catch(() => null);
  if (ms && room === r) addMsgs(r, ms);
}
async function pullRecent(r) {
  // refresh reactions / deletions / seen
  const [ms, info] = await Promise.all([C.messages(r.id, null, null, 40).catch(() => null), C.info(r.id).catch(() => null)]);
  if (room !== r) return;
  if (info) r.info = { ...r.info, members: info.members, muted: info.muted };
  if (ms) ms.forEach(m => r.msgs.set(m.id, m));
  draw(r);
}
function startLive(r) {
  // Polling keeps working even if live updates can't connect.
  r.poll = setInterval(() => { if (!r.live && document.visibilityState === 'visible') pullNew(r); }, 3000);
  r.slow = setInterval(() => { if (document.visibilityState === 'visible') pullRecent(r); }, r.live ? 30000 : 9000);
  try {
    const sb = cloud.sb;
    sb.realtime.setAuth?.();
    const ch = sb.channel(`chat:${r.id}`, { config: { private: true, broadcast: { self: false } } });
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${r.id}` }, () => pullNew(r))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${r.id}` }, () => pullRecent(r))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reactions', filter: `chat_id=eq.${r.id}` }, () => pullRecent(r))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_members', filter: `chat_id=eq.${r.id}` }, () => pullRecent(r))
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!payload?.id || payload.id === cloud.user?.id) return;
        r.typing[payload.id] = { name: String(payload.name || 'Someone').slice(0, 30), at: Date.now() };
        drawTyping(r);
        clearTimeout(r.typingHide);
        r.typingHide = setTimeout(() => { const now = Date.now(); for (const k in r.typing) if (now - r.typing[k].at > 4000) delete r.typing[k]; drawTyping(r); }, 4200);
      })
      .subscribe(status => { r.live = status === 'SUBSCRIBED'; });
    r.ch = ch;
  } catch (e) { r.live = false; }
}
function sendTyping(r) {
  const now = Date.now(); if (!r.ch || !r.live || now - (r.lastTyping || 0) < 2500) return;
  r.lastTyping = now;
  r.ch.send({ type: 'broadcast', event: 'typing', payload: { id: cloud.user.id, name: cloud.profile?.display_name || cloud.profile?.username } }).catch?.(() => {});
}

/* ---------- title picker ---------- */
function pickTitle(onPick) {
  const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 10px"><i class="i i-clapperboard" aria-hidden="true"></i> Send a movie or series</h2>
    <input id="tpq" type="search" placeholder="Search movies & series…" autocomplete="off" aria-label="Search titles"><div id="tpr" class="pkr" style="max-height:50vh;margin-top:8px"></div>`);
  const q = $('#tpq', sh), res = $('#tpr', sh); let timer, live = [];
  const draw2 = () => {
    const v = q.value.trim();
    const loc = v ? localSearch(v).slice(0, 8) : TITLES.slice(0, 8);
    const extra = live.filter(x => !loc.some(t => t.name.toLowerCase() === x.name.toLowerCase())).slice(0, 8);
    res.innerHTML = loc.map(t => `<button type="button" class="dres" data-id="${esc(t.id)}">${poster(t, { small: true, mine: false })}<span><b>${esc(t.name)}</b><span class="meta">${esc(t.year)}</span></span></button>`).join('')
      + extra.map(x => `<button type="button" class="dres" data-id="tmdb-${x.type}-${x.id}">${poster({ ...x, colors: ['#262036', '#ff4f9a'] }, { small: true, mine: false })}<span><b>${esc(x.name)}</b><span class="meta">${esc(x.year || '')}</span></span></button>`).join('');
    hydratePosters(res);
  };
  draw2();
  q.oninput = () => { draw2(); clearTimeout(timer); timer = setTimeout(async () => { live = await tmdbSearch(q.value); draw2(); }, 260); };
  res.onclick = async e => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    const t = BYID[b.dataset.id] || await titleFor(keyOf(b.dataset.id));
    closeSheet(); if (t) onPick(t);
  };
}

/* =====================================================================
   "Send to a friend" from a title page or review
   ===================================================================== */
export async function sendTitleToChat(t) {
  if (!socialReady()) { toast(cloud.user ? 'Finish setting up your account first.' : 'Sign in to send this to friends.'); return; }
  const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 6px"><i class="i i-message-circle" aria-hidden="true"></i> Send “${esc(t.name)}”</h2>
    <label class="sr-only" for="stn">Add a note</label><input id="stn" maxlength="300" placeholder="Add a note (optional)">
    <div id="stl" class="nclist" style="margin-top:10px"><div class="rskel"></div></div>`);
  const [chats, fr] = await Promise.all([C.list('inbox').catch(() => []), S.friends().then(x => x.friends).catch(() => [])]);
  const dmWith = new Set(chats.filter(c => c.kind === 'dm').map(c => c.members[0]?.id));
  const rows = chats.map(c => `<button type="button" class="ncrow" data-chat="${c.id}">${groupAvatar(c)}<span class="pname"><b>${esc(chatName(c))}</b><span class="meta">${c.kind === 'group' ? `${c.count} people` : handle(c.members[0])}</span></span><span class="btn sm">Send</span></button>`)
    .concat(fr.filter(p => !dmWith.has(p.id)).map(p => `<button type="button" class="ncrow" data-user="${esc(p.id)}">${avatar(p, 'sm')}<span class="pname"><b>${esc(p.display_name || p.username)}</b><span class="meta">${handle(p)}</span></span><span class="btn sm">Send</span></button>`));
  $('#stl', sh).innerHTML = rows.length ? rows.join('') : `<div class="sub">Add friends first, then you can send them titles. <a class="see" href="#/friends/find">Find people</a></div>`;
  $('#stl', sh).onclick = async e => {
    const b = e.target.closest('[data-chat],[data-user]'); if (!b || b.disabled) return;
    b.disabled = true;
    try {
      const id = b.dataset.chat ? +b.dataset.chat : await C.dm(b.dataset.user);
      const note = $('#stn', sh).value.trim();
      await C.send(id, note || null, keyOf(t.id));
      b.querySelector('.btn').textContent = '✓ Sent'; buzz(); toast('Sent!');
    } catch (er) { toast(plain(er), 'sad'); b.disabled = false; }
  };
}

/* ---------- start a 1-on-1 from a profile ---------- */
export async function messageUser(p) {
  try { const id = await C.dm(p.id); location.hash = `#/chat/${id}`; }
  catch (e) { toast(plain(e), 'sad'); }
}

/* ---------- red dot: hear about new messages anywhere in the app ---------- */
let inboxCh = null;
export function watchInbox() {
  if (inboxCh || !cloud.sb || !cloud.user) return;
  try {
    let t;
    inboxCh = cloud.sb.channel('my-inbox')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, ({ new: m }) => {
        if (!m || m.sender === cloud.user?.id) return;
        clearTimeout(t); t = setTimeout(() => refreshRequests(), 600);
      }).subscribe();
  } catch (e) { inboxCh = null; }
}
export function unwatchInbox() { try { inboxCh && cloud.sb?.removeChannel(inboxCh); } catch (e) { /* ignore */ } inboxCh = null; }
