// Play: weekly leagues, daily challenges + weekly quests, streak tools, badges and events.
// Every number here comes from the server. The app only shows it.
import { cloud, keyOf, refreshMe, plain } from '../cloud.js';
import { $, esc, toast, sheet, closeSheet, empty, poster, hydratePosters, buzz, confetti, hearts, emo } from '../ui.js';
import { socialReady, avatar, profileHref, titlesFor } from '../social.js';

async function rpc(fn, args = {}) {
  if (!cloud.sb) throw new Error('You seem to be offline. Try again.');
  const { data, error } = await cloud.sb.rpc(fn, args);
  if (error) throw new Error(error.message || 'Something went wrong. Please try again.');
  return data;
}
export const G = {
  league: () => rpc('my_league'),
  seen: week => rpc('league_seen', { p_week: week }),
  challenges: () => rpc('my_challenges'),
  claim: id => rpc('claim_challenge', { p_id: id }),
  streak: () => rpc('streak_status'),
  repair: () => rpc('repair_streak'),
  takeBreak: days => rpc('take_break', { p_days: days }),
  endBreak: () => rpc('end_break'),
  box: () => rpc('open_mystery_box'),
  badges: () => rpc('my_achievements', { p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }),
  events: () => rpc('list_events'),
  event: slug => rpc('event_detail', { p_slug: slug }),
  pick: (cat, pick) => rpc('make_pick', { p_category: cat, p_pick: pick }),
  board: (slug, scope) => rpc('event_board', { p_slug: slug, p_scope: scope }),
};
export const TIERS = [['Bronze', '<i class="i i-medal" aria-hidden="true"></i>'], ['Silver', '<i class="i i-medal" aria-hidden="true"></i>'], ['Gold', '<i class="i i-medal" aria-hidden="true"></i>'], ['Sapphire', '<i class="i i-diamond" aria-hidden="true"></i>'], ['Ruby', '<i class="i i-diamond" aria-hidden="true"></i>'], ['Emerald', '<i class="i i-heart" aria-hidden="true"></i>'], ['Diamond', '<i class="i i-gem" aria-hidden="true"></i>']];
const TABS = [['league', 'League'], ['challenges', 'Challenges'], ['badges', 'Badges'], ['events', 'Events']];
const day = s => new Date(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const when = s => new Date(s).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function renderPlay(app, tab = 'league', sub = '') {
  if (!TABS.some(t => t[0] === tab)) tab = 'league';
  document.title = 'Play — Heartbeat';
  if (!socialReady() && tab !== 'events') {
    app.innerHTML = `<div class="screen play"><header class="top"><h1 class="logo" style="font-size:26px;margin:0"><i class="i i-trophy" aria-hidden="true"></i> Play</h1></header>
      <div class="card">${empty(cloud.user ? 'Finish setting up your account to join leagues and challenges.' : 'Make a free account to join weekly leagues, daily challenges and earn badges.', 'happy',
        cloud.user ? '<a class="btn" href="#/welcome">Finish setup</a>' : '<a class="btn" href="#/signin/up">Make an account</a>')}</div></div>`;
    return;
  }
  app.innerHTML = `<div class="screen play">
    <header class="top"><h1 class="logo" style="font-size:26px;margin:0"><i class="i i-trophy" aria-hidden="true"></i> Play</h1></header>
    <nav class="ftabs" aria-label="Play sections">${TABS.map(([k, l]) => `<a href="#/play/${k}" class="chip ${k === tab ? 'on' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    <div id="gbody" class="fbody"><div class="card"><div class="rskel"></div><div class="rskel"></div></div></div></div>`;
  const body = $('#gbody', app);
  ({ league: fillLeague, challenges: fillChallenges, badges: fillBadges, events: fillEvents })[tab](body, sub).catch(e => {
    body.innerHTML = `<div class="card">${empty(esc(plain(e)), 'sad', '<button class="btn sm" id="gretry">Try again</button>')}</div>`;
    $('#gretry', body).onclick = () => renderPlay(app, tab, sub);
  });
}

/* ---------------- League ---------------- */
async function fillLeague(body) {
  const L = await G.league();
  const [name, e] = TIERS[L.tier];
  const me = L.people.find(p => p.me) || {};
  const rows = L.people.map(p => {
    const zone = L.up && p.place <= L.up ? 'upz' : L.down && p.place > L.size - L.down ? 'downz' : '';
    const who = p.hidden ? `<span class="ava sm hid" aria-hidden="true"><i><i class="i i-sun" aria-hidden="true"></i></i></span><span class="pname"><b>${esc(p.display_name)}</b></span>`
      : `<a class="plink" href="${profileHref(p)}">${avatar(p, 'sm')}<span class="pname"><b>${esc(p.display_name || p.username)}${p.me ? ' (you)' : ''}</b><span class="meta">${p.rank ? esc(p.rank) : ''}</span></span></a>`;
    return `<li class="lrow ${zone} ${p.me ? 'me' : ''}"><span class="lplace">${p.place}</span>${who}<b class="lxp">${p.xp} XP</b></li>`;
  });
  if (L.up && L.size > L.up) rows.splice(L.up, 0, `<li class="lline up" aria-hidden="true"><span><i class="i i-arrow-up" aria-hidden="true"></i> Move up zone</span></li>`);
  if (L.down && L.size > L.down) rows.splice(rows.length - L.down, 0, `<li class="lline down" aria-hidden="true"><span><i class="i i-download" aria-hidden="true"></i> Move down zone</span></li>`);
  body.innerHTML = `
    <section class="card lhead tier-${L.tier}"><div class="lbadge" aria-hidden="true">${e}</div>
      <div><h2>${name} League</h2><div class="sub">${L.size} ${L.size === 1 ? 'player' : 'players'} · you're #${me.place || '–'} with ${me.xp || 0} XP this week</div>
      <div class="sub">New week starts ${when(L.ends_at)}. ${L.top ? 'This is the top league! #1 wins a free month of Plus' : `Top ${L.up} move up${L.down ? `, bottom ${L.down} move down` : ''}.`}</div></div></section>
    <div class="ltiers" aria-label="League tiers">${TIERS.map(([n, em], i) => `<span class="${i === L.tier ? 'on' : i < L.tier ? 'done' : ''}" title="${n}">${em}</span>`).join('')}</div>
    <ol class="card ltable">${rows.join('')}</ol>
    <div class="sub" style="text-align:center;margin:8px 0 16px">Earn XP by rating, reviewing, challenges and quests. Up to 30 players per league. Plus gives no league advantage.</div>`;
  if (L.result) reveal(L.result);
}

function reveal(r) {
  const [nn, ne] = TIERS[r.new_tier];
  const msg = r.outcome === 'win' ? `You won the ${esc(r.tier_name)} League!` : r.outcome === 'up' ? `You moved up to ${esc(nn)}!`
    : r.outcome === 'down' ? `You're in ${esc(nn)} this week` : `You stayed in ${esc(nn)}`;
  const sub = r.outcome === 'win' ? 'You get a free month of Heartbeat Plus!' : r.outcome === 'down' ? 'No worries. A few ratings and you\'ll climb back up!'
    : r.outcome === 'up' ? 'Amazing week!' : 'Nice and steady.';
  const sh = sheet(`<div class="reveal ${r.outcome}">
      <div class="rvweek">Last week's results</div>
      <div class="rvflip"><span class="rvold" aria-hidden="true">${TIERS[r.tier][1]}</span><span class="rvnew">${ne}</span></div>
      <h2>${msg}</h2><div class="sub">You finished #${r.place} of ${r.size} with ${r.xp} XP. ${sub}</div>
      <button class="btn big" id="rvok">Let's go!</button></div>`, () => G.seen(r.week).catch(() => {}));
  if (r.outcome === 'up' || r.outcome === 'win') { confetti(r.outcome === 'win' ? 160 : 90); buzz([20, 40, 20]); }
  $('#rvok', sh).onclick = () => closeSheet();
}

/* ---------------- Challenges + streak tools ---------------- */
async function fillChallenges(body) {
  const [C, S] = await Promise.all([G.challenges(), G.streak()]);
  const item = (x, weekly) => {
    const done = x.have >= x.goal, pct = Math.round(x.have / x.goal * 100);
    return `<li class="chal ${x.claimed ? 'claimed' : done ? 'ready' : ''}"><span class="che" aria-hidden="true">${emo(x.emoji)}</span>
      <div class="chi"><b>${esc(x.label)}</b><div class="track" role="progressbar" aria-label="${esc(x.label)}" aria-valuenow="${x.have}" aria-valuemin="0" aria-valuemax="${x.goal}"><i style="width:${pct}%"></i></div>
      <span class="meta">${x.have} / ${x.goal} · +${x.xp} XP${weekly ? ' · Shield' : ''}</span></div>
      ${x.claimed ? '<span class="pill2 ok"><i class="i i-check" aria-hidden="true"></i> Done</span>' : done ? `<button class="btn sm" data-claim="${esc(x.id)}">Claim</button>` : ''}</li>`;
  };
  const left = C.daily.filter(x => !x.claimed).length;
  body.innerHTML = `
    ${streakCardHTML(S)}
    <section class="card"><h2 class="h3"><i class="i i-target" aria-hidden="true"></i> Today's challenges</h2><div class="sub">${left ? `${left} left today. New ones every day.` : 'All done for today! Come back tomorrow.'}</div>
      <ul class="chals">${C.daily.map(x => item(x, false)).join('')}</ul></section>
    <section class="card"><h2 class="h3"><i class="i i-map" aria-hidden="true"></i> This week's quests</h2><div class="sub">Bigger goals, bigger XP. Finishing one also earns you a Streak Shield (1 a month).</div>
      <ul class="chals">${C.weekly.map(x => item(x, true)).join('')}</ul></section>`;
  body.onclick = async e => {
    const b = e.target.closest('[data-claim],[data-act]'); if (!b || b.disabled) return;
    b.disabled = true;
    try {
      if (b.dataset.claim) {
        const r = await G.claim(b.dataset.claim);
        const br = b.getBoundingClientRect(); hearts(br.x + br.width / 2, br.y, 10); buzz([15, 30, 15]);
        toast(`+${r.xp_gained} XP! ${r.shield ? 'You also earned a Streak Shield!' : ''}`);
        refreshMe();
      } else await streakAction(b.dataset.act, b);
      await fillChallenges(body);
    } catch (er) { toast(plain(er), 'sad'); b.disabled = false; }
  };
}

export function streakCardHTML(S) {
  const onBreak = S.break_until;
  return `<section class="card streakbox"><div class="flame"><span class="f" aria-hidden="true">${onBreak ? '<i class="i i-moon" aria-hidden="true"></i>' : '<i class="i i-flame" aria-hidden="true"></i>'}</span>
      <div><b>${S.streak}</b> <span style="font-weight:900">day streak</span>
      <div class="sub">${onBreak ? `On a break until ${day(S.break_until)}. Your streak is safe.` : `Best: ${S.best} days.`}</div></div></div>
    ${S.can_fix ? `<div class="fixbox"><b>Oh no, you missed a day!</b><div class="sub">Use a Shield to keep your ${S.fix_to}-day streak.</div>
        ${S.shields || S.plus_repairs ? `<button class="btn sm" data-act="repair"><i class="i i-shield" aria-hidden="true"></i> Use a Shield</button>` : `<div class="sub">You have no Shields. Finish a weekly quest to earn one.</div>`}</div>` : ''}
    ${S.box ? `<button class="btn big boxbtn" data-act="box"><i class="i i-gift" aria-hidden="true"></i> Open your mystery box!</button>` : `<div class="sub"><i class="i i-gift" aria-hidden="true"></i> Next mystery box at a ${S.box_at}-day streak.</div>`}
    <div class="srow"><span><i class="i i-shield" aria-hidden="true"></i> Streak Shields</span><b>${S.shields}${S.plus ? ` + ${S.plus_repairs} Plus` : ''}</b></div>
    <div class="srow"><span><i class="i i-moon" aria-hidden="true"></i> Take a break</span>${onBreak ? '<button class="btn sm ghost" data-act="endbreak">End break</button>'
      : S.break_used ? '<span class="meta">Used this month</span>' : '<button class="btn sm ghost" data-act="break">Pause streak</button>'}</div>
  </section>`;
}
async function streakAction(act, b) {
  if (act === 'repair') { await G.repair(); confetti(40); toast('Streak saved!'); refreshMe(); }
  if (act === 'endbreak') { await G.endBreak(); toast('Welcome back!'); }
  if (act === 'box') {
    const r = await G.box();
    const sh = sheet(`<div class="reveal box"><div class="rvweek">Mystery box</div><div class="boxopen" aria-hidden="true"><i class="i i-gift" aria-hidden="true"></i></div>
      <div class="boxprize">${emo(r.emoji)}</div><h2>${esc(r.label)}</h2><div class="sub">Thanks for showing up for 7 days! See you at the next box.</div>
      <button class="btn big" id="bxok">Yay!</button></div>`);
    confetti(80); buzz([20, 40, 20]);
    $('#bxok', sh).onclick = () => closeSheet();
    refreshMe();
  }
  if (act === 'break') {
    await new Promise(res => {
      const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 6px"><i class="i i-moon" aria-hidden="true"></i> Take a break</h2>
        <div class="sub" style="margin-bottom:12px">Your streak waits for you. No reminders while you're away. One break a month.</div>
        <div class="brk">${[1, 3, 7, 14].map(d => `<button class="btn ghost" data-d="${d}">${d} day${d > 1 ? 's' : ''}</button>`).join('')}</div>`, res);
      sh.querySelector('.brk').onclick = async e => {
        const x = e.target.closest('[data-d]'); if (!x) return;
        try { await G.takeBreak(+x.dataset.d); toast('Enjoy your break! Your streak is safe.'); closeSheet(); }
        catch (er) { toast(plain(er), 'sad'); }
      };
    });
  }
}

/* ---------------- Badges ---------------- */
async function fillBadges(body) {
  const A = await G.badges();
  const got = A.filter(a => a.got).length;
  body.innerHTML = `<section class="card"><h2 class="h3"><i class="i i-medal" aria-hidden="true"></i> Your badges</h2><div class="sub">${got} of ${A.length} unlocked. Every badge is earned, never bought.</div>
    <ul class="agrid">${A.map(a => `<li class="ach ${a.got ? 'got' : ''}"><span class="ae" aria-hidden="true">${emo(a.emoji)}</span><b>${esc(a.name)}</b>
      <span class="meta">${esc(a.desc)}</span>${a.got ? '<span class="pill2 ok">Unlocked</span>' : `<div class="track" aria-label="${a.have} of ${a.goal}"><i style="width:${Math.round(a.have / a.goal * 100)}%"></i></div><span class="meta">${a.have} / ${a.goal}</span>`}
      <span class="sr-only">${a.got ? 'Unlocked' : 'Locked'}</span></li>`).join('')}</ul></section>
    <section class="card"><h2 class="h3"><i class="i i-award" aria-hidden="true"></i> Rank frames</h2><div class="sub">Each rank gives your profile photo a new frame color. Free for everyone.</div>
      <div class="rkframes">${['Ticket Holder', 'Front Row', 'Critic', 'Top Critic', "Director's Cut", 'Legend'].map(r => `<div>${avatar({ username: r, display_name: r[0], rank: r }, 'sm')}<span class="meta">${esc(r)}</span></div>`).join('')}</div></section>`;
}

/* ---------------- Events ---------------- */
async function fillEvents(body, slug) {
  if (slug) return fillEvent(body, slug);
  const E = await G.events();
  body.innerHTML = E.length ? E.map(e => `<a class="card linkcard evcard" href="#/play/events/${esc(e.slug)}"><span style="font-size:36px" aria-hidden="true">${emo(e.emoji)}</span>
      <div style="flex:1"><h2 class="h3">${esc(e.title)}</h2><div class="sub">${{ soon: 'Coming soon', open: `Open for picks${e.locks_at ? ` until ${day(e.locks_at)}` : ''}`, locked: 'Picks are locked', done: 'Results are in!' }[e.status]}${e.my_picks ? ` · ${e.my_picks} picks made` : ''}</div></div>
      <span class="btn sm ghost" aria-hidden="true">Open</span></a>`).join('') : `<div class="card">${empty('No events right now. Check back for award season!', 'happy')}</div>`;
}
async function fillEvent(body, slug) {
  const e = await G.event(slug);
  if (!e) { body.innerHTML = `<div class="card">${empty('Event not found.', 'sad')}</div>`; return; }
  const keys = e.categories.flatMap(c => c.nominees.map(n => n.k)).filter(k => /^(movie|tv):\d+$/.test(k));
  const ts = Object.fromEntries((await titlesFor([...new Set(keys)])).map(t => [keyOf(t.id), t]));
  const open = e.status === 'open' && socialReady();
  const cats = e.categories.map(c => {
    const total = c.counts ? Object.values(c.counts).reduce((a, b) => a + b, 0) : 0;
    return `<section class="card evcat" data-cat="${c.id}"><h3 class="h3">${esc(c.name)}</h3>
      ${c.nominees.length ? `<div class="noms" role="radiogroup" aria-label="${esc(c.name)}">${c.nominees.map(n => {
        const t = ts[n.k], mine = c.mine === n.k, win = c.winner === n.k;
        const pct = total ? Math.round((c.counts[n.k] || 0) / total * 100) : null;
        return `<button type="button" role="radio" aria-checked="${mine}" class="nom ${mine ? 'on' : ''} ${win ? 'win' : ''}" data-pick="${esc(n.k)}" ${open ? '' : 'disabled'}>
          ${t ? poster(t, { small: true, mine: false }) : '<span class="nopo" aria-hidden="true"><i class="i i-clapperboard" aria-hidden="true"></i></span>'}<span class="nl">${esc(n.label || t?.name || n.k)}</span>
          ${win ? '<span class="pill2 ok"><i class="i i-trophy" aria-hidden="true"></i> Winner</span>' : ''}${pct != null ? `<span class="meta">${pct}% picked</span>` : ''}${mine ? '<span class="pill2">Your pick</span>' : ''}</button>`;
      }).join('')}</div>` : '<div class="sub">Nominees coming soon.</div>'}</section>`;
  }).join('');
  body.innerHTML = `<a class="see" href="#/play/events">← All events</a>
    <section class="card phero"><div class="pheart" aria-hidden="true">${emo(e.emoji)}</div><h2>${esc(e.title)}</h2><p class="sub">${esc(e.info || '')}</p>
      <div class="sub"><b>${{ soon: 'Coming soon', open: `Make your picks${e.locks_at ? ` before ${day(e.locks_at)}` : ''}. +${e.xp_each} XP for each right one.`, locked: 'Picks are locked. Results soon!', done: 'Results are in!' }[e.status]}</b></div>
      ${e.status === 'open' && !socialReady() ? '<a class="btn" href="#/signin">Sign in to play</a>' : ''}</section>
    ${e.status === 'done' && socialReady() ? '<section class="card" id="evboard"><div class="rskel"></div></section>' : ''}
    ${cats}`;
  hydratePosters(body);
  body.onclick = async ev => {
    const b = ev.target.closest('[data-pick]'); if (!b || b.disabled) return;
    const cat = b.closest('[data-cat]');
    try {
      await G.pick(+cat.dataset.cat, b.dataset.pick);
      cat.querySelectorAll('.nom').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); x.querySelector('.pill2:not(.ok)')?.remove(); });
      b.insertAdjacentHTML('beforeend', '<span class="pill2">Your pick</span>'); buzz(10);
    } catch (er) { toast(plain(er), 'sad'); }
  };
  if (e.status === 'done' && socialReady()) {
    const box = $('#evboard', body);
    const draw = async scope => {
      const B = await G.board(slug, scope).catch(() => []);
      box.innerHTML = `<h2 class="h3"><i class="i i-medal" aria-hidden="true"></i> Leaderboard</h2><div class="rcsub"><button class="chip ${scope === 'friends' ? 'on' : ''}" data-sc="friends">Friends</button><button class="chip ${scope === 'all' ? 'on' : ''}" data-sc="all">Everyone</button></div>
        <ol class="board">${B.map((p, i) => `<li class="${p.me ? 'me' : ''}"><span class="medal">${['<i class="i i-medal" aria-hidden="true"></i>', '<i class="i i-medal" aria-hidden="true"></i>', '<i class="i i-medal" aria-hidden="true"></i>'][i] || i + 1}</span>${p.hidden ? `<span class="pname"><b>${esc(p.display_name)}</b></span>` : `<a class="plink" href="${profileHref(p)}">${avatar(p, 'sm')}<span class="pname"><b>${esc(p.display_name || p.username)}${p.me ? ' (you)' : ''}</b></span></a>`}<b class="rcgt">${p.correct}/${p.picks}</b></li>`).join('') || '<div class="sub">No picks were made.</div>'}</ol>`;
      box.querySelectorAll('[data-sc]').forEach(x => { x.onclick = () => draw(x.dataset.sc); });
    };
    draw('friends');
  }
}

/* ---------------- small cards for Home and Me ---------------- */
export function homePlayHTML() { return socialReady() ? '<div id="homeplay"></div>' : ''; }
export async function fillHomePlay(root) {
  const box = $('#homeplay', root); if (!box) return;
  try {
    const [C, L] = await Promise.all([G.challenges(), G.league()]);
    if (!box.isConnected) return;
    const done = C.daily.filter(x => x.claimed).length, ready = C.daily.filter(x => !x.claimed && x.have >= x.goal).length;
    const me = L.people.find(p => p.me) || {};
    box.innerHTML = `<a class="card linkcard hplay" href="#/play/challenges"><span style="font-size:32px" aria-hidden="true"><i class="i i-target" aria-hidden="true"></i></span>
      <div style="flex:1"><h2 class="h3">Today: ${done}/${C.daily.length} challenges${ready ? ` · ${ready} ready to claim!` : ''}</h2>
      <div class="sub">${TIERS[L.tier][1]} ${esc(L.tier_name)} League · you're #${me.place || '–'} with ${me.xp || 0} XP</div></div>
      <span class="btn sm ${ready ? '' : 'ghost'}" aria-hidden="true">${ready ? 'Claim' : 'Play'}</span></a>`;
    if (L.result) reveal(L.result);
  } catch (e) { box.innerHTML = ''; }
}
