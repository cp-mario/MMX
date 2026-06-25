/**
 * MMX Visual Editor — Code Editor (Monaco-style)
 *
 * Architecture (simplified Monaco-like):
 *   - Model:  Line-based text stored in a hidden <textarea> (always source of truth)
 *   - View:   A syntax-highlighted overlay <div> shows the content with colored spans.
 *             Only visible lines are efficiently updated via innerHTML.
 *   - Input:  The <textarea> captures ALL native input (typing, IME, paste, clipboard).
 *             Special keys (Enter→auto-indent, Tab→indent) are intercepted via keydown.
 *   - Cursor: The browser's native textarea caret is used directly (no custom cursor).
 *   - Click:  Chromium textarea hit-testing is unreliable, so we intercept mousedown
 *             and compute the true cursor position via caretRangeFromPoint on the overlay.
 *
 * All editing operations modify editor.value and let the input event propagate to
 * update the highlighter and line numbers.
 */

import { state } from "./state.js";
import { debounce, throttle, showToast, loadIcon } from "./utils.js";
import { highlightMmx } from "./syntaxHighlighter.js";
import { findAllTables, findAllElements, checkTableCompletion, findAllTablesWithCompletion } from "./editorUtils.js";
import { undoManager } from "./undoManager.js";

// ─── DOM references ─────────────────────────────────────────────────────────

/** @type {HTMLTextAreaElement} */
let editor = null;
/** @type {HTMLDivElement} */
let highlighter = null;
/** @type {HTMLDivElement} */
let lineNumbersEl = null;
/** @type {HTMLDivElement} */
let measureEl = null; // hidden element for measuring visual line count

// ─── Preview iframe reference ───────────────────────────────────────────────

let previewIframe = null;
let scrollSyncEnabled = true;

// ─── Scroll-sync guard ──────────────────────────────────────────────────────

let isSyncing = false;
let rafId = null;

// ─── Re-highlight guard ──────────────────────────────────────────────────────

let isUpdating = false;

// ─── IME composition flag ────────────────────────────────────────────────────

let isComposing = false;

// ─── Undo/Redo auto-save ────────────────────────────────────────────────────

/** Time in ms of continuous typing after which an undo snapshot is saved */
const UNDO_AUTO_SAVE_MS = 1200;
let lastUndoAutoSave = 0;

// ─── Multi-edit cycling state ────────────────────────────────────────────────

const multiEditIndex = new Map();

// ─── Line-number icon cache & concurrency guard ─────────────────────────────

/** @type {Record<string, string>} Pre-loaded SVG strings for line-number icons */
let lineIconCache = null;

/** Guard flag: true while updateLineNumbers() is building/replacing DOM */
let _updatingLineNumbers = false;

// ═════════════════════════════════════════════════════════════════════════════
// CURSOR / SELECTION HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Get the current selection range as text offsets.
 * @returns {{ start: number, end: number }}
 */
function getSelectionOffsets() {
  if (!editor) return { start: 0, end: 0 };
  return { start: editor.selectionStart, end: editor.selectionEnd };
}

// ═════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Pre-load SVG icons used by updateLineNumbers into the module-level cache
 * so updateLineNumbers can remain synchronous after the first call.
 */
async function preloadLineIcons() {
  const types = ['warning', 'table', 'image', 'video', 'audio', 'code', 'link', 'inlineimage'];
  const cache = {};
  for (const t of types) {
    try {
      cache[t] = await loadIcon(t);
    } catch {
      cache[t] = ''; // fallback: empty string
    }
  }
  lineIconCache = cache;
}

export function initCodeEditor() {
  editor = document.getElementById("codeEditor");
  highlighter = document.getElementById("editorHighlighter");
  lineNumbersEl = document.getElementById("lineNumbers");

  if (!editor || !highlighter) {
    console.error("codeEditor: required DOM elements (#codeEditor, #editorHighlighter) not found");
    return;
  }

  // Create hidden measuring element for visual line counting
  measureEl = document.createElement("div");
  measureEl.id = "editorMeasureEl";
  measureEl.style.cssText =
    "position:fixed;top:-9999px;left:0;visibility:hidden;pointer-events:none;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;";
  document.body.appendChild(measureEl);

  // Start pre-loading line-number icons (fires asynchronously; cache will
  // be ready before the first user interaction).
  preloadLineIcons();

  // ── Event listeners on the <textarea> ──────────────────────────────────
  editor.addEventListener("input", handleInput);
  editor.addEventListener("scroll", handleScroll, { passive: true });
  editor.addEventListener("keydown", handleKeydown);
  editor.addEventListener("mousedown", handleMousedown);
  editor.addEventListener("click", handleCursorActivity);
  editor.addEventListener("keyup", handleCursorActivity);
  editor.addEventListener("compositionstart", () => { isComposing = true; });
  editor.addEventListener("compositionend", () => { isComposing = false; });

  // ── File-change subscription ───────────────────────────────────────────
  let previousFilePath = null;
  state.subscribe("currentFile", (file) => {
    if (file) {
      setEditorContent(file.content, 0);
      // Only reset undo stack when opening a different file (not on saves)
      if (file.path !== previousFilePath) {
        undoManager.reset(file.content, 0, 0);
        previousFilePath = file.path;
      }
    } else {
      editor.value = "";
      updateHighlighter();
      updateLineNumbers();
      undoManager.clear();
      previousFilePath = null;
    }
  });

  // ── Initial render ─────────────────────────────────────────────────────
  updateHighlighter();
  updateLineNumbers();

  // Apply initial line wrap state to match the UI toggle (active = on)
  setLineWrapEnabled(true);

  // Watch for container resize to sync preview iframe
  setupResizeObserver();
}

