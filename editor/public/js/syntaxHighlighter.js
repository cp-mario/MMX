/**
 * MMX Visual Editor — Syntax Highlighter (v2)
 *
 * Line-by-line MMX syntax highlighting with state tracking for
 * multi-line constructs (code blocks, admonitions, tables, HTML blocks).
 *
 * Each line is escaped then highlighted independently; block-level state
 * is tracked across lines so that content inside a code block gets a
 * uniform class and is not re-parsed for inline patterns.
 */

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Highlight MMX source text into HTML with syntax spans.
 * Supports multi-line inline formatting (bold, italic, strikethrough, underline, color)
 * by accumulating non-block lines and applying inline highlighting on joined text.
 * @param {string} code - Raw MMX source
 * @returns {string} HTML with <span> wrappers for highlighting
 */
export function highlightMmx(code) {
  if (!code) return "";

  const lines = code.split("\n");
  const out = new Array(lines.length);

  const state = {
    inCodeBlock: false,
    inAdmonition: false,
    inTable: false,
    inHtmlBlock: false,
    admonitionType: "",
    tableMode: "",
    tableRows: 0,
  };

  // Accumulate consecutive non-block lines so inline patterns
  // (bold, italic, strikethrough, underline, color tags) can span
  // across multiple lines.
  let pendingInline = [];

  function flushInline() {
    if (pendingInline.length === 0) return;
    // Join escaped text with newlines — inline patterns (with flags g/m)
    // operate on the full joined text, enabling multi-line matching.
    const joined = pendingInline.map(p => p.escaped).join('\n');
    const highlighted = highlightInline(joined);
    const parts = highlighted.split('\n');
    for (let j = 0; j < parts.length; j++) {
      out[pendingInline[j].index] = parts[j];
    }
    pendingInline = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const escaped = escapeHtml(raw);
    const blockResult = processBlockLine(state, escaped, raw);

    if (blockResult.block === "code") {
      flushInline();
      out[i] = `<span class="mmx-codeblock">${blockResult.line}</span>`;
    } else if (blockResult.block === "admonition") {
      // Admonitions can contain inline formatting, so we still highlight them
      // but each line is processed independently (inline across admon lines
      // is not supported since they are block containers).
      flushInline();
      out[i] = `<span class="mmx-admonition">${blockResult.line}</span>`;
    } else if (blockResult.block === "table") {
      flushInline();
      const tableContent = blockResult.line;
      let innerContent = tableContent;
      if (tableContent.startsWith('<span class="mmx-table">') && tableContent.endsWith('</span>')) {
        innerContent = tableContent.substring(26, tableContent.length - 7);
      }
      const highlightedContent = highlightInline(innerContent);
      out[i] = `<span class="mmx-table">${highlightedContent}</span>`;
    } else if (blockResult.block === "html") {
      flushInline();
      out[i] = `<span class="mmx-html-block">${blockResult.line}</span>`;
    } else {
      // Non-block — accumulate for batch inline highlighting (supports multiline)
      pendingInline.push({ index: i, raw, escaped });
    }
  }

  flushInline();

  return out.join("\n");
}

// ═════════════════════════════════════════════════════════════════════════════
// BLOCK-LEVEL PROCESSING
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Process a single line for block-level constructs. Updates the shared state.
 * @param {object} st - Shared state { inCodeBlock, inAdmonition, inTable, inHtmlBlock, admonitionType }
 * @param {string} escaped - HTML-escaped line
 * @param {string} raw - Original line (for pattern matching)
 * @returns {{ line: string, block: string|null }}
 */
