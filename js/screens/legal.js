// Part 9: legal pages, Help & legal hub, Contact us, and the "agree to the Terms" prompt.
//   #/legal  #/terms  #/privacy  #/guidelines  #/contact
import { cloud, plain } from '../cloud.js';
import { $, esc, toast, sheet, closeSheet, empty } from '../ui.js';
import { LEGAL, DOCS } from '../legal.js';

const nice = v => new Date(v + 'T12:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function renderLegalDoc(app, which) {
  const d = DOCS[which];
  if (!d) { location.hash = '#/legal'; return; }
  document.title = `${d.title} — Heartbeat`;
  app.innerHTML = `<div class="screen legal"><header class="top"><a class="icon-btn" href="#/legal" aria-label="Back to Help and legal"><i class="i i-arrow-left" aria-hidden="true"></i></a>
      <h1 class="logo" style="font-size:24px;margin:0">${d.icon} ${d.title}</h1><span></span></header>
    <p class="meta lgdate">Last updated ${nice(LEGAL.version)}</p>
    <section class="card lgsum"><h2 class="h3">The short version</h2><ul>${d.summary.map(s => `<li>${s}</li>`).join('')}</ul></section>
    <nav class="card lgtoc" aria-label="On this page"><b>On this page</b><ol>${d.sections.map(([h]) => `<li><a href="#/${which}" data-go="${slug(h)}">${esc(h)}</a></li>`).join('')}</ol></nav>
    ${d.sections.map(([h, ps]) => `<section class="card lgsec" id="lg-${slug(h)}"><h2 class="h3">${esc(h)}</h2>${ps.map(p => `<p>${p}</p>`).join('')}</section>`).join('')}
    <p class="meta lgfoot">Questions? <a class="see" href="#/contact">Contact us</a> · <a class="see" href="#/legal">All legal pages</a></p></div>`;
  app.querySelectorAll('[data-go]').forEach(a => a.onclick = e => {
    e.preventDefault(); const t = document.getElementById('lg-' + a.dataset.go);
    if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'start' }); t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true }); }
  });
}

export function renderLegalHub(app) {
  document.title = 'Help & legal — Heartbeat';
  const row = (href, ic, h, p) => `<a class="card linkcard" href="${href}"><span style="font-size:28px" aria-hidden="true">${ic}</span><div style="flex:1"><h2 class="h3">${h}</h2><div class="sub">${p}</div></div><span class="btn sm ghost" aria-hidden="true">Open</span></a>`;
  app.innerHTML = `<div class="screen legal"><header class="top"><a class="icon-btn" href="#/me" aria-label="Back"><i class="i i-arrow-left" aria-hidden="true"></i></a><h1 class="logo" style="font-size:24px;margin:0"><i class="i i-scroll-text" aria-hidden="true"></i> Help &amp; legal</h1><span></span></header>
    ${row('#/terms', '<i class="i i-scroll-text" aria-hidden="true"></i>', 'Terms of Service', 'The rules for using Heartbeat and Heartbeat Plus.')}
    ${row('#/privacy', '<i class="i i-lock" aria-hidden="true"></i>', 'Privacy Policy', 'What we keep, why, and your choices. We never sell your data.')}
    ${row('#/guidelines', '<i class="i i-handshake" aria-hidden="true"></i>', 'Community Guidelines', 'Be kind, hide spoilers, be honest.')}
    ${row('#/security', '<i class="i i-package" aria-hidden="true"></i>', 'Your data', 'Download everything, or delete your account.')}
    ${row('#/contact', '<i class="i i-message-circle" aria-hidden="true"></i>', 'Contact us', 'Help, privacy requests, safety, bugs.')}
    ${row('#/about', '<i class="i i-clapperboard" aria-hidden="true"></i>', 'About & credits', 'How Heartbeat works. Movie data from TMDB.')}
    <p class="meta" style="text-align:center;margin-top:10px">Last updated ${nice(LEGAL.version)}</p></div>`;
}