// ═════════════════════════════════════════════════════════════════════════════
// DIRTY STATE
// ═════════════════════════════════════════════════════════════════════════════

function updateDirtyState() {
  if (!editor) return;
  const currentFile = state.get("currentFile");
  const content = editor.value;
  if (currentFile) {
    state.set("dirty", content !== currentFile.content);
  } else {
    state.set("dirty", content !== "");
  }
  state.set("editorContent", content);
}

// ═════════════════════════════════════════════════════════════════════════════
// SCROLL SYNCHRONIZATION
// ═════════════════════════════════════════════════════════════════════════════

function handleScroll() {
  if (isSyncing) return;

  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    rafId = null;
    if (!editor || !highlighter || !lineNumbersEl) return;

    // Keep the highlighter overlay scrolled in lockstep with the textarea
    // (both vertical and horizontal scroll)
    highlighter.scrollTop = editor.scrollTop;
    highlighter.scrollLeft = editor.scrollLeft;
    lineNumbersEl.scrollTop = editor.scrollTop;

    if (scrollSyncEnabled && previewIframe) {
      syncEditorToPreview();
    }
  });
}

export function syncEditorToPreview() {
  if (!previewIframe || !editor) return;
  try {
    const doc = previewIframe.contentDocument || previewIframe.contentWindow?.document;
    if (!doc) return;
    const scrollEl = doc.scrollingElement || doc.documentElement;
    if (!scrollEl) return;

    const editorMax = editor.scrollHeight - editor.clientHeight;
    const previewMax = scrollEl.scrollHeight - scrollEl.clientHeight;
    if (editorMax <= 0 || previewMax <= 0) return;

    const ratio = Math.min(editor.scrollTop / editorMax, 1);
    const target = ratio * previewMax;

    if (Math.abs(scrollEl.scrollTop - target) > 2) {
      isSyncing = true;
      scrollEl.scrollTop = target;
      isSyncing = false;
    }
  } catch (_) { /* cross-origin */ }
}

export function syncPreviewToEditor(iframe) {
  if (!scrollSyncEnabled || !iframe || !editor) return;
  if (isSyncing) return;

  try {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;
    const scrollEl = doc.scrollingElement || doc.documentElement;
    if (!scrollEl) return;

    const previewMax = scrollEl.scrollHeight - scrollEl.clientHeight;
    const editorMax = editor.scrollHeight - editor.clientHeight;
    if (previewMax <= 0 || editorMax <= 0) return;

    const ratio = Math.min(scrollEl.scrollTop / previewMax, 1);
    const target = ratio * editorMax;

    if (Math.abs(editor.scrollTop - target) > 2) {
      isSyncing = true;
      editor.scrollTop = target;
      if (lineNumbersEl) lineNumbersEl.scrollTop = target;
      isSyncing = false;
    }
  } catch (_) { /* cross-origin */ }
}

export function setPreviewIframe(iframe) {
  previewIframe = iframe;
}

export function setScrollSyncEnabled(enabled) {
  scrollSyncEnabled = enabled;
}

/**
 * Enable or disable line wrapping in the editor
 * @param {boolean} enabled - true for wrap on, false for wrap off
 */
export function setLineWrapEnabled(enabled) {
  if (!editor || !highlighter) return;

  const ws = enabled ? "pre-wrap" : "pre";
  const ox = enabled ? "hidden" : "auto";
  const ww = enabled ? "break-word" : "normal";
  const ow = enabled ? "break-word" : "normal";

  editor.style.whiteSpace = ws;
  editor.style.overflowX = ox;
  editor.style.wordWrap = ww;
  editor.style.overflowWrap = ow;

  highlighter.style.whiteSpace = ws;
  highlighter.style.overflowX = ox;
  highlighter.style.wordWrap = ww;
  highlighter.style.overflowWrap = ow;

  if (measureEl) {
    measureEl.style.whiteSpace = ws;
    measureEl.style.wordWrap = ww;
    measureEl.style.overflowWrap = ow;
  }

  requestAnimationFrame(() => refreshEditor());
}

// ═════════════════════════════════════════════════════════════════════════════
// INPUT HANDLING
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Throttled re-highlight for responsive syntax coloring without overloading.
 * Runs at most every 300 ms while the user types.
 */
/**
 * Call after any programmatic modification to editor.value to keep the
 * highlighter, dirty state, and line numbers in sync.
 * (User-initiated typing already triggers input → handleInput → update.)
 */
function updateAfterEdit() {
  if (!editor) return;
  updateHighlighter();
  updateDirtyState();
  updateLineNumbers();
  throttledRefresh();
}

const throttledRefresh = throttle(() => {
  refreshEditor();
}, 300);

