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

  // Step 5.5: Extract and protect HTML attributes BEFORE applying inline patterns
  // This prevents URL linkification from corrupting attribute values like path="..."
  const extractedAttributes = extractHtmlAttributes(result);
  result = extractedAttributes.html;

  // Step 6: Apply inline formatting (this will NOT affect protected code blocks, inline code, or attributes)
  for (const { regex, replace } of PATTERNS.inline) {
    result = result.replace(regex, replace);
  }

  // Step 6.5: Restore HTML attributes after inline patterns have been applied
  result = restoreHtmlAttributes(result, extractedAttributes.attributes);

  // Step 7: Restore inline code with proper formatting
  result = restoreInlineCode(result, extractedInlineCode.inlineBlocks);

  // Step 8: Restore protected code blocks (with original unprocessed content)
  result = restoreRawBlocks(result, extracted.blocks);

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

      } else {
        // Formatted blocks: tables or notes
        if (block.type === 'table') {
            const mode = block.tableMode || 'v';

            const processCell = (text) => {
              let content = text.replace(/^\n+/, '').replace(/\n+$/, '');
              content = content.split('\n').map(l => l).join('<br>');
              for (const { regex, replace } of PATTERNS.inline) {
                content = content.replace(regex, replace);
              }
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
          processed = wrapParagraphs(block.content.join('\n'));

          for (const { regex, replace } of PATTERNS.inline) {
            processed = processed.replace(regex, replace);
          }

          if (block.type === 'note') {
            processed = `<span class="admonition-label note-label">Note:</span>${processed}`;
            html = `<${block.tag} class="${block.classes ? block.classes.join(' ') : block.class}">${processed}</${block.tag}>`;
          } else if (block.type === 'tip') {
            processed = `<span class="admonition-label tip-label">Tip:</span>${processed}`;
            html = `<${block.tag} class="${block.classes ? block.classes.join(' ') : block.class}">${processed}</${block.tag}>`;
          } else if (block.type === 'important') {
            processed = `<span class="admonition-label important-label">Important:</span>${processed}`;
            html = `<${block.tag} class="${block.classes ? block.classes.join(' ') : block.class}">${processed}</${block.tag}>`;
          } else if (block.type === 'warning') {
            processed = `<span class="admonition-label warning-label">Warning:</span>${processed}`;
            html = `<${block.tag} class="${block.classes ? block.classes.join(' ') : block.class}">${processed}</${block.tag}>`;
          } else if (block.type === 'caution') {
            processed = `<span class="admonition-label caution-label">Caution:</span>${processed}`;
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

  const parseListItem = (line) => {
    // Pattern: - text (unordered, optional level number before flexible whitespace)
    const ulMatch = /^-(\d*)\s+(.+)$/.exec(line);
    if (ulMatch) {
      return {
        type: 'ul',
        level: ulMatch[1] ? Number(ulMatch[1]) : 0,
        start: null,
        content: ulMatch[2],
      };
    }

    // Pattern: + text (ordered with +, optional level number before flexible whitespace)
    const olPlusMatch = /^\+(\d*)\s+(.+)$/.exec(line);
    if (olPlusMatch) {
      return {
        type: 'ol',
        level: olPlusMatch[1] ? Number(olPlusMatch[1]) : 0,
        start: null,
        content: olPlusMatch[2],
      };
    }

    // Pattern: n.m text (ordered numbered with level)
    const olNumLevelMatch = /^(\d+)\.(\d+)\s+(.+)$/.exec(line);
    if (olNumLevelMatch) {
      return {
        type: 'ol',
        level: Number(olNumLevelMatch[2]),
        start: Number(olNumLevelMatch[1]),
        content: olNumLevelMatch[3],
      };
    }

    // Pattern: n. text (ordered numbered, no level)
    const olNumMatch = /^(\d+)\.\s+(.+)$/.exec(line);
    if (olNumMatch) {
      return {
        type: 'ol',
        level: 0,
        start: Number(olNumMatch[1]),
        content: olNumMatch[2],
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
    output.push(`<li>${item.content}`);
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