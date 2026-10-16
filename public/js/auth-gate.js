// Runs before first paint on pages that need an Atlas account (My Pathway,
// Applications, College Lab, Suggest a Resource). With no signed-in username
// in this browser, the page stays hidden while layout.js checks with the
// server and sends the visitor to sign in if needed.
(function () {
  try {
    var raw = window.localStorage.getItem('atlas.account.v1');
    var account = raw ? JSON.parse(raw) : null;
    if (!account || !account.username) document.documentElement.classList.add('gate-checking');
  } catch (e) {
    /* storage unavailable: layout.js still checks */
  }
})();
