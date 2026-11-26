// Sign up / sign in / check your email / forgot password / first-time setup.
import { cloud, signUp, signIn, signInGoogle, resendEmail, sendReset, setNewPassword, setBirthdate, saveProfile, usernameFree, plain, mfaList, mfaVerify, signOut } from '../cloud.js';
import { $, esc, mascot, toast, confetti } from '../ui.js';

const LOGO = `<span class="mark" aria-hidden="true"><svg viewBox="0 0 32 32" width="24" height="24"><path d="M3 17h6l2.5-6 4 12 3-9 2 3H29" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
const G = `<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

let lastEmail = '';
const ageOf = b => { const d = new Date(b), n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--; return a; };
const today = () => new Date().toISOString().slice(0, 10);
const frame = inner => `<div class="screen auth"><div class="authbox">
  <a class="slogo authlogo" href="#/" aria-label="Heartbeat home">${LOGO}<span>heartbeat</span></a>${inner}</div></div>`;

/* ---------- "I'm not a robot" check (Cloudflare Turnstile), only if it's switched on ---------- */
let tsLoad = null;
function botCheck(el) {
  if (!cloud.turnstile || !el) return { token: () => '', reset() {} };
  let token = '', id = null;
  tsLoad = tsLoad || new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
    s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
  tsLoad.then(() => { if (el.isConnected) id = window.turnstile.render(el, { sitekey: cloud.turnstile, theme: 'dark', callback: t => { token = t; }, 'expired-callback': () => { token = ''; } }); })
    .catch(() => { el.textContent = 'The robot check could not load. Check your internet.'; });
  return { token: () => token, reset() { token = ''; try { window.turnstile?.reset(id); } catch (e) { } } };
}

/* ---------- 2-step code after the password ---------- */
function twoStep(app) {
  if (!cloud.user) { location.hash = '#/signin'; return; }
  if (!cloud.needsCode) { location.hash = '#/me'; return; }
  app.innerHTML = frame(`<div class="mascot" style="padding:6px 0">${mascot('wow')}</div>
    <h1 class="authh">One more step 🔐</h1>
    <p class="sub" style="text-align:center">Open your authenticator app and type the 6-digit code for Heartbeat.</p>
    <form id="f" novalidate><label class="fld"><span>6-digit code</span><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" pattern="[0-9 ]{6,7}" required></label>
    <p class="errmsg" id="err" role="alert" tabindex="-1" hidden></p>
    <button class="btn big" id="go">Continue</button></form>
    <div class="authlinks"><button class="see linkbtn" id="out" type="button">Use a different account</button></div>`);
  $('#code').focus();
  $('#out').onclick = async () => { await signOut(); location.hash = '#/signin'; };
  $('#f').onsubmit = async e => {
    e.preventDefault(); const b = $('#go'); busy(b, true);
    try {
      const f = (await mfaList()).find(x => x.status === 'verified');
      if (!f) throw new Error('No authenticator found for this account.');
      await mfaVerify(f.id, $('#code').value);
      toast('Signed in! 💓'); location.hash = '#/me';
    } catch (x) { busy(b, false); showErr($('#err'), plain(x)); $('#code').select(); }
  };
}
const notReady = () => frame(`<div class="mascot">${mascot('sad')}<div>${cloud.error === 'offline' ? 'You seem to be offline. Accounts need the internet.' : 'Accounts are not switched on yet.'}<br><a class="see" href="#/">Keep using Heartbeat on this device</a></div></div>`);

function busy(btn, on, label) { btn.disabled = on; if (on) { btn.dataset.l = btn.innerHTML; btn.innerHTML = label || 'One sec…'; } else if (btn.dataset.l) btn.innerHTML = btn.dataset.l; }
function showErr(el, msg) { el.textContent = msg; el.hidden = !msg; if (msg) el.focus?.(); }

