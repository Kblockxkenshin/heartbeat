// Written reviews: the editor, the Reviews section on a title, review cards, comments, reports,
// the "Want to tell people why?" prompt, and the My Reviews page.
import { BYID } from '../data.js';
import { U, rate as saveRating } from '../store.js';
import { avatar, titleFor } from '../social.js';
import { sendTitleToChat } from './chat.js';
import { cloud, keyOf, idOf } from '../cloud.js';
import { $, $$, esc, sheet, closeSheet, toast, hearts, confetti, buzz, mascot, wide, poster, hydratePosters } from '../ui.js';
import {
  TAG_LIST, MIN, MAX, PRIVACY, listReviews, precheck, postReview, editReview, deleteReview, vote, listComments, addComment,
  deleteComment, report, myReviews, saveDraft, loadDraft, dropDraft, allDrafts, fmt, countChars, miniGraph, ordinal, ago, shareReviewImage,
  appealReview, syncReviews, aiCheck,
} from '../reviews.js';

const state = {};          // per title: { sort, min, max, items, loading, error }
const expanded = new Set(); // review ids with "Read more" opened
const revealed = new Set(); // review ids with spoilers shown
let onChange = () => {};    // set by the detail page so it can redraw
export const setReviewsChanged = fn => { onChange = fn; };

const needAccount = what => {
  if (!cloud.ready) { toast('Reviews need the internet. Try again soon.', 'sad'); return true; }
  if (!cloud.user) {
    sheet(`<h2 class="h3" style="font-size:22px;margin:0 0 6px">✍️ ${esc(what)}</h2>
      <p class="sub">Reviews are shared with other people, so you need a free account. It takes 1 minute.</p>
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap"><a class="btn" href="#/signin/up" onclick="document.getElementById('sheet')?.remove()">Make an account</a><a class="btn ghost" href="#/signin" onclick="document.getElementById('sheet')?.remove()">Sign in</a></div>`);
    return true;
  }
  return false;
};
const mineFor = id => (state[id]?.uid === (cloud.user?.id || null) ? state[id].items || [] : []).find(r => r.mine && !r.is_rewatch && r.user_id === cloud.user?.id);
/** Ask the server if I already have a main review for this title (works even before the list loads). */
async function fetchMine(t) {
  const m = mineFor(t.id); if (m || !cloud.user) return m || null;
  const { data } = await cloud.sb.from('reviews').select('id,title_key,headline,body,start_note,middle_note,ending_note,tags,has_spoilers,is_rewatch,watch_no,watched_on,privacy,start_h,middle_h,end_h,overall')
    .eq('user_id', cloud.user.id).eq('title_key', keyOf(t.id)).eq('is_rewatch', false).maybeSingle();
  return data ? { ...data, mine: true } : null;
}

/* =====================================================================
   Prompt after saving a journey rating
   ===================================================================== */
export function promptReview(t) {
  if (!cloud.ready || mineFor(t.id)) return;
  setTimeout(async () => {
    if (cloud.user && await fetchMine(t).catch(() => null)) return;
    if ($('#sheet') || $('#editor')) return;
    sheet(`<div style="text-align:center">
      <div style="font-size:44px" aria-hidden="true">✍️</div>
      <h2 class="h3" style="font-size:22px;justify-content:center;margin:4px 0">Want to tell people why?</h2>
      <p class="sub">A few sentences about <b>${esc(t.name)}</b> help others decide. Good reviews earn up to +20 XP.</p>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:14px"><button class="btn" id="pw">Write a review</button><button class="btn ghost" id="ps">Skip</button></div></div>`);
    $('#pw').onclick = () => { closeSheet(); openEditor(t); };
    $('#ps').onclick = () => closeSheet();
  }, 650);
}

/* =====================================================================
   Editor (phone: full screen · desktop: big modal with live preview)
   ===================================================================== */
