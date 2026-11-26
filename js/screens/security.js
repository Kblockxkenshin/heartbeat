// #/security: 2-step sign-in (authenticator app), account status, and how Heartbeat keeps you safe.
import { cloud, mfaList, mfaStart, mfaVerify, mfaOff, plain } from '../cloud.js';
import { $, esc, toast, sheet, closeSheet, empty, confetti } from '../ui.js';
import { yourDataHTML, wireYourData } from './legal.js';

// Supabase sends the QR as a plain SVG data address; encode it so every browser shows it.
const qrSrc = q => {
  const m = /^data:image\/svg\+xml;(?:utf-8|charset=utf-8),([\s\S]*)$/i.exec(q || '');
  return m && !/^%3C/i.test(m[1]) ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(m[1]) : q;
};
const day = s => s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

export async function renderSecurity(app) {
  document.title = 'Security — Heartbeat';
  app.innerHTML = `<div class="screen sec"><header class="top"><a class="icon-btn" href="#/me" aria-label="Back"><i class="i i-arrow-left" aria-hidden="true"></i></a>
    <h1 class="logo" style="font-size:24px;margin:0"><i class="i i-lock-keyhole" aria-hidden="true"></i> Security</h1><span></span></header><div id="secb"><div class="card"><div class="rskel"></div></div></div></div>`;
  const box = $('#secb', app);
  if (!cloud.user) { box.innerHTML = `<div class="card">${empty('Sign in to manage your account security.', 'happy', '<a class="btn" href="#/signin">Sign in</a>')}</div>`; return; }
  let factors = [];
  try { factors = await mfaList(); } catch (e) { /* older projects: 2-step not available */ }
  const on = factors.find(f => f.status === 'verified');
  const s = cloud.sec || {};
  box.innerHTML = `
    ${s.paused ? `<section class="card pausedcard" role="alert"><h2 class="h3"><i class="i i-pause" aria-hidden="true"></i> Your account is ${s.status === 'banned' ? 'banned' : 'paused'}</h2>
      <div class="sub">${s.status === 'banned' ? 'It broke the community rules.' : `Until ${esc(day(s.until))}.`} Reason: ${esc(s.reason || 'community rules')}</div>
      <div class="sub">You can still look around, but you can't rate, review or chat for now.</div></section>` : ''}
    <section class="card">
      <div class="secrow"><span class="secic" aria-hidden="true">${on ? '<i class="i i-check" aria-hidden="true"></i>' : '<i class="i i-lock-open" aria-hidden="true"></i>'}</span><div style="flex:1"><h2 class="h3">2-step sign-in</h2>
        <div class="sub">${on ? 'On. When you sign in, we also ask for a code from your authenticator app.' : 'Add a code from an authenticator app (like Google Authenticator or Authy) when you sign in. Even if someone gets your password, they can\'t get in.'}</div></div></div>
      <button class="btn ${on ? 'ghost' : ''}" id="mfa">${on ? 'Turn off 2-step sign-in' : 'Turn on 2-step sign-in'}</button>
      ${s.admin && !on ? '<div class="sub" style="margin-top:8px;color:var(--pink)">You are an admin: the admin panel needs 2-step sign-in.</div>' : ''}
    </section>
    ${s.admin ? `<a class="card linkcard" href="#/admin"><span style="font-size:30px" aria-hidden="true"><i class="i i-shield" aria-hidden="true"></i></span><div style="flex:1"><h2 class="h3">Admin panel</h2><div class="sub">Reports, flags, held ratings, users and the security log.</div></div><span class="btn sm ghost" aria-hidden="true">Open</span></a>` : ''}
    <section class="card teensafe" id="teen" hidden></section>
    <section class="card" id="stpriv"><h2 class="h3"><i class="i i-clapperboard" aria-hidden="true"></i> Studios &amp; your data</h2>
      <p class="sub">Studios that make movies and shows can see <b>totals and averages</b> from Heartbeat (like "4.2 stars from 1,200 people"). They never see your name, profile, single ratings or messages. People under 18 are never counted.</p>
      <div id="privb" class="sub">Loading…</div></section>
    <section class="card"><h2 class="h3">How we keep Heartbeat safe</h2><ul class="safelist">
      <li><i class="i i-calculator" aria-hidden="true"></i> Your XP, rank, streak and Plus are worked out on our server. Nobody can edit them from the app.</li>
      <li><i class="i i-lock" aria-hidden="true"></i> Every table has rules, so people only see what they're allowed to.</li>
      <li><i class="i i-turtle" aria-hidden="true"></i> Speed limits stop spam: too many ratings, messages or requests at once get slowed down.</li>
      <li><i class="i i-bot" aria-hidden="true"></i> Fake accounts and rating waves on one title are held back until a person checks them.</li>
      <li><i class="i i-smartphone" aria-hidden="true"></i> We keep a scrambled code for your device, never your real IP address.</li>
      <li><i class="i i-flag" aria-hidden="true"></i> You can report anything. Our team reviews reports and can pause accounts that break the rules.</li></ul></section>`;
  $('#mfa', box).onclick = () => on ? turnOff(app, on) : turnOn(app);
  fillPrivacy($('#privb', box));
  box.insertAdjacentHTML('beforeend', yourDataHTML()); wireYourData(box);
  cloud.sb.rpc('my_safety').then(({ data }) => {
    const t = $('#teen', box);
    if (t && data?.minor) { t.innerHTML = `<h2 class="h3"><i class="i i-shield-check" aria-hidden="true"></i> Extra safety is on</h2><p class="sub">Because you are under 18:</p><ul class="safelist">${data.protections.map(p => `<li><i class="i i-check" aria-hidden="true"></i> ${esc(p)}</li>`).join('')}</ul>`; t.hidden = false; }
  }, () => {});
}

async function fillPrivacy(el) {
  let p;
  try { const { data, error } = await cloud.sb.rpc('my_privacy'); if (error) throw error; p = data; } catch (e) { el.textContent = 'Could not load these settings.'; return; }
  const draw = () => {
    el.className = '';
    el.innerHTML = `<label class="tog"><input type="checkbox" id="pvin" ${p.studio_opt_out ? '' : 'checked'}><span>Include me in studio stats <small class="hint">(always anonymous and grouped)</small></span></label>
      <label class="tog"><input type="checkbox" id="pvpn" ${p.panels_opt_in ? 'checked' : ''} ${p.adult && p.verified ? '' : 'disabled'}><span>Invite me to screener panels <small class="hint">(watch trailers or early cuts, +50 XP, answers without your name)</small></span></label>
      ${!p.adult ? '<p class="meta">Screener panels are for people 18 and older.</p>' : !p.verified ? '<p class="meta">Confirm your email to join screener panels.</p>' : !p.panel_ready ? '<p class="meta">Invites go to members ranked Critic or higher. Keep rating and reviewing!</p>' : ''}
      <a class="see" href="#/screeners">See my screener invites</a>`;
    const save = async () => {
      try { const { data, error } = await cloud.sb.rpc('set_studio_privacy', { p_opt_out: !$('#pvin', el).checked, p_panels: $('#pvpn', el).checked }); if (error) throw error; p = data; toast('Saved.'); }
      catch (e) { toast(e.message || 'Could not save.', 'sad'); }
      draw();
    };
    $('#pvin', el).onchange = save; $('#pvpn', el).onchange = save;
  };
  draw();
}

async function turnOn(app) {
  let f;
  try { f = await mfaStart(); } catch (e) { toast(plain(e), 'sad'); return; }
  const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 6px">Turn on 2-step sign-in</h2>
    <ol class="steps"><li>Open an authenticator app on your phone.</li><li>Scan this code (or type the key).</li><li>Type the 6-digit code it shows.</li></ol>
    <div class="qrbox"><img src="${esc(qrSrc(f.totp.qr_code))}" alt="QR code to add Heartbeat to your authenticator app" width="180" height="180"></div>
    <div class="sub" style="text-align:center;margin:6px 0 12px">Key: <code class="totpkey">${esc(f.totp.secret)}</code></div>
    <label class="fld"><span>6-digit code</span><input id="mcode" inputmode="numeric" autocomplete="one-time-code" maxlength="7"></label>
    <p class="errmsg" id="merr" role="alert" hidden></p>
    <button class="btn big" id="mgo">Turn on</button>`);
  $('#mgo', sh).onclick = async () => {
    const b = $('#mgo', sh); b.disabled = true;
    try { await mfaVerify(f.id, $('#mcode', sh).value); closeSheet(); confetti(60); toast('2-step sign-in is on!'); renderSecurity(app); }
    catch (e) { const er = $('#merr', sh); er.textContent = plain(e); er.hidden = false; b.disabled = false; }
  };
}

function turnOff(app, f) {
  const sh = sheet(`<h2 class="h3" style="font-size:21px;margin:0 0 6px">Turn off 2-step sign-in?</h2>
    <div class="sub" style="margin-bottom:14px">Your account will only need your password again. It's less safe.</div>
    <button class="btn big ghost" id="offy">Yes, turn it off</button><button class="btn big" id="offn" style="margin-top:8px">Keep it on</button>`);
  $('#offn', sh).onclick = () => closeSheet();
  $('#offy', sh).onclick = async () => {
    try { await mfaOff(f.id); closeSheet(); toast('2-step sign-in is off.'); renderSecurity(app); }
    catch (e) { toast(plain(e), 'sad'); }
  };
}
