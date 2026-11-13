/* SIXFOLD — names.js  (keeps a display name from being rude)
 *
 * The one free text a player can show another is the display name (Find a rival,
 * Play a friend). Every name is checked before it is saved or sent, and every name
 * read off the database is checked again before it is shown; a caught name shows as
 * "Player". The list is short on purpose and stored rot13 encoded so this source
 * reads clean. Two kinds of entry:
 *   WHOLE  matches anywhere in the name once spacing and symbols are gone (long,
 *          unambiguous words);
 *   TOKEN  matches only a whole word of the name, or the whole name run together
 *          (short words that hide inside ordinary names and places).
 * The matcher ignores case, spacing and punctuation, sees through digits and
 * symbols used for letters, and through letters held down ("fooooo").
 */
(function (root) {
  "use strict";
  function rot13(s) { return String(s).replace(/[a-z]/g, function (c) { return String.fromCharCode((c.charCodeAt(0) - 97 + 13) % 26 + 97); }); }
  var WHOLE = "shpx|ovgpu|phag|avttre|avttn|snttbg|juber|gjng|cravf|intvan|qvyqb|cbea|wvmm|jnaxre|uvgyre|ergneq|genaal|onfgneq|nffubyr|cvff|obyybpx|jrgonpx|ohyyfuvg|fuvgurnq|zbgures"
    .split("|").map(rot13);
  var TOKEN = "fuvg|fuvggl|nff|nefr|qvpx|pbpx|chffl|encr|encrq|encvfg|fyhg|snt|ubr|phz|gvgf|gvggl|obbo|nany|frk|frkl|xvxr|fcvp|puvax|qlxr|pbba|tbbx|cnxv|xlf|cevpx|fynt|funt|frzra|ahqr|arteb|ubeal|jnax|anmv"
    .split("|").map(rot13);
  // digits and symbols standing in for letters
  var LEET = { "0": "o", "1": "i", "2": "z", "3": "e", "4": "a", "5": "s", "6": "g", "7": "t", "8": "b", "9": "g", "@": "a", "$": "s", "!": "i", "|": "i", "+": "t", "€": "e", "£": "l" };
  function leet(s) {
    var out = "";
    s = String(s == null ? "" : s).toLowerCase();
    try { s = s.normalize("NFKD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    for (var i = 0; i < s.length; i++) { var c = s.charAt(i); out += LEET[c] || c; }
    return out;
  }
  function squash(s, keep) { return s.replace(keep === 1 ? /(.)\1+/g : /(.)\1\1+/g, keep === 1 ? "$1" : "$1$1"); }
  function hasDouble(w) { return /(.)\1/.test(w); }
  function tokenHit(tok) {
    if (!tok) return false;
    var t2 = squash(tok, 2), t1 = squash(tok, 1);
    for (var i = 0; i < TOKEN.length; i++) {
      var w = TOKEN[i];
      var forms = [w, w + "s", w + "z"];
      for (var j = 0; j < forms.length; j++) {
        if (t2 === forms[j]) return true;
        if (!hasDouble(w) && t1 === squash(forms[j], 1)) return true;
      }
    }
    return false;
  }
  function isRude(name) {
    var s = leet(name);
    var joined = s.replace(/[^a-z]/g, "");
    if (!joined) return false;
    var j2 = squash(joined, 2), j1 = squash(joined, 1);
    for (var i = 0; i < WHOLE.length; i++) {
      var w = WHOLE[i];
      if (j2.indexOf(w) >= 0) return true;
      if (!hasDouble(w) && j1.indexOf(w) >= 0) return true;
    }
    if (tokenHit(joined)) return true;
    var toks = s.split(/[^a-z]+/);
    for (var k = 0; k < toks.length; k++) if (tokenHit(toks[k])) return true;
    return false;
  }
  // the name to show or send: a caught name becomes "Player"
  function clean(name, fallback) { return isRude(name) ? "Player" : name; }
  var api = { isRude: isRude, clean: clean, _lists: function () { return { whole: WHOLE.length, token: TOKEN.length }; } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Names = api;
})(typeof window !== "undefined" ? window : this);
