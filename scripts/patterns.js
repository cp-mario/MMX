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
    // Note block: :::note [classes] ... :::
    {
      name: 'note',
      open: /^:::note(?:\s+([^\n]+))?\s*$/gm,
      close: /^:::\s*$/gm,
      tag: 'div',
      class: 'note',
    },

    // Code block: :::code [language] [flags] ... :::
    {
      name: 'code',
      open: /^:::code\s*(.*)$/gm,
      close: /^:::\s*$/gm,
      tag: 'pre',
      class: 'multiline-code',
      raw: true
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

    // Link: [text](url)
    {
      regex: /\[([^\]]+)\]\(([^)]+)\)/g,
      replace: (match, text, href) => {
        const normalizedHref = normalizePageHref(href);
        return `<a target="_blank" href="${normalizedHref}">${text}</a>`;
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