function processBlockLine(st, escaped, raw) {
  const rawTrimmed = raw.trim();

  // ── Code block ─────────────────────────────────────────────────────────
  if (/^:::code\b/.test(rawTrimmed)) {
    st.inCodeBlock = true;
    // Highlight the opening marker
    const rest = escaped.replace(/^:::code/, "");
    return { line: `<span class="mmx-codeblock-marker">:::code</span>${rest}`, block: null };
  }
  if (st.inCodeBlock && /^:::\s*$/.test(rawTrimmed)) {
    st.inCodeBlock = false;
    return { line: `<span class="mmx-codeblock-marker">:::</span>`, block: null };
  }
  if (st.inCodeBlock) {
    // Inside a code block — no further highlighting
    return { line: escaped, block: "code" };
  }

  // ── Admonition ─────────────────────────────────────────────────────────
  const admonMatch = rawTrimmed.match(/^(>>>)(note|tip|important|warning|caution)((?:\s+.*)?)$/);
  if (admonMatch) {
    st.inAdmonition = true;
    st.admonitionType = admonMatch[2];
    const typeClass = `mmx-admonition-${admonMatch[2]}`;
    const markers = escapeHtml(admonMatch[1]);
    const typeName = escapeHtml(admonMatch[2]);
    const rest = admonMatch[3] ? escapeHtml(admonMatch[3]) : "";
    return {
      line: `<span class="mmx-admonition-marker">${markers}</span><span class="${typeClass}">${typeName}</span><span class="${typeClass}">${rest}</span>`,
      block: null,
    };
  }
  if (st.inAdmonition && /^>>>\s*$/.test(rawTrimmed)) {
    st.inAdmonition = false;
    st.admonitionType = "";
    return { line: `<span class="mmx-admonition-marker">>>></span>`, block: null };
  }
  if (st.inAdmonition) {
    // Inside an admonition — apply the admonition type colour but still
    // highlight inline elements so bold, italic, links etc. work.
    return { line: escaped, block: null };
  }

  // ── Table ──────────────────────────────────────────────────────────────
  if (/^#table\b/.test(rawTrimmed)) {
    st.inTable = true;
    // Parse mode from the #table line
    let tableMode = 'h';
    const modeMatch = rawTrimmed.match(/#table\(([^)]+)\)/);
    if (modeMatch) {
      tableMode = modeMatch[1];
    }
    st.tableMode = tableMode;
    st.tableRows = 0;
    
    const match = raw.match(/^#table(\s+[^\n]*)?$/);
    if (match) {
      const args = match[1] ? escapeHtml(match[1]) : "";
      return { line: `<span class="mmx-table-marker">#table</span>${args}`, block: null };
    }
    return { line: `<span class="mmx-table-marker">${escaped}</span>`, block: null };
  }
  if (st.inTable && /^#endtable\s*$/.test(rawTrimmed)) {
    st.inTable = false;
    return { line: `<span class="mmx-table-end">#endtable</span>`, block: null };
  }
  if (st.inTable) {
    st.tableRows++;
    let highlighted = escaped;
    if (st.tableMode === 'h' && st.tableRows === 1) {
      // Horizontal mode: first data row is header
      highlighted = `<span class="mmx-table-header">${escaped}</span>`;
    } else if (st.tableMode === 'v') {
      // Vertical mode: first cell of each row is the label/header
      const pipeIdx = escaped.indexOf('|');
      if (pipeIdx >= 0) {
        highlighted = `<span class="mmx-table-header">${escaped.substring(0, pipeIdx)}</span>${escaped.substring(pipeIdx)}`;
      }
    } else if (st.tableMode === 'b') {
      if (st.tableRows === 1) {
        // Both mode: first row is all headers
        highlighted = `<span class="mmx-table-header">${escaped}</span>`;
      } else {
        // Subsequent rows: first cell is label header
        const pipeIdx = escaped.indexOf('|');
        if (pipeIdx >= 0) {
          highlighted = `<span class="mmx-table-header">${escaped.substring(0, pipeIdx)}</span>${escaped.substring(pipeIdx)}`;
        }
      }
    }
    return { line: highlighted, block: "table" };
  }

  // ── HTML block ─────────────────────────────────────────────────────────
  if (/^#html\b/.test(rawTrimmed)) {
    st.inHtmlBlock = true;
    const match = raw.match(/^#html(\s+[^\n]*)?$/);
    if (match && match[1]) {
      const rest = escapeHtml(match[1]);
      return { line: `<span class="mmx-html-block">#html</span>${rest}`, block: null };
    }
    return { line: `<span class="mmx-html-block">${escaped}</span>`, block: null };
  }
  if (st.inHtmlBlock && /^###\s*$/.test(rawTrimmed)) {
    st.inHtmlBlock = false;
    return { line: `<span class="mmx-html-block">###</span>`, block: null };
  }
  if (st.inHtmlBlock) {
    return { line: escaped, block: "html" };
  }

  return { line: escaped, block: null };
}

// ═════════════════════════════════════════════════════════════════════════════
// INLINE HIGHLIGHTING
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Apply inline syntax highlighting to escaped MMX text using a single-pass
 * position-based approach.
 *
 * Instead of running sequential `.replace()` calls (which let HTML inserted
 * by one pattern pollute the input of later patterns — e.g. `**bold** *italic*`
 * broke because the italic regex saw asterisks left inside the bold span),
 * we collect ALL matches on the CLEAN escaped text first, then sort them
 * by position, discard overlapping ones (earliest-start / longest wins),
 * and build the final HTML in one pass.
 *
 * Multi-line text is supported natively because the character classes
 * (`[^*]+`, `[^~]+`, etc.) already match newlines.  The caller is
 * responsible for joining non-block lines before invoking this function.
 *
 * @param {string} escaped - HTML-escaped text (may contain newlines)
 * @returns {string} HTML with inline highlighting spans
 */
function highlightInline(escaped) {
  // ── Collect all candidate spans ───────────────────────────────────────
  const spans = [];

  function add(start, end, html) {
    spans.push({ start, end, html });
  }

  // 1. Comments (must come before most patterns)
  for (const m of escaped.matchAll(/(&lt;!--[\s\S]*?--&gt;)/g)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-comment">${m[0]}</span>`);
  }

  // 2. Headings
  for (const m of escaped.matchAll(/^((#{1,6})[ \t]+(.*?)(?:[ \t]*(%\{.*?%\})?[ \t]*)?)$/gm)) {
    const level = m[2].length;
    const hClass = `mmx-h${level}`;
    let result = `<span class="${hClass}">${m[2]}</span> `;
    if (m[3]) result += `<span class="${hClass}">${escapeHtml(m[3])}</span>`;
    if (m[4]) result += ` <span class="mmx-heading-tag">${escapeHtml(m[4])}</span>`;
    add(m.index, m.index + m[0].length, result);
  }

  // 3. Single-line directives
  for (const m of escaped.matchAll(/(^#b[ \t]*$)/gm)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-break">${m[0]}</span>`);
  }
  for (const m of escaped.matchAll(/(^#s[ \t]*$)/gm)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-separator">${m[0]}</span>`);
  }
  for (const m of escaped.matchAll(/(^#code\([^)]*\)(?:[ \t]+[\w \t]+)?$)/gm)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-codeblock">${m[0]}</span>`);
  }
  for (const m of escaped.matchAll(/(^#iframe\(.*?\)$)/gm)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-iframe">${m[0]}</span>`);
  }
  for (const m of escaped.matchAll(/(^!!!\([^)]*\)(?:[ \t]+[\w\- \t]+)?[ \t]*$)/gm)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-audio">${m[0]}</span>`);
  }
  for (const m of escaped.matchAll(/(^!!\([^)]*\)(?:[ \t]+[\w\- \t]+)?[ \t]*$)/gm)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-video">${m[0]}</span>`);
  }
  for (const m of escaped.matchAll(/(^!\[[^\]]*\]\([^)]*\)(?:[ \t]+[\w\- \t]+)?[ \t]*$)/gm)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-image">${m[0]}</span>`);
  }

  // 4. Special inline constructs
  for (const m of escaped.matchAll(/(\$\$[A-Za-z_][A-Za-z0-9_\-]*)/g)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-anchor-link">${m[0]}</span>`);
  }
  for (const m of escaped.matchAll(/(\$\[[^\]]*\]\([A-Za-z0-9_\-]+\))/g)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-anchor">${m[0]}</span>`);
  }
  // <c="color">text</c>  (multiline: [\s\S] matches newlines)
  for (const m of escaped.matchAll(/(&lt;c="[^"]*"&gt;[\s\S]*?&lt;\/c&gt;)/g)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-color-tag">${m[0]}</span>`);
  }
  // <ch>text</ch> or <ch="color">text</ch>  (multiline)
  for (const m of escaped.matchAll(/(&lt;ch(?:="[^"]*")?&gt;[\s\S]*?&lt;\/ch&gt;)/g)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-highlight-tag">${m[0]}</span>`);
  }
  for (const m of escaped.matchAll(/(&lt;colorDisplay="[^"]*"\s*\/&gt;)/g)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-colordisplay">${m[0]}</span>`);
  }
  for (const m of escaped.matchAll(/(&lt;\-[^>]+\-&gt;)/g)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-image">${m[0]}</span>`);
  }
  for (const m of escaped.matchAll(/(&lt;%[^%]*%&gt;)/g)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-inline-raw">${m[0]}</span>`);
  }

  // 5. Inline formatting
  // `code` (inline code)
  for (const m of escaped.matchAll(/(`[^`]+`)/g)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-code">${m[0]}</span>`);
  }
  // **bold**
  for (const m of escaped.matchAll(/(\*\*[^*]+\*\*)/g)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-bold">${m[0]}</span>`);
  }
  // *italic* (but not ** — lookahead + lookbehind prevents matching
  // inside ** or at the second * of a ** marker, e.g. "**bold** *italic*")
  for (const m of escaped.matchAll(/(?<!\*)\*(?!\*)[^*]+\*(?!\*)/g)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-italic">${m[0]}</span>`);
  }
  // ~strikethrough~  (multi-line: [^~]+ matches any char except ~)
  for (const m of escaped.matchAll(/(~[^~]+~)/g)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-strikethrough">${m[0]}</span>`);
  }
  // __underline__  (multi-line: [^_]+ matches any char except _)
  for (const m of escaped.matchAll(/(__[^_]+__)/g)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-underline">${m[0]}</span>`);
  }
  // [text](url) — link
  for (const m of escaped.matchAll(/(\[[^\]]*\]\([^)]*\))/g)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-link">${m[0]}</span>`);
  }

  // 6. List markers
  for (const m of escaped.matchAll(/^(-[\t ]+\S)/gm)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-list-marker">-</span>${m[0].slice(1)}`);
  }
  for (const m of escaped.matchAll(/^(\+[\t ]+\S)/gm)) {
    add(m.index, m.index + m[0].length,
      `<span class="mmx-list-marker">+</span>${m[0].slice(1)}`);
  }
  for (const m of escaped.matchAll(/^(\d+\.[\t ]+\S)/gm)) {
    const dotIdx = m[0].indexOf(".");
    add(m.index, m.index + m[0].length,
      `<span class="mmx-list-marker">${m[0].slice(0, dotIdx + 1)}</span>${m[0].slice(dotIdx + 1)}`);
  }
  for (const m of escaped.matchAll(/(\[ \]|\[x\]|\[X\])/g)) {
    const html = m[0] === "[ ]"
      ? '<span class="mmx-task-uncheck">[ ]</span>'
      : `<span class="mmx-task-check">${m[0]}</span>`;
    add(m.index, m.index + m[0].length, html);
  }

  // ── Sort & resolve overlaps ──────────────────────────────────────────
  // Sort by start position, then longer span first (for same-start ties).
  spans.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  const filtered = [];
  let lastEnd = 0;
  for (const s of spans) {
    if (s.start >= lastEnd) {
      filtered.push(s);
      lastEnd = s.end;
    }
  }

  // ── Build result ─────────────────────────────────────────────────────
  let result = '';
  let pos = 0;
  for (const s of filtered) {
    result += escaped.slice(pos, s.start);
    result += s.html;
    pos = s.end;
  }
  result += escaped.slice(pos);

  return result;
}

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Escape HTML special characters.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