export function renderAuth(app, mode = '') {
  document.title = 'Sign in — Heartbeat';
  if (!cloud.ready) { app.innerHTML = notReady(); return; }
  if (mode === '2fa') return twoStep(app);
  if (cloud.user && !['reset'].includes(mode)) { location.hash = needsSetup() ? '#/welcome' : '#/me'; return; }
  if (mode === 'check') return checkEmail(app);
  if (mode === 'forgot') return forgot(app);
  if (mode === 'reset') return reset(app);
  const up = mode === 'up';
  app.innerHTML = frame(`
    <h1 class="authh">${up ? 'Make your account' : 'Welcome back!'}</h1>
    <p class="sub" style="text-align:center;margin:0 0 16px">${up ? 'Save your ratings everywhere, add friends, and earn ranks.' : 'Sign in to see your ratings on every device.'}</p>
    ${cloud.flash ? `<div class="okmsg" role="status">${esc(cloud.flash)}</div>` : ''}
    <button class="btn ghost big gbtn" id="google" type="button">${G} Continue with Google</button>
    <div class="or"><span>or with email</span></div>
    <form id="f" novalidate>
      <label class="fld"><span>Email</span><input id="em" type="email" autocomplete="email" required value="${esc(lastEmail)}"></label>
      ${up ? `<label class="fld"><span>Username</span><input id="un" autocomplete="username" required minlength="3" maxlength="20" pattern="[a-z0-9_.]{3,20}" placeholder="like movie.maya" autocapitalize="none" spellcheck="false"><small class="hint">3–20 letters, numbers, _ or .</small></label>
      <label class="fld"><span>Birthday</span><input id="bd" type="date" required max="${today()}" min="1900-01-01"><small class="hint">You must be 13 or older. Only you can see this.</small></label>` : ''}
      <label class="fld"><span>Password</span><input id="pw" type="password" autocomplete="${up ? 'new-password' : 'current-password'}" required minlength="8"><small class="hint">${up ? 'At least 8 characters.' : ''}</small></label>
      ${cloud.turnstile ? '<div class="botcheck" id="ts"></div>' : ''}
      <p class="errmsg" id="err" role="alert" tabindex="-1" hidden></p>
      <button class="btn big" id="go" type="submit">${up ? 'Create account' : 'Sign in'}</button>
    </form>
    <div class="authlinks">${up ? `Already have an account? <a class="see" href="#/signin">Sign in</a>` : `New here? <a class="see" href="#/signin/up">Make an account</a> · <a class="see" href="#/signin/forgot">Forgot password?</a>`}</div>
    <p class="sub tiny">You can keep using Heartbeat without an account. Your ratings then stay on this device only.</p>`);
  cloud.flash = null;
  const err = $('#err'), bot = botCheck($('#ts'));
  $('#google').onclick = async e => { busy(e.currentTarget, true); try { await signInGoogle(); } catch (x) { busy(e.currentTarget, false); showErr(err, plain(x)); } };
  if (up) $('#un').addEventListener('input', e => { e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''); });
  $('#f').onsubmit = async e => {
    e.preventDefault(); showErr(err, '');
    const email = $('#em').value.trim(), password = $('#pw').value;
    lastEmail = email;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showErr(err, 'Please enter a real email.');
    if (password.length < 8) return showErr(err, 'Your password needs at least 8 characters.');
    if (cloud.turnstile && !bot.token()) return showErr(err, 'Please finish the "I\'m not a robot" check.');
    const btn = $('#go'); busy(btn, true);
    try {
      if (up) {
        const username = $('#un').value.trim(), birthdate = $('#bd').value;
        if (!/^[a-z0-9_.]{3,20}$/.test(username)) throw new Error('Usernames are 3–20 letters, numbers, _ or .');
        if (!birthdate) throw new Error('Please add your birthday.');
        if (ageOf(birthdate) < 13) throw new Error('You must be 13 or older to use Heartbeat.');
        if (!(await usernameFree(username))) throw new Error('That username is taken. Try another one.');
        const d = await signUp({ email, password, username, birthdate, captchaToken: bot.token() || undefined });
        if (d.session) { confetti(); location.hash = '#/welcome'; } else location.hash = '#/signin/check';
      } else {
        await signIn(email, password, bot.token() || undefined);
        const { data } = await cloud.sb.auth.mfa.getAuthenticatorAssuranceLevel().catch(() => ({}));
        if (data?.nextLevel === 'aal2' && data?.currentLevel !== 'aal2') { cloud.needsCode = true; location.hash = '#/signin/2fa'; return; }
        toast('Signed in! 💓');
        location.hash = '#/me';
      }
    } catch (x) { busy(btn, false); bot.reset(); showErr(err, plain(x)); }
  };
}

function checkEmail(app) {
  app.innerHTML = frame(`<div class="mascot" style="padding:10px 0">${mascot('wow')}</div>
    <h1 class="authh">Check your email 📬</h1>
    <p class="sub" style="text-align:center">We sent a link to <b>${esc(lastEmail || 'your email')}</b>.<br>Tap it to turn on your account. Then come back here.</p>
    <p class="sub" style="text-align:center">You need to confirm your email before you can chat or post reviews.</p>
    <button class="btn ghost big" id="again" ${lastEmail ? '' : 'disabled'}>Send the email again</button>
    <p class="okmsg" id="ok" role="status" hidden></p>
    <div class="authlinks"><a class="see" href="#/signin">I confirmed it, sign me in</a></div>`);
  $('#again').onclick = async e => {
    busy(e.currentTarget, true);
    try { await resendEmail(lastEmail); $('#ok').textContent = 'Sent! Check your inbox (and spam).'; $('#ok').hidden = false; }
    catch (x) { $('#ok').textContent = plain(x); $('#ok').hidden = false; }
    setTimeout(() => busy(e.currentTarget, false), 30000);
  };
}

