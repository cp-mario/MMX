/**
 * MMX to HTML Parser
 * Converts custom MMX format to valid HTML
 */

import { PATTERNS } from "./patterns.js";

/**
 * Main conversion function
 * @param {string} mmx - Raw MMX content
 * @returns {string} HTML content
 */
export function mmxToHtml(mmx) {
  let result = mmx;

  // Step 0: Strip HTML-style comments (<!-- ... -->) from the source.
  // This is intentionally the very first step so the comment text never
  // reaches any MMX pattern (headings, lists, inline code, links, etc.)
  // and is guaranteed to be removed from the output. Comments can span
  // multiple lines and can appear inline next to other content; we
  // replace the whole match (including the leading and trailing space,
  // when present) with a single space so adjacent words do not merge.
  result = stripComments(result);

  // Step 1: Process multi-line blocks FIRST to isolate raw code blocks
  // This must happen before monoline patterns so that MMX inside :::code blocks
  // is not compiled by monoline patterns
  for (const block of PATTERNS.multiline) {
    result = parseMultilineBlocks(result, block);
  }

  // Step 2: Extract and protect raw code blocks IMMEDIATELY
  // This prevents monoline patterns from affecting code block content
  const extracted = extractRawBlocks(result);
  result = extracted.html;

  // Step 3: NOW process single-line patterns (safe, won't affect protected code)
  for (const { regex, replace } of PATTERNS.monoline) {
    result = result.replace(regex, replace);
  }

  // Step 4: Parse Markdown-style lists before wrapping text
  result = parseLists(result);

  // Step 4.5: Parse blockquote lines ("> ") and group consecutive ones
  result = parseBlockquotes(result);

  // Step 5: Wrap plain text in <p> tags
  result = wrapParagraphs(result);

  // Step 5: Extract inline code (backticks) BEFORE applying inline patterns
  // This prevents patterns like bold/italic from being applied inside inline code
  const extractedInlineCode = extractInlineCode(result);
  result = extractedInlineCode.html;

  // Step 5.4: Extract inline raw tags <% ... %> BEFORE applying inline patterns
  // Content inside <% ... %> is kept verbatim (no bold, italic, links, color, etc.).
  // Like inline code, the tag is single-line and only protects against inline patterns.
  const extractedInlineRaw = extractInlineRaw(result);
  result = extractedInlineRaw.html;

  // Step 5.5: Extract and protect HTML attributes BEFORE applying inline patterns
  // This prevents URL linkification from corrupting attribute values like path="..."
  const extractedAttributes = extractHtmlAttributes(result);
  result = extractedAttributes.html;

  // Step 6: Apply inline formatting (this will NOT affect protected code blocks, inline code, attributes, or <%...%> raw blocks)
  for (const { regex, replace } of PATTERNS.inline) {
    result = result.replace(regex, replace);
  }

  // Step 6.5: Restore HTML attributes after inline patterns have been applied
  result = restoreHtmlAttributes(result, extractedAttributes.attributes);

  // Step 7: Restore inline code with proper formatting
  result = restoreInlineCode(result, extractedInlineCode.inlineBlocks);

  // Step 7.5: Restore inline raw blocks <% ... %> with proper formatting
  result = restoreInlineRaw(result, extractedInlineRaw.rawBlocks);

  // Step 8: Restore protected code blocks (with original unprocessed content)
  result = restoreRawBlocks(result, extracted.blocks);

  // Restore raw HTML blocks (#html ... ###) that were replaced with
  // placeholders during multiline parsing so they are not processed
  // by monoline, list, paragraph, or inline patterns.
  if (globalThis.__MMX_RAW_HTML_BLOCKS__) {
    for (const item of globalThis.__MMX_RAW_HTML_BLOCKS__) {
      result = result.replace(item.key, item.value);
    }
    globalThis.__MMX_RAW_HTML_BLOCKS__ = [];
  }

  // Step 7: Handle global iframe blocks
  if (globalThis.__MMX_RAW_IFRAMES__) {
    for (const item of globalThis.__MMX_RAW_IFRAMES__) {
      result = result.replace(item.key, item.value);
    }
  }

  // Step 8: Final cleanup - remove unwanted <br> after block elements
  return result.replace(/(<\/?(?:h[1-6]|div|p|ul|ol|li|blockquote)[^>]*>)\s*<br>\s*/gi, '$1');
}

