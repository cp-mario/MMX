/**
 * MMX Visual Editor — Utility functions
 */

/**
 * Debounce a function call
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(fn, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Throttle a function call
 * @param {Function} fn - Function to throttle
 * @param {number} limit - Minimum interval in milliseconds
 * @returns {Function} Throttled function
 */
export function throttle(fn, limit = 100) {
  let inThrottle = false;
  return function (...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Escape HTML special characters
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Get cursor position in textarea
 * @param {HTMLTextAreaElement} textarea
 * @returns {{ start: number, end: number }}
 */
export function getCursorPosition(textarea) {
  return {
    start: textarea.selectionStart,
    end: textarea.selectionEnd,
  };
}

/**
 * Insert text at cursor position in textarea
 * @param {HTMLTextAreaElement} textarea
 * @param {string} before - Text to insert before selection
 * @param {string} after - Text to insert after selection
 * @param {number} cursorOffset - Offset to place cursor after insertion
 */
export function insertAtCursor(textarea, before, after = "", cursorOffset = 0) {
  const { start, end } = getCursorPosition(textarea);
  const selected = textarea.value.substring(start, end);
  const newText = before + selected + after;

  textarea.focus();
  const value = textarea.value;
  textarea.value = value.substring(0, start) + newText + value.substring(end);

  // Calculate new cursor position
  const newCursor = start + before.length + selected.length + cursorOffset;
  textarea.setSelectionRange(newCursor, newCursor);
}

/**
 * Replace selected text with new text
 * @param {HTMLTextAreaElement} textarea
 * @param {string} text
 */
export function replaceSelection(textarea, text) {
  const { start, end } = getCursorPosition(textarea);
  textarea.focus();
  const value = textarea.value;
  textarea.value = value.substring(0, start) + text + value.substring(end);
  textarea.setSelectionRange(start + text.length, start + text.length);
}

/**
 * Get the current line text at cursor position
 * @param {HTMLTextAreaElement} textarea
 * @returns {{ line: string, lineStart: number, lineEnd: number }}
 */
export function getCurrentLine(textarea) {
  const value = textarea.value;
  const pos = textarea.selectionStart;
  const lineStart = value.lastIndexOf("\n", pos - 1) + 1;
  const lineEnd = value.indexOf("\n", pos);
  const line = value.substring(lineStart, lineEnd === -1 ? value.length : lineEnd);
  return { line, lineStart, lineEnd: lineEnd === -1 ? value.length : lineEnd };
}

/**
 * Indent a multi-line string
 * @param {string} text
 * @param {number} level
 * @returns {string}
 */
export function indentLines(text, level = 1) {
  const indent = "\t".repeat(level);
  return text
    .split("\n")
    .map((line) => (line.trim() ? indent + line : line))
    .join("\n");
}

/**
 * Generate a unique ID
 * @returns {string}
 */
export function uniqueId() {
  return `mmx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Show a toast notification
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 */
export function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = "toast toast-" + type;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 9999;
    padding: 10px 18px; border-radius: 8px; font-size: 13px;
    background: ${type === "success" ? "var(--green, #a6e3a1)" : type === "error" ? "var(--red, #f38ba8)" : "var(--accent, #89b4fa)"};
    color: var(--bg-tertiary, #11111b);
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    opacity: 0; transform: translateY(10px);
    transition: opacity 0.2s, transform 0.2s;
    font-family: var(--font-sans);
  `;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => toast.remove(), 200);
  }, 2500);
}

/**
 * Format file size
 * @param {number} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Check if a file path is an MMX file
 * @param {string} filePath
 * @returns {boolean}
 */
export function isMmxFile(filePath) {
  return filePath.toLowerCase().endsWith(".mmx");
}

/**
 * Icon cache to avoid repeated fetches
 * @type {Map<string, string>}
 */
const iconCache = new Map();

/**
 * Load an SVG icon from file and return as HTML string
 * @param {string} iconName - Name of the icon file (without .svg extension)
 * @returns {Promise<string>} SVG HTML string
 */
export async function loadIcon(iconName) {
  if (iconCache.has(iconName)) {
    return iconCache.get(iconName);
  }

  try {
    const response = await fetch(`icons/${iconName}.svg`);
    if (!response.ok) {
      throw new Error(`Failed to load icon: ${iconName}`);
    }
    const svgText = await response.text();
    // SVG files already have correct stroke="currentColor" and fill="none"
    // Just ensure the root <svg> element has width/height removed so inline sizing works
    const svgHtml = svgText
      .replace(/<svg([^>]*)>/, (match, attrs) => {
        // Keep all attrs but ensure width/height are not hardcoded (let CSS/data-size control them)
        let cleaned = attrs.replace(/\s*width="[^"]*"/g, '');
        cleaned = cleaned.replace(/\s*height="[^"]*"/g, '');
        return `<svg${cleaned}>`;
      });
    iconCache.set(iconName, svgHtml);
    return svgHtml;
  } catch (error) {
    console.error(`Error loading icon ${iconName}:`, error);
    // Return a fallback empty icon with no hardcoded width/height so CSS can control sizing
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"></svg>';
  }
}

/**
 * Replace all elements with data-icon attribute with loaded SVG icons
 * @param {HTMLElement} container - Container element to search within (default: document)
 */
export async function replaceIcons(container = document) {
  const iconElements = container.querySelectorAll('[data-icon]');
  for (const el of iconElements) {
    const iconName = el.dataset.icon;
    const svgHtml = await loadIcon(iconName);
    el.innerHTML = svgHtml;
    // Apply any size classes
    if (el.dataset.size) {
      const svg = el.querySelector('svg');
      if (svg) {
        svg.setAttribute('width', el.dataset.size);
        svg.setAttribute('height', el.dataset.size);
      }
    }
  }
}

/**
 * Get an icon as an inline SVG element
 * @param {string} iconName - Name of the icon file (without .svg extension)
 * @param {Object} options - Options for the icon
 * @param {number} options.size - Size in pixels (default: 16)
 * @param {string} options.class - Additional CSS classes
 * @returns {Promise<SVGElement>} SVG element
 */
export async function createIcon(iconName, options = {}) {
  const svgHtml = await loadIcon(iconName);
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgHtml, 'image/svg+xml');
  const svg = doc.documentElement;
  
  if (options.size) {
    svg.setAttribute('width', options.size);
    svg.setAttribute('height', options.size);
  }
  if (options.class) {
    svg.classList.add(...options.class.split(' '));
  }
  
  return svg;
}
