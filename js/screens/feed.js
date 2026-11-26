// Vertical, swipeable video reviews. Spoilers past your progress stay locked.
import { BYID, HANDLES } from '../data.js';
import { U, save } from '../store.js';
import { $, esc, empty, toast, sheet, closeSheet, hearts } from '../ui.js';
import { timeline, journey, argmax } from '../journey.js';
import { rerender } from '../app.js';

export function parseVideo(url) {
  url = (url || '').trim(); let m;
  if ((m = url.match(/^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:shorts\/|watch\?v=)|youtu\.be\/)([\w-]{11})(?:[?&#].*)?$/))) return { plat: 'YouTube Shorts', embed: 'https://www.youtube-nocookie.com/embed/' + m[1] };
  if ((m = url.match(/^(?:https?:\/\/)?(?:www\.|m\.)?tiktok\.com\/@[\w.-]+\/video\/(\d{8,})(?:[?#].*)?$/))) return { plat: 'TikTok', embed: 'https://www.tiktok.com/embed/v2/' + m[1] };
  if ((m = url.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:reel|reels|p)\/([\w-]+)\/?(?:[?#].*)?$/))) return { plat: 'Instagram Reel', embed: 'https://www.instagram.com/reel/' + m[1] + '/embed' };
  return null;
}
function videos(t) {
  const J = journey(t), g = argmax(J.gotGood), n = J.tl.length, h = t.id.length * 7;
  const caps = [`Is ${t.name} worth it? 60-second take`, `Don't quit before ${J.tl[g].l}!`, `That moment near the end…`, `Rating ${t.name} with zero spoilers`];
  return caps.map((c, i) => ({ id: t.id + 'v' + i, h: HANDLES[(i + h) % 8], plat: ['YouTube Shorts', 'TikTok', 'Instagram Reel', 'TikTok'][i], cap: c, moment: i === 1 ? g : i === 2 ? Math.max(0, n - 2) : null, likes: 400 + i * 913 + h * 31, sample: true }))
    .concat((U.videos?.[t.id] || []));
}

export function renderFeed(app, id, start) {
  const t = BYID[id];
  if (!t) { app.innerHTML = empty('No videos here.', 'sad'); return; }
  const tl = timeline(t), prog = U.progress[t.id] ?? -1, vids = videos(t);
  document.title = `${t.name} video reviews — Heartbeat`;
  app.innerHTML = `<div class="feed-top"><a class="pill" href="#/t/${t.id}">← ${esc(t.name)}</a>
    <div style="display:flex;gap:8px"><select id="prog" class="pill" style="width:auto;border:0;color:#fff" aria-label="How far you have watched"><option value="-1">Not started</option>${tl.map((x, j) => `<option value="${j}" ${prog === j ? 'selected' : ''}>Up to ${esc(x.s)}</option>`).join('')}</select><button class="pill" id="add"><i class="i i-plus" aria-hidden="true"></i> Add</button></div></div>
  <div class="feed" id="feed">${vids.map(v => { const locked = v.moment != null && v.moment > prog; return `<section class="slide" data-v="${v.id}">
    ${v.embed && !locked ? `<iframe src="${esc(v.embed)}" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="Video review by ${esc(v.h)}"></iframe>`
      : `<div class="ph" style="position:absolute;inset:0;justify-content:center;background:#121212"><div style="font-size:44px"><i class="i i-play" aria-hidden="true"></i></div><div>${v.sample ? 'Sample video' : esc(v.plat)}</div><div class="meta" style="color:#ddd">${v.sample ? 'Real TikToks, Shorts and Reels play here' : 'Open it on ' + esc(v.plat)}</div></div>`}
    ${locked ? `<div class="lock"><div style="font-size:44px"><i class="i i-lock" aria-hidden="true"></i></div><b style="font-size:20px">Spoiler lock</b><div class="meta" style="color:#ddd">This one is about ${esc(tl[v.moment].l)}.<br>You're at ${prog < 0 ? 'the start' : esc(tl[prog].l)}.</div><button class="btn sm" data-unlock>Show anyway</button></div>` : ''}
    <div class="over"><div style="font-weight:900">@${esc(v.h)} <span class="meta" style="color:#ccc">· ${esc(v.plat)}</span></div><div style="margin:4px 0;font-weight:700">${esc(v.cap)}</div>${v.moment != null ? `<span class="pill"><i class="i i-map-pin" aria-hidden="true"></i> ${esc(tl[v.moment].l)}</span>` : ''}</div>
    <div class="acts">
      <button data-like class="${U.likes[v.id] ? 'on' : ''}" aria-label="Like"><span><i class="i i-heart" aria-hidden="true"></i></span>${(v.likes || 0) + (U.likes[v.id] ? 1 : 0)}</button>
      <button data-help class="${U.helped[v.id] ? 'on' : ''}" aria-label="This helped me decide"><span><i class="i i-check" aria-hidden="true"></i></span>Helped</button>
      <button data-rep aria-label="Report"><span><i class="i i-flag" aria-hidden="true"></i></span>Report</button>
    </div></section>`; }).join('')}</div>`;
  const feed = $('#feed');
  if (start) { const el = feed.querySelector(`[data-v="${CSS.escape(start)}"]`); if (el) feed.scrollTop = el.offsetTop; }
  $('#prog').onchange = e => { U.progress[t.id] = +e.target.value; save(); rerender(); };
  $('#add').onclick = () => addVideo(t);
  feed.onclick = e => {
    const sl = e.target.closest('[data-v]'); if (!sl) return; const vid = sl.dataset.v, v = vids.find(x => x.id === vid);
    if (e.target.closest('[data-unlock]')) { sl.querySelector('.lock').remove(); return; }
    if (e.target.closest('[data-like]')) { U.likes[vid] = !U.likes[vid]; save(); const b = e.target.closest('[data-like]'); b.classList.toggle('on'); b.lastChild.textContent = (v.likes || 0) + (U.likes[vid] ? 1 : 0); if (U.likes[vid]) { const r = b.getBoundingClientRect(); hearts(r.x + 25, r.y + 25, 8); } }
    else if (e.target.closest('[data-help]')) { U.helped[vid] = !U.helped[vid]; save(); e.target.closest('[data-help]').classList.toggle('on'); if (U.helped[vid]) toast('Thanks! That helps others decide.'); }
    else if (e.target.closest('[data-rep]')) { const s = sheet(`<h3>Report this video</h3><div class="chips" style="margin-top:12px">${['Spoiler not marked', 'Wrong title', 'Spam', 'Hateful or unsafe'].map(r => `<button class="chip" data-r="${r}">${r}</button>`).join('')}</div>`); s.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { closeSheet(); toast('Reported. Thanks for keeping it kind.'); }); }
  };
}

function addVideo(t) {
  const tl = timeline(t);
  const s = sheet(`<h3>Add your video review</h3><div class="sub">Paste your YouTube Short, TikTok or Instagram Reel link. We only save the link.</div>
    <input id="vurl" style="margin-top:12px" placeholder="https://www.tiktok.com/@you/video/…" inputmode="url">
    <div class="sub" style="margin:12px 0 6px">Attach to a moment (optional)</div>
    <select id="vmom"><option value="">General review — no spoilers</option>${tl.map((x, i) => `<option value="${i}">${esc(x.l)}</option>`).join('')}</select>
    <div id="vmsg" class="sub" style="margin-top:8px"></div><button class="btn big" id="vsave" style="margin-top:12px">Check link & save</button>`);
  $('#vsave', s).onclick = () => {
    const url = $('#vurl', s).value, p = parseVideo(url);
    if (!p) { $('#vmsg', s).innerHTML = '<span style="color:#ff8fa3;font-weight:800">That doesn\'t look like a Short, TikTok or Reel link. Check it and try again.</span>'; return; }
    U.videos = U.videos || {}; (U.videos[t.id] = U.videos[t.id] || []).push({ id: t.id + 'u' + Date.now(), h: U.name.toLowerCase().replace(/\s+/g, ''), plat: p.plat, cap: 'My review', moment: $('#vmom', s).value === '' ? null : +$('#vmom', s).value, likes: 0, url: url.trim(), embed: p.embed });
    save(); closeSheet(); toast(`Nice! Your ${p.plat} is in the feed.`); rerender();
  };
}
