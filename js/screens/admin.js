// #/admin: the moderation panel. Only admins who signed in with 2-step can use it.
// The server checks this on every call; this screen only shows what the server returns.
import { cloud, keyOf, plain } from '../cloud.js';
import { $, esc, toast, sheet, closeSheet, empty } from '../ui.js';
import { avatar, profileHref, titlesFor, ago } from '../social.js';

async function rpc(fn, args = {}) {
  const { data, error } = await cloud.sb.rpc(fn, args);
  if (error) throw new Error(error.message || 'Something went wrong.');
  return data;
}
const TABS = [['overview', '📊 Overview'], ['ai', '🤖 AI queue'], ['reports', '🚩 Reports'], ['flags', '🤖 Flags'], ['held', '⏸️ Held ratings'], ['users', '👤 Users'], ['studios', '🎬 Studios'], ['log', '📜 Log']];
const who = p => p ? (p.hidden ? esc(p.display_name) : `<a href="${profileHref(p)}">${avatar(p, 'xs')} <b>${esc(p.display_name || p.username)}</b> <span class="meta">@${esc(p.username || '')}</span></a>`) : '<span class="meta">—</span>';
const day = s => s ? new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

export async function renderAdmin(app, tab = 'overview') {
  if (!TABS.some(t => t[0] === tab)) tab = 'overview';
  document.title = 'Admin — Heartbeat';
  const s = cloud.sec || {};
  if (!cloud.user || !s.admin) {
    app.innerHTML = `<div class="screen"><div class="card">${empty('This page is for Heartbeat admins only.', 'sad', '<a class="btn" href="#/">Go home</a>')}</div></div>`;
    return;
  }
  if (s.aal !== 'aal2') {
    app.innerHTML = `<div class="screen"><div class="card">${empty('Admins must use 2-step sign-in. Turn it on, then sign in again with your code.', 'happy', '<a class="btn" href="#/security">Set up 2-step sign-in</a>')}</div></div>`;
    return;
  }
  app.innerHTML = `<div class="screen admin"><header class="top"><h1 class="logo" style="font-size:24px;margin:0">🛡️ Admin</h1></header>
    <nav class="ftabs" aria-label="Admin sections">${TABS.map(([k, l]) => `<a href="#/admin/${k}" class="chip ${k === tab ? 'on' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    <div id="ab" class="fbody"><div class="card"><div class="rskel"></div><div class="rskel"></div></div></div></div>`;
  const box = $('#ab', app);
  try { await ({ overview, ai, reports, flags, held, users, studios, log })[tab](box, app); }
  catch (e) { box.innerHTML = `<div class="card">${empty(esc(plain(e)), 'sad')}</div>`; }
}

async function overview(box) {
  const o = await rpc('admin_overview');
  const tile = (n, l, h) => `<a class="card atile" href="${h}"><b>${n}</b><span>${l}</span></a>`;
  box.innerHTML = `<div class="atiles">
    ${tile(o.ai_queue ?? 0, 'reviews to check', '#/admin/ai')}${tile(o.reports, 'open reports', '#/admin/reports')}${tile(o.flags, 'open flags', '#/admin/flags')}
    ${tile(o.held, 'held ratings', '#/admin/held')}${tile(o.paused, 'paused accounts', '#/admin/users')}
    ${tile(o.users, 'members', '#/admin/users')}${tile(o.new_today, 'new today', '#/admin/users')}
    ${tile(o.events_today, 'security events today', '#/admin/log')}</div>
    <div class="sub" style="text-align:center;margin-top:8px">🤖 AI review check: <b>${o.ai_on ? 'on' : 'off (rule check only)'}</b>${o.ai_on ? ` · ${o.ai_today ?? 0} checked today` : ''}</div>
    <div class="sub" style="text-align:center;margin-top:4px">Everything you do here is saved in the admin log.</div>`;
}