const TOPICS = [['help', 'Help with the app'], ['privacy', 'Privacy or my data'], ['safety', 'Safety (someone is in danger or being harmed)'], ['bug', 'Something is broken'], ['studio', 'Heartbeat for Studios'], ['legal', 'Legal or copyright'], ['other', 'Something else']];
export function renderContact(app) {
  document.title = 'Contact us — Heartbeat';
  app.innerHTML = `<div class="screen legal"><header class="top"><a class="icon-btn" href="#/legal" aria-label="Back"><i class="i i-arrow-left" aria-hidden="true"></i></a><h1 class="logo" style="font-size:24px;margin:0"><i class="i i-message-circle" aria-hidden="true"></i> Contact us</h1><span></span></header>
    <section class="card" id="ctb"></section>
    <p class="meta" style="margin:8px 4px">If someone is in danger right now, call your local emergency number first.</p></div>`;
  const box = $('#ctb', app);
  const mail = cloud.contactEmail ? `<p class="sub">You can also email us at <a class="see" href="mailto:${esc(cloud.contactEmail)}">${esc(cloud.contactEmail)}</a>.</p>` : '';
  if (!cloud.user) {
    box.innerHTML = `<p class="sub">Please sign in so we know who to answer.</p><a class="btn" href="#/signin">Sign in</a>${mail}`;
    return;
  }
  box.innerHTML = `<form id="ctf" novalidate>
      <label class="fld"><span>What is it about?</span><select id="ctt">${TOPICS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label class="fld"><span>Your message</span><textarea id="ctm" rows="5" maxlength="2000" required></textarea></label>
      <label class="fld"><span>Email to answer (optional — we use your account email if empty)</span><input id="cte" type="email" maxlength="120" autocomplete="email"></label>
      <p class="errmsg" id="cterr" role="alert" hidden></p>
      <button class="btn big" id="ctgo">Send</button></form>${mail}
    <p class="meta">For privacy requests (like GDPR or CCPA), pick "Privacy or my data". We answer within 30 days.</p>`;
  const pre = new URLSearchParams(location.hash.split('?')[1] || '').get('topic');
  if (pre && TOPICS.some(t => t[0] === pre)) $('#ctt', box).value = pre;
  $('#ctf', box).onsubmit = async e => {
    e.preventDefault(); const b = $('#ctgo', box); b.disabled = true;
    try {
      const { error } = await cloud.sb.rpc('contact_us', { p_topic: $('#ctt', box).value, p_message: $('#ctm', box).value.trim(), p_reply_to: $('#cte', box).value.trim() || null });
      if (error) throw error;
      box.innerHTML = `<p class="okmsg" role="status">Thanks! We got your message and will answer soon. <i class="i i-mail" aria-hidden="true"></i></p>`;
    } catch (x) { const er = $('#cterr', box); er.textContent = plain(x); er.hidden = false; b.disabled = false; }
  };
}