/**
 * Parses multi-line blocks using stack-based approach
 * @param {string} text - Text with multi-line blocks
 * @param {Object} config - Block configuration
 * @returns {string} HTML with parsed blocks
 */
function parseMultilineBlocks(text, config) {
  const lines = text.split('\n');
  const output = [];
  const stack = [];

  for (const line of lines) {
    if (config.close.test(line) && stack.length > 0) {
      config.close.lastIndex = 0;

      const block = stack.pop();
      let processed;
      let html;

      if (block.raw) {
        // Raw code block: escape HTML entities
        let content = block.content.join('\n');
        
        content = content.replace(/^\n+/, '').replace(/\n+$/, '')
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;");

        let attrs = '';
        if (block.isAuto) attrs = ' auto="true"';

        const preClasses = (block.classes && block.classes.length) ? block.classes.join(' ') : block.class;

        processed = `<code>${content}</code>`;
        html = `<pre class="${preClasses}"${attrs}>${processed}</pre>`;

      } else if (block.html) {
        // Raw HTML block: output content as-is without escaping.
        // Content is NOT processed by monoline or inline patterns.
        let content = block.content.join('\n');
        content = content.replace(/^\n+/, '').replace(/\n+$/, '');
        const divClasses = (block.classes && block.classes.length) ? block.classes.join(' ') : block.class;
        const rawHtml = `<div class="${divClasses}">${content}</div>`;

        // Store the raw HTML in a global array and emit a placeholder
        // so subsequent processing (monoline, lists, paragraphs, inline)
        // cannot corrupt the content. Restored in mmxToHtml after
        // restoreRawBlocks.
        if (!globalThis.__MMX_RAW_HTML_BLOCKS__) {
          globalThis.__MMX_RAW_HTML_BLOCKS__ = [];
        }
        const key = `%%RAW_HTML_${globalThis.__MMX_RAW_HTML_BLOCKS__.length}%%`;
        globalThis.__MMX_RAW_HTML_BLOCKS__.push({ key, value: rawHtml });
        html = key;

      } else {
        // Formatted blocks: tables or notes
        if (block.type === 'table') {
            const mode = block.tableMode || 'v';

            const processCell = (text) => {
              let content = text.replace(/^\n+/, '').replace(/\n+$/, '');
              content = content.split('\n').map(l => l).join('<br>');

              // Protect <%...%> raw tags inside the cell so inline patterns
              // (bold, italic, links, etc.) do not compile their content.
              const cellRaw = extractInlineRaw(content);
              content = cellRaw.html;

              for (const { regex, replace } of PATTERNS.inline) {
                content = content.replace(regex, replace);
              }

              content = restoreInlineRaw(content, cellRaw.rawBlocks);
              return content || '&nbsp;';
            };

            const classAttr = (block.classes && block.classes.length) ? ` class="${block.classes.join(' ').trim()}"` : '';

            const rows = block.content
              .map(r => r.trim())
              .filter(r => r !== '')
              .map(r => {
                let row = r;
                if (mode === 'b' && !row.startsWith('|') && row.match(/^\s+/)) {
                  row = '|' + row.replace(/^\s+/, '');
                }
                return row.split('|').map(c => c.trim());
              })
              .filter(r => r.length > 0);

            if (rows.length === 0) {
              html = `<div class="table-wrapper"><table${classAttr}></table></div>`;
            } else {
              let theadRows = '';
              let tbodyRows = '';
              let firstRowIsHeader = (mode === 'h' || mode === 'b');

              rows.forEach((rowCells, rowIndex) => {
                const isFirstRow = rowIndex === 0;
                const isHeaderRow = firstRowIsHeader && isFirstRow;
                const isVerticalHeader = (mode === 'v' || mode === 'b');

                const cellsHtml = rowCells.map((cell, colIndex) => {
                  const processedCell = processCell(cell);
                  const isFirstCol = colIndex === 0;
                  const isVerticalHeaderCell = isVerticalHeader && isFirstCol && !isHeaderRow;

                  if (isHeaderRow) {
                    return `<th class="horizontal-title">${processedCell}</th>`;
                  } else if (isVerticalHeaderCell) {
                    return `<th class="vertical-title">${processedCell}</th>`;
                  } else {
                    return `<td class="normal-t-item">${processedCell}</td>`;
                  }
                }).join('');

                let finalCellsHtml = cellsHtml;
                if (mode === 'b' && isHeaderRow) {
                  finalCellsHtml = '<th class="b-blank">&nbsp;</th>' + cellsHtml;
                }

                const rowHtml = `<tr>${finalCellsHtml}</tr>`;
                if (isHeaderRow) {
                  theadRows += rowHtml + '\n';
                } else {
                  tbodyRows += rowHtml + '\n';
                }
              });

              let tableHtml = `<table${classAttr}>`;
              if (theadRows) {
                tableHtml += `<thead>\n${theadRows}</thead>\n`;
              }
              tableHtml += `<tbody>\n${tbodyRows}</tbody></table>`;
              html = `<div class="table-wrapper">${tableHtml}</div>`;
            }

        } else {
          // Inside non-raw multiline blocks (notes, tip, important, warning,
          // caution, tables...), the body still needs to be processed by the
          // monoline patterns so that directives like `#code(path)` expand
          // and `#b`, `#s`, images, audio, video work too. We first protect
          // any nested `:::code ... :::` raw block (so MMX inside it is not
          // compiled), then run the monoline patterns, then unwrap and apply
          // the inline patterns, just like the main flow.
          let body = block.content.join('\n');
          const nestedRaw = extractRawBlocks(body);
          body = nestedRaw.html;

          for (const { regex, replace } of PATTERNS.monoline) {
            body = body.replace(regex, replace);
          }

          body = restoreRawBlocks(body, nestedRaw.blocks);

          processed = wrapParagraphs(body);

          // Protect <%...%> raw tags inside the admonition body so that
          // inline patterns (bold, italic, links, etc.) do not compile
          // their content. Restored right after the inline pass below.
          const nestedRawTags = extractInlineRaw(processed);
          processed = nestedRawTags.html;

          for (const { regex, replace } of PATTERNS.inline) {
            processed = processed.replace(regex, replace);
          }

          processed = restoreInlineRaw(processed, nestedRawTags.rawBlocks);

          if (block.type === 'note') {
            processed = `<span class="admonition-label note-label"><img class="admonition-icon" src="intAssets/icons/note.svg" alt="" aria-hidden="true">Note:</span>${processed}`;
            html = `<${block.tag} class="${block.classes ? block.classes.join(' ') : block.class}">${processed}</${block.tag}>`;
          } else if (block.type === 'tip') {
            processed = `<span class="admonition-label tip-label"><img class="admonition-icon" src="intAssets/icons/tip.svg" alt="" aria-hidden="true">Tip:</span>${processed}`;
            html = `<${block.tag} class="${block.classes ? block.classes.join(' ') : block.class}">${processed}</${block.tag}>`;
          } else if (block.type === 'important') {
            processed = `<span class="admonition-label important-label"><img class="admonition-icon" src="intAssets/icons/important.svg" alt="" aria-hidden="true">Important:</span>${processed}`;
            html = `<${block.tag} class="${block.classes ? block.classes.join(' ') : block.class}">${processed}</${block.tag}>`;
          } else if (block.type === 'warning') {
            processed = `<span class="admonition-label warning-label"><img class="admonition-icon" src="intAssets/icons/warning.svg" alt="" aria-hidden="true">Warning:</span>${processed}`;
            html = `<${block.tag} class="${block.classes ? block.classes.join(' ') : block.class}">${processed}</${block.tag}>`;
          } else if (block.type === 'caution') {
            processed = `<span class="admonition-label caution-label"><img class="admonition-icon" src="intAssets/icons/caution.svg" alt="" aria-hidden="true">Caution:</span>${processed}`;
            html = `<${block.tag} class="${block.classes ? block.classes.join(' ') : block.class}">${processed}</${block.tag}>`;
          } else {
            html = `<${block.tag} class="${block.classes ? block.classes.join(' ') : block.class}">${processed}</${block.tag}>`;
          }
        }
      }

      if (stack.length > 0) {
        stack[stack.length - 1].content.push(html);
      } else {
        output.push(html);
      }

    } else if (config.open.test(line)) {
      config.open.lastIndex = 0;
      const match = config.open.exec(line);
      config.open.lastIndex = 0;

      // For code blocks, the entire content after :::code is in group 1
      // For other blocks, we maintain parenContent and extraContent logic
      let parenContent = '';
      let extraContent = '';
      
      if (config.name === 'code') {
        // Code block: everything after :::code is treated as flags
        extraContent = match && match[1] ? match[1].trim() : '';
      } else {
        parenContent = match && match[1] ? match[1].trim() : '';
        extraContent = match && match[2] ? match[2].trim() : '';
      }

      let tableMode = 'h';
      let tokens = [];
      let isAuto = false;

      if (config.name === 'table') {
        if (parenContent && ['v', 'h', 'b'].includes(parenContent.toLowerCase())) {
          tableMode = parenContent.toLowerCase();
          if (extraContent) {
            tokens = extraContent.split(/\s+/).filter(t => t);
          }
        } else if (extraContent) {
          const allTokens = extraContent.split(/\s+/).filter(t => t);
          const modeToken = allTokens.find(t => ['v', 'h', 'b'].includes(t.toLowerCase()));
          if (modeToken) {
            tableMode = modeToken.toLowerCase();
            tokens = allTokens.filter(t => t !== modeToken);
          } else {
            tokens = allTokens;
          }
        }
        isAuto = false;
      } else {
        tokens = extraContent ? extraContent.split(/\s+/).filter(t => t) : [];
        isAuto = tokens.includes('auto');
      }

      const extraClasses = tokens.filter(t => t !== 'auto');
      stack.push({
        type: config.name,
        content: [],
        tag: config.tag,
        class: config.class,
        raw: config.raw || false,
        html: config.html || false,
        flags: tokens,
        isAuto,
        classes: [config.class, ...extraClasses],
        tableMode: config.name === 'table' ? tableMode : undefined
      });

    } else if (stack.length > 0) {
      stack[stack.length - 1].content.push(line);

    } else {
      output.push(line);
    }
  }

  return output.join('\n');
}

