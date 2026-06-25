/**
 * MMX Visual Editor — Autocomplete (v2)
 *
 * Provides auto-completion suggestions when the user types certain
 * trigger prefixes (#, ::, ![, *, <c=, etc.).
 *
 * Architecture:
 *   - On each input event we inspect the text before the cursor.
 *   - If it matches a trigger prefix, we show a dropdown of suggestions.
 *   - The dropdown is positioned near the cursor line using a mirror element.
 *   - Keyboard navigation (↑↓EnterTabEsc) is handled on keydown.
 */

import { getEditorElement, getEditorContent, insertText, getCursorOffset, setEditorContent } from "./codeEditor.js";

// ─── Suggestion definitions ──────────────────────────────────────────────────

const SUGGESTIONS = [
  // Headings (line-start only)
  { trigger: "#", insert: "# ", label: "# H1", desc: "Heading 1", startOfLine: true },
  { trigger: "##", insert: "## ", label: "## H2", desc: "Heading 2", startOfLine: true },
  { trigger: "###", insert: "### ", label: "### H3", desc: "Heading 3", startOfLine: true },
  { trigger: "####", insert: "#### ", label: "#### H4", desc: "Heading 4", startOfLine: true },
  { trigger: "#####", insert: "##### ", label: "##### H5", desc: "Heading 5", startOfLine: true },
  { trigger: "######", insert: "###### ", label: "###### H6", desc: "Heading 6", startOfLine: true },

  // Code blocks (line-start only)
  { trigger: ":::", insert: ":::code\n\n:::", label: ":::code ...:::", desc: "Code block", startOfLine: true },

  // Tables (line-start only)
  { trigger: "#table", insert: "#table(h)\nHeader 1|Header 2|Header 3\ndata 1|data 2|data 3\n#endtable", label: "#table", desc: "Insert table", startOfLine: true },

  // Images
  { trigger: "![", insert: "![alt text](path/to/image.png)", label: "![alt](path)", desc: "Insert image" },

  // Inline images
  { trigger: "<-", insert: "<-path/to/image->", label: "<-path->", desc: "Inline image icon" },

  // Video
  { trigger: "!!(", insert: "!!(path/to/video.mp4)", label: "!!(path)", desc: "Insert video" },
  // Audio
  { trigger: "!!!", insert: "!!!(path/to/audio.mp3)", label: "!!!(path)", desc: "Insert audio" },

  // Code file include (line-start only)
  { trigger: "#code", insert: "#code(path/to/file.js)", label: "#code(path)", desc: "Include code file", startOfLine: true },

  // Separators (line-start only)
  { trigger: "#s", insert: "#s", label: "#s", desc: "Horizontal separator", startOfLine: true },
  { trigger: "#b", insert: "#b", label: "#b", desc: "Line break", startOfLine: true },

  // Inline formatting
  { trigger: "**", insert: "****", label: "**bold**", desc: "Bold text", midCursor: true, exactMatch: true },
  { trigger: "*", insert: "**", label: "*italic*", desc: "Italic text", midCursor: true },
  { trigger: "~~", insert: "~~~~", label: "~~strikethrough~~", desc: "Strikethrough", midCursor: true, exactMatch: true },
  { trigger: "__", insert: "____", label: "__underline__", desc: "Underline", midCursor: true, exactMatch: true },
  { trigger: "`", insert: "``", label: "`code`", desc: "Inline code", midCursor: true },

  // Raw HTML (line-start only)
  { trigger: "#html", insert: "#html\n<!-- Your HTML here -->\n###", label: "#html ... ###", desc: "Raw HTML block", startOfLine: true },

  // Iframe (line-start only)
  { trigger: "#iframe", insert: '#iframe(<iframe src="https://example.com"></iframe>!)', label: "#iframe(...)", desc: "Embed iframe", startOfLine: true },

  // Color
  { trigger: '<c=', insert: '<c="color">text</c>', label: '<c="color">', desc: "Colored text" },
  { trigger: "<ch", insert: '<ch="yellow">text</ch>', label: '<ch="color">', desc: "Highlighted text" },

  // Color display
  { trigger: "<color", insert: '<colorDisplay="color"/>', label: '<colorDisplay=""/>', desc: "Color swatch" },
];