export async function openEditor(t, existing = null) {
  if (needAccount('Write a review')) return;
  if (!existing) { const m = await fetchMine(t).catch(() => null); if (m) existing = m; }
  const draft = existing ? null : await loadDraft(t.id).catch(() => null);
  const r0 = U.ratings[t.id];
  const v = existing ? {
    headline: existing.headline || '', body: existing.body || '', start_note: existing.start_note || '', middle_note: existing.middle_note || '',
    ending_note: existing.ending_note || '', tags: existing.tags || [], has_spoilers: existing.has_spoilers, watched_on: existing.watched_on || '',
    is_rewatch: existing.is_rewatch, privacy: existing.privacy, start_h: existing.start_h, middle_h: existing.middle_h, end_h: existing.end_h,
  } : Object.assign({ headline: '', body: '', start_note: '', middle_note: '', ending_note: '', tags: [], has_spoilers: false, watched_on: '',
    is_rewatch: false, privacy: 'public', start_h: r0?.start || 0, middle_h: r0?.middle || 0, end_h: r0?.end || 0 }, draft || {});
  const ratedAlready = !!r0 || !!existing;
  let dirty = false, saveTimer = null, saving = false, undoText = null;

  const el = document.createElement('div'); el.id = 'editor'; el.className = 'redit-bg';
  el.innerHTML = `<div class="redit" role="dialog" aria-modal="true" aria-labelledby="edh">
    <header class="redhead">
      <button class="icon-btn" id="edClose" aria-label="Close editor">✕</button>
      <div class="redt"><h2 id="edh">${existing ? 'Edit review' : 'Write a review'}</h2><div class="sub">${esc(t.name)} · <span id="edSaved">${draft ? 'Draft loaded' : 'Drafts save by themselves'}</span></div></div>
      <button class="btn sm" id="edPost">${existing ? 'Save' : 'Post'}</button>
    </header>
    <div class="redbody">
      <div class="redform">
        ${ratedAlready ? '' : `<div class="card redrate"><div class="h3" style="font-size:16px">First, rate the journey</div>
          ${[['start_h', 'Start'], ['middle_h', 'Middle'], ['end_h', 'Ending']].map(([k, l]) => `<div class="jrow"><div class="lab">${l}</div><div class="hearts" role="radiogroup" aria-label="${l} rating">${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" aria-checked="${v[k] === n}" aria-label="${l}: ${n} hearts" class="${v[k] >= n ? 'on' : ''}" data-hk="${k}" data-hv="${n}">💖</button>`).join('')}</div></div>`).join('')}</div>`}
        <label class="fld"><span>Title <small class="hint" style="display:inline">(optional)</small></span><input id="edHead" maxlength="120" placeholder="Sum it up in a few words" value="${esc(v.headline)}"></label>
        <div class="fld"><span id="edBodyL">Your review</span>
          <div class="redtools" role="toolbar" aria-label="Formatting">
            <button type="button" data-fx="b" aria-label="Bold"><b>B</b></button><button type="button" data-fx="i" aria-label="Italic"><i>I</i></button>
            <button type="button" data-fx="s" aria-label="Hide selected text as spoiler">🙈 Hide as spoiler</button>
            <button type="button" class="wide-hide" id="edPrevBtn" aria-pressed="false">👀 Preview</button>
          </div>
          <textarea id="edBody" aria-labelledby="edBodyL" rows="6" placeholder="What did you think? Why?">${esc(v.body)}</textarea>
          <div class="redcount"><span id="edCount"></span><span class="hint">Tip: select text, then tap 🙈 to hide a spoiler.</span></div>
          <div class="redprev wide-hide" id="edPrevPh" hidden></div>
        </div>
        <details class="rednotes" ${v.start_note || v.middle_note || v.ending_note ? 'open' : ''}><summary>🧭 Short notes for each part <span class="hint">(optional)</span></summary>
          ${[['start_note', 'Start'], ['middle_note', 'Middle'], ['ending_note', 'Ending']].map(([k, l]) => `<label class="fld"><span>${l}</span><input id="ed_${k}" maxlength="500" value="${esc(v[k])}" placeholder="How was the ${l.toLowerCase()}?"></label>`).join('')}
        </details>
        <div class="fld"><span>Quick tags</span><div class="chips" id="edTags">${TAG_LIST.map(x => `<button type="button" class="chip ${v.tags.includes(x) ? 'on' : ''}" aria-pressed="${v.tags.includes(x)}" data-tag="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>
        <div class="redrow">
          <label class="fld"><span>Watched on</span><input id="edDate" type="date" max="${new Date().toISOString().slice(0, 10)}" value="${esc(v.watched_on || '')}"></label>
          <label class="fld"><span>Who can see it</span><select id="edPriv">${Object.entries(PRIVACY).map(([k, [e, l]]) => `<option value="${k}" ${v.privacy === k ? 'selected' : ''}>${e} ${l}</option>`).join('')}</select></label>
        </div>
        <div class="redrow">
          <label class="tog"><input type="checkbox" id="edSpo" ${v.has_spoilers ? 'checked' : ''}><span>Contains spoilers <small class="hint">(hides the whole review)</small></span></label>
          ${existing ? '' : `<label class="tog"><input type="checkbox" id="edRew" ${v.is_rewatch ? 'checked' : ''}><span>🔁 Rewatch</span></label>`}
        </div>
        <p class="errmsg" id="edErr" role="alert" tabindex="-1" hidden></p>
        <div id="edCheck"></div>
      </div>
      <aside class="redside wide-only" aria-label="Live preview"><div class="sub" style="font-weight:900;margin-bottom:8px">👀 Live preview</div><div id="edPrev"></div></aside>
    </div></div>`;
  document.body.appendChild(el);
  document.documentElement.classList.add('locked');
  const body = $('#edBody', el), err = $('#edErr', el);

  const read = () => ({
    title_key: keyOf(t.id), headline: $('#edHead', el).value.trim(), body: body.value,
    start_note: $('#ed_start_note', el).value.trim(), middle_note: $('#ed_middle_note', el).value.trim(), ending_note: $('#ed_ending_note', el).value.trim(),
    tags: $$('#edTags .chip.on', el).map(b => b.dataset.tag), has_spoilers: $('#edSpo', el).checked, watched_on: $('#edDate', el).value || null,
    is_rewatch: existing ? existing.is_rewatch : !!$('#edRew', el)?.checked, privacy: $('#edPriv', el).value,
    start_h: v.start_h, middle_h: v.middle_h, end_h: v.end_h,
  });
  const card = () => {
    const d = read();
    return reviewCardHTML({ ...d, id: 0, username: cloud.profile?.username || 'you', avatar_url: cloud.profile?.avatar_url, rank: cloud.stats?.rank || 'Popcorn', overall: Math.round(((d.start_h + d.middle_h + d.end_h * 2) / 4) * 2) / 2 || 0, created_at: new Date().toISOString(), mine: true, helpful: 0, likes: 0, comments: 0, watch_no: d.is_rewatch ? 2 : 1 }, { preview: true });
  };
  const refresh = () => {
    const n = countChars(body.value);
    const c = $('#edCount', el); c.textContent = `${n.toLocaleString()} / ${MAX.toLocaleString()}${n < MIN ? ` · ${MIN - n} more to go` : ''}`;
    c.className = n < MIN || n > MAX ? 'warn' : '';
    body.style.height = 'auto'; body.style.height = Math.min(Math.max(body.scrollHeight, 140), wide() ? 420 : 9999) + 'px';
    if (wide()) $('#edPrev', el).innerHTML = card();
    else if (!$('#edPrevPh', el).hidden) $('#edPrevPh', el).innerHTML = card();
  };
  const autosave = () => {
    dirty = true; clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      if (existing) return; saving = true; $('#edSaved', el).textContent = 'Saving…';
      try { await saveDraft(t.id, read()); $('#edSaved', el).textContent = 'Draft saved ✓'; }
      catch (e) { $('#edSaved', el).textContent = 'Draft saved on this device'; }
      saving = false; dirty = false;
    }, 2500);
  };
  refresh();

  // text formatting buttons keep the selection (pointerdown is cancelled)
  $$('.redtools [data-fx]', el).forEach(b => {
    b.addEventListener('pointerdown', e => e.preventDefault());
    b.onclick = () => {
      const fx = b.dataset.fx, mark = fx === 'b' ? '**' : fx === 'i' ? '*' : '||';
      let s = body.selectionStart, e = body.selectionEnd; const txt = body.value;
      if (s === e) { if (fx === 's') { toast('Select the spoiler text first, then tap 🙈.'); return; } }
      const sel = txt.slice(s, e) || (fx === 'b' ? 'bold text' : 'italic text');
      body.value = txt.slice(0, s) + mark + sel + mark + txt.slice(e);
      body.focus(); body.setSelectionRange(s + mark.length, s + mark.length + sel.length);
      refresh(); autosave();
    };
  });
  $('#edPrevBtn', el).onclick = e => {
    const ph = $('#edPrevPh', el), on = ph.hidden; ph.hidden = !on; e.currentTarget.setAttribute('aria-pressed', on); if (on) refresh();
  };
  el.addEventListener('input', e => { if (e.target.matches('input,textarea,select')) { if (!err.hidden) err.hidden = true; refresh(); autosave(); } });
  el.addEventListener('change', () => { refresh(); autosave(); });
  $$('#edTags .chip', el).forEach(c => c.onclick = () => {
    const on = !c.classList.contains('on');
    if (on && $$('#edTags .chip.on', el).length >= 8) { toast('Up to 8 tags.'); return; }
    c.classList.toggle('on', on); c.setAttribute('aria-pressed', on); buzz(6); refresh(); autosave();
  });
  $$('[data-hk]', el).forEach(b => b.onclick = () => {
    const k = b.dataset.hk, n = +b.dataset.hv;
    if (!v.start_h && !v.middle_h && !v.end_h) { v.start_h = v.middle_h = v.end_h = n; }
    v[k] = n; $$('[data-hk]', el).forEach(x => { const on = v[x.dataset.hk] >= +x.dataset.hv; x.classList.toggle('on', on); x.setAttribute('aria-checked', v[x.dataset.hk] === +x.dataset.hv); });
    buzz(8); refresh(); autosave();
  });
  el.addEventListener('click', e => { const s = e.target.closest('.spo'); if (s && !s.classList.contains('shown')) s.classList.add('shown'); });

  const close = async (posted) => {
    clearTimeout(saveTimer);
    if (!posted && !existing && (dirty || saving)) { try { await saveDraft(t.id, read()); toast('Draft saved. Find it on your Me page.'); } catch (e) { /* kept on device */ } }
    window.removeEventListener('keydown', onKey, true);
    el.remove(); document.documentElement.classList.remove('locked');
  };
  const onKey = e => { if (e.key === 'Escape' && !$('#sheet')) { e.preventDefault(); e.stopPropagation(); close(false); } };
  window.addEventListener('keydown', onKey, true);
  $('#edClose', el).onclick = () => close(false);

  /* ---- Check, then post ---- */
  const showErr = m => { err.textContent = m; err.hidden = !m; if (m) err.focus(); };
  const go = async () => {
    showErr('');
    const d = read();
    if (!d.start_h || !d.middle_h || !d.end_h) return showErr('Please rate the Start, Middle and Ending first.');
    const n = countChars(d.body);
    if (n < MIN) return showErr(`Reviews need at least ${MIN} characters. ${MIN - n} more to go!`);
    if (n > MAX) return showErr(`Reviews can be up to ${MAX.toLocaleString()} characters.`);
    const btn = $('#edPost', el); btn.disabled = true; btn.textContent = 'Checking…';
    let chk;
    try { chk = await precheck({ ...d, id: existing?.id || '' }); }
    catch (x) { btn.disabled = false; btn.textContent = existing ? 'Save' : 'Post'; return showErr(x.message); }
    btn.disabled = false; btn.textContent = existing ? 'Save' : 'Post';
    if (chk.block) return showErr(chk.block);
    // auto-hide sentences that look like spoilers (the writer can undo)
    let hid = 0; undoText = null;
    if (!d.has_spoilers && chk.spoilers?.length) {
      undoText = body.value; let txt = body.value;
      chk.spoilers.forEach(s => { if (s && txt.includes(s) && !txt.includes('||' + s + '||')) { txt = txt.replace(s, `||${s}||`); hid++; } });
      if (hid) { body.value = txt; refresh(); } else undoText = null;
    }
    const tier = chk.score >= 60 ? 'great' : chk.score >= 35 ? 'ok' : 'low';
    $('#edCheck', el).innerHTML = `<div class="card rcheck ${tier}" role="status">
      <div class="h3" style="font-size:17px">${tier === 'great' ? '🌟 Looks great!' : tier === 'ok' ? '👍 Good to go' : '💡 Quick tip before you post'}</div>
      <div class="qbar" aria-label="Quality ${chk.score} out of 100"><i style="width:${chk.score}%"></i></div>
      <div class="sub">Quality ${chk.score}/100 · ${existing ? 'XP was given when you first posted' : `you'll earn <b>+${chk.xp} XP</b>`}</div>
      ${chk.tips?.length ? `<ul class="tips">${chk.tips.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${hid ? `<div class="spohid">🙈 We hid ${hid} sentence${hid > 1 ? 's' : ''} that might be a spoiler. <button type="button" class="see" id="edUndo">Undo</button></div>` : ''}
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px"><button class="btn" id="edDo">${existing ? 'Save changes' : 'Post it'}</button><button class="btn ghost" id="edMore">Keep editing</button></div></div>`;
    $('#edCheck', el).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('#edMore', el).onclick = () => { $('#edCheck', el).innerHTML = ''; body.focus(); };
    if (hid) $('#edUndo', el).onclick = () => { body.value = undoText; undoText = null; refresh(); $('#edUndo', el).parentElement.textContent = 'OK, those sentences are not hidden.'; };
    $('#edDo', el).onclick = async e => {
      const b = e.currentTarget; b.disabled = true; b.textContent = existing ? 'Saving…' : 'Posting…';
      try {
        const out = existing ? await editReview(existing.id, read()) : await postReview(read());
        if (!existing && !U.ratings[t.id]) saveRating(t.id, { start: d.start_h, middle: d.middle_h, end: d.end_h });
        await dropDraft(t.id).catch(() => {});
        const r = b.getBoundingClientRect(); hearts(r.x + r.width / 2, r.y, 14); buzz([15, 30, 15]);
        if (out.privacy === 'private' && read().privacy !== 'private') toast('Only you can see it until you confirm your email.');
        delete state[t.id]; await close(true);
        if (out.status === 'pending' || out.status === 'held') await showCheck(out, t, !!existing);
        else {
          if (!existing && out.xp >= 20) confetti(60);
          toast(existing ? 'Review updated! ✏️' : out.xp ? `Posted! +${out.xp} XP 💓` : 'Posted! 💓');
          aiCheck(out.id).catch(() => {});   // the server may also check it in the background
        }
        onChange();
      } catch (x) { b.disabled = false; b.textContent = existing ? 'Save changes' : 'Post it'; showErr(x.message); }
    };
  };
  $('#edPost', el).onclick = go;
  setTimeout(() => (ratedAlready ? body : $('[data-hk]', el)).focus(), 60);
}

