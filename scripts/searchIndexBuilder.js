/**
 * MMX Search Index Builder
 *
 * Generates a compact inverted index at build time so the runtime search
 * (intAssets/search/search.js) can answer queries with O(tokens + postings)
 * work and only a single network fetch.
 *
 * Index format (v3, compact):
 *   {
 *     "v": 3,
 *     "d": [[url, title, breadcrumb, snippet], ...],          // docs, by id
 *     "i": { "token": [docId0, w0, docId1, w1, ...], ... }    // inverted index
 *   }
 *
 * - Postings are stored as a single flat array per token: alternating
 *   [docId, weight, ...]. docId values are delta-encoded (each entry stores
 *   the delta from the previous docId in the same token's list) so the
 *   numbers stay tiny and gzip-friendly.
 * - weight is a single digit 0-3 (0=title, 1=heading, 2=section, 3=body),
 *   so 1 byte per posting in the JSON.
 * - Snippets are stored as plain text (no <mark>). The runtime applies
 *   highlights via a single regex per query, which is both smaller on
 *   the wire and more correct for multi-term queries.
 * - The index is sorted by docId within each token, which is required
 *   for the delta-encoding trick.
 */

import fs from "fs";
import path from "path";
import { mmxToHtml } from "./parser.js";
import { toKebabCase } from "./kebabCase.js";

/**
 * Compile .mmx -> plain text. We preprocess the raw MMX to drop things
 * we never want indexed (media references, the heading link button's
 * SVG/title noise, etc.), then run the parser to get clean HTML, then
 * strip the remaining tags.
 *
 * Doing the media-strip on the MMX (not the HTML) is important: those
 * directives are simple line patterns, easier to drop here, and the
 * parser otherwise leaves `path="assets/foo.png"` text behind inside
 * <pre> blocks, polluting the index.
 *
 * @param {string} mmx - Raw MMX content
 * @returns {string} Plain text
 */
export function extractMmxPlainText(mmx) {
  const cleanMmx = stripMmxNoise(mmx);
  const html = mmxToHtml(cleanMmx);
  return stripHtml(html);
}

/**
 * Drop MMX-only noise from the source before it ever reaches the parser.
 * We remove:
 *   - the heading link button text/SVG (parser-injected, not user content)
 *   - code-file inclusion directives (#code(path)) - the path is searchable
 *     elsewhere, the loaded content is the user's file
 *   - block media directives (image/video/audio) - the alt text is a label,
 *     not body content worth indexing
 *   - inline image directives
 *   - other monoline directives that add no searchable text
 */
