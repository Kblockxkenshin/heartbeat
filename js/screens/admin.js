// #/admin: the moderation panel. Only admins who signed in with 2-step can use it.
// The server checks this on every call; this screen only shows what the server returns.
import { cloud, keyOf, idOf, plain } from '../cloud.js';
import { echarts, countUp } from '../motion.js';
import { loadTitle } from '../tmdb.js';
import { BYID } from '../data.js';
import { $, esc, toast, sheet, closeSheet, empty } from '../ui.js';
import { avatar, profileHref, titlesFor, ago } from '../social.js';
import { LANGS } from './upcoming.js';
import { cr } from './boxoffice.js';

async function rpc(fn, args = {}) {
  const { data, error } = await cloud.sb.rpc(fn, args);
  if (error) throw new Error(error.message || 'Something went wrong.');
  return data;
}
const TABS = [['stats', 'Stats'], ['overview', 'Overview'], ['ai', 'AI queue'], ['reports', 'Reports'], ['flags', 'Flags'], ['held', 'Held ratings'], ['users', 'Users'], ['studios', 'Studios'], ['inbox', 'Inbox'], ['boxoffice', 'Box office'], ['log', 'Log']];
const who = p => p ? (p.hidden ? esc(p.display_name) : `<a href="${profileHref(p)}">${avatar(p, 'xs')} <b>${esc(p.display_name || p.username)}</b> <span class="meta">@${esc(p.username || '')}</span></a>`) : '<span class="meta">—</span>';
const day = s => s ? new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

export async function renderAdmin(app, tab = 'stats') {
  if (!TABS.some(t => t[0] === tab)) tab = 'stats';
  document.title = 'Admin — Heartbeat';
  const s = cloud.sec || {};
  if (!cloud.user || !s.admin) {
    app.innerHTML = `<div class="screen"><div class="card">${empty('This page is for Heartbeat admins only.', 'sad', '<a class="btn" href="#/">Go home</a>')}</div></div>`;
    return;
  }
  if (s.aal !== 'aal2' && tab !== 'stats') {
    app.innerHTML = `<div class="screen"><div class="card">${empty('Admins must use 2-step sign-in. Turn it on, then sign in again with your code.', 'happy', '<a class="btn" href="#/security">Set up 2-step sign-in</a>')}</div></div>`;
    return;
  }
  app.innerHTML = `<div class="screen admin"><header class="top"><h1 class="logo" style="font-size:24px;margin:0"><i class="i i-shield" aria-hidden="true"></i> Admin</h1></header>
    ${s.aal !== 'aal2' ? `<div class="card anote"><i class="i i-lock" aria-hidden="true"></i><span>You can see your stats now. To use the other tools (reports, bans, box office editing) turn on <a href="#/security">2-step sign-in</a>.</span></div>` : ''}
    <nav class="ftabs" aria-label="Admin sections">${TABS.map(([k, l]) => `<a href="#/admin/${k}" class="chip ${k === tab ? 'on' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    <div id="ab" class="fbody"><div class="card"><div class="rskel"></div><div class="rskel"></div></div></div></div>`;
  const box = $('#ab', app);
  try { await ({ stats, overview, ai, reports, flags, held, users, studios, inbox, boxoffice, log })[tab](box, app); }
  catch (e) { box.innerHTML = `<div class="card">${empty(esc(plain(e)), 'sad')}</div>`; }
}

