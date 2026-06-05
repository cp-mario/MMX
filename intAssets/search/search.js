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

    function slugifyId(s) {
      return String(s || "")
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
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

    // Levenshtein distance for fuzzy matching (small, efficient impl)
    function levenshtein(a, b) {
      if (a === b) return 0;
      a = String(a || ""); b = String(b || "");
      var la = a.length, lb = b.length;
      if (la === 0) return lb;
      if (lb === 0) return la;
      var prev = new Array(lb + 1), cur = new Array(lb + 1);
      for (var j = 0; j <= lb; j++) prev[j] = j;
      for (var i = 0; i < la; i++) {
        cur[0] = i + 1;
        var ai = a.charAt(i);
        for (var j = 0; j < lb; j++) {
          var cost = ai === b.charAt(j) ? 0 : 1;
          var del = prev[j + 1] + 1;
          var ins = cur[j] + 1;
          var sub = prev[j] + cost;
          cur[j + 1] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
        }
        var tmp = prev; prev = cur; cur = tmp;
      }
      return prev[lb];
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
      var missingToken = false;
      for (var i = 0; i < tokens.length; i++) {
        var p = M[tokens[i]];
        if (!p) { missingToken = true; break; }
        var L = p.length >> 1;
        if (L < seedLen) { seedLen = L; seed = i; }
      }

      // Fallback fuzzy scan when an indexed token is missing: allow
      // approximate matches (typos/spaces) by scanning haystacks.
      if (missingToken) {
        var cap = expanded ? 1e9 : MAX;
        var D = idx.d || [];
        var H = idx.h || [];
        var phrase = joinPhrase(tokens);
        var top = [];
        for (var dId = 0; dId < D.length; dId++) {
          var d = D[dId] || [];
          var title = d[1] || '';
          var hdrs = H[dId] || [];
          var hay = makeHaystack(hdrs, title);
          var score = 0;
          if (phrase && hay.indexOf(phrase) >= 0) score += PHRASE_BONUS + 100;
          for (var ti = 0; ti < tokens.length; ti++) {
            var tk = tokens[ti];
            if (!tk) continue;
            if (hay.indexOf(tk) >= 0) score += 30;
            else {
              var words = hay.split(/\s+/);
              for (var wi = 0; wi < words.length; wi++) {
                var wd = words[wi];
                if (!wd) continue;
                if (Math.abs(wd.length - tk.length) <= 2 && levenshtein(wd, tk) <= 1) { score += 15; break; }
                if (wd.indexOf(tk) >= 0) { score += 10; break; }
              }
            }
          }
          if (score > 0) top.push({ i: dId, s: score, hdr: null });
        }
        top.sort(function(a,b){ return b.s - a.s; });
        if (top.length > cap) top.length = cap;
        for (var r = 0; r < top.length; r++) {
          top[r].hdr = pickHeader((H[top[r].i] || []), joinPhrase(tokens));
        }
        return { empty: false, noMatch: false, results: top };
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

      var tokensArr = tok(q);
      var phrase = joinPhrase(tokensArr);
      var re = reHl(tokensArr);
      var docs = idx.d, html = "";

      for (var x = 0; x < state.results.length; x++) {
        var r = state.results[x];
        var d = docs[r.i] || [];
        var url = d[0] || "", title = d[1] || "", path = d[2] || "", sn = d[3] || "";
        var baseHref = prefix + url;

        // Check per-page headers and render any that match the query/tokens
        var hdrs = (idx.h && idx.h[r.i]) || [];
        var matchedHeaders = [];
        for (var hi = 0; hi < hdrs.length; hi++) {
          var hid = hdrs[hi][0] || "";
          var htxt = hdrs[hi][1] || "";
          var hn = norm(htxt);
          if (phrase && hn.indexOf(phrase) >= 0) {
            matchedHeaders.push({ id: hid, text: htxt });
            continue;
          }
          for (var ti = 0; ti < tokensArr.length; ti++) {
            if (tokensArr[ti] && hn.indexOf(tokensArr[ti]) >= 0) {
              matchedHeaders.push({ id: hid, text: htxt });
              break;
            }
          }
        }

        // Render header-level results first (one per matching header)
        for (var m = 0; m < matchedHeaders.length; m++) {
          var mid = matchedHeaders[m].id || "";
          var mtext = matchedHeaders[m].text || "";
          var slug = slugifyId(mtext);
          var anchor = slug ? ('#' + slug) : (mid ? ('#' + mid) : '');
          var href = baseHref + anchor;
          html +=
            '<a class="sidebar-search-item" role="option" href="' + esc(href) + '">' +
            '<div class="sidebar-search-item-title">' + hl(esc(mtext), re) + '</div>' +
            (title ? '<div class="sidebar-search-item-path">' + esc(title) + '</div>' : '') +
            (sn ? '<div class="sidebar-search-item-snippet">' + hl(esc(sn), re) + '</div>' : '') +
            '</a>';
        }

        // If no header matched, fall back to the page-level result
        if (matchedHeaders.length === 0) {
          // Try to pick the best header for this result (from collect())
          var anchor2 = '';
          if (r.hdr) {
            // try to locate the header text for the id stored in the index
            var foundText = '';
            for (var hi2 = 0; hi2 < hdrs.length; hi2++) {
              if ((hdrs[hi2][0] || '') === r.hdr) { foundText = hdrs[hi2][1] || ''; break; }
            }
            var sl = slugifyId(foundText);
            if (sl) anchor2 = '#' + sl;
            else anchor2 = '#' + r.hdr;
          } else if (hdrs.length) {
            var firstText = hdrs[0][1] || '';
            var sl2 = slugifyId(firstText);
            if (sl2) anchor2 = '#' + sl2;
          }

          var href2 = baseHref + (anchor2 || '');
          html +=
            '<a class="sidebar-search-item" role="option" href="' + esc(href2) + '">' +
            '<div class="sidebar-search-item-title">' + hl(esc(title), re) + '</div>' +
            (path ? '<div class="sidebar-search-item-path">' + esc(path.replace(/\//g, " \u203A ")) + '</div>' : '') +
            (sn ? '<div class="sidebar-search-item-snippet">' + hl(esc(sn), re) + '</div>' : '') +
            '</a>';
        }
      }
      R.innerHTML = html;
    }

    // Delegated click for the "view all" / "show fewer" toggle button inside
    // R. We use stopPropagation() so the document-level "click outside" handler
    // doesn't immediately clear the results we are about to re-render.
    R.addEventListener('click', function (e) {
      var el = e.target;
      while (el && el !== R) {
        if (el.classList && el.classList.contains('sidebar-search-more')) {
          e.preventDefault();
          e.stopPropagation();
          expanded = !expanded;
          if (lastQ) run(lastQ, expanded);
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

      // Decide whether to append a toggle button at the end of the list.
      // - collapsed view: append "View all results (N)" only if there are
      //   more results than MAX.
      // - expanded view: append "Show fewer results" so the user can collapse.
      if (!state.empty && !state.noMatch) {
        if (!expanded && state.results.length === MAX) {
          var total = countAll(q);
          if (total > MAX) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'sidebar-search-more';
            btn.innerHTML = '<span class="sidebar-search-more-label">View all results</span>' +
                            ' <span class="sidebar-search-more-count">(' + total + ')</span>';
            R.appendChild(btn);
          }
        } else if (expanded && keepExpanded) {
          var btnLess = document.createElement('button');
          btnLess.type = 'button';
          btnLess.className = 'sidebar-search-more sidebar-search-less';
          btnLess.innerHTML = '<span class="sidebar-search-more-label">Show fewer results</span>';
          R.appendChild(btnLess);
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
      // We check composedPath() (not e.target) because the R-level delegated
      // handler may have removed the original target from the DOM before
      // this document-level bubble handler runs - in that case
      // box.contains(e.target) would falsely return false and the results
      // would be wiped out right after being re-rendered.
      var path = e.composedPath ? e.composedPath() : [];
      var inside = false;
      for (var i = 0; i < path.length; i++) {
        if (path[i] && path[i].id === 'sidebar-search') { inside = true; break; }
      }
      if (!inside) R.innerHTML = '';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
        // Build the href with the #headerId so highlightOnLoad on the