function handleInput(event) {
  // During IME composition, the textarea.value doesn't include the composition
  // text. Use event.data to show the current composition in the highlighter.
  if (isComposing && event?.inputType === 'insertCompositionText' && event.data != null) {
    const val = editor.value;
    const pos = editor.selectionStart;
    const displayText = val.substring(0, pos) + event.data + val.substring(pos);
    highlighter.innerHTML = highlightMmx(displayText);
    return;
  }

  // Always update dirty state, even during re-highlight
  updateDirtyState();

  // Always update line numbers — the concurrency guard inside
  // updateLineNumbers() prevents races.
  updateLineNumbers();

  // If a full refresh (re-highlight + re-number) is already in progress,
  // skip the extra work here; the running refresh will produce the latest
  // content because it reads editor.value when it executes.
  if (isUpdating) return;

  // Update the highlighter overlay with new syntax spans
  updateHighlighter();

  // Schedule a throttled full refresh (re-highlights & re-numbers)
  throttledRefresh();

  // Auto-save undo snapshot on continuous typing (throttled)
  if (!undoManager.isUndoing) {
    const now = Date.now();
    if (now - lastUndoAutoSave > UNDO_AUTO_SAVE_MS) {
      saveUndoSnapshot();
      lastUndoAutoSave = now;
    }
  }
}

/**
 * Full refresh: re-highlights all content and recalculates line numbers.
 * Safe to call multiple times (guarded by isUpdating).
 */