/**
 * Parses Markdown-style lists (-, +, n., with optional indentation levels)
 * @param {string} text - Text with potential list items
 * @returns {string} HTML with parsed lists
 */
function parseLists(text) {
  const lines = text.split('\n').map(l => l.trimEnd());
  const output = [];
  const stack = [];
  let listCount = 0;

  /**
   * Detects a leading task-list marker (`[ ]` or `[x]`, case-insensitive
   * for the x) at the start of a list item's content and splits it out
   * into a `{ checked }` flag. The marker is removed from `content` so
   * the inline patterns do not see it.
   *
   * The marker is allowed to be followed by any amount of whitespace
   * before the actual text, e.g. `- [ ]   text` and `- [x]\ttext` both
   * work. Anything other than `[ ]` or `[x]` (a single space or `x`
   * strictly inside square brackets) is left untouched and the item is
   * not treated as a task list.
   *
   * @param {string} content
   * @returns {{ checked: boolean, content: string } | null}
   */
  const extractTaskMarker = (content) => {
    const m = /^\[([ xX])\]\s+(.*)$/.exec(content);
    if (!m) return null;
    return {
      checked: m[1].toLowerCase() === 'x',
      content: m[2],
    };
  };

  const parseListItem = (line) => {
    // Pattern: - text (unordered, optional level number before flexible whitespace)
    const ulMatch = /^-(\d*)\s+(.+)$/.exec(line);
    if (ulMatch) {
      const level = ulMatch[1] ? Number(ulMatch[1]) : 0;
      const task = extractTaskMarker(ulMatch[2]);
      return {
        type: 'ul',
        level,
        start: null,
        content: task ? task.content : ulMatch[2],
        task: task ? { checked: task.checked } : null,
      };
    }

    // Pattern: + text (ordered with +, optional level number before flexible whitespace)
    const olPlusMatch = /^\+(\d*)\s+(.+)$/.exec(line);
    if (olPlusMatch) {
      const level = olPlusMatch[1] ? Number(olPlusMatch[1]) : 0;
      const task = extractTaskMarker(olPlusMatch[2]);
      return {
        type: 'ol',
        level,
        start: null,
        content: task ? task.content : olPlusMatch[2],
        task: task ? { checked: task.checked } : null,
      };
    }

    // Pattern: n.m text (ordered numbered with level)
    const olNumLevelMatch = /^(\d+)\.(\d+)\s+(.+)$/.exec(line);
    if (olNumLevelMatch) {
      const task = extractTaskMarker(olNumLevelMatch[3]);
      return {
        type: 'ol',
        level: Number(olNumLevelMatch[2]),
        start: Number(olNumLevelMatch[1]),
        content: task ? task.content : olNumLevelMatch[3],
        task: task ? { checked: task.checked } : null,
      };
    }

    // Pattern: n. text (ordered numbered, no level)
    const olNumMatch = /^(\d+)\.\s+(.+)$/.exec(line);
    if (olNumMatch) {
      const task = extractTaskMarker(olNumMatch[2]);
      return {
        type: 'ol',
        level: 0,
        start: Number(olNumMatch[1]),
        content: task ? task.content : olNumMatch[2],
        task: task ? { checked: task.checked } : null,
      };
    }

    return null;
  };

  const closeList = () => {
    const current = stack.pop();
    if (current?.itemOpen) output.push('</li>');
    if (current) output.push(`</${current.type}>`);
  };

  const closeUntilLevel = (targetLevel, targetType) => {
    while (stack.length > 0 && stack[stack.length - 1].level > targetLevel) {
      closeList();
    }
    if (stack.length > 0 && stack[stack.length - 1].level === targetLevel && stack[stack.length - 1].type !== targetType) {
      closeList();
    }
  };

  const openList = (type, start, level) => {
    const attrs = start && start !== 1 ? ` start="${start}"` : '';
    output.push(`<${type}${attrs}>`);
    stack.push({ type, level, start, itemOpen: false });
  };

  const addItem = (item) => {
    listCount++;
    closeUntilLevel(item.level, item.type);

    if (!stack.length || stack[stack.length - 1].level < item.level) {
      const parentLevel = stack.length ? stack[stack.length - 1].level : -1;
      for (let lv = parentLevel + 1; lv <= item.level; lv += 1) {
        openList(item.type, lv === item.level ? item.start : null, lv);
      }
    }

    const current = stack[stack.length - 1];
    if (current?.itemOpen) output.push('</li>');
    current.itemOpen = true;

    // Task list item: render the checkbox inline, followed by the
    // item content. We deliberately do NOT use a `<label>` wrapper
    // (either wrapping the input or via `for=...`) because clicking
    // a nested interactive element (a link, a button) inside the
    // content would ALSO toggle the checkbox on top of the link's
    // own action, which is surprising. Instead, the whole row is a
    // `<div class="task-list-item">` and the click handler in
    // script.js toggles the checkbox manually -- unless the click
    // originated on a nested interactive element, in which case the
    // handler leaves the checkbox alone and lets the link / button
    // do its thing.
    //
    // The checkbox is rendered with the `checked` HTML attribute
    // that matches the MMX source (`[x]` = checked, `[ ]` =
    // unchecked), so the visible state on a fresh page load always
    // matches the source. We do NOT store the toggled state in
    // localStorage / sessionStorage on purpose: reloading the page
    // (or rebuilding the docs) resets every checkbox back to
    // whatever the MMX file says, which is the expected behavior for
    // documentation task lists. The user can still click the
    // checkbox during the current session to mark items as done;
    // that change is purely visual and is lost on reload.
    if (item.task) {
      const checkedAttr = item.task.checked ? ' checked' : '';
      output.push(
        `<li class="task-list-item-li"><div class="task-list-item"><input type="checkbox" class="task-list-checkbox"${checkedAttr}> <span class="task-list-content">${item.content}</span></div>`
      );
    } else {
      output.push(`<li>${item.content}`);
    }
  };

  for (const line of lines) {
    const item = parseListItem(line);
    if (!item) {
      while (stack.length) closeList();
      output.push(line);
    } else {
      addItem(item);
    }
  }

  while (stack.length) closeList();
  return output.join('\n');
}