/* =====================================================================
   AI check: result after posting, and the status on my own review cards
   ===================================================================== */
const checkingHTML = () => `<div class="aibig spin" aria-hidden="true">🤖</div><h2 class="h3">Checking your review…</h2>
  <p class="sub">This takes a few seconds. We check that it's kind, real and about the movie or show.</p>`;
function resultHTML(r, edited) {
  const tips = (r.tips || []).filter(Boolean);
  const tipsHTML = tips.length ? `<ul class="tips">${tips.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  if (r.status === 'ok' || r.status === 'tips') {
    const q = r.score ?? null;
    return `<div class="aibig" aria-hidden="true">${q >= 60 ? '🌟' : '💓'}</div><h2 class="h3">${edited ? 'Review updated!' : 'Posted!'}${r.xp ? ` +${r.xp} XP` : ''}</h2>
      ${q != null ? `<div class="qbar" aria-label="Quality ${q} out of 100"><i style="width:${q}%"></i></div>
      <div class="sub">Quality ${q}/100${!edited && r.xp && r.xp < 20 ? ' · Great reviews earn up to +20 XP' : ''}</div>` : ''}
      ${tipsHTML}${r.hidden_spoilers ? `<div class="spohid">🙈 We hid ${r.hidden_spoilers} spoiler sentence${r.hidden_spoilers > 1 ? 's' : ''} behind "Tap to reveal". Edit your review to change it.</div>` : ''}
      <button class="btn big" id="aiDone">Nice!</button>`;
  }
  if (r.status === 'held') return `<div class="aibig" aria-hidden="true">👀</div><h2 class="h3">A person will check it soon</h2>
      ${r.note ? `<p class="sub">${esc(r.note)}</p>` : ''}<p class="sub">Only you can see it until then. You'll get your XP when it's approved.</p>
      <button class="btn big" id="aiDone">OK</button>`;
  if (r.status === 'blocked') return `<div class="aibig" aria-hidden="true">🚫</div><h2 class="h3">Not posted yet</h2>
      <p class="sub"><b>${esc(r.note || 'It breaks the community rules.')}</b></p>
      <p class="sub">You can change it and post again. If you think our robot made a mistake, ask a person to look.</p>
      <div class="aibtns"><button class="btn" id="aiEdit">✏️ Change it</button><button class="btn ghost" id="aiAppeal">🙋 Ask a person</button></div>`;
  return `<div class="aibig" aria-hidden="true">⏳</div><h2 class="h3">Saved! Still checking</h2>
      <p class="sub">Our robot is busy right now. Your review will be checked soon. Only you can see it until then.</p>
      <button class="btn big" id="aiDone">OK</button>`;
}
async function reviewById(id) {
  const { data } = await cloud.sb.from('reviews').select('id,title_key,headline,body,start_note,middle_note,ending_note,tags,has_spoilers,is_rewatch,watch_no,watched_on,privacy,start_h,middle_h,end_h,overall')
    .eq('id', id).maybeSingle();
  return data ? { ...data, mine: true } : null;
}
async function showCheck(out, t, edited) {
  sheet(`<div class="aichk" id="aiChk" role="status" aria-live="polite">${checkingHTML()}</div>`);
  let res = out;
  if (out.status === 'pending') {
    try {
      const d = await aiCheck(out.id);
      if (d.ai === false) { await syncReviews().catch(() => {}); res = { ...out, status: 'ok', xp: edited ? 0 : out.xp_later }; }
      else res = { ...out, ...d.result };
      if (res.status === 'unchanged') res.status = 'pending';
    } catch (e) { res = { ...out, status: 'pending' }; }
  }
  const box = $('#aiChk'); if (!box) return;
  box.innerHTML = resultHTML(res, edited);
  if (res.xp >= 20) confetti(60);
  const done = $('#aiDone', box); if (done) { done.onclick = () => closeSheet(); done.focus(); }
  const ed = $('#aiEdit', box);
  if (ed) ed.onclick = async () => { const rv = await reviewById(res.id); closeSheet(); if (rv) openEditor(t, rv); };
  const ap = $('#aiAppeal', box); if (ap) ap.onclick = () => openAppeal({ id: res.id }, () => { delete state[t.id]; onChange(); });
  onChange();
}
function statusStrip(r) {
  const st = r.ai_status;
  if (!st || st === 'ok') return '';
  if (st === 'tips') return r.ai_tips?.length ? `<div class="aistrip tip">💡 ${esc(r.ai_tips[0])}</div>` : '';
  if (st === 'pending') return `<div class="aistrip wait" role="status">🤖 Checking your review… Only you can see it for now.</div>`;
  if (st === 'held') return `<div class="aistrip wait" role="status">👀 A person will check it soon. Only you can see it.${r.ai_note ? `<div class="sub">${esc(r.ai_note)}</div>` : ''}</div>`;
  const ap = r.appeal;
  return `<div class="aistrip no" role="note"><b>🚫 Not posted.</b> ${esc(r.ai_note || 'It breaks the community rules.')}
    <div class="aibtns"><button type="button" class="btn sm" data-act="edit">✏️ Change it</button>${ap === 'open' ? '<span class="sub">🙋 A person will look at it again.</span>'
      : ap === 'upheld' ? '<span class="sub">A person checked it again and kept it hidden.</span>' : '<button type="button" class="btn sm ghost" data-act="appeal">🙋 Ask a person</button>'}</div></div>`;
}
function openAppeal(r, after) {
  const sh = sheet(`<h2 class="h3" style="font-size:20px;margin:0 0 6px">🙋 Ask a person to look</h2>
    <p class="sub">Tell us why it should be posted. A moderator will read your review again.</p>
    <label class="fld"><span>Why? (you can skip this)</span><textarea id="apN" maxlength="300" rows="3" placeholder="Like: I meant the villain in the movie, not a real person."></textarea></label>
    <p class="errmsg" id="apE" role="alert" hidden></p>
    <button class="btn big" id="apGo">Send</button>`);
  $('#apGo', sh).onclick = async () => {
    try { await appealReview(r.id, $('#apN', sh).value.trim()); closeSheet(); toast('Sent! A person will look at it. 🙋'); r.appeal = 'open'; after?.(); }
    catch (e) { const x = $('#apE', sh); x.textContent = e.message; x.hidden = false; }
  };
}
/* My reviews that still wait for the AI: ask for the check again (once per page visit). */
const kicked = new Set();
async function kickPending(items, after) {
  const p = (items || []).filter(r => r.ai_status === 'pending' && !kicked.has(r.id)).slice(0, 2);
  if (!p.length || !cloud.user) return;
  p.forEach(r => kicked.add(r.id));
  await syncReviews().catch(() => {});
  for (const r of p) await aiCheck(r.id).catch(() => {});
  after();
}

/* =====================================================================
   Review card
   ===================================================================== */
export function reviewCardHTML(r, { preview = false, showTitle = false } = {}) {
  const long = (r.body || '').length > 420 || (r.body || '').split('\n').length > 6;
  const open = expanded.has(r.id) || preview, show = revealed.has(r.id);
  const wholeSpoiler = r.has_spoilers && !/\|\|/.test(r.body || '');
  const t = showTitle ? BYID[idOf(r.title_key)] : null;
  const notes = [['Start', r.start_note], ['Middle', r.middle_note], ['Ending', r.ending_note]].filter(x => x[1]);
  return `<article class="rcard ${r.top_critic ? 'critic' : ''} ${r.friend ? 'friend' : ''}" data-rid="${r.id}">
    <header class="rch">
      ${r.username && !preview ? `<a href="#/u/${encodeURIComponent(r.username)}" class="ravl" tabindex="-1" aria-hidden="true">${avatar(r, 'sm', 'rav')}</a>` : avatar(r, 'sm', 'rav')}
      <div class="rwho">${r.username && !preview ? `<a href="#/u/${encodeURIComponent(r.username)}"><b>@${esc(r.username)}</b></a>` : `<b>@${esc(r.username || 'someone')}</b>`}${r.top_critic ? ' <span class="crit" title="Top Critic">⭐ Top Critic</span>' : ''}${r.friend ? ' <span class="frd">Friend</span>' : ''}
        <div class="meta">${esc(r.rank || 'Popcorn')} · ${r.created_at ? ago(r.created_at) : ''}${r.edited ? ' · Edited' : ''}${r.mine && r.privacy && r.privacy !== 'public' ? ` · ${PRIVACY[r.privacy][0]} ${PRIVACY[r.privacy][1]}` : ''}</div></div>
      <div class="rscore">${r.start_h ? miniGraph(r.start_h, r.middle_h, r.end_h) : ''}<b>★ ${r.overall || '–'}</b></div>
    </header>
    ${r.mine ? statusStrip(r) : ''}
    ${t ? `<a class="rtitle" href="#/t/${esc(t.id)}">${esc(t.name)}</a>` : r.title_key && showTitle ? `<a class="rtitle" href="#/t/${esc(idOf(r.title_key))}">Open title</a>` : ''}
    <div class="rlabels">${r.is_rewatch ? `<span class="pill2">🔁 ${ordinal(r.watch_no || 2)} watch</span>` : ''}${r.watched_on ? `<span class="pill2">📅 ${esc(new Date(r.watched_on + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))}</span>` : ''}${(r.tags || []).map(x => `<span class="pill2 tag">${esc(x)}</span>`).join('')}</div>
    ${r.headline ? `<h3 class="rhead">${esc(r.headline)}</h3>` : ''}
    <div class="rbody-wrap ${wholeSpoiler && !show && !preview ? 'blurred' : ''}">
      <div class="rbody ${long && !open ? 'clamp6' : ''}">${fmt(r.body, { revealAll: show })}</div>
      ${notes.length ? `<dl class="rnotes">${notes.map(([l, n]) => `<div><dt>${l}</dt><dd>${fmt(n, { revealAll: show })}</dd></div>`).join('')}</dl>` : ''}
      ${wholeSpoiler && !show && !preview ? `<button class="spocover" type="button" data-reveal="${r.id}">🙈 Contains spoilers · <u>Tap to reveal</u></button>` : ''}
    </div>
    ${long && !open ? `<button class="see more" type="button" data-more="${r.id}">Read more</button>` : ''}
    ${preview ? '' : `<footer class="ract">
      <button type="button" class="rbtn ${r.my_helpful ? 'on' : ''}" data-act="helpful" aria-pressed="${!!r.my_helpful}" ${r.mine ? 'disabled title="You can\'t vote on your own review"' : ''}>👍 Helpful${r.helpful ? ` · ${r.helpful}` : ''}</button>
      <button type="button" class="rbtn ${r.my_like ? 'on' : ''}" data-act="like" aria-pressed="${!!r.my_like}" aria-label="Like" ${r.mine ? 'disabled' : ''}>${r.my_like ? '❤️' : '♡'}${r.likes ? ` ${r.likes}` : ''}</button>
      <button type="button" class="rbtn" data-act="comments" aria-label="Comments">💬${r.comments ? ` ${r.comments}` : ''}</button>
      <button type="button" class="rbtn" data-act="share" aria-label="Share as image">📤</button>
      <button type="button" class="rbtn" data-act="more" aria-label="More options">⋯</button>
    </footer>`}
  </article>`;
}

/* =====================================================================
   Reviews section on a title page
   ===================================================================== */
const SORTS = [['helpful', 'Most helpful'], ['new', 'Newest'], ['friends', 'Friends first'], ['critics', 'Top Critics']];
export function reviewsSectionHTML(t) {
  if (!cloud.ready) return '';
  let s = state[t.id];
  const uid = cloud.user?.id || null;   // a different person signed in: forget the old list
  if (!s || s.uid !== uid) s = state[t.id] = { sort: s?.sort || 'helpful', min: 0, max: 5, items: null, uid };
  const mine = mineFor(t.id);
  return `<section class="card span2 revsec" id="revsec" aria-labelledby="revh">
    <div class="revtop"><h2 class="h3" id="revh">✍️ Reviews</h2>
      <button class="btn sm" id="writeBtn2">${mine ? '✏️ Edit my review' : '✍️ Write a review'}</button></div>
    <div class="revctl">
      <div class="chips" role="group" aria-label="Sort reviews">${SORTS.map(([k, l]) => `<button type="button" class="chip ${s.sort === k ? 'on' : ''}" aria-pressed="${s.sort === k}" data-sort="${k}">${l}</button>`).join('')}</div>
      <label class="rfilter"><span class="sr-only">Filter by rating</span><select id="revFilter">
        ${[['0-5', 'All ratings'], ['4.5-5', '★ 4.5 – 5'], ['3.5-4', '★ 3.5 – 4'], ['2.5-3', '★ 2.5 – 3'], ['0-2', '★ 2 or less']].map(([k, l]) => `<option value="${k}" ${`${s.min}-${s.max}` === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select></label>
    </div>
    <div id="revlist" aria-live="polite">${s.items ? listHTML(t, s) : '<div class="rskel"></div><div class="rskel"></div>'}</div>
  </section>`;
}
function listHTML(t, s) {
  if (s.error) return `<div class="sub">${esc(s.error)}</div>`;
  if (!s.items.length) return `<div class="mascot" style="padding:14px">${mascot('happy')}<div>No reviews yet${s.min || s.max < 5 ? ' with that rating' : ''}. Be the first to say why!</div></div>`;
  return s.items.map(r => reviewCardHTML(r)).join('') + (s.more ? `<button class="btn ghost sm" id="revMore" style="margin-top:10px">Show more reviews</button>` : '');
}
export async function loadReviews(root, t, force = false) {
  const s = state[t.id]; if (!s || !cloud.ready) return;
  if (s.items && !force) { wireReviews(root, t); if (Date.now() - (s.at || 0) < 15000) return; }
  s.at = Date.now();
  try {
    const items = await listReviews(t.id, s.sort, s.min, s.max, 0);
    s.items = items; s.more = items.length >= 20; s.error = null;
    kickPending(items.filter(r => r.mine), () => loadReviews(root, t, true));
  } catch (e) { s.items = s.items || []; s.error = e.message; }
  const list = $('#revlist', root); if (!list) return;
  list.innerHTML = listHTML(t, s);
  const wb = $('#writeBtn2', root); if (wb) wb.innerHTML = mineFor(t.id) ? '✏️ Edit my review' : '✍️ Write a review';
  const wb1 = $('#writeBtn', root); if (wb1) wb1.innerHTML = mineFor(t.id) ? '✏️ Edit my review' : '✍️ Write a review';
  wireReviews(root, t);
}
function wireReviews(root, t) {
  const sec = $('#revsec', root); if (!sec || sec.dataset.wired) return; sec.dataset.wired = 1;
  const s = state[t.id];
  $('#writeBtn2', sec).onclick = () => openEditor(t);
  $$('[data-sort]', sec).forEach(b => b.onclick = () => { s.sort = b.dataset.sort; $$('[data-sort]', sec).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); loadReviews(root, t, true); });
  $('#revFilter', sec).onchange = e => { const [a, b] = e.target.value.split('-').map(Number); s.min = a; s.max = b; loadReviews(root, t, true); };
  sec.addEventListener('click', async e => {
    const more = e.target.closest('[data-more]'); if (more) { expanded.add(+more.dataset.more); rerenderCard(sec, t, +more.dataset.more); return; }
    const rv = e.target.closest('[data-reveal]'); if (rv) { revealed.add(+rv.dataset.reveal); rerenderCard(sec, t, +rv.dataset.reveal); return; }
    const spo = e.target.closest('.spo'); if (spo) { spo.classList.add('shown'); spo.setAttribute('aria-label', 'Spoiler shown'); return; }
    if (e.target.closest('#revMore')) {
      const extra = await listReviews(t.id, s.sort, s.min, s.max, s.items.length).catch(() => []);
      s.items = s.items.concat(extra); s.more = extra.length >= 20; $('#revlist', sec).innerHTML = listHTML(t, s); return;
    }
    const a = e.target.closest('[data-act]'); if (!a) return;
    const id = +a.closest('[data-rid]').dataset.rid, r = s.items.find(x => x.id === id); if (!r) return;
    await cardAction(a.dataset.act, r, t, a, () => rerenderCard(sec, t, id), () => loadReviews(root, t, true));
  });
}
function rerenderCard(sec, t, id) {
  const r = state[t.id].items.find(x => x.id === id), old = $(`[data-rid="${id}"]`, sec);
  if (r && old) old.outerHTML = reviewCardHTML(r);
}

/* ---- actions shared by title page + My Reviews ---- */
async function cardAction(act, r, t, btn, redraw, reload) {
  if (act === 'share') {
    try { const how = await shareReviewImage(t || { name: 'Heartbeat', year: '', type: 'movie', colors: ['#2b0d4f', '#ff4f9a'] }, r); toast(how === 'shared' ? 'Shared! 📤' : 'Image saved! Post it to your story 📸'); }
    catch (e) { if (e.name !== 'AbortError') toast('Could not make the image.', 'sad'); }
    return;
  }
  if (act === 'more') return moreMenu(r, t, redraw, reload);
  if (act === 'edit') return openEditor(t || BYID[idOf(r.title_key)] || { id: idOf(r.title_key), name: 'this title' }, r);
  if (act === 'appeal') return openAppeal(r, reload);
  if (act === 'comments') return openComments(r, redraw);
  if (needAccount(act === 'helpful' ? 'Mark reviews helpful' : 'Like reviews')) return;
  try {
    const out = await vote(r.id, act);
    r.helpful = out.helpful; r.likes = out.likes;
    if (act === 'helpful') r.my_helpful = out.on; else r.my_like = out.on;
    if (out.on) { const b = btn.getBoundingClientRect(); hearts(b.x + b.width / 2, b.y, act === 'like' ? 8 : 4); buzz(8); }
    redraw();
  } catch (e) { toast(e.message, 'sad'); }
}
function moreMenu(r, t, redraw, reload) {
  const mine = r.mine;
  sheet(`<h2 class="h3" style="font-size:20px;margin:0 0 10px">${mine ? 'Your review' : 'Review options'}</h2>
    <div class="menu">
      ${mine ? `<button class="mitem" id="mEdit">✏️ Edit review</button><button class="mitem danger" id="mDel">🗑️ Delete review</button>` : ''}
      <button class="mitem" id="mChat">💬 Send to a friend</button>
      <button class="mitem" id="mCopy">🔗 Copy link</button>
      ${mine ? '' : `<button class="mitem danger" id="mRep">🚩 Report review</button>`}
    </div>`);
  $('#mChat').onclick = () => { closeSheet(); const tt = t || BYID[idOf(r.title_key)]; if (tt) sendTitleToChat(tt); else titleFor(r.title_key).then(x => x && sendTitleToChat(x)); };
  $('#mCopy').onclick = async () => { closeSheet(); const u = location.origin + '/#/t/' + idOf(r.title_key || keyOf(t?.id)); try { await navigator.clipboard.writeText(u); toast('Link copied!'); } catch (e) { toast(u); } };
  if (mine) {
    $('#mEdit').onclick = () => { closeSheet(); openEditor(t || BYID[idOf(r.title_key)] || { id: idOf(r.title_key), name: 'this title' }, r); };
    $('#mDel').onclick = () => {
      sheet(`<h2 class="h3" style="font-size:20px">Delete this review?</h2><p class="sub">This can't be undone. Your journey rating stays.</p>
        <div style="display:flex;gap:10px;margin-top:12px"><button class="btn danger-btn" id="dYes">Delete</button><button class="btn ghost" id="dNo">Keep it</button></div>`);
      $('#dNo').onclick = () => closeSheet();
      $('#dYes').onclick = async () => { try { await deleteReview(r.id); closeSheet(); toast('Review deleted.'); reload(); onChange(); } catch (e) { toast(e.message, 'sad'); } };
    };
  } else $('#mRep').onclick = () => openReport(r.id, null);
}
function openReport(reviewId, commentId) {
  if (needAccount('Report')) return;
  const R = [['spam', 'Spam or ads'], ['spoilers', 'Spoilers not hidden'], ['hate', 'Hate'], ['harassment', 'Harassment or bullying'], ['other', 'Something else']];
  sheet(`<h2 class="h3" style="font-size:20px;margin:0 0 4px">🚩 Report ${commentId ? 'comment' : 'review'}</h2><p class="sub">Thanks for keeping Heartbeat kind. What's wrong?</p>
    <div class="menu" role="radiogroup">${R.map(([k, l], i) => `<label class="mitem radio"><input type="radio" name="rr" value="${k}" ${i ? '' : 'checked'}> ${l}</label>`).join('')}</div>
    <label class="fld" style="margin-top:8px"><span>More details <small class="hint" style="display:inline">(optional)</small></span><input id="rNote" maxlength="300"></label>
    <button class="btn" id="rSend">Send report</button>`);
  $('#rSend').onclick = async e => {
    e.currentTarget.disabled = true;
    try { await report(reviewId, commentId, $('[name=rr]:checked').value, $('#rNote').value.trim()); closeSheet(); toast('Report sent. Thank you! 💓'); }
    catch (x) { e.currentTarget.disabled = false; toast(x.message, 'sad'); }
  };
}

/* ---- comments (replies one level deep) ---- */
async function openComments(r, redraw) {
  let replyTo = null;
  const sh = sheet(`<h2 class="h3" style="font-size:20px;margin:0 0 8px">💬 Comments</h2><div id="cList" class="clist"><div class="rskel"></div></div>
    <form id="cForm" class="cform"><div class="sub" id="cTo" hidden></div>
      <div style="display:flex;gap:8px"><input id="cIn" maxlength="1000" placeholder="${cloud.user ? 'Add a comment…' : 'Sign in to comment'}" ${cloud.user ? '' : 'disabled'} aria-label="Write a comment"><button class="btn sm" ${cloud.user ? '' : 'disabled'}>Send</button></div></form>`);
  const draw = async () => {
    const list = await listComments(r.id).catch(e => { toast(e.message, 'sad'); return []; });
    const top = list.filter(c => !c.parent_id), kids = id => list.filter(c => c.parent_id === id);
    const one = (c, child) => `<div class="cmt ${child ? 'child' : ''}" data-cid="${c.id}">${avatar(c, 'xs')}
      <div style="flex:1;min-width:0"><a href="#/u/${encodeURIComponent(c.username || '')}"><b>@${esc(c.username)}</b></a> <span class="meta">${esc(c.rank || '')} · ${ago(c.created_at)}</span><div class="cbody">${fmt(c.body)}</div>
      <div class="cact">${child ? '' : `<button type="button" class="see" data-reply="${c.id}" data-who="${esc(c.username)}">Reply</button>`}${c.mine ? `<button type="button" class="see" data-cdel="${c.id}">Delete</button>` : `<button type="button" class="see" data-crep="${c.id}">Report</button>`}</div></div></div>`;
    $('#cList', sh).innerHTML = top.length ? top.map(c => one(c) + kids(c.id).map(k => one(k, true)).join('')).join('') : `<div class="sub" style="padding:8px 0">No comments yet. Say something nice!</div>`;
    r.comments = list.length; redraw();
  };
  draw();
  sh.addEventListener('click', async e => {
    const rp = e.target.closest('[data-reply]'); if (rp) { replyTo = +rp.dataset.reply; const to = $('#cTo', sh); to.hidden = false; to.innerHTML = `Replying to @${esc(rp.dataset.who)} · <button type="button" class="see" id="cNo">Cancel</button>`; $('#cIn', sh).focus(); return; }
    if (e.target.id === 'cNo') { replyTo = null; $('#cTo', sh).hidden = true; return; }
    const del = e.target.closest('[data-cdel]'); if (del) { try { await deleteComment(+del.dataset.cdel); draw(); } catch (x) { toast(x.message, 'sad'); } return; }
    const rep = e.target.closest('[data-crep]'); if (rep) { openReport(r.id, +rep.dataset.crep); }
  });
  $('#cForm', sh).onsubmit = async e => {
    e.preventDefault(); const inp = $('#cIn', sh), txt = inp.value.trim(); if (!txt) return;
    if (needAccount('Comment')) return;
    inp.disabled = true;
    try { await addComment(r.id, txt, replyTo); inp.value = ''; replyTo = null; $('#cTo', sh).hidden = true; await draw(); }
    catch (x) { toast(x.message, 'sad'); }
    inp.disabled = false; inp.focus();
  };
}

/* =====================================================================
   Me page bits + My Reviews page
   ===================================================================== */
export function meReviewsCardHTML() {
  if (!cloud.user) return '';
  return `<section class="card span2" id="meRev"><div class="revtop"><h2 class="h3">✍️ My reviews</h2><a class="btn sm ghost" href="#/myreviews">See all</a></div>
    <div id="meDrafts" class="sub">Loading drafts…</div></section>`;
}
export async function fillMeReviews(root) {
  const box = $('#meDrafts', root); if (!box) return;
  const drafts = await allDrafts().catch(() => []);
  if (!$('#meDrafts', root)) return;
  box.className = '';
  box.innerHTML = drafts.length ? `<div class="sub" style="font-weight:900;margin:4px 0 8px">📝 Drafts (${drafts.length})</div>
    <div class="drafts">${drafts.map(d => { const id = idOf(d.key), t = BYID[id]; return `<button class="draft" type="button" data-draft="${esc(id)}"><b>${esc(t?.name || 'A title')}</b><span class="sub">${esc((d.data?.body || '').replace(/\|\||\*\*?/g, '').slice(0, 80) || 'Empty draft')}</span><span class="meta">${ago(new Date(d.at).toISOString())}</span></button>`; }).join('')}</div>`
    : `<div class="sub">No drafts. Your reviews save as drafts while you write, so nothing gets lost.</div>`;
  $$('[data-draft]', box).forEach(b => b.onclick = async () => {
    const id = b.dataset.draft; let t = BYID[id];
    if (!t) { const { loadTitle } = await import('../tmdb.js'); t = await loadTitle(id); }
    if (t) openEditor(t); else toast('Could not open that title.', 'sad');
  });
}

export async function renderMyReviews(app) {
  document.title = 'My reviews — Heartbeat';
  if (!cloud.user) { app.innerHTML = `<div class="screen"><div class="back-row"><a class="icon-btn" href="#/me" aria-label="Back">←</a><h1>My reviews</h1></div><div class="mascot">${mascot('happy')}<div>Sign in to see your reviews.<br><a class="see" href="#/signin">Sign in</a></div></div></div>`; return; }
  const st = renderMyReviews.st || (renderMyReviews.st = { q: '', sort: 'new', priv: 'all' });
  app.innerHTML = `<div class="screen myrev">
    <div class="back-row"><a class="icon-btn" href="#/me" aria-label="Back to Me">←</a><h1>✍️ My reviews</h1></div>
    <div class="myctl">
      <label class="searchbar" style="margin:0;width:auto;flex:1;min-width:200px"><span aria-hidden="true">🔎</span><input id="mrq" type="search" placeholder="Search my reviews" value="${esc(st.q)}" aria-label="Search my reviews"></label>
      <select id="mrs" aria-label="Sort"><option value="new">Newest</option><option value="helpful">Most helpful</option><option value="rating">Highest rated</option></select>
      <div class="chips" role="group" aria-label="Who can see">${[['all', 'All'], ...Object.entries(PRIVACY).map(([k, [e, l]]) => [k, `${e} ${l}`])].map(([k, l]) => `<button type="button" class="chip ${st.priv === k ? 'on' : ''}" data-pv="${k}" aria-pressed="${st.priv === k}">${l}</button>`).join('')}</div>
    </div>
    <div id="mrlist"><div class="rskel"></div></div></div>`;
  $('#mrs').value = st.sort;
  let items = [];
  const draw = () => {
    const list = items.filter(r => st.priv === 'all' || r.privacy === st.priv);
    // group rewatches as a timeline under each title
    const groups = {}; list.forEach(r => (groups[r.title_key] = groups[r.title_key] || []).push(r));
    $('#mrlist').innerHTML = list.length ? Object.entries(groups).map(([k, rs]) => {
      rs.sort((a, b) => a.watch_no - b.watch_no);
      const t = BYID[idOf(k)];
      return `<div class="mrgroup"><div class="mrhead">${t ? `<a href="#/t/${esc(t.id)}"><b>${esc(t.name)}</b></a>` : `<a href="#/t/${esc(idOf(k))}"><b>Open title</b></a>`}
        ${rs.length > 1 ? `<span class="timeline">${rs.map(r => `${ordinal(r.watch_no)} watch`).join(' → ')}</span>` : ''}</div>
        ${rs.map(r => reviewCardHTML({ ...r, mine: true, username: cloud.profile?.username, avatar_url: cloud.profile?.avatar_url, rank: cloud.stats?.rank, helpful: r.helpful_count, likes: r.like_count, comments: r.comment_count })).join('')}</div>`;
    }).join('') : `<div class="mascot">${mascot('happy')}<div>${items.length ? 'Nothing matches.' : 'No reviews yet. Rate a title, then tell people why!'}</div></div>`;
  };
  const load = async () => { try { items = await myReviews(st.q, st.sort); } catch (e) { items = []; toast(e.message, 'sad'); } draw(); kickPending(items, load); };
  let tm; $('#mrq').oninput = e => { st.q = e.target.value; clearTimeout(tm); tm = setTimeout(load, 250); };
  $('#mrs').onchange = e => { st.sort = e.target.value; load(); };
  $$('[data-pv]').forEach(b => b.onclick = () => { st.priv = b.dataset.pv; $$('[data-pv]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); draw(); });
  $('#mrlist').addEventListener('click', async e => {
    const more = e.target.closest('[data-more]'); if (more) { expanded.add(+more.dataset.more); draw(); return; }
    const rv = e.target.closest('[data-reveal]'); if (rv) { revealed.add(+rv.dataset.reveal); draw(); return; }
    const spo = e.target.closest('.spo'); if (spo) { spo.classList.add('shown'); return; }
    const a = e.target.closest('[data-act]'); if (!a) return;
    const id = +a.closest('[data-rid]').dataset.rid, r = items.find(x => x.id === id); if (!r) return;
    r.username = cloud.profile?.username; r.avatar_url = cloud.profile?.avatar_url; r.mine = true;
    const t = BYID[idOf(r.title_key)];
    await cardAction(a.dataset.act, r, t, a, draw, load);
  });
  setReviewsChanged(load);
  load();
}
