// Applies the saved appearance before the first paint (System, Light, Dark or Night), so the page
// never flashes the wrong theme. Mirrors src/client/lib/theme.tsx, which takes over afterwards.
// Kept as a plain external script so the Content-Security-Policy can stay script-src 'self'.
(function () {
  var colors = { light: '#3a0f34', dark: '#1b1219', night: '#120e11' };
  var pref = 'system';
  try {
    var stored = localStorage.getItem('fairshift.theme');
    if (stored === 'system' || stored === 'light' || stored === 'dark' || stored === 'night') pref = stored;
  } catch {
    /* storage unavailable: follow the device */
  }
  var dark = false;
  try {
    dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    /* matchMedia unavailable */
  }
  var theme = pref === 'system' ? (dark ? 'dark' : 'light') : pref;
  var root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-theme-pref', pref);
  root.style.colorScheme = theme === 'light' ? 'light' : 'dark';
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', colors[theme]);
})();
