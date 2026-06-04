/*!
 * MMX sidebar search.
 * Single index fetch (intAssets/search-index.json), same code path for any
 * size, no options, no flags. Per-query cost is bounded by the smallest
 * posting list of the query terms. Snippets are highlighted at runtime
 * so multi-term queries highlight every term in the snippet.
 *
 * Index (built by scripts/searchIndexBuilder.js):
 *   { v: 3,
 *     d: [[url, title, breadcrumb, snippet], ...],
 *     i: { token: [docIdDelta, weight, docIdDelta, weight, ...] } }
 *
 * The script is loaded from <head>, so we defer initialization to
 * DOMContentLoaded (or run immediately if the doc is already parsed).
 * Without this, the input/results elements don't exist yet and the
 * search becomes a silent no-op.
 */
(function () {
  function init() {
    var I = document.getElementById("sidebar-search-input");
    var R = document.getElementById("sidebar-search-results");
    if (!I || !R) return;
    var C = document.getElementById("sidebar-search-clear");

    // Tunables. Same values regardless of index size.
    var MAX = 8;          // top-N results
    var DEBOUNCE = 80;     // ms after last keystroke
    var MIN_CHARS = 2;     // ignore shorter queries
    var IDLE_MS = 300;     // when to start background prefetch

    // Score weights by zone: title, heading, section, body.
    var W = [100, 30, 8, 2];
    var ALL_BONUS = 50;

    // State.
    var idx = null;        // parsed JSON
    var loading = null;    // in-flight fetch (deduped)
    var pending = null;    // debounce timer
    var lastKey = "";      // highlight-regex cache key
    var lastRe = null;     // cached regex

    // -------- helpers --------
    function esc(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function tok(q) {
      if (!q) return [];
      var n = q.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      var re = /[a-z0-9]{2,}/g, out = [], seen = Object.create(null), m;
      while ((m = re.exec(n)) !== null) {
        if (!seen[m[0]]) { seen[m[0]] = 1; out.push(m[0]); }
      }
      return out;
    }

    function reHl(terms) {
      var k = terms.slice().sort().join("\u0001");
      if (k === lastKey) return lastRe;
      if (!terms.length) { lastKey = k; lastRe = null; return null; }
      var parts = terms.map(function (t) {
        return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      });
      lastKey = k;
      lastRe = new RegExp("(" + parts.join("|") + ")", "gi");
      return lastRe;
    }

    function hl(s, re) { return re ? s.replace(re, "<mark>$1</mark>") : s; }

    // -------- network --------
    function load() {
      if (idx) return Promise.resolve(idx);
      if (loading) return loading;
      loading = fetch(prefix + "intAssets/search-index.json", { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && j.v === 3 && j.d && j.i) idx = j; return idx; })
        .catch(function () { return null; });
      return loading;
    }

    // Warm the cache in the background so the first keystroke never
    // waits on the network. Same code path regardless of index size.
    if ("requestIdleCallback" in window) {
      requestIdleCallback(load, { timeout: IDLE_MS });
    } else {
      setTimeout(load, IDLE_MS);
    }
    I.addEventListener("focus", load, { once: true });

    // -------- search --------
    // Does the given delta-encoded posting array contain docId?
    // Returns the weight if so, or -1 if not. O(arr.length / 2).
    function has(arr, docId) {
      var a = 0, i = 0;
      for (; i < arr.length; i += 2) {
        a += arr[i];
        if (a === docId) return arr[i + 1];
        if (a > docId) return -1;
      }
      return -1;
    }

    function run(q) {
      q = String(q || "").trim();
      if (q.length < MIN_CHARS) { R.innerHTML = ""; return; }
      if (!idx) { R.innerHTML = '<div class="sidebar-search-empty">Loading\u2026</div>'; return; }

      var t = tok(q);
      if (!t.length) { R.innerHTML = ""; return; }

      var M = idx.i, seed = 0, seedLen = 1 / 0;
      for (var i = 0; i < t.length; i++) {
        var p = M[t[i]];
        if (!p) {
          R.innerHTML = '<div class="sidebar-search-empty">No results for "' + esc(q) + '"</div>';
          return;
        }
        var L = p.length >> 1;
        if (L < seedLen) { seedLen = L; seed = i; }
      }

      var sp = M[t[seed]];
      var others = new Array(t.length - 1);
      for (var j = 0, oi = 0; j < t.length; j++) {
        if (j !== seed) others[oi++] = M[t[j]];
      }

      // Walk the seed. For each candidate, verify presence in every
      // other term's posting list and score. Keep the top MAX results
      // sorted by score desc; this is a bounded selection, not a full
      // sort, so cost stays at O(smallestPosting * (terms-1)).
      var top = [], min = -1, acc = 0;
      for (var k = 0; k < sp.length; k += 2) {
        acc += sp[k];
        var dId = acc;
        var sc = W[sp[k + 1]] || 0;
        var hit = 1;

        for (var m = 0; m < others.length; m++) {
          var w = has(others[m], dId);
          if (w < 0) { sc = -1; break; }
          sc += W[w] || 0;
          hit++;
        }
        if (sc < 0) continue;
        if (hit === t.length) sc += ALL_BONUS;

        // Insertion-sort the small top array.
        var item = { i: dId, s: sc };
        if (top.length < MAX) {
          top.push(item);
          for (var s = top.length - 1; s > 0 && top[s - 1].s < top[s].s; s--) {
            var tmp = top[s - 1]; top[s - 1] = top[s]; top[s] = tmp;
          }
          min = top[top.length - 1].s;
        } else if (sc > min) {
          top[top.length - 1] = item;
          for (var s2 = top.length - 1; s2 > 0 && top[s2 - 1].s < top[s2].s; s2--) {
            var tmp2 = top[s2 - 1]; top[s2 - 1] = top[s2]; top[s2] = tmp2;
          }
          min = top[top.length - 1].s;
        }
      }

      if (!top.length) {
        R.innerHTML = '<div class="sidebar-search-empty">No results for "' + esc(q) + '"</div>';
        return;
      }

      var re = reHl(t);
      var docs = idx.d, html = "";
      for (var x = 0; x < top.length; x++) {
        var d = docs[top[x].i] || [];
        var url = d[0] || "", title = d[1] || "", path = d[2] || "", sn = d[3] || "";
        html +=
          '<a class="sidebar-search-item" role="option" href="' + esc(prefix + url) + '">' +
          '<div class="sidebar-search-item-title">' + hl(esc(title), re) + '</div>' +
          (path ? '<div class="sidebar-search-item-path">' + esc(path.replace(/\//g, " \u203A ")) + '</div>' : '') +
          (sn ? '<div class="sidebar-search-item-snippet">' + hl(esc(sn), re) + '</div>' : '') +
          '</a>';
      }
      R.innerHTML = html;
    }

    // -------- wire input --------
    I.addEventListener("input", function () {
      if (pending) clearTimeout(pending);
      var v = I.value;
      pending = setTimeout(function () {
        if (!idx) load().then(function () { run(v); });
        else run(v);
      }, DEBOUNCE);
    });

    if (C) {
      C.addEventListener("click", function () {
        I.value = ""; R.innerHTML = ""; I.focus();
      });
    }

    document.addEventListener("click", function (e) {
      var box = document.getElementById("sidebar-search");
      if (box && !box.contains(e.target)) R.innerHTML = "";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