async function reports(box) {
  let kind = 'review';
  const draw = async () => {
    const R = await rpc('admin_reports', { p_kind: kind });
    box.innerHTML = `<div class="rcsub">${[['review', 'Reviews & comments'], ['chat', 'Chat messages'], ['user', 'People']].map(([k, l]) => `<button class="chip ${k === kind ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
      ${R.length ? R.map(r => `<article class="card arep" data-id="${r.id}">
        <div class="meta">${esc(r.reason)} · ${day(r.at)} · reported by ${who(r.reporter)}</div>
        <div><b>${r.what}</b> by ${who(r.target)}${r.hidden ? ' <span class="pill2">hidden</span>' : ''}</div>
        ${r.text ? `<blockquote class="rnote">${esc(r.text)}</blockquote>` : ''}${r.note ? `<div class="sub">Note: ${esc(r.note)}</div>` : ''}
        <div class="rbtns"><button class="btn sm ghost" data-a="keep">✅ Keep (report was wrong)</button><button class="btn sm" data-a="remove">🗑️ Remove it</button>
        ${r.target?.id ? `<button class="btn sm ghost" data-u="${esc(r.target.id)}" data-n="${esc(r.target.username || '')}">⏸️ Pause person</button>` : ''}</div></article>`).join('')
      : `<div class="card">${empty('No open reports here. 🎉', 'happy')}</div>`}`;
    box.querySelectorAll('[data-k]').forEach(b => { b.onclick = () => { kind = b.dataset.k; draw(); }; });
    box.querySelectorAll('[data-a]').forEach(b => {
      b.onclick = async () => {
        b.disabled = true;
        try { await rpc('admin_resolve_report', { p_kind: kind, p_id: +b.closest('[data-id]').dataset.id, p_action: b.dataset.a }); toast('Done.'); draw(); }
        catch (e) { toast(plain(e), 'sad'); b.disabled = false; }
      };
    });
    wirePause(box, draw);
  };
  await draw();
}

const AIKIND = { appeal: ['🙋', 'Appeal: the writer asks for a second look'], held: ['👀', 'The robot wasn\'t sure'], check: ['⚖️', 'Words don\'t match the rating'] };
const CAT = { none: 'no rule broken', spam: 'spam / ad', gibberish: 'gibberish', copied: 'copied text', ai_filler: 'machine-made filler', hate: 'hate', harassment: 'harassment', sexual: 'sexual', off_topic: 'off topic' };
async function ai(box) {
  const draw = async () => {
    const Q = await rpc('admin_ai_queue');
    const ts = Object.fromEntries((await titlesFor(Q.map(x => x.title_key))).map(t => [keyOf(t.id), t]));
    box.innerHTML = Q.length ? `<div class="sub" style="margin:0 2px 10px">Reviews here are hidden until you decide (rating mismatches stay public). The writer sees your note.</div>` + Q.map(x => {
      const [ic, lab] = AIKIND[x.kind] || ['🤖', x.kind], a = x.ai || {}, t = ts[x.title_key];
      return `<article class="card arep" data-id="${x.id}">
        <div><b>${ic} ${lab}</b> <span class="meta">· ${day(x.at)}</span></div>
        <div>${who(x.author)} on <a href="#/t/${esc(t?.id || '')}">${esc(t?.name || x.title_key)}</a> · ★${x.overall} <span class="meta">(Start ${x.start_h} · Middle ${x.middle_h} · End ${x.end_h})</span></div>
        <blockquote class="rnote">${x.headline ? `<b>${esc(x.headline)}</b><br>` : ''}${esc((x.text || '').replace(/\|\|/g, ''))}${x.notes ? `<br><span class="meta">${esc(x.notes)}</span>` : ''}</blockquote>
        ${a.verdict ? `<div class="meta">🤖 ${esc(a.verdict)} · ${esc(CAT[a.category] || a.category || '')} · sure ${Math.round((a.confidence || 0) * 100)}% · quality ${a.quality ?? x.score}/100${a.paid_fake_risk >= 0.5 ? ` · paid/fake risk ${Math.round(a.paid_fake_risk * 100)}%` : ''}${a.why ? ` · "${esc(a.why)}"` : ''}</div>` : `<div class="meta">Quality ${x.score}/100</div>`}
        ${x.note ? `<div class="sub">Writer sees: ${esc(x.note)}</div>` : ''}${x.appeal_note ? `<div class="sub">🙋 Writer says: "${esc(x.appeal_note)}"</div>` : ''}
        <label class="fld" style="margin-top:6px"><span>Note for the writer if you hide it (optional)</span><input class="ainote" maxlength="300" placeholder="like: Please don't attack other people."></label>
        <div class="rbtns">${x.kind === 'check' ? `<button class="btn sm ghost" data-a="clear">👍 Looks fine</button>` : `<button class="btn sm" data-a="approve">✅ Post it</button>`}
          <button class="btn sm ghost" data-a="block">🚫 ${x.kind === 'check' ? 'Hide it' : 'Keep it hidden'}</button>
          ${x.author?.id ? `<button class="btn sm ghost" data-u="${esc(x.author.id)}" data-n="${esc(x.author.username || '')}">⏸️ Pause person</button>` : ''}</div></article>`;
    }).join('') : `<div class="card">${empty('No reviews waiting. 🎉', 'happy')}</div>`;
    box.querySelectorAll('[data-a]').forEach(b => {
      b.onclick = async () => {
        const card = b.closest('[data-id]'); b.disabled = true;
        try { await rpc('admin_ai_decide', { p_review: +card.dataset.id, p_action: b.dataset.a, p_note: card.querySelector('.ainote')?.value.trim() || null }); toast('Done.'); draw(); }
        catch (e) { toast(plain(e), 'sad'); b.disabled = false; }
      };
    });
    wirePause(box, draw);
  };
  await draw();
}

const FLAG = { rating_burst: '⚡ Too many ratings too fast', multi_account: '👥 Many accounts on one device', review_bomb: '💣 Rating wave on one title', manual: '✋ Flagged by hand' };
async function flags(box) {
  const draw = async () => {
    const F = await rpc('admin_flags');
    const ts = Object.fromEntries((await titlesFor(F.filter(f => f.title_key).map(f => f.title_key))).map(t => [keyOf(t.id), t]));
    box.innerHTML = F.length ? F.map(f => `<article class="card arep" data-id="${f.id}">
        <div><b>${FLAG[f.kind] || esc(f.kind)}</b> <span class="meta">· ${day(f.at)}</span></div>
        <div>${f.user ? who(f.user) : ''}${f.title_key ? `Title: <a href="#/t/${esc(ts[f.title_key]?.id || '')}">${esc(ts[f.title_key]?.name || f.title_key)}</a>` : ''}
          ${f.linked ? ` <span class="pill2">${f.linked} linked account${f.linked > 1 ? 's' : ''}</span>` : ''}${f.paused ? ' <span class="pill2">paused</span>' : ''}</div>
        <div class="meta">${esc(Object.entries(f.detail || {}).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · '))}</div>
        <div class="rbtns"><button class="btn sm ghost" data-a="cleared">✅ Looks fine</button><button class="btn sm ghost" data-a="actioned">✔️ Handled</button>
          ${f.title_key ? '<a class="btn sm" href="#/admin/held">See held ratings</a>' : ''}
          ${f.user && !f.paused ? `<button class="btn sm" data-u="${esc(f.user.id)}" data-n="${esc(f.user.username || '')}">⏸️ Pause person</button>` : ''}</div></article>`).join('')
      : `<div class="card">${empty('No open flags. 🎉', 'happy')}</div>`;
    box.querySelectorAll('[data-a]').forEach(b => {
      b.onclick = async () => {
        try { await rpc('admin_resolve_flag', { p_id: +b.closest('[data-id]').dataset.id, p_action: b.dataset.a }); toast('Done.'); draw(); }
        catch (e) { toast(plain(e), 'sad'); }
      };
    });
    wirePause(box, draw);
  };
  await draw();
}

async function held(box) {
  const draw = async () => {
    const H = await rpc('admin_held');
    const ts = Object.fromEntries((await titlesFor(H.map(h => h.title_key))).map(t => [keyOf(t.id), t]));
    box.innerHTML = H.length ? `<div class="sub" style="margin:0 2px 10px">Held ratings don't count in public scores and give no XP until you release them.</div>` + H.map(h => `<article class="card arep" data-t="${esc(h.title_key)}">
        <div><b>${esc(ts[h.title_key]?.name || h.title_key)}</b> · ${h.n} held (avg ★${h.avg}) · normal avg ${h.normal_avg != null ? '★' + h.normal_avg : '—'}</div>
        <div class="meta">Why: ${esc((h.reasons || []).map(r => ({ wave: 'wave of new accounts', linked: 'linked accounts', too_fast: 'too fast' })[r] || r).join(', '))}</div>
        <div class="heldppl">${h.people.slice(0, 12).map(p => `<span>${who(p)} ★${p.overall}</span>`).join('')}${h.people.length > 12 ? `<span class="meta">+${h.people.length - 12} more</span>` : ''}</div>
        <div class="rbtns"><button class="btn sm ghost" data-a="release">✅ Release (count them)</button><button class="btn sm" data-a="discard">🗑️ Discard</button></div></article>`).join('')
      : `<div class="card">${empty('No held ratings. 🎉', 'happy')}</div>`;
    box.querySelectorAll('[data-a]').forEach(b => {
      b.onclick = async () => {
        try { const n = await rpc('admin_release_held', { p_title: b.closest('[data-t]').dataset.t, p_action: b.dataset.a }); toast(`${n} ratings ${b.dataset.a === 'release' ? 'released' : 'removed'}.`); draw(); }
        catch (e) { toast(plain(e), 'sad'); }
      };
    });
  };
  await draw();
}

async function users(box) {
  box.innerHTML = `<form class="card" id="uf"><label class="fld"><span>Find a person by username</span><input id="uq" autocomplete="off" placeholder="username"></label><button class="btn sm">Search</button></form><div id="ul"></div>`;
  const draw = async () => {
    const U = await rpc('admin_find_user', { p_q: $('#uq', box).value.trim() });
    $('#ul', box).innerHTML = U.length ? U.map(u => `<article class="card arep">
        <div>${who(u)} ${u.admin ? '<span class="pill2">admin</span>' : ''} <span class="pill2 ${u.paused ? '' : 'ok'}">${u.status === 'ok' ? 'active' : esc(u.status)}${u.until ? ' until ' + esc(day(u.until)) : ''}</span></div>
        <div class="meta">Joined ${esc(day(u.joined))} · ${u.flags} open flags · ${u.reports} reports · ${u.linked} linked accounts${u.reason ? ' · Reason: ' + esc(u.reason) : ''}</div>
        ${u.admin ? '' : `<div class="rbtns">${u.paused ? `<button class="btn sm" data-restore="${esc(u.id)}">↩️ Restore</button>` : `<button class="btn sm ghost" data-u="${esc(u.id)}" data-n="${esc(u.username)}">⏸️ Pause or ban</button>`}</div>`}</article>`).join('')
      : `<div class="card">${empty('Nobody found.', 'sad')}</div>`;
    $('#ul', box).querySelectorAll('[data-restore]').forEach(b => {
      b.onclick = async () => { try { await rpc('admin_set_status', { p_user: b.dataset.restore, p_status: 'ok', p_days: null, p_reason: null }); toast('Restored.'); draw(); } catch (e) { toast(plain(e), 'sad'); } };
    });
    wirePause($('#ul', box), draw);
  };
  $('#uf', box).onsubmit = e => { e.preventDefault(); draw().catch(er => toast(plain(er), 'sad')); };
  await draw();
}

async function studios(box) {
  const draw = async () => {
    const S = await rpc('admin_studios');
    box.innerHTML = `<section class="card"><h2 class="h3">💌 Sales requests</h2>
      ${S.requests.length ? S.requests.map(r => `<article class="arep stbox" data-r="${r.id}">
        <div><b>${esc(r.company)}</b> <span class="meta">· ${esc(r.job || '')} · ${day(r.at)}</span></div>
        <div class="meta">${esc(r.email)}${r.website ? ' · ' + esc(r.website) : ''} · account ${who(r.who)}</div>
        ${r.message ? `<blockquote class="rnote">${esc(r.message)}</blockquote>` : ''}
        <div class="stgrid3"><label class="fld"><span>Studio name</span><input class="sn" maxlength="80" value="${esc(r.company)}"></label>
          <label class="fld"><span>Plan</span><select class="sp"><option>pilot</option><option>pro</option><option>enterprise</option></select></label>
          <label class="fld"><span>Title limit</span><input class="sl" type="number" min="1" max="500" value="10"></label></div>
        <div class="rbtns"><button class="btn sm" data-ok="1">✅ Approve</button><button class="btn sm ghost" data-ok="0">Decline</button></div></article>`).join('') : '<p class="sub">No open requests.</p>'}</section>
      <section class="card"><h2 class="h3">🎬 Studios</h2>
      ${S.studios.length ? S.studios.map(s => `<article class="arep" data-s="${s.id}"><div><b>${esc(s.name)}</b> <span class="pill2 ${s.status === 'active' ? 'ok' : ''}">${esc(s.status)}</span> <span class="meta">${esc(s.plan)} · ${s.titles}/${s.title_limit} titles · ${s.team} people · owner ${who(s.owner)}</span></div>
        <div class="rbtns">${s.status === 'active' ? '<button class="btn sm ghost" data-st="suspended">⏸️ Pause</button>' : '<button class="btn sm" data-st="active">▶️ Turn back on</button>'}</div></article>`).join('') : '<p class="sub">No studios yet.</p>'}</section>`;
    box.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => {
      const c = b.closest('[data-r]');
      try { await rpc('admin_studio_request', { p_id: +c.dataset.r, p_approve: b.dataset.ok === '1', p_name: c.querySelector('.sn').value.trim(), p_plan: c.querySelector('.sp').value, p_limit: +c.querySelector('.sl').value }); toast('Done.'); draw(); }
      catch (e) { toast(plain(e), 'sad'); }
    });
    box.querySelectorAll('[data-st]').forEach(b => b.onclick = async () => {
      try { await rpc('admin_studio_set', { p_studio: +b.closest('[data-s]').dataset.s, p_status: b.dataset.st, p_plan: null, p_limit: null }); toast('Done.'); draw(); }
      catch (e) { toast(plain(e), 'sad'); }
    });
  };
  await draw();
}

async function log(box) {
  const E = await rpc('admin_events', { p_limit: 120 });
  box.innerHTML = `<section class="card"><h2 class="h3">📜 Security log</h2><ul class="alog">${E.map(e => `<li><span class="meta">${day(e.at)}</span> <b>${esc(e.kind)}</b> ${e.user ? who(e.user) : ''}
      <span class="meta">${esc(Object.entries(e.detail || {}).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · '))}</span></li>`).join('') || '<li class="sub">Nothing yet.</li>'}</ul></section>`;
}

/* Pause / ban sheet (shared) */
function wirePause(root, after) {
  root.querySelectorAll('[data-u]').forEach(b => {
    b.onclick = () => {
      const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 6px">Pause @${esc(b.dataset.n)}</h2>
        <div class="sub" style="margin-bottom:10px">They can still look around, but can't rate, review, chat or play. They will see the reason.</div>
        <label class="fld"><span>How long</span><select id="pd"><option value="1">1 day</option><option value="3">3 days</option><option value="7" selected>7 days</option><option value="30">30 days</option><option value="ban">Ban (no end)</option></select></label>
        <label class="fld"><span>Reason (they will see this)</span><input id="pr" maxlength="300" placeholder="like: spam links in chat"></label>
        <p class="errmsg" id="perr" role="alert" hidden></p>
        <button class="btn big" id="pgo">Pause account</button>`);
      $('#pgo', sh).onclick = async () => {
        const v = $('#pd', sh).value;
        try {
          await rpc('admin_set_status', { p_user: b.dataset.u, p_status: v === 'ban' ? 'banned' : 'suspended', p_days: v === 'ban' ? null : +v, p_reason: $('#pr', sh).value.trim() });
          closeSheet(); toast('Account paused.'); after();
        } catch (e) { const er = $('#perr', sh); er.textContent = plain(e); er.hidden = false; }
      };
    };
  });
}