function refreshEditor() {
  if (isUpdating) return;
  isUpdating = true;
  try {
    updateHighlighter();
    updateLineNumbers();
  } finally {
    isUpdating = false;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SYNTAX HIGHLIGHTING (OVERLAY)
// ═════════════════════════════════════════════════════════════════════════════

function updateHighlighter() {
  if (!editor || !highlighter) return;
  let html = highlightMmx(editor.value);
  // When the editor value ends with a newline, the highlighter's last empty
  // line collapses to zero height under white-space:pre-wrap (the trailing
  // newline after the last content line doesn't create a visible line box).
  // This makes highlighter.scrollHeight 20px less than the textarea's.
  // Adding a zero-width space forces that last line to have line-height.
  if (html.endsWith('\n')) {
    html += '\u200B';
  }
  highlighter.innerHTML = html;
  // Keep scroll synced after content change
  highlighter.scrollTop = editor.scrollTop;
}

// ═════════════════════════════════════════════════════════════════════════════
// PASTE HANDLING
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The <textarea> handles paste natively (even right-click).
 * We simply let the input event propagate and update the view.
 * If we need to process pasted text (e.g. strip formatting),
 * we can intercept here.
 */
function handlePaste(e) {
  // Native paste is fine — input event will call updateHighlighter.
}

// ═════════════════════════════════════════════════════════════════════════════
// LINE NUMBERS
// ═════════════════════════════════════════════════════════════════════════════

function updateLineNumbers() {
  if (!lineNumbersEl || !editor) return;
  // Guard against concurrent runs — if a previous call is still building the
  // DOM, skip this one (the next input/edit will trigger a fresh update).
  if (_updatingLineNumbers) return;
  _updatingLineNumbers = true;

  try {
    const content = editor.value;
    const lines = content.split("\n");
    const count = lines.length;

    // Find all MMX elements (tables, images, videos, audios, links) and their starting line numbers
    const elements = findAllElements(content);
    const elementStartLines = new Map();

    elements.forEach(element => {
      if (!elementStartLines.has(element.startLine)) {
        elementStartLines.set(element.startLine, []);
      }
      elementStartLines.get(element.startLine).push(element);
    });

    // Check for incomplete tables (missing #endtable)
    const tableCompletion = checkTableCompletion(content);
    const incompleteTableLines = new Set(
      tableCompletion.incompleteTables.map(t => t.startLine)
    );

    // Use pre-loaded icons from cache; if the cache isn't ready yet (very
    // first load), fall back to empty strings — the next update will have
    // icons.
    const icons = lineIconCache || {};
    const warningIconSvg = icons.warning || '';

    // ── Setup measuring element to match editor dimensions ──────────────────
    const cs = getComputedStyle(editor);
    measureEl.style.fontFamily = cs.fontFamily;
    measureEl.style.fontSize = cs.fontSize;
    measureEl.style.lineHeight = cs.lineHeight;
    measureEl.style.padding = '0 14px'; // match editor horizontal padding
    const contentWidth = editor.clientWidth;
    measureEl.style.width = contentWidth + 'px';
    const lineHeight = parseFloat(cs.lineHeight) || 20.8;

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      // Measure how many visual lines this logical line occupies
      measureEl.textContent = lines[i];
      const visualHeight = measureEl.offsetHeight;
      const visualCount = Math.max(1, Math.round(visualHeight / lineHeight));

      const logicalLine = i + 1;

      for (let v = 0; v < visualCount; v++) {
        if (v === 0) {
          // ── First visual line — normal line number with icons ──────────────
          const lineDiv = document.createElement("div");
          lineDiv.className = "line-number";

          // Create span for line number text
          const lineNumberSpan = document.createElement("span");
          lineNumberSpan.className = "line-number-text";
          lineNumberSpan.textContent = logicalLine;
          lineDiv.appendChild(lineNumberSpan);

          // Add warning icon for incomplete tables
          if (incompleteTableLines.has(logicalLine)) {
            const warningIcon = document.createElement("button");
            warningIcon.className = "table-warning-icon element-warning-icon";
            warningIcon.title = "Incomplete table - missing #endtable";
            warningIcon.innerHTML = warningIconSvg;
            warningIcon.addEventListener("click", (e) => {
              e.stopPropagation();
              showToast("Table at line " + logicalLine + " is incomplete - missing #endtable", "warning");
            });
            lineDiv.appendChild(warningIcon);
            lineDiv.classList.add("has-incomplete-table");
          }

          // Add edit icons for elements on this line — group by type
          if (elementStartLines.has(logicalLine)) {
            const elementsOnLine = elementStartLines.get(logicalLine);
            const allSiblings = buildSiblingList(elements, logicalLine);
            const siblings = allSiblings;

            // Group elements by type
            const typeGroups = new Map();
            for (const el of elementsOnLine) {
              if (!typeGroups.has(el.type)) typeGroups.set(el.type, []);
              typeGroups.get(el.type).push(el);
            }

            // Create one button per type group
            for (const [type, group] of typeGroups) {
              if (group.length === 1) {
                // Single element of this type — normal edit icon
                const element = group[0];
                const siblingIndex = siblings.findIndex(s => s === element);
                const editIcon = document.createElement("button");
                editIcon.className = `${type}-edit-icon element-edit-icon`;
                editIcon.title = `Edit ${type}`;
                editIcon.innerHTML = icons[type] || icons.table || '';
                editIcon.addEventListener("click", (e) => {
                  e.stopPropagation();
                  openElementEditorForLine(logicalLine, type);
                });
                lineDiv.appendChild(editIcon);
              } else {
                // Multiple elements of the same type — cycling button
                const multiBtn = document.createElement("button");
                multiBtn.className = `multi-edit-icon element-edit-icon`;
                multiBtn.title = `Edit ${type} (1/${group.length})`;
                multiBtn.setAttribute('aria-label', `Edit ${type} (1/${group.length})`);

                // Use a composite key: lineNumber + ':' + type
                const cycleKey = logicalLine + ':' + type;
                if (!multiEditIndex.has(cycleKey)) multiEditIndex.set(cycleKey, 0);
                let currentIdx = multiEditIndex.get(cycleKey);
                const currentElement = group[currentIdx];

                multiBtn.innerHTML = `
                  ${icons[type] || icons.table || ''}
                  <span class="multi-edit-count">${group.length}</span>
                `;

                multiBtn.addEventListener("click", (e) => {
                  e.stopPropagation();
                  // Advance to the next element in this type group
                  const idx = multiEditIndex.get(cycleKey) ?? 0;
                  const nextIdx = (idx + 1) % group.length;
                  multiEditIndex.set(cycleKey, nextIdx);
                  const nextElement = group[nextIdx];

                  // Update counter
                  multiBtn.title = `Edit ${type} (${nextIdx + 1}/${group.length})`;
                  multiBtn.setAttribute('aria-label', `Edit ${type} (${nextIdx + 1}/${group.length})`);

                  // Dispatch the edit event with sibling navigation data (same-type only)
                  dispatchEditWithSiblings(nextElement, group, group.indexOf(nextElement));
                });

                lineDiv.appendChild(multiBtn);
              }
            }
          }

          fragment.appendChild(lineDiv);
        } else {
          // ── Continuation visual line — empty, no number, no icons ──────────
          const contDiv = document.createElement("div");
          contDiv.className = "line-number line-number-continuation";
          fragment.appendChild(contDiv);
        }
      }
    }
    lineNumbersEl.innerHTML = "";
    lineNumbersEl.appendChild(fragment);
  } catch (err) {
    console.error("updateLineNumbers error:", err);
  } finally {
    _updatingLineNumbers = false;
  }
}

/**
 * Build the list of sibling elements on the same logical line.
 * @param {Array} allElements - All elements from findAllElements()
 * @param {number} lineNumber - The logical line number
 * @param {string} [typeFilter] - Optional type to filter by
 * @returns {Array} Array of sibling elements on this line
 */
function buildSiblingList(allElements, lineNumber, typeFilter) {
  return allElements.filter(e => e.startLine === lineNumber && (!typeFilter || e.type === typeFilter));
}

/**
 * Dispatch a CustomEvent for an element, including sibling navigation data.
 * @param {Object} element - The element to edit
 * @param {Array} siblings - All sibling elements on the same logical line
 * @param {number} siblingIndex - Index of this element within siblings
 */
function dispatchEditWithSiblings(element, siblings, siblingIndex) {
  const content = editor.value;
  const eventName = element.type === 'table' ? 'edit-table' : `edit-${element.type}`;
  
  // Pass through element-specific properties (path, flags, alt, text, url, etc.)
  const extraProps = {};
  for (const key of Object.keys(element)) {
    if (!['start', 'end', 'startLine', 'endLine', 'fullMatch', 'type', 'content'].includes(key)) {
      extraProps[key] = element[key];
    }
  }
  
  window.dispatchEvent(new CustomEvent(eventName, {
    detail: {
      start: element.start,
      end: element.end,
      content: content.substring(element.start, element.end),
      mode: element.mode || '',
      classes: element.classes || '',
      type: element.type,
      ...extraProps,
      siblings: siblings.map(s => {
        const sExtra = {};
        for (const key of Object.keys(s)) {
          if (!['start', 'end', 'startLine', 'endLine', 'fullMatch', 'type', 'content'].includes(key)) {
            sExtra[key] = s[key];
          }
        }
        return {
          type: s.type,
          start: s.start,
          end: s.end,
          content: content.substring(s.start, s.end),
          mode: s.mode || '',
          classes: s.classes || '',
          ...sExtra
        };
      }),
      siblingIndex: siblingIndex
    }
  }));
}

/**
 * Open editor for an element at the given line number
 * @param {number} lineNumber - The line number where the element starts
 * @param {string} elementType - The type of element (table, image, video, audio, link, code)
 */
function openElementEditorForLine(lineNumber, elementType) {
  const content = editor.value;
  const elements = findAllElements(content);

  // Find the element that starts at this line with the specified type
  const element = elements.find(e => e.startLine === lineNumber && e.type === elementType);

  if (element) {
    // Find all siblings on the same logical line (same type only)
    const siblings = buildSiblingList(elements, lineNumber, elementType);
    const siblingIndex = siblings.findIndex(s => s === element);
    // Dispatch with sibling navigation data
    dispatchEditWithSiblings(element, siblings, siblingIndex);
  } else {
    console.warn(`No ${elementType} found at line`, lineNumber);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// KEYBOARD HANDLING
// ═════════════════════════════════════════════════════════════════════════════

function handleKeydown(e) {
  const mod = e.ctrlKey || e.metaKey;

  // Ctrl+S = Save
  if (mod && e.key === "s") {
    e.preventDefault();
    document.querySelector('[data-cmd="save"]')?.click();
    return;
  }
  // Ctrl+B = Bold
  if (mod && e.key === "b") {
    e.preventDefault();
    document.querySelector('[data-cmd="bold"]')?.click();
    return;
  }
  // Ctrl+I = Italic
  if (mod && e.key === "i") {
    e.preventDefault();
    document.querySelector('[data-cmd="italic"]')?.click();
    return;
  }
  // Ctrl+U = Underline
  if (mod && e.key === "u") {
    e.preventDefault();
    document.querySelector('[data-cmd="underline"]')?.click();
    return;
  }
  // Ctrl+H = Heading
  if (mod && e.key === "h") {
    e.preventDefault();
    document.querySelector('[data-cmd="heading"]')?.click();
    return;
  }
  // Ctrl+K = Link
  if (mod && e.key === "k") {
    e.preventDefault();
    document.querySelector('[data-cmd="link"]')?.click();
    return;
  }

  // Ctrl+Z = Undo
  if (mod && e.key === "z" && !e.shiftKey) {
    e.preventDefault();
    performUndo();
    return;
  }

  // Ctrl+Y or Ctrl+Shift+Z = Redo
  if ((mod && e.key === "y") || (mod && e.key === "z" && e.shiftKey)) {
    e.preventDefault();
    performRedo();
    return;
  }

  // Alt+W — toggle line wrap
  if (e.altKey && e.key === "w") {
    e.preventDefault();
    document.querySelector('[data-cmd="wrap-toggle"]')?.click();
    return;
  }

  // Tab / Shift+Tab — indent / unindent
  if (e.key === "Tab") {
    e.preventDefault();
    if (e.shiftKey) {
      unindentSelection();
    } else {
      indentSelection();
    }
    return;
  }

  // ArrowDown — snap cursor to end when on an empty last line
  if (e.key === "ArrowDown") {
    const val = editor.value;
    const cursorPos = editor.selectionStart;
    const lines = val.split("\n");
    const totalLines = lines.length;

    // Calculate current line number (1-based)
    let charCount = 0;
    let currentLine = 0;
    for (let i = 0; i < lines.length; i++) {
      if (cursorPos <= charCount + lines[i].length) {
        currentLine = i + 1;
        break;
      }
      charCount += lines[i].length + 1;
    }
    if (currentLine === 0) currentLine = lines.length;

    // If past the last line and that line is empty, snap cursor to end of content.
    // "currentLine > totalLines" means the cursor is beyond the last logical line,
    // which can only happen when already at val.length. This preserves the native
    // ability to first reach the last empty line via ArrowDown from the line above.
    if (currentLine > totalLines && lines[totalLines - 1] === "") {
      e.preventDefault();
      editor.selectionStart = editor.selectionEnd = val.length;
      return;
    }
  }

  // Enter — auto-indent (plain Enter, not Shift+Enter or Ctrl+Enter)
  if (e.key === "Enter" && !mod && !e.shiftKey) {
    e.preventDefault();
    handleEnter();
    return;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// ENTER – AUTO-INDENT
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Handle Enter key: insert a newline + auto-indentation.
 * Operates directly on editor.value, which triggers input → highlight update.
 */
function handleEnter() {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const val = editor.value;

  // Find the start of the current logical line
  const lineStart = val.lastIndexOf("\n", start - 1) + 1;
  const currentLine = val.substring(lineStart, start);
  const indent = currentLine.match(/^(\s*)/)[1];

  // Build the insertion: newline + current line's leading whitespace
  const insertion = "\n" + indent;
  const newVal = val.substring(0, start) + insertion + val.substring(end);
  const newPos = start + insertion.length;

  editor.value = newVal;
  editor.selectionStart = editor.selectionEnd = newPos;

  // Programmatic value change does NOT fire the input event;
  // update view manually.
  updateAfterEdit();
  // Save undo snapshot after the change
  saveUndoSnapshot();
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB – INDENT / UNINDENT
// ═════════════════════════════════════════════════════════════════════════════

function indentSelection() {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const val = editor.value;

  if (start === end) {
    // Single cursor: insert a tab character at the cursor position
    const newVal = val.substring(0, start) + "\t" + val.substring(end);
    editor.value = newVal;
    editor.selectionStart = editor.selectionEnd = start + 1;
    updateAfterEdit();
    // Save undo snapshot after the change
    saveUndoSnapshot();
    return;
  }

  // Multi-line selection: prepend tab to each selected line
  const lineStart = val.lastIndexOf("\n", start - 1) + 1;
  const selected = val.substring(lineStart, end);
  const indented = selected.replace(/^/gm, "\t");

  const newVal = val.substring(0, lineStart) + indented + val.substring(end);
  editor.value = newVal;
  const added = indented.length - selected.length;
  editor.selectionStart = start + 1;
  editor.selectionEnd = end + added;
  updateAfterEdit();
  // Save undo snapshot after the change
  saveUndoSnapshot();
}

function unindentSelection() {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const val = editor.value;

  const lineStart = val.lastIndexOf("\n", start - 1) + 1;
  const selected = val.substring(lineStart, end);

  let removedBefore = 0;
  let removedTotal = 0;
  const unindented = selected.split("\n").map((line) => {
    if (line.startsWith("\t")) {
      if (removedTotal < start - lineStart) removedBefore++;
      removedTotal++;
      return line.substring(1);
    }
    return line;
  });

  const newVal = val.substring(0, lineStart) + unindented.join("\n") + val.substring(end);
  editor.value = newVal;
  const newStart = Math.max(lineStart, start - removedBefore);
  const newEnd = lineStart + (end - lineStart) - removedTotal;
  editor.selectionStart = newStart;
  editor.selectionEnd = Math.max(newStart, newEnd);
  updateAfterEdit();
  // Save undo snapshot after the change
  saveUndoSnapshot();
}

// ═════════════════════════════════════════════════════════════════════════════
// MOUSEDOWN — CLICK POSITIONING WITH DRAG-TO-SELECT SUPPORT
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Drag-selection state
 */
let mousedownAnchor = null;
let isMouseDown = false;

/**
 * Intercept mousedown to fix Chromium click-positioning on wrapped lines.
 * We prevent the browser's default (which uses font metrics instead of
 * CSS line-height) and instead use document.caretRangeFromPoint on the
 * highlighter overlay (which has identical layout).
 *
 * For drag-to-select we add document-level mousemove/mouseup listeners.
 */
function handleMousedown(e) {
  // Allow multi-click to work natively
  if (e.detail > 1) return;

  // Prevent the browser's native (broken) cursor positioning EARLY
  // so even if offset computation fails, the textarea doesn't get confused
  // by transparent text and fail silently.
  e.preventDefault();

  // Sync highlighter scroll immediately — the rAF in handleScroll may not
  // have fired yet if the user scrolled and clicked quickly.
  highlighter.scrollTop = editor.scrollTop;
  highlighter.scrollLeft = editor.scrollLeft;
  lineNumbersEl.scrollTop = editor.scrollTop;

  // Temporarily swap pointer-events so caretRangeFromPoint can reach the highlighter
  editor.style.pointerEvents = "none";
  highlighter.style.pointerEvents = "auto";

  let range = null;
  try {
    range = document.caretRangeFromPoint(e.clientX, e.clientY);
  } catch (_) {
    // Firefox uses document.caretPositionFromPoint instead
  }

  // Restore pointer-events immediately
  editor.style.pointerEvents = "";
  highlighter.style.pointerEvents = "";

  // Wrap fallible logic in try-catch so we ALWAYS set the cursor,
  // even if caretRangeFromPoint returns null or snapToContentEnd throws.
  try {
    let offset;
    if (range) {
      offset = getAbsoluteTextOffset(range);
    }

    if (offset == null) {
      // Fallback: keep the current cursor position
      offset = editor.selectionStart;
    }

    // Snap to end of content when clicking below the last rendered line
    // (handles empty trailing lines where caretRangeFromPoint returns wrong position)
    offset = snapToContentEnd(offset, e.clientY);

    // Store anchor and set cursor
    mousedownAnchor = offset;
    isMouseDown = true;
    editor.focus();
    editor.setSelectionRange(offset, offset);
  } catch (err) {
    console.warn("handleMousedown error:", err);
    editor.focus();
  }

  // Add document-level listeners for drag-to-select
  document.addEventListener("mousemove", handleDocumentMousemove);
  document.addEventListener("mouseup", handleDocumentMouseup);
}

/**
 * Handle drag-to-select by extending the selection from the mousedown anchor
 * to the current mouse position.
 */
function handleDocumentMousemove(e) {
  if (!isMouseDown || mousedownAnchor == null) return;

  // Sync highlighter scroll immediately (same reason as handleMousedown)
  highlighter.scrollTop = editor.scrollTop;
  highlighter.scrollLeft = editor.scrollLeft;

  // Temporarily swap pointer-events so caretRangeFromPoint can reach the highlighter
  editor.style.pointerEvents = "none";
  highlighter.style.pointerEvents = "auto";

  let range = null;
  try {
    range = document.caretRangeFromPoint(e.clientX, e.clientY);
  } catch (_) {}

  editor.style.pointerEvents = "";
  highlighter.style.pointerEvents = "";

  try {
    let currentOffset;
    if (range) {
      currentOffset = getAbsoluteTextOffset(range);
    }

    if (currentOffset == null) {
      // Fallback: keep the current cursor position
      currentOffset = editor.selectionStart;
    }

    // Snap to end of content when dragging below the last rendered line
    currentOffset = snapToContentEnd(currentOffset, e.clientY);

    // Set selection from anchor to current position
    const start = Math.min(mousedownAnchor, currentOffset);
    const end = Math.max(mousedownAnchor, currentOffset);
    editor.setSelectionRange(start, end);
  } catch (err) {
    console.warn("handleDocumentMousemove error:", err);
  }
}

/**
 * Clean up after drag selection ends.
 */
function handleDocumentMouseup() {
  document.removeEventListener("mousemove", handleDocumentMousemove);
  document.removeEventListener("mouseup", handleDocumentMouseup);
  isMouseDown = false;
  mousedownAnchor = null;
}

/**
 * Walk all text nodes inside the highlighter to translate a DOM Range
 * (startContainer + startOffset) into an absolute character offset from the
 * beginning of the editor content.
 *
 * @param {Range} range - A Range obtained from caretRangeFromPoint
 * @returns {number} The absolute character offset
 */
function getAbsoluteTextOffset(range) {
  if (!range) return 0;
  const walker = document.createTreeWalker(highlighter, NodeFilter.SHOW_TEXT, null, false);
  let totalChars = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node === range.startContainer) {
      return totalChars + range.startOffset;
    }
    totalChars += node.textContent.length;
  }
  // Fallback: return the start offset (shouldn't normally happen)
  return range.startOffset;
}

/**
 * When clicking on empty lines (where the highlighter has no visible text
 * characters), caretRangeFromPoint returns an incorrect offset. This function
 * detects such cases by mapping the click Y coordinate to the correct logical
 * line and snapping the offset to the proper position for empty lines.
 * @param {number} offset - The offset from getAbsoluteTextOffset
 * @param {number} clientY - The mouse Y coordinate from the click event
 * @returns {number} The corrected offset
 */
function snapToContentEnd(offset, clientY) {
  if (!editor) return offset;
  // Guard: measureEl must exist for line-height measurement
  if (!measureEl) return offset;
  const val = editor.value;

  // Style the measure element to match the editor layout
  const cs = getComputedStyle(editor);
  measureEl.style.fontFamily = cs.fontFamily;
  measureEl.style.fontSize = cs.fontSize;
  measureEl.style.lineHeight = cs.lineHeight;
  measureEl.style.padding = '0 14px';
  const contentWidth = editor.clientWidth;
  measureEl.style.width = contentWidth + 'px';
  const lineHeight = parseFloat(cs.lineHeight) || 20.8;
  const paddingTop = parseFloat(cs.paddingTop) || 10;
  const scrollTop = editor.scrollTop || 0;
  const editorRect = editor.getBoundingClientRect();

  // Walk through each logical line, measuring its visual height,
  // and determine which line the click Y falls on.
  const lines = val.split("\n");
  let yOffset = 0; // accumulates top of each line block
  let clickedLine = -1;

  for (let i = 0; i < lines.length; i++) {
    measureEl.textContent = lines[i] || " ";
    const visualHeight = measureEl.offsetHeight;
    const visualCount = Math.max(1, Math.round(visualHeight / lineHeight));
    const lineBlockHeight = visualCount * lineHeight;

    const lineTop = editorRect.top + paddingTop + yOffset - scrollTop;
    if (clientY >= lineTop && clientY < lineTop + lineBlockHeight) {
      clickedLine = i;
      break;
    }
    yOffset += lineBlockHeight;
  }

  // If the click is below all rendered lines, snap to the end of content
  if (clickedLine === -1 && lines.length > 0) {
    const totalContentHeight = yOffset + Math.max(1, Math.round(
      (measureEl.textContent = lines[lines.length - 1] || " ",
       measureEl.offsetHeight) / lineHeight
    )) * lineHeight;
    if (clientY >= editorRect.top + paddingTop + totalContentHeight - scrollTop) {
      return val.length;
    }
  }

  // If the clicked line is empty, compute its correct offset
  if (clickedLine >= 0) {
    if (lines[clickedLine] === "") {
      let linePos = 0;
      for (let j = 0; j < clickedLine; j++) {
        linePos += lines[j].length + 1; // +1 for the newline separator
      }
      // For an empty line, start and end are the same position
      return linePos;
    }

    // For a non-empty line, compute its boundaries
    let lineStartPos = 0;
    for (let j = 0; j < clickedLine; j++) {
      lineStartPos += lines[j].length + 1;
    }
    const lineEndPos = lineStartPos + lines[clickedLine].length;

    // If the original offset from caretRangeFromPoint is at or within this
    // line (including its end at the newline), use it.
    if (offset >= lineStartPos && offset <= lineEndPos) {
      return offset;
    }

    // Otherwise (caretRangeFromPoint gave us a wrong offset, e.g. val.length
    // for the last line, or an offset past the line's content), return the
    // start of the line so the cursor is at least on the correct line.
    return lineStartPos;
  }

  // Fallback: if we couldn't find a clicked line but the offset seems valid, keep it
  if (offset < val.length) {
    return offset;
  }

  // Last resort: snap to end only if we truly can't determine the position
  return val.length;
}

// ═════════════════════════════════════════════════════════════════════════════
// TEXT MANIPULATION API
// ═════════════════════════════════════════════════════════════════════════════

export function wrapSelection(before, after = "") {
  if (!editor) return;

  // Save undo snapshot before programmatic wrapping
  saveUndoSnapshot();

  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const val = editor.value;
  let selStart = start;
  let selEnd = end;

  if (start === end) {
    const wordBounds = findWordBounds(val, start);
    if (wordBounds) {
      selStart = wordBounds.start;
      selEnd = wordBounds.end;
    }
  }

  const selected = val.substring(selStart, selEnd);
  const replacement = before + selected + after;
  const newVal = val.substring(0, selStart) + replacement + val.substring(selEnd);

  editor.value = newVal;
  editor.selectionStart = selStart + before.length;
  editor.selectionEnd = selStart + before.length + selected.length;
  editor.focus();
  updateAfterEdit();
  // Save undo snapshot after the change
  saveUndoSnapshot();
}

function findWordBounds(text, pos) {
  if (pos >= text.length) return null;
  if (/\s/.test(text[pos])) {
    if (pos > 0 && !/\s/.test(text[pos - 1])) {
      pos = pos;
    } else {
      return null;
    }
  }

  let start = pos;
  let end = pos;
  while (start > 0 && /\S/.test(text[start - 1])) start--;
  while (end < text.length && /\S/.test(text[end])) end++;

  return start < end ? { start, end } : null;
}

export function insertText(text) {
  if (!editor) return;

  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const val = editor.value;
  const newVal = val.substring(0, start) + text + val.substring(end);

  editor.value = newVal;
  editor.selectionStart = editor.selectionEnd = start + text.length;
  editor.focus();
  updateAfterEdit();
  // Save undo snapshot after the change
  saveUndoSnapshot();
}

export function setEditorContent(text, cursorOffset, captureUndo = false) {
  if (!editor) return;
  // Strip any zero-width spaces that might have been saved
  text = text.replace(/\u200B/g, "");
  editor.value = text;
  updateHighlighter();
  updateDirtyState();
  updateLineNumbers();
  if (cursorOffset != null) {
    editor.setSelectionRange(cursorOffset, cursorOffset);
  } else {
    editor.setSelectionRange(0, 0);
  }
  editor.focus();
  // Save undo snapshot after the change if requested
  if (captureUndo) {
    saveUndoSnapshot();
  }
}

export function getEditorContent() {
  return editor ? editor.value : "";
}

export function getEditorElement() {
  return editor;
}

export function getSelectionRange() {
  return getSelectionOffsets();
}

/**
 * Get the current cursor position as a character offset (for autocomplete).
 * @returns {number}
 */
export function getCursorOffset() {
  return editor ? editor.selectionStart : 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// UNDO / REDO
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Save an undo snapshot of the current editor state.
 */
function saveUndoSnapshot() {
  if (!editor) return;
  undoManager.saveSnapshot(editor.value, editor.selectionStart, editor.selectionEnd);
}

/**
 * Perform an undo operation.
 */
function performUndo() {
  if (!editor) return;
  const state = undoManager.undo();
  if (!state) return;
  applyUndoRedoState(state);
}

/**
 * Perform a redo operation.
 */
function performRedo() {
  if (!editor) return;
  const state = undoManager.redo();
  if (!state) return;
  applyUndoRedoState(state);
}

/**
 * Apply an undo/redo state to the editor and reset the flag.
 * @param {{content: string, cursorStart: number, cursorEnd: number}} state
 */
function applyUndoRedoState(state) {
  editor.value = state.content;
  editor.selectionStart = state.cursorStart;
  editor.selectionEnd = state.cursorEnd;
  undoManager.finishUndoRedo();
  updateAfterEdit();
}

/**
 * Public API: save an undo snapshot before making external programmatic changes.
 * Call this before calling insertText(), setEditorContent(), etc. from outside codeEditor.
 */
export function captureUndoSnapshot() {
  saveUndoSnapshot();
}

// ═════════════════════════════════════════════════════════════════════════════
// CURSOR ACTIVITY
// ═════════════════════════════════════════════════════════════════════════════

function handleCursorActivity() {
  if (!editor) return;
  const pos = { start: editor.selectionStart, end: editor.selectionEnd };
  state.set("cursorPos", pos);
}

// ═════════════════════════════════════════════════════════════════════════════
// RESIZE OBSERVER
// ═════════════════════════════════════════════════════════════════════════════

function setupResizeObserver() {
  try {
    const observer = new ResizeObserver(() => {
      // When the editor container resizes, recalculate line numbers and
      // re-highlight in case wrapping behaviour changed
      if (editor) {
        requestAnimationFrame(() => refreshEditor());
      }
    });
    const editorSection = document.querySelector(".editor-section");
    if (editorSection) observer.observe(editorSection);
  } catch (_) {
    // ResizeObserver not supported — silently skip
  }
}
