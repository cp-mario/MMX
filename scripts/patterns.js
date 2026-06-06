/**
 * MMX Pattern Definitions
 * Regex patterns for MMX to HTML conversion
 */

import { normalizePageHref } from "./kebabCase.js";

// Track used heading IDs for auto-generation with duplicates
const usedHeadingIds = new Map();

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function generateHeadingId(text, explicitId) {
  if (explicitId) return explicitId;
  
  const baseSlug = slugify(text);
  
  if (!usedHeadingIds.has(baseSlug)) {
    usedHeadingIds.set(baseSlug, 1);
    return baseSlug;
  }
  
  const count = usedHeadingIds.get(baseSlug) + 1;
  usedHeadingIds.set(baseSlug, count);
  return `${baseSlug}-${count}`;
}

function createHeadingWithLinkIcon(level, text, id) {
  const linkIcon = `<svg class="heading-link-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Copy link"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
  
  return `<h${level} id="${id}">${text}<button class="heading-link-btn" data-heading-id="${id}" title="Copy link to header">${linkIcon}</button></h${level}>`;
}

export function resetHeadingIdTracker() {
  usedHeadingIds.clear();
}

export const PATTERNS = {
  monoline: [
    // Heading level 6: ###### Title %{id}%
    { 
      regex: /^###### (.*?)\s*(?:%\{(.+?)\}%\s*)?$/gm, 
      replace: (match, text, id) => {
        const generatedId = generateHeadingId(text, id);
        const finalId = id || generatedId;
        return createHeadingWithLinkIcon(6, text, finalId);
      }
    },

    // Heading level 5: ##### Title %{id}%
    { 
      regex: /^##### (.*?)\s*(?:%\{(.+?)\}%\s*)?$/gm, 
      replace: (match, text, id) => {
        const generatedId = generateHeadingId(text, id);
        const finalId = id || generatedId;
        return createHeadingWithLinkIcon(5, text, finalId);
      }
    },

    // Heading level 4: #### Title %{id}%
    { 
      regex: /^#### (.*?)\s*(?:%\{(.+?)\}%\s*)?$/gm, 
      replace: (match, text, id) => {
        const generatedId = generateHeadingId(text, id);
        const finalId = id || generatedId;
        return createHeadingWithLinkIcon(4, text, finalId);
      }
    },

    // Heading level 3: ### Title %{id}%
    { 
      regex: /^### (.*?)\s*(?:%\{(.+?)\}%\s*)?$/gm, 
      replace: (match, text, id) => {
        const generatedId = generateHeadingId(text, id);
        const finalId = id || generatedId;
        return createHeadingWithLinkIcon(3, text, finalId);
      }
    },

    // Heading level 2: ## Title %{id}%
    { 
      regex: /^## (.*?)\s*(?:%\{(.+?)\}%\s*)?$/gm, 
      replace: (match, text, id) => {
        const generatedId = generateHeadingId(text, id);
        const finalId = id || generatedId;
        return createHeadingWithLinkIcon(2, text, finalId);
      }
    },

    // Heading level 1: # Title %{id}%
    { 
      regex: /^# (.*?)\s*(?:%\{(.+?)\}%\s*)?$/gm, 
      replace: (match, text, id) => {
        const generatedId = generateHeadingId(text, id);
        const finalId = id || generatedId;
        return createHeadingWithLinkIcon(1, text, finalId);
      }
    },

    // Hard break: #b
    { regex: /^#b.*$/gm, replace: '%%HARD_BREAK%%' },

    // Horizontal separator: #s
    { regex: /^#s.*$/gm, replace: '<hr>' },

    // Embedded iframe: #iframe( ¡<html>! )
    {
      regex: /^\s*#iframe\(\s*¡([\s\S]+?)!\s*\)\s*$/gm,
      replace: (match, content) => {
        const html = content.trim();
        return `<div class="iframe">${html}</div>`;
      }
    },

    // Code file inclusion: #code(path/to/file) [flags]
    { 
      regex: /^#code\((.+?)\)(?:\s+([\w\s]+))?$/gm, 
      replace: (match, path, flags) => {
        const opts = flags ? flags.trim().split(/\s+/) : [];
        const auto = opts.includes("auto");
        const extraClasses = opts.filter(f => f !== "auto");
        let classes = ["fileCode", "multiline-code", ...extraClasses];
        return auto
          ? `<pre class="${classes.join(" ")}" path="${path}" auto="true"></pre>`
          : `<pre class="${classes.join(" ")}" path="${path}"></pre>`;
      }
    },

    // Block audio: !!!( path ) [classes]
    { 
      regex: /^!!!\(([^)]+)\)(?:\s+([\w\-\s]+))?\s*$/gm, 
      replace: (match, src, classes) => {
        const cls = classes ? ` ${classes.trim().split(/\s+/).join(' ')}` : '';
        return `<div class="audio${cls}"><audio src="${src}"></audio></div>`;
      }
    },

    // Block video: !!( path ) [classes]
    { 
      regex: /^!!\(([^)]+)\)(?:\s+([\w\-\s]+))?\s*$/gm, 
      replace: (match, src, classes) => {
        const clsAttr = classes ? ` class="${classes.trim().split(/\s+/).join(' ')}"` : '';
        return `<video src="${src}"></video>`;
      }
    },

    // Block image: ![alt](path) [classes]
    {
      regex: /^!\[([^\]]*)\]\(([^)]+)\)(?:\s+([\w\-\s]+))?\s*$/gm,
      replace: (match, alt, src, classes) => {
        const cls = classes ? ` class="${classes.trim().split(/\s+/).join(' ')}"` : '';
        // Lazy-load images to reduce CLS caused by late image loading
        return `<img alt="${alt}" class="img" src="${src}"${cls} loading="lazy">`;
      }
    }
  ],

  multiline: [
    // Code block: :::code [language] [flags] ... :::
    // IMPORTANT: this MUST be the first entry in the multiline array.
    // `parseMultilineBlocks` is called once per config in order, so the
    // `code` config has to run BEFORE the admonition configs (`note`,
    // `tip`, `important`, `warning`, `caution`). Otherwise the `>>>`...
    // `>>>` markers inside a `:::code ... :::` block are matched and
    // converted into real admonitions, and the user gets escaped HTML
    // (e.g. `&lt;div class="tip"&gt;...`) inside the code block instead
    // of the literal `>>>` text they wrote.
    {
      name: 'code',
      open: /^:::code\s*(.*)$/gm,
      close: /^:::\s*$/gm,
      tag: 'pre',
      class: 'multiline-code',
      raw: true
    },

    // Note block: >>>note [classes] ... >>>
    // Uses >>> as the delimiter (instead of :::) so that `:::code ... :::`
    // blocks can contain literal `:::note` examples without the inner `:::`
    // being mistaken for the closing of the code block.
    {
      name: 'note',
      open: /^>>>note(?:\s+([^\n]+))?\s*$/gm,
      close: /^>>>\s*$/gm,
      tag: 'div',
      class: 'note',
    },

    // Tip block (sugerencia): >>>tip [classes] ... >>>
    {
      name: 'tip',
      open: /^>>>tip(?:\s+([^\n]+))?\s*$/gm,
      close: /^>>>\s*$/gm,
      tag: 'div',
      class: 'tip',
    },

    // Important block: >>>important [classes] ... >>>
    {
      name: 'important',
      open: /^>>>important(?:\s+([^\n]+))?\s*$/gm,
      close: /^>>>\s*$/gm,
      tag: 'div',
      class: 'important',
    },

    // Warning block: >>>warning [classes] ... >>>
    {
      name: 'warning',
      open: /^>>>warning(?:\s+([^\n]+))?\s*$/gm,
      close: /^>>>\s*$/gm,
      tag: 'div',
      class: 'warning',
    },

    // Caution block: >>>caution [classes] ... >>>
    {
      name: 'caution',
      open: /^>>>caution(?:\s+([^\n]+))?\s*$/gm,
      close: /^>>>\s*$/gm,
      tag: 'div',
      class: 'caution',
    },

    // Table block: #table [mode] [classes] ... #endtable
    {
      name: 'table',
      open: /^#table(?:\(([^)]+)\))?(?:\s+([^\n]+))?\s*$/gm,
      close: /^#endtable\s*$/gm,
      tag: 'table',
      class: 'table',
      raw: false
    },
  ],

  inline: [
    // Inline image icon: <-path/to/image->
    {
      regex: /<\-([^>]+)\->/g,
      replace: (match, src) => `<img class="inlineImg" alt="icon" src="${src}">`
    },

    // Anchor (named bookmark): $[text](id)
    // Defines a same-page bookmark at the current position. The `text`
    // is the visible label that gets rendered, and the `id` is the name
    // the bookmark can be linked to with `$$id` (same page) or
    // `[text](pages/Other.html#id)` (cross-page, using the standard
    // MMX link syntax). The output is a `<span id="...">` so the
    // bookmark has zero visual side effects: the text inside is shown
    // exactly as written, but the surrounding element carries the id
    // that the browser scrolls to when a link points at `#id`.
    //
    // The id is restricted to letters, digits, dashes and underscores
    // so it is always a valid HTML id and a valid URL fragment
    // (no need to percent-encode anything). Dots are NOT allowed in
    // the id on purpose: MMX's auto-URL detector would otherwise see
    // `my.id` inside the link's visible text and re-link it to
    // `https://my.id` (because `.id` is a real TLD), which would
    // produce a nested anchor and break the layout. Use dashes for
    // hierarchical ids (e.g. `my-anchor`, `section-1-intro`).
    //
    // The text is taken verbatim, which means MMX inside it (like
    // `**bold**`) is still compiled by the patterns that run AFTER
    // this one. This mirrors how the link pattern renders its text.
    //
    // This pattern must run BEFORE the generic `[text](url)` link
    // pattern, otherwise the bracket/paren part would be eaten first
    // and `$[text](id)` would never match.
    {
      regex: /\$\[([^\]\n]+)\]\(([A-Za-z0-9_\-]+)\)/g,
      replace: (match, text, id) => `<span class="mmx-anchor" id="${id}">${text}</span>`
    },

    // Link: [text](url)
    {
      regex: /\[([^\]]+)\]\(([^)]+)\)/g,
      replace: (match, text, href) => {
        const normalizedHref = normalizePageHref(href);
        return `<a target="_blank" href="${normalizedHref}">${text}</a>`;
      }
    },

    // Same-page anchor link: $$id
    // Shortcut for an in-page link to a bookmark defined with
    // `$[text](id)`. The id becomes both the visible label of the link
    // AND the href target, so `$my-anchor` is equivalent to
    // `[my-anchor](#my-anchor)`. This is purely a same-page helper:
    // cross-page links to a bookmark are written with the regular
    // link syntax, e.g. `[header](pages/Other.html#my-anchor)`.
    //
    // The id is restricted to the same character set as the anchor
    // pattern above. A negative lookbehind for `[` and `(` makes sure
    // we never match a `$$id` that is part of a still-unresolved anchor
    // (`$[text](id)`) or a link (`[text]($$id)`) -- by the time this
    // pattern runs, anchors have already been replaced with their
    // `<span id="...">` form and links with their `<a href="...">`
    // form, so the lookbehind is just an extra safety net.
    //
    // The pattern is also restricted to ids that begin with a letter
    // or an underscore so that a literal `$` followed by a number
    // (e.g. `$42`), by punctuation (e.g. `$.` or `$,`) or by
    // whitespace is never accidentally captured: those stay as plain
    // text in the rendered page.
    //
    // The id is matched greedily, but any trailing `.`, `,`, `;`,
    // `:`, `!`, `?`, `(`, `)` or `#` is stripped in the replace
    // callback so that natural sentence punctuation like
    // "Click $my-id." or "see $intro, for details" does NOT get
    // eaten by the link. An id that legitimately contains a `.` in
    // the middle (e.g. `$my.id`) is left alone: the strip removes
    // the trailing characters of the match, not the inner ones.
    {
      regex: /(?<![\[\(])\$\$([A-Za-z_][A-Za-z0-9_\-]+)/g,
      replace: (match, id) => {
        // Strip trailing punctuation that is almost never part of
        // an id in real-world usage (sentence periods, commas,
        // parentheses, etc.). We keep stripping as long as the
        // last character is one of them, so a trailing "...", ".,"
        // or ".)" is removed cleanly.
        const trailing = /[.,;:!?)(#]+$/;
        const cleanId = id.replace(trailing, "");
        if (!cleanId) return match; // pure punctuation: leave source alone
        return `<a class="mmx-anchor-link" href="#${cleanId}">${cleanId}</a>`;
      }
    },

    // Bold: **text**
    {
      regex: /\*\*(.*?)\*\*/g,
      replace: (match, text) => `<strong>${text}</strong>`
    },

    // Italic: *text*
    {
      regex: /\*(.*?)\*/g,
      replace: (match, text) => `<em>${text}</em>`
    },

    // Colored text: <c="color">text</c>
    {
      regex: /<c="([^"]+)">(.*?)<\/c>/gs,
      replace: (match, color, content) => {
        return `<div class="coloredText" style="color: ${color};">${content}</div>`;
      }
    },

    // Color display: <colorDisplay="color"/>
    // Self-closing tag that renders the literal color value next to a
    // filled circle filled with that same color. Accepts any CSS color
    // (named, hex, rgb(), hsl(), etc.). Useful for documenting a palette.
    // The whole element is a button: clicking either the swatch or the
    // label copies the color value to the clipboard (handled in script.js).
    {
      regex: /<colorDisplay="([^"]+)"\s*\/>/g,
      replace: (match, color) => {
        return `<button type="button" class="colorDisplay" data-color="${color}" title="Click to copy ${color}"><span class="colorDisplay-label">${color}</span><span class="colorDisplay-swatch" style="background-color: ${color};"></span></button>`;
      }
    },

    // Strikethrough: ~text~
    // Tildes are not used anywhere else in MMX, so this is safe.
    {
      regex: /~([^~\n]+)~/g,
      replace: (match, text) => `<del>${text}</del>`
    },

    // Underline: __text__
    // Double underscores are not used anywhere else in MMX, so this is
    // safe. (Single `_` is kept free for future use; only `__` is bound.)
    {
      regex: /__([^_\n]+)__/g,
      replace: (match, text) => `<u>${text}</u>`
    },

    // Subscript: <sub>text</sub>
    {
      regex: /<sub>(.*?)<\/sub>/gs,
      replace: (match, content) => `<sub>${content}</sub>`
    },

    // Superscript: <sup>text</sup>
    {
      regex: /<sup>(.*?)<\/sup>/gs,
      replace: (match, content) => `<sup>${content}</sup>`
    },

    // Auto-detect and linkify plain URLs
    // Matches: https://..., http://..., www...., and domain.com patterns
    // Does NOT match URLs already inside <a> tags, href attributes, or path attributes
    {
      regex: /(?<!href=")(?<!href=')(?<!path=")(?<!path=')(?<!<a[^>]*)\b(https?:\/\/[^\s<>"\[\]()]+|www\.[^\s<>"\[\]()]+|[a-zA-Z0-9][\w\-]*\.(?:com|org|net|edu|gov|io|co|uk|de|fr|es|it|ru|cn|jp|au|ca|in|br|mx|se|ch|nl|be|at|cz|pl|tr|kr|tw|hk|sg|my|th|ph|vn|id|nz|gr|pt|ie|dk|no|fi|is|hu|ro|bg)[^\s<>"\[\]()]*)\b(?!["\]>])/gi,
      replace: (match, url) => {
        // Ensure URL has a protocol
        let finalUrl = url;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          if (url.startsWith('www.')) {
            finalUrl = 'https://' + url;
          } else {
            // Assume https for domain.com patterns
            finalUrl = 'https://' + url;
          }
        }
        return `<a target="_blank" href="${finalUrl}">${url}</a>`;
      }
    }

    // Note: Inline code is now handled separately in parser.js
    // to prevent MMX patterns inside backticks from being compiled
  ]
};
