// #/security: 2-step sign-in (authenticator app), account status, and how Heartbeat keeps you safe.
import { cloud, mfaList, mfaStart, mfaVerify, mfaOff, plain } from '../cloud.js';
import { $, esc, toast, sheet, closeSheet, empty, confetti } from '../ui.js';

// Supabase sends the QR as a plain SVG data address; encode it so every browser shows it.
const qrSrc = q => {
  const m = /^data:image\/svg\+xml;(?:utf-8|charset=utf-8),([\s\S]*)$/i.exec(q || '');
  return m && !/^%3C/i.test(m[1]) ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(m[1]) : q;
};
const day = s => s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

export async function renderSecurity(app) {
  document.title = 'Security — Heartbeat';
  app.innerHTML = `<div class="screen sec"><header class="top"><a class="icon-btn" href="#/me" aria-label="Back">←</a>
    <h1 class="logo" style="font-size:24px;margin:0">🔐 Security</h1><span></span></header><div id="secb"><div class="card"><div class="rskel"></div></div></div></div>`;
  const box = $('#secb', app);
  if (!cloud.user) { box.innerHTML = `<div class="card">${empty('Sign in to manage your account security.', 'happy', '<a class="btn" href="#/signin">Sign in</a>')}</div>`; return; }
  let factors = [];
  try { factors = await mfaList(); } catch (e) { /* older projects: 2-step not available */ }
  const on = factors.find(f => f.status === 'verified');
  const s = cloud.sec || {};
  box.innerHTML = `
    ${s.paused ? `<section class="card pausedcard" role="alert"><h2 class="h3">⏸️ Your account is ${s.status === 'banned' ? 'banned' : 'paused'}</h2>
      <div class="sub">${s.status === 'banned' ? 'It broke the community rules.' : `Until ${esc(day(s.until))}.`} Reason: ${esc(s.reason || 'community rules')}</div>
      <div class="sub">You can still look around, but you can't rate, review or chat for now.</div></section>` : ''}
    <section class="card">
      <div class="secrow"><span class="secic" aria-hidden="true">${on ? '✅' : '🔓'}</span><div style="flex:1"><h2 class="h3">2-step sign-in</h2>
        <div class="sub">${on ? 'On. When you sign in, we also ask for a code from your authenticator app.' : 'Add a code from an authenticator app (like Google Authenticator or Authy) when you sign in. Even if someone gets your password, they can\'t get in.'}</div></div></div>
      <button class="btn ${on ? 'ghost' : ''}" id="mfa">${on ? 'Turn off 2-step sign-in' : 'Turn on 2-step sign-in'}</button>
      ${s.admin && !on ? '<div class="sub" style="margin-top:8px;color:var(--pink)">You are an admin: the admin panel needs 2-step sign-in.</div>' : ''}
    </section>
    ${s.admin ? `<a class="card linkcard" href="#/admin"><span style="font-size:30px" aria-hidden="true">🛡️</span><div style="flex:1"><h2 class="h3">Admin panel</h2><div class="sub">Reports, flags, held ratings, users and the security log.</div></div><span class="btn sm ghost" aria-hidden="true">Open</span></a>` : ''}
    <section class="card"><h2 class="h3">How we keep Heartbeat safe</h2><ul class="safelist">
      <li>🧮 Your XP, rank, streak and Plus are worked out on our server. Nobody can edit them from the app.</li>
      <li>🔒 Every table has rules, so people only see what they're allowed to.</li>
      <li>🐢 Speed limits stop spam: too many ratings, messages or requests at once get slowed down.</li>
      <li>🤖 Fake accounts and rating waves on one title are held back until a person checks them.</li>
      <li>📱 We keep a scrambled code for your device, never your real IP address.</li>
      <li>🚩 You can report anything. Our team reviews reports and can pause accounts that break the rules.</li></ul></section>`;
  $('#mfa', box).onclick = () => on ? turnOff(app, on) : turnOn(app);
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
    try { await mfaVerify(f.id, $('#mcode', sh).value); closeSheet(); confetti(60); toast('2-step sign-in is on! 🔐'); renderSecurity(app); }
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
