// Runs before first paint (loaded synchronously in <head>) so saved theme and
// accessibility preferences apply without a flash of the default styles.
(function () {
  try {
    var raw = window.localStorage.getItem('atlas.settings.v2');
    if (!raw) return;
    var s = JSON.parse(raw);
    var root = document.documentElement;
    if (s.theme === 'light' || s.theme === 'dark') root.setAttribute('data-theme', s.theme);
    if (s.textSize === 'lg') root.classList.add('text-lg');
    if (s.textSize === 'xl') root.classList.add('text-xl');
    if (s.highContrast) root.classList.add('high-contrast');
    if (s.readableFont) root.classList.add('readable-font');
    if (s.cvdPalette) root.classList.add('cvd-palette');
    if (s.reduceMotion) root.classList.add('reduce-motion');
  } catch (e) {
    /* storage unavailable: fall back to defaults */
  }
})();