/**
 * Parses blockquote lines (lines starting with "> ") and groups consecutive ones
 * into a single <blockquote>. Inline formatting (bold, links, etc.) is applied
 * later by the inline patterns step on the inner content.
 * @param {string} text - Text with potential blockquote lines
 * @returns {string} HTML with parsed blockquotes
 */
function parseBlockquotes(text) {
  const lines = text.split('\n');
  const output = [];
  const quoteRegex = /^>\s+(.*)$/;
  let buffer = [];

  const flush = () => {
    if (buffer.length === 0) return;
    const inner = buffer.join('<br>');
    output.push(`<blockquote>${inner}</blockquote>`);
    buffer = [];
  };

  for (const line of lines) {
    const match = quoteRegex.exec(line);
    if (match) {
      buffer.push(match[1]);
    } else {
      flush();
      output.push(line);
    }
  }
  flush();

  return output.join('\n');
}

/**
 * Wraps plain text in <p> tags while respecting block-level HTML
 * @param {string} text - Text with plain text and HTML blocks
 * @returns {string} Text with paragraphs wrapped
 */
function wrapParagraphs(text) {
  const lines = text.split('\n');
  const output = [];
  let paragraph = [];

  const blockRegex = /^<\/?(?:h[1-6]|div|p|ul|ol|li|blockquote|hr|img|pre|iframe|table|thead|tbody|tfoot|tr|th|td)/i;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    
    const content = paragraph.join('<br>');
    output.push(`<p>${content}</p>`);
    paragraph = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^%%RAW_\d+%%$/.test(trimmed)) {
      flushParagraph();
      output.push(trimmed);
      continue;
    }

    if (trimmed === '%%HARD_BREAK%%') {
      flushParagraph();
      output.push('<br>');
      continue;
    }

    if (trimmed === '') {
      flushParagraph();
      continue;
    }

    if (blockRegex.test(trimmed)) {
      flushParagraph();
      output.push(line);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  
  return output.join('\n');
}