function stripMmxNoise(mmx) {
  return mmx
    // Code file inclusions: `#code(path/to/file) [flags]`
    .replace(/^#code\([^)]*\)(?:\s+[\w\s]+)?\s*$/gm, "")
    // Block media: ! [](path) [classes], !!(path), !!!(path)
    .replace(/^!?!!?\[[^\]]*\]\([^)]*\)(?:\s+[\w\-\s]+)?\s*$/gm, "")
    .replace(/^!!\([^)]*\)(?:\s+[\w\-\s]+)?\s*$/gm, "")
    .replace(/^!!!\([^)]*\)(?:\s+[\w\-\s]+)?\s*$/gm, "")
    // Inline image icon: <-path->
    .replace(/<\-[^>]+\->/g, "")
    // iframe directive: #iframe( ... )
    .replace(/^#iframe\([\s\S]+?\)\s*$/gm, "")
    // Hard-break (#b) and separator (#s) markers
    .replace(/^#b.*$/gm, "")
    .replace(/^#s.*$/gm, "")
    // Colored-text span: <c="...">...</c>  -> keep inner text
    .replace(/<c="[^"]+">([\s\S]*?)<\/c>/g, "$1");
}

/**
 * Remove HTML tags and decode the few entities we use. We also drop the
 * heading link button's title/SVG text (the parser injects a "Copy link"
 * title and an SVG which leaks into the visible text otherwise).
 */
function stripHtml(html) {
  if (!html) return "";
  return html
    // Drop entire <script>, <style>, and the heading link button blocks
    // (they carry no useful indexable text).
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<button[^>]*class="heading-link-btn"[\s\S]*?<\/button>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    // Replace block-level closing tags with a space so words don't merge
    .replace(/<\/(p|div|li|h[1-6]|tr|td|th|blockquote|pre|br|hr)>/gi, " ")
    // Drop remaining tags
    .replace(/<[^>]+>/g, " ")
    // Decode common entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tokenize the same way the runtime does, so build-time weights line up
 * with runtime matches exactly.
 */
function tokenize(s) {
  if (!s) return [];
  const norm = String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const out = [];
  const re = /[a-z0-9]{2,}/g;
  let m;
  while ((m = re.exec(norm)) !== null) out.push(m[0]);
  return out;
}

/**
 * Find the first occurrence of any term in the text. Used to center the
 * snippet on the first match so the user sees relevant context.
 * Returns the lower-case char index of the first match, or -1.
 */
function findFirstHit(lowerText, terms) {
  let best = -1;
  for (const t of terms) {
    const idx = lowerText.indexOf(t);
    if (idx >= 0 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

/**
 * Build a single search entry: doc metadata + inverted-index postings.
 */
export function buildSearchEntry({ url, title, breadcrumb, mmx }) {
  const text = extractMmxPlainText(mmx);

  // The body used for tokenization is capped so a single huge page can't
  // blow up the index. The user only ever reads the first ~8K of any doc
  // in a search result, so indexing more is wasted bytes.
  const BODY_CAP = 8000;
  const bodyForTokens = text.length > BODY_CAP ? text.slice(0, BODY_CAP) : text;
  const lower = bodyForTokens.toLowerCase();

  // Snippet: ~200 chars centered on the first title-token hit. If we
  // can't find one, just show the head of the doc. We always show a
  // small slice, not the whole body.
  const seedTerms = tokenize(title).slice(0, 3);
  const SNIPPET_RADIUS = 100;
  let snippet = bodyForTokens;
  if (bodyForTokens.length > SNIPPET_RADIUS * 2) {
    const hit = seedTerms.length ? findFirstHit(lower, seedTerms) : -1;
    const start = hit < 0 ? 0 : Math.max(0, hit - SNIPPET_RADIUS);
    const end = Math.min(bodyForTokens.length, start + SNIPPET_RADIUS * 2);
    snippet =
      (start > 0 ? "\u2026" : "") +
      bodyForTokens.slice(start, end) +
      (end < bodyForTokens.length ? "\u2026" : "");
  }

  // Title tokens get the highest weight (0). Everything else from the
  // body goes to weight 3. A token that appears in both keeps the
  // title weight, which is what users expect.
  const tokens = Object.create(null);
  const titleToks = tokenize(title);
  for (let i = 0; i < titleToks.length; i++) tokens[titleToks[i]] = 0;

  // Tokenize the body once. The same `tokenize` returns a flat list of
  // words; we only need to know *which* tokens exist in the body, not
  // how many times, so we walk the list and insert weight-3 entries
  // for anything not already a title token.
  const bodyToks = tokenize(bodyForTokens);
  for (let i = 0; i < bodyToks.length; i++) {
    const t = bodyToks[i];
    if (tokens[t] === undefined) tokens[t] = 3;
  }

  return {
    url,
    title,
    breadcrumb,
    snippet,
    tokens,
  };
}

/**
 * Walk the pages source dir, build entries for every .mmx and the root
 * index.mmx, in deterministic order.
 */
export function collectSearchEntries(pagesSourceDir, rootIndexMmxPath) {
  const entries = [];
  const mmxFiles = [];

  if (rootIndexMmxPath && fs.existsSync(rootIndexMmxPath)) {
    mmxFiles.push({ absPath: rootIndexMmxPath, relPath: "index.mmx" });
  }

  walk(pagesSourceDir, pagesSourceDir, mmxFiles);

  // Deterministic order: index first, then everything else sorted.
  mmxFiles.sort((a, b) => {
    if (a.relPath === "index.mmx") return -1;
    if (b.relPath === "index.mmx") return 1;
    return a.relPath.localeCompare(b.relPath);
  });

  for (const { absPath, relPath } of mmxFiles) {
    const mmx = fs.readFileSync(absPath, "utf8");
    const title = extractTitle(mmx) || relPath;
    const breadcrumb = buildBreadcrumb(relPath);
    const url = relPath === "index.mmx"
      ? "index.html"
      : "pages/" + toKebabCase(relPath).replace(/\.mmx$/i, ".html");

    entries.push(buildSearchEntry({ url, title, breadcrumb, mmx }));
  }

  return entries;
}

function walk(dir, root, out) {
  if (!fs.existsSync(dir)) return;
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walk(full, root, out);
    } else if (item.toLowerCase().endsWith(".mmx")) {
      out.push({ absPath: full, relPath: path.relative(root, full).replace(/\\/g, "/") });
    }
  }
}

/**
 * Pull the page title out of MMX: the first H1 line "# Title" wins.
 * Falls back to null when there isn't one.
 */
function extractTitle(mmx) {
  const m = /^\s*#\s+(.+?)\s*(?:%\{[^}]+\}%\s*)?$/m.exec(mmx);
  return m ? m[1].trim() : null;
}

/**
 * Build the breadcrumb from the relative path. "Examples/Code example.mmx"
 * -> "Examples". The root index has no breadcrumb.
 */
function buildBreadcrumb(relPath) {
  if (relPath === "index.mmx") return "";
  const parts = relPath.split("/");
  parts.pop(); // drop filename
  return parts.map(p => toKebabCase(p)).join("/");
}

/**
 * Write the compact JSON index to intAssets/search-index.json. The output
 * is minified (no whitespace) and uses a stable key order so the file
 * changes minimally between builds of the same project.
 */
export function writeSearchIndex(outputDir, entries) {
  const docs = entries.map(e => [e.url, e.title, e.breadcrumb, e.snippet]);

  // Build the inverted index. We accumulate per-token arrays of [docId, weight],
  // sort by docId, then emit as a flat delta-encoded array for compactness.
  const inv = new Map();
  for (let docId = 0; docId < entries.length; docId++) {
    const toks = entries[docId].tokens;
    for (const t in toks) {
      let arr = inv.get(t);
      if (!arr) {
        arr = [];
        inv.set(t, arr);
      }
      // First occurrence: store [docId, weight]
      arr.push([docId, toks[t]]);
    }
  }

  const indexOut = {};
  for (const [token, arr] of inv) {
    // Sort by docId so the delta-encoding stays monotonic
    arr.sort((a, b) => a[0] - b[0]);
    const flat = new Array(arr.length * 2);
    let prev = 0;
    for (let i = 0; i < arr.length; i++) {
      const [docId, w] = arr[i];
      flat[i * 2] = docId - prev;
      flat[i * 2 + 1] = w;
      prev = docId;
    }
    indexOut[token] = flat;
  }

  const out = { v: 3, d: docs, i: indexOut };
  const outDir = path.join(outputDir, "intAssets");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "search-index.json"),
    JSON.stringify(out),
    "utf8"
  );
}
