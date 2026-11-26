import { mascot } from '../ui.js';

export function renderAbout(app) {
  document.title = 'About — Heartbeat';
  app.innerHTML = `<div class="screen about">
    <div class="back-row"><a class="icon-btn" href="#/me" aria-label="Back">←</a><h1>About</h1></div>
    <div class="mascot" style="padding-bottom:6px">${mascot('happy')}<div><b style="color:var(--text);font-size:20px">Heartbeat</b><br>Rate the journey, not just the ending.</div></div>
    <div class="card"><h3>🎬 Movie & TV data</h3>
      <p><a href="https://www.themoviedb.org" target="_blank" rel="noopener"><img src="/icons/tmdb.svg" alt="TMDB — The Movie Database" class="tmdblogo" width="160" height="21"></a></p>
      <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      <p class="sub">Posters, backdrops, years, genres, runtimes and overviews come from <a class="see" style="display:inline;padding:0" href="https://www.themoviedb.org" target="_blank" rel="noopener">themoviedb.org</a>.</p></div>
    <div class="card"><h3>▶️ Trailers</h3><p class="sub">Trailers play from YouTube (privacy-enhanced mode) or Vimeo.</p></div>
    <div class="card"><h3>📜 Legal</h3><p class="sub"><a class="see" href="#/terms">Terms of Service</a> · <a class="see" href="#/privacy">Privacy Policy</a> · <a class="see" href="#/guidelines">Community Guidelines</a> · <a class="see" href="#/contact">Contact us</a></p></div>
    <div class="card"><h3>🔒 Your data</h3><p class="sub">Without an account, your ratings stay on this device only. With an account, they are saved on our server so you can use them on any device. Your birthday is private, and only you can see it. You can <a class="see" href="#/security">download or delete your data</a> any time.</p></div>
  </div>`;
}