/* Ask once to agree to the current Terms & Privacy Policy (new accounts agreed when they signed up). */
let asked = false;
export async function checkTerms() {
  if (asked || !cloud.user || !cloud.sb || cloud.needsCode || cloud.needsBirthdate) return;
  asked = true;
  const { data: have } = await cloud.sb.rpc('my_terms').then(x => x, () => ({}));
  if (have && have >= LEGAL.version) return;
  let signedUpNow = false; try { signedUpNow = localStorage.getItem('hb_terms_ok') === LEGAL.version; } catch (e) { }
  if (signedUpNow) { await cloud.sb.rpc('accept_terms', { p_version: LEGAL.version }).then(() => {}, () => {}); try { localStorage.removeItem('hb_terms_ok'); } catch (e) { } return; }
  if (/^#\/(terms|privacy|guidelines|welcome|signin)/.test(location.hash)) { asked = false; return; }
  const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 6px"><i class="i i-scroll-text" aria-hidden="true"></i> ${have ? 'We updated our Terms' : 'Our Terms & Privacy Policy'}</h2>
    <p class="sub">Please read the short version and agree to keep using your account. We never sell your data, and you can download or delete it any time.</p>
    <ul class="lglinks"><li><a class="see" href="#/terms">Terms of Service</a></li><li><a class="see" href="#/privacy">Privacy Policy</a></li><li><a class="see" href="#/guidelines">Community Guidelines</a></li></ul>
    <button class="btn big" id="tok">I agree</button><button class="btn ghost big" id="tlater" style="margin-top:8px">Later</button>`);
  sh.querySelectorAll('.lglinks a').forEach(a => a.onclick = () => { closeSheet(); asked = false; });
  $('#tlater', sh).onclick = () => closeSheet();
  $('#tok', sh).onclick = async () => {
    const { error } = await cloud.sb.rpc('accept_terms', { p_version: LEGAL.version });
    if (error) { toast(plain(error), 'sad'); return; }
    closeSheet(); toast('Thanks!');
  };
}

/* ---------- Your data: download + delete (used on the Security page) ---------- */
function download(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function deviceData() {
  const out = {};
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^(heartbeat|hb_)/.test(k) && !/device|token|auth/i.test(k)) { const v = localStorage.getItem(k); try { out[k] = JSON.parse(v); } catch (e) { out[k] = v; } } } } catch (e) { }
  return out;
}
export function yourDataHTML() {
  return `<section class="card" id="mydata"><h2 class="h3"><i class="i i-package" aria-hidden="true"></i> Your data</h2>
    <p class="sub">Download a copy of everything Heartbeat keeps about you, or delete your account.</p>
    <div class="aibtns"><button class="btn" id="dlme"><i class="i i-download" aria-hidden="true"></i> Download my data</button>${cloud.user ? '<button class="btn ghost dangerbtn" id="delme"><i class="i i-trash" aria-hidden="true"></i> Delete my account</button>' : ''}</div>
    <p class="meta">The download is a JSON file. ${cloud.user ? 'It includes your account and what is saved on this device.' : 'Without an account, your ratings only live on this device.'}</p></section>`;
}
export function wireYourData(root) {
  const dl = $('#dlme', root), del = $('#delme', root);
  if (dl) dl.onclick = async () => {
    dl.disabled = true;
    try {
      const out = { this_device: deviceData() };
      if (cloud.user) { const { data, error } = await cloud.sb.rpc('export_my_data'); if (error) throw error; out.account = data; try { out.account.release_reminders = (await cloud.sb.rpc('my_release_alerts')).data || []; } catch (e) { /* older databases */ } }
      download(`heartbeat-my-data-${new Date().toISOString().slice(0, 10)}.json`, out); toast('Downloaded');
    } catch (e) { toast(plain(e), 'sad'); }
    dl.disabled = false;
  };
  if (del) del.onclick = () => {
    const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 6px"><i class="i i-trash" aria-hidden="true"></i> Delete my account?</h2>
      <p class="sub">This deletes your account <b>right away and for good</b>: your profile, ratings, reviews, comments, friends, chats, XP, ranks and settings. Your chat messages are wiped for everyone.</p>
      <p class="sub">Want a copy first? Use "Download my data". Have Heartbeat Plus? Cancel it first so you are not charged again.</p>
      <label class="fld"><span>Type DELETE to confirm</span><input id="delc" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
      <p class="errmsg" id="delerr" role="alert" hidden></p>
      <button class="btn big dangerbtn" id="delgo" disabled>Delete my account</button><button class="btn ghost big" id="delno" style="margin-top:8px">Keep my account</button>`);
    const inp = $('#delc', sh), go = $('#delgo', sh);
    inp.oninput = () => { go.disabled = inp.value.trim() !== 'DELETE'; };
    $('#delno', sh).onclick = () => closeSheet();
    go.onclick = async () => {
      go.disabled = true; go.textContent = 'Deleting…';
      try {
        const uid = cloud.user.id;
        // Remove profile photos first (the storage rules let people remove their own files).
        try { const b = cloud.sb.storage.from('avatars'); const { data: files } = await b.list(uid); if (files?.length) await b.remove(files.map(f => `${uid}/${f.name}`)); } catch (e) { }
        const { error } = await cloud.sb.rpc('delete_my_account', { p_confirm: 'DELETE' });
        if (error) throw error;
        try { Object.keys(localStorage).filter(k => /^(heartbeat|hb_)/.test(k) && k !== 'hb_device').forEach(k => localStorage.removeItem(k)); } catch (e) { }
        await cloud.sb.auth.signOut().catch(() => {});
        closeSheet(); location.hash = '#/'; setTimeout(() => location.reload(), 300);
        toast('Your account was deleted. Take care!');
      } catch (e) { const er = $('#delerr', sh); er.textContent = plain(e); er.hidden = false; go.disabled = false; go.textContent = 'Delete my account'; }
    };
  };
}
export { empty };