/* ---------- Stats: how the site is doing ---------- */
let statsDays = 30, statsTimer = null, charts = [];
const fmtN = n => (+n || 0).toLocaleString('en-US');
const rel = s => { if (!s) return 'never'; const m = Math.round((Date.now() - new Date(s)) / 6e4); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const PAGE = { home: 'Home', rate: 'Quick Rate', taste: 'Top 10 picker', t: 'A movie / show page', search: 'Search', boxoffice: 'Box office', upcoming: 'Upcoming', me: 'Profile', friends: 'Friends', signin: 'Sign in', u: 'Someone’s profile', invite: 'Invite link', chat: 'Chat', play: 'Play' };
async function stats(box) {
  clearInterval(statsTimer);
  const draw = async () => {
    if (!document.body.contains(box)) { clearInterval(statsTimer); return; }
    const S = await rpc('admin_stats', { p_days: statsDays });
    const tile = (n, l, sub = '', k = '') => `<div class="card stile"><b data-n="${+n || 0}" ${k ? `data-k="${k}"` : ''}>${fmtN(n)}</b><span>${l}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const bars = (list, label, val, fmtL = x => esc(x)) => { const max = Math.max(1, ...list.map(x => +x[val] || 0)); return list.length ? list.map(x => `<div class="sbar"><span>${fmtL(x[label])}</span><i style="width:${Math.max(4, (+x[val] || 0) / max * 100)}%"></i><b>${fmtN(x[val])}</b></div>`).join('') : '<div class="meta">Nothing yet.</div>'; };
    box.innerHTML = `<div class="stats">
      <div class="shead"><div class="regsw" role="tablist">${[7, 30, 90].map(d => `<button data-days="${d}" class="${d === statsDays ? 'on' : ''}">${d} days</button>`).join('')}</div>
        <span class="meta">Updated ${new Date(S.as_of).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · refreshes every minute</span><button class="btn sm ghost" id="sref"><i class="i i-refresh-cw" aria-hidden="true"></i> Refresh</button></div>
      <h2 class="sh">Today</h2>
      <div class="stiles">
        ${tile(S.visitors_today, 'visitors today', `${fmtN(S.first_time_today)} first-time`)}
        ${tile(S.new_today, 'new members today', `${fmtN(S.new_7d)} this week`)}
        ${tile(S.views_today, 'pages viewed today')}
        ${tile(S.ratings_today + S.swipes_today, 'ratings + swipes today')}
      </div>
      <h2 class="sh">All time</h2>
      <div class="stiles">
        ${tile(S.members, 'members', `${fmtN(S.new_30d)} joined in 30 days`)}
        ${tile(S.visitors_30d, 'visitors (30 days)', `${fmtN(S.visitors_7d)} this week · ${fmtN(S.returning_7d)} came back`)}
        ${tile(S.active_members_7d, 'active members this week')}
        ${tile(S.taste_visitors, 'did the Top 10 hook', `${fmtN(S.taste_today)} today`)}
        ${tile(S.ratings, 'ratings')}${tile(S.swipes, 'swipes')}${tile(S.reviews, 'reviews')}
        ${tile(S.phone_share_7d ?? 0, '% on phones (7 days)')}
      </div>
      <section class="card schart"><h2 class="h3">Visitors and new members</h2><div class="ch" id="sc1" role="img"></div></section>
      <section class="card schart"><h2 class="h3">Activity</h2><div class="ch" id="sc2" role="img"></div></section>
      <div class="scols">
        <section class="card"><h2 class="h3">Newest members</h2><ul class="smem">${(S.recent_members || []).map(m => `<li><b>${esc(m.display_name || m.username || 'Not finished sign-up')}</b>${m.username ? `<span class="meta">@${esc(m.username)}</span>` : ''}
          <small>Joined ${rel(m.joined)} · ${fmtN(m.ratings)} ratings · ${fmtN(m.swipes)} swipes · last seen ${rel(m.last_seen)}</small></li>`).join('') || '<li class="meta">Nobody yet.</li>'}</ul></section>
        <section class="card"><h2 class="h3">Where visitors come from <span class="meta">30 days</span></h2>${bars(S.top_sources || [], 'source', 'visits', x => esc(x === 'direct' ? 'Typed the link / app' : x.replace(/^www\./, '')))}</section>
        <section class="card"><h2 class="h3">First page they open <span class="meta">7 days</span></h2>${bars(S.top_pages || [], 'page', 'visits', x => esc(PAGE[x] || x))}</section>
        <section class="card"><h2 class="h3">Most loved this week</h2><div id="stt">${bars((S.top_titles || []).map(x => ({ ...x, name: x.title_key })), 'name', 'n', x => `<span data-tk="${esc(x)}">${esc(x)}</span>`)}</div></section>
      </div>
      <p class="meta snote">Visits are counted from Nov 28, 2026, when this dashboard was added. A visitor = one phone or computer per day. Nothing personal is stored (no IP addresses).</p>
    </div>`;
    box.querySelectorAll('[data-days]').forEach(b => b.onclick = () => { statsDays = +b.dataset.days; draw(); });
    box.querySelector('#sref').onclick = () => draw();
    // Movie / show names for the "most loved" list
    box.querySelectorAll('[data-tk]').forEach(async el => { const t = await loadTitle(idOf(el.dataset.tk)).catch(() => null); if (t?.name && document.body.contains(el)) el.textContent = t.name; });
    const days = S.daily || [], lbl = days.map(d => new Date(d.day + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    const E = await echarts(); charts.forEach(c => c.dispose?.()); charts = [];
    if (!E) return;
    const mono = '"Geist Mono", ui-monospace, monospace';
    const base = (el, series) => { const c = E.init(el, null, { renderer: 'svg' }); charts.push(c); new ResizeObserver(() => !c.isDisposed() && c.resize()).observe(el);
      c.setOption({ animationDuration: 700, textStyle: { fontFamily: mono }, grid: { left: 6, right: 12, top: 34, bottom: 6, containLabel: true },
        legend: { top: 0, left: 0, textStyle: { color: '#8A8A8A', fontSize: 12 }, itemWidth: 12, itemHeight: 8 },
        tooltip: { trigger: 'axis', backgroundColor: '#0A0A0A', borderColor: '#1F1F1F', textStyle: { color: '#F5F5F5', fontSize: 12, fontFamily: mono } },
        xAxis: { type: 'category', data: lbl, axisLine: { lineStyle: { color: '#1F1F1F' } }, axisTick: { show: false }, axisLabel: { color: '#5E5E5E', fontSize: 11, hideOverlap: true } },
        yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#1A1A1A' } }, axisLabel: { color: '#5E5E5E', fontSize: 11 } }, series }); };
    base(box.querySelector('#sc1'), [
      { name: 'Visitors', type: 'line', smooth: .2, showSymbol: false, data: days.map(d => d.visitors), lineStyle: { width: 2, color: '#C6F432' }, itemStyle: { color: '#C6F432' }, areaStyle: { color: 'rgba(198,244,50,.08)' } },
      { name: 'First-time', type: 'line', smooth: .2, showSymbol: false, data: days.map(d => d.first_time), lineStyle: { width: 1.5, color: '#8A8A8A', type: 'dashed' }, itemStyle: { color: '#8A8A8A' } },
      { name: 'New members', type: 'bar', barMaxWidth: 10, data: days.map(d => d.signups), itemStyle: { color: '#F5F5F5', borderRadius: [3, 3, 0, 0] } }]);
    base(box.querySelector('#sc2'), [
      { name: 'Ratings', type: 'bar', stack: 'a', barMaxWidth: 12, data: days.map(d => d.ratings), itemStyle: { color: '#C6F432' } },
      { name: 'Swipes', type: 'bar', stack: 'a', barMaxWidth: 12, data: days.map(d => d.swipes), itemStyle: { color: '#5E5E5E', borderRadius: [3, 3, 0, 0] } },
      { name: 'Pages viewed', type: 'line', smooth: .2, showSymbol: false, data: days.map(d => d.views), lineStyle: { width: 1.5, color: '#F5F5F5' }, itemStyle: { color: '#F5F5F5' } }]);
  };
  await draw();
  statsTimer = setInterval(() => { if (document.visibilityState === 'visible' && location.hash.startsWith('#/admin') && !/#\/admin\/(?!stats)/.test(location.hash)) draw().catch(() => {}); }, 60000);
}

async function overview(box) {
  const o = await rpc('admin_overview');
  const tile = (n, l, h) => `<a class="card atile" href="${h}"><b>${n}</b><span>${l}</span></a>`;
  box.innerHTML = `<div class="atiles">
    ${tile(o.ai_queue ?? 0, 'reviews to check', '#/admin/ai')}${tile(o.reports, 'open reports', '#/admin/reports')}${tile(o.flags, 'open flags', '#/admin/flags')}
    ${tile(o.held, 'held ratings', '#/admin/held')}${tile(o.paused, 'paused accounts', '#/admin/users')}
    ${tile(o.users, 'members', '#/admin/users')}${tile(o.new_today, 'new today', '#/admin/users')}
    ${tile(o.events_today, 'security events today', '#/admin/log')}</div>
    <div class="sub" style="text-align:center;margin-top:8px"><i class="i i-bot" aria-hidden="true"></i> AI review check: <b>${o.ai_on ? 'on' : 'off (rule check only)'}</b>${o.ai_on ? ` · ${o.ai_today ?? 0} checked today` : ''}</div>
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
        <div class="rbtns"><button class="btn sm ghost" data-a="keep"><i class="i i-check" aria-hidden="true"></i> Keep (report was wrong)</button><button class="btn sm" data-a="remove"><i class="i i-trash" aria-hidden="true"></i> Remove it</button>
        ${r.target?.id ? `<button class="btn sm ghost" data-u="${esc(r.target.id)}" data-n="${esc(r.target.username || '')}"><i class="i i-pause" aria-hidden="true"></i> Pause person</button>` : ''}</div></article>`).join('')
      : `<div class="card">${empty('No open reports here.', 'happy')}</div>`}`;
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

const AIKIND = { appeal: ['<i class="i i-hand" aria-hidden="true"></i>', 'Appeal: the writer asks for a second look'], held: ['<i class="i i-eye" aria-hidden="true"></i>', 'The robot wasn\'t sure'], check: ['<i class="i i-scale" aria-hidden="true"></i>', 'Words don\'t match the rating'] };
const CAT = { none: 'no rule broken', spam: 'spam / ad', gibberish: 'gibberish', copied: 'copied text', ai_filler: 'machine-made filler', hate: 'hate', harassment: 'harassment', sexual: 'sexual', off_topic: 'off topic' };
async function ai(box) {
  const draw = async () => {
    const Q = await rpc('admin_ai_queue');
    const ts = Object.fromEntries((await titlesFor(Q.map(x => x.title_key))).map(t => [keyOf(t.id), t]));
    box.innerHTML = Q.length ? `<div class="sub" style="margin:0 2px 10px">Reviews here are hidden until you decide (rating mismatches stay public). The writer sees your note.</div>` + Q.map(x => {
      const [ic, lab] = AIKIND[x.kind] || ['<i class="i i-bot" aria-hidden="true"></i>', x.kind], a = x.ai || {}, t = ts[x.title_key];
      return `<article class="card arep" data-id="${x.id}">
        <div><b>${ic} ${lab}</b> <span class="meta">· ${day(x.at)}</span></div>
        <div>${who(x.author)} on <a href="#/t/${esc(t?.id || '')}">${esc(t?.name || x.title_key)}</a> · <i class="i i-star" aria-hidden="true"></i>${x.overall} <span class="meta">(Start ${x.start_h} · Middle ${x.middle_h} · End ${x.end_h})</span></div>
        <blockquote class="rnote">${x.headline ? `<b>${esc(x.headline)}</b><br>` : ''}${esc((x.text || '').replace(/\|\|/g, ''))}${x.notes ? `<br><span class="meta">${esc(x.notes)}</span>` : ''}</blockquote>
        ${a.verdict ? `<div class="meta"><i class="i i-bot" aria-hidden="true"></i> ${esc(a.verdict)} · ${esc(CAT[a.category] || a.category || '')} · sure ${Math.round((a.confidence || 0) * 100)}% · quality ${a.quality ?? x.score}/100${a.paid_fake_risk >= 0.5 ? ` · paid/fake risk ${Math.round(a.paid_fake_risk * 100)}%` : ''}${a.why ? ` · "${esc(a.why)}"` : ''}</div>` : `<div class="meta">Quality ${x.score}/100</div>`}
        ${x.note ? `<div class="sub">Writer sees: ${esc(x.note)}</div>` : ''}${x.appeal_note ? `<div class="sub"><i class="i i-hand" aria-hidden="true"></i> Writer says: "${esc(x.appeal_note)}"</div>` : ''}
        <label class="fld" style="margin-top:6px"><span>Note for the writer if you hide it (optional)</span><input class="ainote" maxlength="300" placeholder="like: Please don't attack other people."></label>
        <div class="rbtns">${x.kind === 'check' ? `<button class="btn sm ghost" data-a="clear"><i class="i i-thumbs-up" aria-hidden="true"></i> Looks fine</button>` : `<button class="btn sm" data-a="approve"><i class="i i-check" aria-hidden="true"></i> Post it</button>`}
          <button class="btn sm ghost" data-a="block"><i class="i i-ban" aria-hidden="true"></i> ${x.kind === 'check' ? 'Hide it' : 'Keep it hidden'}</button>
          ${x.author?.id ? `<button class="btn sm ghost" data-u="${esc(x.author.id)}" data-n="${esc(x.author.username || '')}"><i class="i i-pause" aria-hidden="true"></i> Pause person</button>` : ''}</div></article>`;
    }).join('') : `<div class="card">${empty('No reviews waiting.', 'happy')}</div>`;
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

const FLAG = { rating_burst: 'Too many ratings too fast', multi_account: 'Many accounts on one device', review_bomb: 'Rating wave on one title', manual: 'Flagged by hand' };
async function flags(box) {
  const draw = async () => {
    const F = await rpc('admin_flags');
    const ts = Object.fromEntries((await titlesFor(F.filter(f => f.title_key).map(f => f.title_key))).map(t => [keyOf(t.id), t]));
    box.innerHTML = F.length ? F.map(f => `<article class="card arep" data-id="${f.id}">
        <div><b>${FLAG[f.kind] || esc(f.kind)}</b> <span class="meta">· ${day(f.at)}</span></div>
        <div>${f.user ? who(f.user) : ''}${f.title_key ? `Title: <a href="#/t/${esc(ts[f.title_key]?.id || '')}">${esc(ts[f.title_key]?.name || f.title_key)}</a>` : ''}
          ${f.linked ? ` <span class="pill2">${f.linked} linked account${f.linked > 1 ? 's' : ''}</span>` : ''}${f.paused ? ' <span class="pill2">paused</span>' : ''}</div>
        <div class="meta">${esc(Object.entries(f.detail || {}).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · '))}</div>
        <div class="rbtns"><button class="btn sm ghost" data-a="cleared"><i class="i i-check" aria-hidden="true"></i> Looks fine</button><button class="btn sm ghost" data-a="actioned"><i class="i i-check" aria-hidden="true"></i> Handled</button>
          ${f.title_key ? '<a class="btn sm" href="#/admin/held">See held ratings</a>' : ''}
          ${f.user && !f.paused ? `<button class="btn sm" data-u="${esc(f.user.id)}" data-n="${esc(f.user.username || '')}"><i class="i i-pause" aria-hidden="true"></i> Pause person</button>` : ''}</div></article>`).join('')
      : `<div class="card">${empty('No open flags.', 'happy')}</div>`;
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
        <div><b>${esc(ts[h.title_key]?.name || h.title_key)}</b> · ${h.n} held (avg <i class="i i-star" aria-hidden="true"></i>${h.avg}) · normal avg ${h.normal_avg != null ? '<i class="i i-star" aria-hidden="true"></i>' + h.normal_avg : '—'}</div>
        <div class="meta">Why: ${esc((h.reasons || []).map(r => ({ wave: 'wave of new accounts', linked: 'linked accounts', too_fast: 'too fast' })[r] || r).join(', '))}</div>
        <div class="heldppl">${h.people.slice(0, 12).map(p => `<span>${who(p)} <i class="i i-star" aria-hidden="true"></i>${p.overall}</span>`).join('')}${h.people.length > 12 ? `<span class="meta">+${h.people.length - 12} more</span>` : ''}</div>
        <div class="rbtns"><button class="btn sm ghost" data-a="release"><i class="i i-check" aria-hidden="true"></i> Release (count them)</button><button class="btn sm" data-a="discard"><i class="i i-trash" aria-hidden="true"></i> Discard</button></div></article>`).join('')
      : `<div class="card">${empty('No held ratings.', 'happy')}</div>`;
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
        ${u.admin ? '' : `<div class="rbtns">${u.paused ? `<button class="btn sm" data-restore="${esc(u.id)}"><i class="i i-undo-2" aria-hidden="true"></i> Restore</button>` : `<button class="btn sm ghost" data-u="${esc(u.id)}" data-n="${esc(u.username)}"><i class="i i-pause" aria-hidden="true"></i> Pause or ban</button>`}</div>`}</article>`).join('')
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
    box.innerHTML = `<section class="card"><h2 class="h3"><i class="i i-mail" aria-hidden="true"></i> Sales requests</h2>
      ${S.requests.length ? S.requests.map(r => `<article class="arep stbox" data-r="${r.id}">
        <div><b>${esc(r.company)}</b> <span class="meta">· ${esc(r.job || '')} · ${day(r.at)}</span></div>
        <div class="meta">${esc(r.email)}${r.website ? ' · ' + esc(r.website) : ''} · account ${who(r.who)}</div>
        ${r.message ? `<blockquote class="rnote">${esc(r.message)}</blockquote>` : ''}
        <div class="stgrid3"><label class="fld"><span>Studio name</span><input class="sn" maxlength="80" value="${esc(r.company)}"></label>
          <label class="fld"><span>Plan</span><select class="sp"><option>pilot</option><option>pro</option><option>enterprise</option></select></label>
          <label class="fld"><span>Title limit</span><input class="sl" type="number" min="1" max="500" value="10"></label></div>
        <div class="rbtns"><button class="btn sm" data-ok="1"><i class="i i-check" aria-hidden="true"></i> Approve</button><button class="btn sm ghost" data-ok="0">Decline</button></div></article>`).join('') : '<p class="sub">No open requests.</p>'}</section>
      <section class="card"><h2 class="h3"><i class="i i-clapperboard" aria-hidden="true"></i> Studios</h2>
      ${S.studios.length ? S.studios.map(s => `<article class="arep" data-s="${s.id}"><div><b>${esc(s.name)}</b> <span class="pill2 ${s.status === 'active' ? 'ok' : ''}">${esc(s.status)}</span> <span class="meta">${esc(s.plan)} · ${s.titles}/${s.title_limit} titles · ${s.team} people · owner ${who(s.owner)}</span></div>
        <div class="rbtns">${s.status === 'active' ? '<button class="btn sm ghost" data-st="suspended"><i class="i i-pause" aria-hidden="true"></i> Pause</button>' : '<button class="btn sm" data-st="active"><i class="i i-play" aria-hidden="true"></i> Turn back on</button>'}</div></article>`).join('') : '<p class="sub">No studios yet.</p>'}</section>`;
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

const TOPIC = { help: 'Help', privacy: 'Privacy / data', safety: 'Safety', bug: 'Bug', studio: 'Studios', legal: 'Legal / copyright', other: 'Other' };
async function inbox(box) {
  const draw = async () => {
    const L = await rpc('admin_inbox');
    box.innerHTML = `<div class="sub" style="margin:0 2px 10px">Answer by email. Privacy requests (GDPR / CCPA) must be answered within 30 days. People can download or delete their own data in Me → Security.</div>` +
      (L.length ? L.map(m => `<article class="card arep" data-id="${m.id}"><div><b>${TOPIC[m.topic] || esc(m.topic)}</b> <span class="meta">· ${day(m.at)}</span></div>
        <div class="meta">${m.who ? who(m.who) : 'deleted account'} · reply to ${m.reply_to ? `<a class="see" href="mailto:${esc(m.reply_to)}">${esc(m.reply_to)}</a>` : '—'}</div>
        <blockquote class="rnote">${esc(m.message)}</blockquote><div class="rbtns"><button class="btn sm" data-done><i class="i i-check" aria-hidden="true"></i> Done</button></div></article>`).join('')
      : `<div class="card">${empty('No messages.', 'happy')}</div>`);
    box.querySelectorAll('[data-done]').forEach(b => b.onclick = async () => {
      try { await rpc('admin_inbox_done', { p_id: +b.closest('[data-id]').dataset.id }); toast('Done.'); draw(); } catch (e) { toast(plain(e), 'sad'); }
    });
  };
  await draw();
}

/* ---------- Box office: add movies and their daily numbers ---------- */
const CERTS = ['', 'U', 'UA', 'U/A 7+', 'U/A 13+', 'U/A 16+', 'A', 'S'];
const VERD = ['', 'Industry hit', 'Blockbuster', 'Super hit', 'Superhit', 'Hit', 'Average', 'Flop', 'Utter flop', 'Disaster'];
/** CSV lines: day, India net, India gross, overseas, note, est  (₹ crore; gross/overseas/note optional; "est" marks a filled-in day; a first line with words is skipped). */
export function parseDays(txt) {
  const out = [], bad = [];
  txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach((l, i) => {
    const c = l.split(/[,\t]/).map(x => x.trim());
    if (i === 0 && isNaN(parseFloat(c[0]))) return;
    const day = parseInt(c[0], 10), num = v => v === '' || v == null ? '' : String(parseFloat(String(v).replace(/[₹cr\s]/gi, '')));
    if (!(day >= 1 && day <= 400) || c[1] == null || isNaN(parseFloat(c[1]))) { bad.push(i + 1); return; }
    out.push({ day, net: num(c[1]), gross: num(c[2]), overseas: num(c[3]), note: (c[4] || '').slice(0, 40), est: /^est/i.test(c[5] || '') });
  });
  return { days: out, bad };
}
async function boxoffice(box) {
  const list = await rpc('box_office_summary');
  box.innerHTML = `<div class="sub" style="margin:0 2px 10px">Numbers are public on the Box Office page. Add the source for every movie. Money is in ₹ crore.</div>
    <button class="btn sm" id="bonew">${'<i class="i i-plus" aria-hidden="true"></i>'} Add a movie</button>
    <div style="margin-top:12px">${list.length ? list.map(m => `<article class="card arep"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><div><b>${esc(m.title)}</b> <span class="meta">· ${esc(LANGS[m.lang] || m.lang)} · ${esc(m.release_date)} · ${m.days} days · ${cr(+m.worldwide)} worldwide${m.running ? ' · running' : ''}</span></div>
      <div class="rbtns"><a class="btn sm ghost" href="#/boxoffice/${m.id}">View</a><button class="btn sm ghost" data-edit="${m.id}">Edit</button></div></div></article>`).join('') : `<div class="card">${empty('No movies yet.')}</div>`}</div>`;
  $('#bonew', box).onclick = () => editMovie(null, () => boxoffice(box));
  box.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => editMovie(await rpc('box_office_movie', { p_id: +b.dataset.edit }), () => boxoffice(box)));
}
function editMovie(D, done) {
  const m = D?.movie || { running: true, lang: 'hi' };
  const f = (k, l, v, type = 'text', extra = '') => `<label class="fld"><span>${l}</span><input id="bo_${k}" type="${type}" value="${esc(v ?? '')}" ${extra}></label>`;
  const s = (k, l, opts, v) => `<label class="fld"><span>${l}</span><select id="bo_${k}">${opts.map(([a, b]) => `<option value="${esc(a)}" ${String(a) === String(v ?? '') ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></label>`;
  const csv = (D?.days || []).map(d => [d.day, d.net, d.gross, d.overseas, d.note || '', d.est ? 'est' : ''].join(', ').replace(/(, )+$/, '')).join('\n');
  const sh = sheet(`<h2 class="h3" style="font-size:20px;margin:0 0 10px">${m.id ? 'Edit movie' : 'Add a movie'}</h2>
    <div class="bogrid">
      ${f('tmdb_id', 'TMDB movie id (fills poster)', m.tmdb_id, 'number', 'min="1"')}<div class="fld"><span>&nbsp;</span><button class="btn sm ghost" id="bo_fill" type="button">Fill from TMDB</button></div>
      ${f('title', 'Title', m.title, 'text', 'maxlength="200" required')}${s('lang', 'Language', Object.entries(LANGS), m.lang)}
      ${f('release_date', 'Release date', m.release_date, 'date')}${s('certificate', 'Certificate', CERTS.map(c => [c, c || '—']), m.certificate)}
      ${f('runtime', 'Runtime (minutes)', m.runtime, 'number')}${f('screens', 'Opening screens', m.screens, 'number')}
      ${f('budget', 'Budget (₹ Cr)', m.budget_cr, 'number', 'step="0.01"')}${f('breakeven', 'Break-even worldwide gross (₹ Cr, empty = 2 × budget)', m.breakeven_cr, 'number', 'step="0.01"')}
      ${f('ott_date', 'OTT release date', m.ott_date, 'date')}${f('ott_platform', 'OTT platform', m.ott_platform)}
      ${s('verdict', 'Verdict (empty = worked out from numbers)', VERD.map(v => [v, v || 'Auto']), m.verdict)}${s('running', 'In theaters?', [['true', 'Yes, still running'], ['false', 'No, run ended']], String(m.running))}
    </div>
    ${f('poster_path', 'TMDB poster path', m.poster_path, 'text', 'pattern="/[A-Za-z0-9_.-]+"')}
    ${f('source', 'Source (required for trust)', m.source, 'text', 'maxlength="200" placeholder="e.g. Producer press release, trade report"')}
    <label class="fld"><span>Daily numbers — one line per day: day, India net, India gross, overseas, note, est</span><textarea id="bo_days" rows="8" placeholder="1, 25.5, 30.1, 8.2, Opening&#10;2, 31.0, , 9.0, Diwali">${esc(csv)}</textarea>
      <span class="hint">₹ crore. Gross, overseas and note can be empty (gross then counts as net + 18% GST). Write "est" at the end of a line that is a guess, not a reported number.</span></label>
    <label class="tog"><input type="checkbox" id="bo_replace" ${m.id ? '' : 'checked'}> Replace all saved days with this list</label>
    <p class="errmsg" id="bo_err" hidden></p>
    <button class="btn big" id="bo_save">Save</button>
    ${m.id ? '<button class="btn ghost big dangerbtn" id="bo_del" style="margin-top:8px">Delete this movie</button>' : ''}`);
  const v = k => $('#bo_' + k, sh).value.trim(), err = $('#bo_err', sh);
  $('#bo_fill', sh).onclick = async () => {
    const id = v('tmdb_id'); if (!/^\d+$/.test(id)) { toast('Type the TMDB id first.', 'sad'); return; }
    try { const d = await fetch(`/api/tmdb?type=movie&id=${id}`).then(r => r.ok ? r.json() : Promise.reject(new Error('Not found on TMDB.')));
      if (!v('title')) $('#bo_title', sh).value = d.name || '';
      if (d.release_date && !v('release_date')) $('#bo_release_date', sh).value = d.release_date;
      if (d.runtime) $('#bo_runtime', sh).value = d.runtime;
      if (d.poster_path) $('#bo_poster_path', sh).value = d.poster_path;
      toast('Filled from TMDB.');
    } catch (e) { toast(plain(e), 'sad'); }
  };
  $('#bo_save', sh).onclick = async () => {
    err.hidden = true;
    const { days, bad } = parseDays($('#bo_days', sh).value);
    if (bad.length) { err.textContent = `Check line${bad.length > 1 ? 's' : ''} ${bad.join(', ')}: each line needs a day number and the India net.`; err.hidden = false; return; }
    if (!v('title') || !v('release_date')) { err.textContent = 'Title and release date are needed.'; err.hidden = false; return; }
    const p = { id: m.id || '', tmdb_id: v('tmdb_id'), title: v('title'), lang: v('lang'), release_date: v('release_date'), certificate: v('certificate'), runtime: v('runtime'), screens: v('screens'),
      budget: v('budget'), breakeven: v('breakeven'), ott_date: v('ott_date'), ott_platform: v('ott_platform'), verdict: v('verdict'), running: v('running') === 'true', poster_path: v('poster_path'), source: v('source') };
    try {
      const id = await rpc('admin_bo_save', { p });
      if (days.length || $('#bo_replace', sh).checked) await rpc('admin_bo_days', { p_movie: id, p_days: days, p_replace: $('#bo_replace', sh).checked });
      closeSheet(); toast('Saved.'); done();
    } catch (e) { err.textContent = plain(e); err.hidden = false; }
  };
  const del = $('#bo_del', sh);
  if (del) del.onclick = async () => { if (!confirm(`Delete ${m.title} and all its numbers?`)) return; try { await rpc('admin_bo_delete', { p_movie: m.id }); closeSheet(); toast('Deleted.'); done(); } catch (e) { toast(plain(e), 'sad'); } };
}

async function log(box) {
  const E = await rpc('admin_events', { p_limit: 120 });
  box.innerHTML = `<section class="card"><h2 class="h3"><i class="i i-scroll-text" aria-hidden="true"></i> Security log</h2><ul class="alog">${E.map(e => `<li><span class="meta">${day(e.at)}</span> <b>${esc(e.kind)}</b> ${e.user ? who(e.user) : ''}
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
