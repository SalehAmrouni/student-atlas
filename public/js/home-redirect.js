// Runs before first paint on the homepage. Signed-in students go straight to
// My Pathway; the homepage still opens when they ask for it (?home=1) or start
// the wizard (?wizard=1).
(function () {
  try {
    var q = new URLSearchParams(window.location.search);
    if (q.has('home') || q.has('wizard')) return;
    var raw = window.localStorage.getItem('atlas.account.v1');
    var account = raw ? JSON.parse(raw) : null;
    if (account && account.username) {
      // Hide the homepage and skip its scripts while the browser navigates away.
      document.documentElement.classList.add('redirecting');
      window.location.replace('/profile.html' + window.location.hash);
    }
  } catch (e) {
    /* storage unavailable: show the homepage */
  }
})();