// ─── Autocomplete state ──────────────────────────────────────────────────────

let dropdownEl = null;
let editorContainer = null;
let currentSuggestions = [];
let selectedIndex = -1;
let mirrorEl = null; // hidden element used to measure cursor position
let _suppressInput = false;
let _suppressTimer = null;

/**
 * Suppress the next programmatic input event so the autocomplete
 * dropdown does NOT appear after a toolbar operation (bold, italic, etc.).
 * A short timer clears the flag in case the expected input never arrives.
 */
export function suppressNextInput() {
  _suppressInput = true;
  if (_suppressTimer) clearTimeout(_suppressTimer);
  _suppressTimer = setTimeout(() => { _suppressInput = false; }, 500);
}

// ═════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═════════════════════════════════════════════════════════════════════════════

export function initAutocomplete() {
  dropdownEl = document.getElementById("autocompleteDropdown");
  if (!dropdownEl) return;

  editorContainer = document.querySelector(".editor-container");

  const editorEl = getEditorElement();
  if (!editorEl) return;

  // Create a mirror element to measure cursor screen position
  mirrorEl = createMirrorElement(editorEl);

  editorEl.addEventListener("input", onInput);
  editorEl.addEventListener("keydown", onKeydown);
  editorEl.addEventListener("blur", () => setTimeout(hideDropdown, 200));
  editorEl.addEventListener("scroll", positionDropdown);
  editorEl.addEventListener("click", onCursorChange);

  // Prevent blur when clicking inside the dropdown
  dropdownEl.addEventListener("mousedown", (e) => e.preventDefault());

  // Click-to-select
  dropdownEl.addEventListener("click", (e) => {
    const item = e.target.closest(".autocomplete-item");
    if (item) {
      const idx = parseInt(item.dataset.index, 10);
      if (currentSuggestions[idx]) applySuggestion(currentSuggestions[idx]);
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// MIRROR ELEMENT (for measuring cursor position)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Create a hidden mirror element that mimics the textarea's styling so we
 * can measure where the cursor is in screen coordinates.
 */
function createMirrorElement(element) {
  const mirror = document.createElement("div");
  mirror.className = "autocomplete-mirror";
  // Copy all relevant computed styles
  const cs = getComputedStyle(element);
  const props = [
    "fontFamily", "fontSize", "fontWeight", "fontStyle",
    "lineHeight", "letterSpacing", "wordSpacing",
    "whiteSpace", "wordWrap", "overflowWrap",
    "paddingTop", "paddingLeft", "paddingRight", "paddingBottom",
    "borderTopWidth", "borderLeftWidth", "borderRightWidth", "borderBottomWidth",
    "tabSize", "boxSizing",
  ];
  for (const p of props) {
    mirror.style[p] = cs[p];
  }
  mirror.style.position = "absolute";
  mirror.style.top = "0";
  mirror.style.left = "0";
  mirror.style.pointerEvents = "none";
  mirror.style.visibility = "hidden";
  mirror.style.zIndex = "-1";
  mirror.style.overflow = "hidden";
  mirror.textContent = ".";
  // Insert into the editor container so it shares the same coordinate space as the editor
  if (editorContainer) editorContainer.appendChild(mirror);
  return mirror;
}

/**
 * Measure the screen position of a given text offset in the textarea.
 * @param {number} offset - Character offset
 * @returns {{ top: number, left: number }} Pixel coordinates relative to editor-wrapper
 */
function measureCursorOffset(offset) {
  if (!mirrorEl || !getEditorElement()) return { top: 0, left: 0 };

  const editorEl = getEditorElement();
  const text = (editorEl.textContent || "").substring(0, offset);

  // Replace special characters with visible representations
  const displayText = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  // Add a marker span at the cursor position
  mirrorEl.innerHTML = displayText + '<span id="mirror-marker">.</span>';

  // Reset scroll position of mirror to match editor
  mirrorEl.scrollTop = editorEl.scrollTop;
  mirrorEl.scrollLeft = editorEl.scrollLeft;

  const marker = mirrorEl.querySelector("#mirror-marker");
  if (!marker) return { top: 0, left: 0 };

  const rect = marker.getBoundingClientRect();
  const containerRect = editorContainer
    ? editorContainer.getBoundingClientRect()
    : { top: 0, left: 0 };

  return {
    top: rect.top - containerRect.top,
    left: rect.left - containerRect.left,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// INPUT HANDLING
// ═════════════════════════════════════════════════════════════════════════════

function onInput() {
  // Suppress autocomplete after toolbar operations (bold, italic, etc.)
  if (_suppressInput) {
    _suppressInput = false;
    if (_suppressTimer) clearTimeout(_suppressTimer);
    _suppressTimer = null;
    return;
  }

  if (!getEditorElement()) return;

  const cursorPos = getCursorOffset();
  const text = getEditorContent();
  const lineStart = text.lastIndexOf("\n", cursorPos - 1) + 1;
  const currentLine = text.substring(lineStart, cursorPos);

  // Don't show inside code blocks or admonitions
  if (isInsideMultiLineBlock(text, cursorPos)) {
    hideDropdown();
    return;
  }

  const matches = findSuggestions(currentLine);

  if (matches.length > 0) {
    currentSuggestions = matches;
    selectedIndex = 0;
    showDropdown(matches, cursorPos);
  } else {
    hideDropdown();
  }
}

function onCursorChange() {
  // Re-evaluate on click (cursor position may have changed significantly)
  onInput();
}

// ═════════════════════════════════════════════════════════════════════════════
// KEYBOARD NAVIGATION
// ═════════════════════════════════════════════════════════════════════════════

function onKeydown(e) {
  if (!dropdownEl || dropdownEl.style.display === "none") return;

  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, currentSuggestions.length - 1);
      highlightSelected();
      break;
    case "ArrowUp":
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      highlightSelected();
      break;
    // Only Tab accepts the suggestion; Enter inserts a newline (default behavior)
    case "Tab":
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < currentSuggestions.length) {
        applySuggestion(currentSuggestions[selectedIndex]);
      }
      break;
    case "Escape":
      e.preventDefault();
      hideDropdown();
      break;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SUGGESTION MATCHING
// ═════════════════════════════════════════════════════════════════════════════

function findSuggestions(line) {
  const wordMatch = line.match(/([#*:<>!@$[\]|+~`\-\w.]+)$/);
  const word = wordMatch ? wordMatch[1] : "";
  if (!word) return [];

  // Check if the typed word is at the beginning of a line (or after only whitespace)
  const leadingText = line.substring(0, line.length - word.length);
  const isAtLineStart = leadingText.trim() === "";

  // Match only when word is a prefix of the trigger, or word equals the trigger exactly.
  // This prevents false matches like "**text**" matching the bold trigger "**".
  const hits = SUGGESTIONS.filter((s) => {
    // Block suggestions that require start-of-line are only shown at line start
    if (s.startOfLine && !isAtLineStart) return false;
    // For paired markers (**, ~~, __), require exact match so a single * or ~
    // doesn't trigger the full replacement prematurely.
    if (s.exactMatch) return word === s.trigger;
    return s.trigger.startsWith(word) || word === s.trigger;
  });

  // Limit and deduplicate by insert text
  const seen = new Set();
  const result = [];
  for (const s of hits) {
    if (!seen.has(s.insert)) {
      seen.add(s.insert);
      result.push(s);
      if (result.length >= 10) break;
    }
  }
  return result;
}

// ═════════════════════════════════════════════════════════════════════════════
// DROPDOWN RENDERING & POSITIONING
// ═════════════════════════════════════════════════════════════════════════════

function showDropdown(suggestions, cursorPos) {
  if (!dropdownEl) return;

  dropdownEl.innerHTML = suggestions
    .map((s, i) => `<div class="autocomplete-item ${i === selectedIndex ? "selected" : ""}" data-index="${i}">
      <span class="ac-label">${escapeHtml(s.label)}</span>
      <span class="ac-desc">${escapeHtml(s.desc)}</span>
    </div>`)
    .join("");

  dropdownEl.style.display = "block";
  positionDropdown(cursorPos);
}

function hideDropdown() {
  if (!dropdownEl) return;
  dropdownEl.style.display = "none";
  currentSuggestions = [];
  selectedIndex = -1;
}

function positionDropdown(cursorPos) {
  const editorEl = getEditorElement();
  if (!dropdownEl || !editorEl) return;

  const pos = measureCursorOffset(cursorPos ?? getCursorOffset());

  // Calculate line height from the editor's computed font-size and line-height
  const cs = getComputedStyle(editorEl);
  const fontSize = parseFloat(cs.fontSize) || 13;
  const lh = cs.lineHeight === "normal"
    ? fontSize * 1.6
    : parseFloat(cs.lineHeight);
  const lineHeight = lh || fontSize * 1.6;

  // Convert to viewport coordinates by adding the container's offset
  const containerRect = editorContainer
    ? editorContainer.getBoundingClientRect()
    : { left: 0, top: 0 };

  dropdownEl.style.top = Math.round(containerRect.top + pos.top + lineHeight) + "px";
  dropdownEl.style.left = Math.round(containerRect.left + pos.left) + "px";
  dropdownEl.style.bottom = "auto";
  dropdownEl.style.right = "auto";
}

function highlightSelected() {
  if (!dropdownEl) return;
  const items = dropdownEl.querySelectorAll(".autocomplete-item");
  items.forEach((item, i) => item.classList.toggle("selected", i === selectedIndex));

  const selected = items[selectedIndex];
  if (selected) selected.scrollIntoView({ block: "nearest" });
}

// ═════════════════════════════════════════════════════════════════════════════
// APPLY SUGGESTION
// ═════════════════════════════════════════════════════════════════════════════

function applySuggestion(suggestion) {
  if (!getEditorElement()) return;

  const cursorPos = getCursorOffset();
  const text = getEditorContent();
  const lineStart = text.lastIndexOf("\n", cursorPos - 1) + 1;
  const beforeCursor = text.substring(lineStart, cursorPos);

  const wordMatch = beforeCursor.match(/([#*:<>!@$[\]|+~`\-\w.]+)$/);
  const word = wordMatch ? wordMatch[1] : "";
  const replaceStart = cursorPos - (word.length || 0);

  const newText = text.substring(0, replaceStart) + suggestion.insert + text.substring(cursorPos);
  // For paired markers (bold, italic, etc.), place cursor between them
  const newPos = suggestion.midCursor
    ? replaceStart + Math.floor(suggestion.insert.length / 2)
    : replaceStart + suggestion.insert.length;
  setEditorContent(newText, newPos, true);

  hideDropdown();

  // Suppress the next input event so the same suggestion doesn't re-appear immediately
  suppressNextInput();
}

// ═════════════════════════════════════════════════════════════════════════════
// UTILITY
// ═════════════════════════════════════════════════════════════════════════════

function isInsideMultiLineBlock(text, cursorPos) {
  const beforeCursor = text.substring(0, cursorPos);

  // Code blocks :::code ... :::
  const codeCloses = (beforeCursor.match(/^:::\s*$/gm) || []).length;
  const codeOpens = (beforeCursor.match(/:::code\s*[^\n]*$/gm) || []).length;
  if (codeOpens > codeCloses) return true;

  // Admonitions >>>type ... >>>
  const admonCloses = (beforeCursor.match(/^>>>\s*$/gm) || []).length;
  const admonOpens = (beforeCursor.match(/^>>>\w+/gm) || []).length;
  if (admonOpens > admonCloses) return true;

  return false;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