/**
 * Extracts raw code blocks and replaces with placeholders
 * @param {string} html - HTML content with code blocks
 * @returns {Object} { html, blocks }
 */
function extractRawBlocks(html) {
  const blocks = [];
  let i = 0;

  // Match <pre> tags that have multiline-code class (with any additional classes)
  html = html.replace(/<pre[^>]*\bmultiline-code\b[^>]*>[\s\S]*?<\/pre>/g, (match) => {
    const key = `%%RAW_${i++}%%`;
    blocks.push({ key, value: match });
    return key;
  });

  return { html, blocks };
}

/**
 * Restores code blocks by replacing placeholders
 * @param {string} html - HTML with placeholders
 * @param {Array} blocks - Extracted blocks
 * @returns {string} HTML with restored blocks
 */
function restoreRawBlocks(html, blocks) {
  for (const b of blocks) {
    html = html.replace(b.key, b.value);
  }
  return html;
}

/**
 * Extracts inline code (backticks) and replaces with placeholders
 * This prevents patterns like bold/italic from being applied inside code
 * @param {string} html - HTML content with inline code
 * @returns {Object} { html, inlineBlocks }
 */
function extractInlineCode(html) {
  const inlineBlocks = [];
  let i = 0;

  // Match backticks with content: `code`
  html = html.replace(/`([^`]+)`/g, (match, code) => {
    const key = `%%INLINE_CODE_${i++}%%`;
    // Escape the code content to prevent HTML injection
    const escapedCode = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const htmlCode = `<code class="inline-code">${escapedCode}</code>`;
    inlineBlocks.push({ key, value: htmlCode });
    return key;
  });

  return { html, inlineBlocks };
}

/**
 * Restores inline code by replacing placeholders with formatted code
 * @param {string} html - HTML with placeholders
 * @param {Array} inlineBlocks - Extracted inline code blocks
 * @returns {string} HTML with restored inline code
 */
function restoreInlineCode(html, inlineBlocks) {
  for (const block of inlineBlocks) {
    html = html.replace(block.key, block.value);
  }
  return html;
}

/**
 * Extracts inline raw blocks (<% ... %>) and replaces with placeholders.
 * Content inside <% ... %> is preserved verbatim and is NOT parsed by
 * any inline pattern (bold, italic, links, colors, linkified URLs...).
 * The tag is single-line: a newline closes the tag.
 * @param {string} html - HTML content with potential <% ... %> blocks
 * @returns {Object} { html, rawBlocks }
 */
function extractInlineRaw(html) {
  const rawBlocks = [];
  let i = 0;

  // First pass: match <% ... %> source tags (used while a block's body
  // is still in source form, before it is wrapped in <p>/<code>).
  // Non-greedy and no-newline so two tags on the same line are matched
  // separately and a multi-line raw block uses :::code ... :::.
  html = html.replace(/<%([^%\n]*?)%>/g, (match, content) => {
    const key = `%%INLINE_RAW_${i++}%%`;
    // Escape the content so any HTML inside the tag is shown as literal
    // text and cannot inject real markup.
    const escapedContent = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const htmlBlock = `<code class="inline-raw">${escapedContent}</code>`;
    rawBlocks.push({ key, value: htmlBlock });
    return key;
  });

  // Second pass: match <code class="inline-raw">...</code> tags that
  // were already produced earlier in the pipeline (e.g. inside an
  // admonition body). Their inner text must be hidden from the main
  // inline patterns pass, otherwise a raw tag containing `**` would
  // be re-compiled into <strong> when the main flow runs the bold
  // pattern over the rendered output of the admonition.
  html = html.replace(/<code class="inline-raw">([\s\S]*?)<\/code>/g, (match, content) => {
    const key = `%%INLINE_RAW_${i++}%%`;
    rawBlocks.push({ key, value: match });
    return key;
  });

  return { html, rawBlocks };
}

/**
 * Restores inline raw blocks by replacing placeholders with formatted blocks.
 * @param {string} html - HTML with placeholders
 * @param {Array} rawBlocks - Extracted inline raw blocks
 * @returns {string} HTML with restored inline raw blocks
 */
function restoreInlineRaw(html, rawBlocks) {
  for (const block of rawBlocks) {
    html = html.replace(block.key, block.value);
  }
  return html;
}

/**
 * Extracts HTML attributes (especially URLs in attributes) and replaces with placeholders
 * This prevents inline patterns from processing URLs inside attribute values
 * @param {string} html - HTML content with attributes
 * @returns {Object} { html, attributes }
 */
function extractHtmlAttributes(html) {
  const attributes = [];
  let i = 0;

  // Match all HTML attributes that contain URLs (path="...", src="...", href="...")
  html = html.replace(/\b(path|src|href)="([^"]*)"/g, (match) => {
    const key = `%%HTML_ATTR_${i++}%%`;
    attributes.push({ key, value: match });
    return key;
  });

  return { html, attributes };
}

/**
 * Restores HTML attributes by replacing placeholders
 * @param {string} html - HTML with placeholders
 * @param {Array} attributes - Extracted attributes
 * @returns {string} HTML with restored attributes
 */
function restoreHtmlAttributes(html, attributes) {
  for (const attr of attributes) {
    html = html.replace(attr.key, attr.value);
  }
  return html;
}

/**
 * Strips HTML-style comments (`<!-- ... -->`) from the source, but
 * leaves the comment text untouched when it appears inside a region
 * that must be preserved verbatim:
 *
 *  - multi-line blocks (everything between `:::name` and `:::`),
 *  - inline code (text wrapped in single backticks), and
 *  - inline raw tags (`<% ... %>`).
 *
 * A small state machine walks the source character by character so we
 * can correctly handle all four cases:
 *
 *   1. multi-line blocks are detected first: when we hit `:::` we scan
 *      forward for the matching closing `:::` (or, for admonitions and
 *      other named blocks, the appropriate `:::` closing pattern from
 *      `PATTERNS.multiline`) and copy the whole region verbatim,
 *   2. inline raw tags are detected next: a `<%` opens the tag and
 *      `%>` closes it on the same line (anything inside is copied as-is),
 *   3. inline code is detected next: a backtick opens the span and the
 *      next backtick on the same line closes it (the contents are
 *      copied as-is, so `<!--` inside `` `<!--` `` is preserved),
 *   4. inside normal text, `<!-- ... -->` matches are replaced with a
 *      single space so adjacent words do not merge.
 *
 * Unterminated comments (a `<!--` with no matching `-->` in normal
 * text) are left untouched, so a literal `<!--` can still be displayed
 * by pairing it with a closing delimiter inside one of the protected
 * regions above. This mirrors how most browsers treat malformed HTML
 * comments.
 *
 * @param {string} text - Raw MMX source
 * @returns {string} Source with all well-formed comments removed
 */
function stripComments(text) {
  const n = text.length;
  let out = '';
  let i = 0;

  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    const next2 = text[i + 2];

    // --- 1. Multi-line blocks: `:::name ... :::` ---------------------
    // Copy the whole block (open line, body, close line) verbatim so
    // any `<!--` inside the body is preserved.
    if (ch === ':' && next === ':' && next2 === ':') {
      const openEnd = text.indexOf('\n', i);
      const endMarker = openEnd === -1 ? n : openEnd;
      const openLine = text.slice(i, endMarker);
      out += openLine;
      i = endMarker;

      // Try to find a matching closing `:::` line. We do not need to
      // know the block type: any `:::` line ends the current block.
      let found = false;
      while (i < n) {
        const nl = text.indexOf('\n', i);
        const lineEnd = nl === -1 ? n : nl;
        const line = text.slice(i, lineEnd);
        if (/^:::/.test(line)) {
          out += '\n' + line;
          i = lineEnd;
          found = true;
          break;
        }
        out += '\n' + line;
        i = lineEnd + 1;
      }
      if (!found) {
        // No closing marker: copy the rest of the source as-is.
        out += text.slice(i);
        i = n;
      }
      continue;
    }

    // --- 2. Inline raw tag: <% ... %> --------------------------------
    // A single-line tag. Anything between `<%` and the matching `%>`
    // is copied verbatim, including any `<!--` markers.
    if (ch === '<' && next === '%') {
      const close = text.indexOf('%>', i + 2);
      if (close !== -1) {
        const end = close + 2;
        // Only treat as a raw tag if it ends on the same line; this
        // avoids false positives with stray `<%` characters that have
        // no matching `%>` on the same line.
        const nl = text.indexOf('\n', i);
        if (nl === -1 || end <= nl) {
          out += text.slice(i, end);
          i = end;
          continue;
        }
      }
    }

    // --- 3. Inline code: ` ... ` -------------------------------------
    // A single-line span wrapped in backticks. Anything between the
    // opening and closing backtick is copied verbatim.
    if (ch === '`') {
      // Find the closing backtick on the same line.
      const nl = text.indexOf('\n', i);
      const lineEnd = nl === -1 ? n : nl;
      const close = text.indexOf('`', i + 1);
      if (close !== -1 && close < lineEnd) {
        const span = text.slice(i, close + 1);
        out += span;
        i = close + 1;
        continue;
      }
    }

    // --- 4. Normal text: strip `<!-- ... -->` ------------------------
    if (ch === '<' && next === '!' && next2 === '-' && text[i + 3] === '-') {
      const end = text.indexOf('-->', i + 4);
      if (end !== -1) {
        // Replace the whole comment (including a single trailing space
        // if present) with a single space so adjacent words do not
        // merge together.
        let drop = end + 3 - i;
        if (text[end + 3] === ' ') drop += 1;
        out += ' ';
        i += drop;
        continue;
      }
      // Unterminated: copy the rest as-is.
      out += text.slice(i);
      i = n;
      continue;
    }

    // Default: copy the character and advance.
    out += ch;
    i += 1;
  }

  return out;
}