function forgot(app) {
  app.innerHTML = frame(`<h1 class="authh">Forgot your password?</h1>
    <p class="sub" style="text-align:center">No problem. We'll email you a link to make a new one.</p>
    <form id="f" novalidate><label class="fld"><span>Email</span><input id="em" type="email" autocomplete="email" required value="${esc(lastEmail)}"></label>
    ${cloud.turnstile ? '<div class="botcheck" id="ts"></div>' : ''}
    <p class="errmsg" id="err" role="alert" tabindex="-1" hidden></p>
    <button class="btn big" id="go">Send me a link</button></form>
    <div class="authlinks"><a class="see" href="#/signin">Back to sign in</a></div>`);
  const bot = botCheck($('#ts'));
  $('#f').onsubmit = async e => {
    e.preventDefault(); const email = $('#em').value.trim(); lastEmail = email;
    if (cloud.turnstile && !bot.token()) return showErr($('#err'), 'Please finish the "I\'m not a robot" check.');
    const b = $('#go'); busy(b, true);
    try { await sendReset(email, bot.token() || undefined); app.querySelector('form').outerHTML = `<p class="okmsg" role="status">If that email has an account, a link is on its way. 📬</p>`; }
    catch (x) { busy(b, false); showErr($('#err'), plain(x)); }
  };
}

function reset(app) {
  if (!cloud.user) { location.hash = '#/signin/forgot'; return; }
  app.innerHTML = frame(`<h1 class="authh">Make a new password</h1>
    <form id="f" novalidate><label class="fld"><span>New password</span><input id="pw" type="password" autocomplete="new-password" minlength="8" required><small class="hint">At least 8 characters.</small></label>
    <p class="errmsg" id="err" role="alert" tabindex="-1" hidden></p><button class="btn big" id="go">Save password</button></form>`);
  $('#f').onsubmit = async e => {
    e.preventDefault(); const pw = $('#pw').value;
    if (pw.length < 8) return showErr($('#err'), 'Your password needs at least 8 characters.');
    const b = $('#go'); busy(b, true);
    try { await setNewPassword(pw); toast('Password saved!'); location.hash = '#/me'; }
    catch (x) { busy(b, false); showErr($('#err'), plain(x)); }
  };
}

/* ---------- first-time setup (Google sign-ups, or a missing username) ---------- */
export const needsSetup = () => !!cloud.user && (cloud.needsBirthdate || !cloud.profile?.username);
export function renderWelcome(app) {
  document.title = 'Welcome — Heartbeat';
  if (!cloud.user) { location.hash = '#/signin'; return; }
  if (!cloud.profile && !cloud.stats) { app.innerHTML = frame(`<div class="mascot">${mascot('happy')}<div>Loading your account…</div></div>`); return; }
  if (!needsSetup()) { location.hash = '#/me'; return; }
  const needB = cloud.needsBirthdate, needU = !cloud.profile?.username;
  app.innerHTML = frame(`<h1 class="authh">Almost done! 🎉</h1>
    <p class="sub" style="text-align:center;margin:0 0 16px">Just ${needB && needU ? 'two quick things' : 'one quick thing'}.</p>
    <form id="f" novalidate>
      ${needU ? `<label class="fld"><span>Pick a username</span><input id="un" autocomplete="username" required maxlength="20" placeholder="like movie.maya" autocapitalize="none" spellcheck="false"><small class="hint">3–20 letters, numbers, _ or .</small></label>` : ''}
      ${needB ? `<label class="fld"><span>Your birthday</span><input id="bd" type="date" required max="${today()}" min="1900-01-01"><small class="hint">You must be 13 or older. Only you can see this, and you can't change it later.</small></label>` : ''}
      <p class="errmsg" id="err" role="alert" tabindex="-1" hidden></p>
      <button class="btn big" id="go">Let's go</button>
    </form>
    <div class="authlinks"><button class="see" id="out" type="button">Sign out</button></div>`);
  if (needU) $('#un').addEventListener('input', e => { e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''); });
  $('#out').onclick = async () => { const { signOut } = await import('../cloud.js'); await signOut(); location.hash = '#/'; };
  $('#f').onsubmit = async e => {
    e.preventDefault(); const err = $('#err'); showErr(err, '');
    const b = $('#go'); busy(b, true);
    // Read the values now: the page may redraw while we wait for the server.
    const u = needU ? $('#un').value.trim() : '', bd = needB ? $('#bd').value : '';
    try {
      if (needU) {
        if (!/^[a-z0-9_.]{3,20}$/.test(u)) throw new Error('Usernames are 3–20 letters, numbers, _ or .');
        if (!(await usernameFree(u))) throw new Error('That username is taken. Try another one.');
      }
      if (needB) {
        if (!bd) throw new Error('Please add your birthday.');
        if (ageOf(bd) < 13) throw new Error('You must be 13 or older to use Heartbeat.');
        await setBirthdate(bd);   // birthday first: the server only lets members edit their profile
      }
      if (needU) await saveProfile({ username: u });
      confetti(); toast('Welcome to Heartbeat! 💓'); location.hash = '#/me';
    } catch (x) { const bb = $('#go'); if (bb) busy(bb, false); const ee = $('#err'); if (ee) showErr(ee, plain(x)); }
  };
}
