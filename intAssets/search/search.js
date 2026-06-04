/*!
 * MMX sidebar search.
 * Single index fetch (intAssets/search-index.json), same code path for any
 * size, no options, no flags. Per-query cost is bounded by the smallest
 * posting list of the query terms. Snippets are highlighted at runtime
 * so multi-term queries highlight every term in the snippet.
 *
 * Index (built by scripts/searchIndexBuilder.js):
 *   { v: 4,
 *     d: [[url, title, breadcrumb, snippet], ...],
 *     i: { token: [docIdDelta, weight, docIdDelta, weight, ...] },
 *     h: [[ [headerId, headerText], ... ], ...]   // by docId
 *   }
/*!
 * MMX sidebar search (v4 runtime).
 * See scripts/searchIndexBuilder.js for index format and headers field.
 */
(function () {
  function init() {
    var I = document.getElementById("sidebar-search-input");
    var R = document.getElementById("sidebar-search-results");
    if (!I || !R) return;
    var C = document.getElementById("sidebar-search-clear");

    var MAX = 8;
    var DEBOUNCE = 80;
    var MIN_CHARS = 1; // allow single-char raw queries (1-char matches require reindex)
    var MIN_TOKEN = 2; // include 2-char tokens (1-char requires rebuild)
    var IDLE_MS = 300;

    var W = [100, 30, 8, 2];
    var ALL_BONUS = 50;
    var PHRASE_BONUS = 80;

    var idx = null;
    var loading = null;
    var pending = null;
    var lastKey = "";
    var lastRe = null;
    var expanded = false;
    var lastQ = "";

    function esc(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function norm(s) {
      return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }

    function tok(q) {
      if (!q) return [];
      var n = norm(q);
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
      var parts = terms.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); });
      lastKey = k;
      lastRe = new RegExp("(" + parts.join("|") + ")", "gi");
      return lastRe;
    }

    function hl(s, re) { return re ? s.replace(re, "<mark>$1</mark>") : s; }

    function load() {
      if (idx) return Promise.resolve(idx);
      if (loading) return loading;
      loading = fetch(prefix + "intAssets/search-index.json", { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && j.v === 4 && j.d && j.i) idx = j; return idx; })
        .catch(function () { return null; });
      return loading;
    }

    if ("requestIdleCallback" in window) requestIdleCallback(load, { timeout: IDLE_MS });
    else setTimeout(load, IDLE_MS);
    I.addEventListener("focus", load, { once: true });

    function has(arr, docId) {
      var a = 0, i = 0;
      for (; i < arr.length; i += 2) {
        a += arr[i];
        if (a === docId) return arr[i + 1];
        if (a > docId) return -1;
      }
      return -1;
    }

    function makeHaystack(headers, title) {
      var parts = [norm(title || "")];
      for (var i = 0; i < (headers || []).length; i++) parts.push(norm(headers[i][1] || ""));
      return parts.join(" \u0001 ");
    }

    function pickHeader(headers, phrase) {
      if (!headers || !headers.length) return null;
      if (phrase) {
        for (var i = 0; i < headers.length; i++) {
          if (norm(headers[i][1] || "").indexOf(phrase) >= 0) return headers[i][0] || null;
        }
      }
      return headers[0][0] || null;
    }

    function joinPhrase(tokens) { return tokens.join(" "); }

    function collect(q) {
      var tokensAll = tok(q);
      var tokens = tokensAll.filter(function (t) { return t.length >= MIN_TOKEN; });
      if (!tokens.length) return { empty: tokensAll.length > 0, noMatch: false, results: [] };

      var M = idx.i, seed = 0, seedLen = 1/0;
      for (var i = 0; i < tokens.length; i++) {
        var p = M[tokens[i]];
        if (!p) return { empty: false, noMatch: true, results: [] };
        var L = p.length >> 1;
        if (L < seedLen) { seedLen = L; seed = i; }
      }

      var sp = M[tokens[seed]];
      var others = new Array(tokens.length - 1);
      for (var j = 0, oi = 0; j < tokens.length; j++) if (j !== seed) others[oi++] = M[tokens[j]];

      var phrase = joinPhrase(tokens);
      var cap = expanded ? 1e9 : MAX;

      var top = [], min = -1, acc = 0;
      for (var k = 0; k < sp.length; k += 2) {
        acc += sp[k];
        var dId = acc;
        var sc = W[sp[k+1]] || 0;
        var hit = 1;
        for (var m = 0; m < others.length; m++) {
          var w = has(others[m], dId);
          if (w < 0) { sc = -1; break; }
          sc += W[w] || 0; hit++;
        }
        if (sc < 0) continue;
        if (hit === tokens.length) sc += ALL_BONUS;

        var hdrs = (idx.h && idx.h[dId]) || [];
        var hay = makeHaystack(hdrs, (idx.d[dId] || [])[1] || "");
        if (phrase && hay.indexOf(phrase) >= 0) sc += PHRASE_BONUS;

        var item = { i: dId, s: sc, hdr: null };
        if (top.length < cap) {
          top.push(item);
          for (var s = top.length - 1; s > 0 && top[s-1].s < top[s].s; s--) { var tmp = top[s-1]; top[s-1] = top[s]; top[s] = tmp; }
          min = top[top.length-1].s;
        } else if (sc > min) {
          top[top.length-1] = item;
          for (var s2 = top.length - 1; s2 > 0 && top[s2-1].s < top[s2].s; s2--) { var tmp2 = top[s2-1]; top[s2-1] = top[s2]; top[s2] = tmp2; }
          min = top[top.length-1].s;
        }
      }

      for (var r = 0; r < top.length; r++) {
        var dId2 = top[r].i;
        var hdrs2 = (idx.h && idx.h[dId2]) || [];
        top[r].hdr = pickHeader(hdrs2, phrase);
      }

      return { empty: false, noMatch: false, results: top };
    }

    function render(state, q) {
      if (state.noMatch || !state.results.length) { R.innerHTML = '<div class="sidebar-search-empty">No results for "' + esc(q) + '"</div>'; return; }

      var re = reHl(tok(q));
      var docs = idx.d, html = "";
      for (var x = 0; x < state.results.length; x++) {
        var r = state.results[x];
        var d = docs[r.i] || [];
        var url = d[0] || "", title = d[1] || "", path = d[2] || "", sn = d[3] || "";
        var href = prefix + url;
        // Pass the raw query to the destination page so it can locate
        // the nearest parent header for the actual match. Avoid forcing
        // a specific hash here so the page can decide the best anchor.
        if (q) {
          var sep = url.indexOf('?') === -1 ? '?' : '&';
          href += sep + 'q=' + encodeURIComponent(q);
        } else if (r.hdr) {
          href += "#" + r.hdr;
        }
        html +=
          '<a class="sidebar-search-item" role="option" href="' + esc(href) + '">' +
          '<div class="sidebar-search-item-title">' + hl(esc(title), re) + '</div>' +
          (path ? '<div class="sidebar-search-item-path">' + esc(path.replace(/\//g, " \u203A ")) + '</div>' : '') +
          (sn ? '<div class="sidebar-search-item-snippet">' + hl(esc(sn), re) + '</div>' : '') +
          '</a>';
      }
      R.innerHTML = html;
    }

    // delegated click for the "ver todos" button inside R
    R.addEventListener('click', function (e) {
      var el = e.target;
      while (el && el !== R) {
        if (el.classList && el.classList.contains('sidebar-search-more')) {
          e.preventDefault();
          expanded = true;
          if (lastQ) run(lastQ, true);
          return;
        }
        el = el.parentElement;
      }
    });

    function run(q, keepExpanded) {
      q = String(q || "").trim();
      lastQ = q;
      expanded = !!keepExpanded || false;
      if (q.length < MIN_CHARS) { R.innerHTML = ""; return; }
      if (!idx) { R.innerHTML = '<div class="sidebar-search-empty">Loading\u2026</div>'; return; }

      var state = collect(q);
      render(state, q);

      if (!state.empty && !state.noMatch && state.results.length === MAX && !expanded) {
        var total = countAll(q);
        if (total > MAX) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'sidebar-search-more';
          btn.textContent = 'View all results (' + total + ')';
          R.appendChild(btn);
        }
      }
    }

    function countAll(q) {
      var tokensAll = tok(q);
      var tokens = tokensAll.filter(function (t) { return t.length >= MIN_TOKEN; });
      if (!tokens.length) return 0;
      var M = idx.i, seed = 0, seedLen = 1/0;
      for (var i = 0; i < tokens.length; i++) {
        var p = M[tokens[i]];
        if (!p) return 0;
        var L = p.length >> 1;
        if (L < seedLen) { seedLen = L; seed = i; }
      }
      var sp = M[tokens[seed]];
      var others = new Array(tokens.length - 1);
      for (var j = 0, oi = 0; j < tokens.length; j++) if (j !== seed) others[oi++] = M[tokens[j]];

      var acc = 0, cnt = 0;
      for (var k = 0; k < sp.length; k += 2) {
        acc += sp[k];
        var dId = acc;
        var ok = true;
        for (var m = 0; m < others.length; m++) { if (has(others[m], dId) < 0) { ok = false; break; } }
        if (ok) cnt++;
      }
      return cnt;
    }

    I.addEventListener('input', function () {
      if (pending) clearTimeout(pending);
      var v = I.value;
      pending = setTimeout(function () { if (!idx) load().then(function () { run(v); }); else run(v); }, DEBOUNCE);
    });

    if (C) C.addEventListener('click', function () { I.value = ''; R.innerHTML = ''; I.focus(); });

    document.addEventListener('click', function (e) {
      var box = document.getElementById('sidebar-search');
      if (box && !box.contains(e.target)) R.innerHTML = '';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
        // Build the href with the #headerId so highlightOnLoad on the
