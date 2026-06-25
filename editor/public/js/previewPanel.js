/**
 * MMX Visual Editor — Preview Panel
 *
 * Renders live preview of MMX content by calling the server's
 * preview API. Uses an iframe with real output styles so the
 * preview looks identical to the final documentation.
 */

import { state } from "./state.js";
import * as api from "./api.js";
import { debounce } from "./utils.js";
import { setPreviewIframe, syncPreviewToEditor, syncEditorToPreview } from "./codeEditor.js";

let previewTimer = null;
let lastRequestId = 0;
let previewIframe = null;
let iframeReady = false;

/**
 * Initialize the preview panel
 */
export function initPreview() {
  const previewSection = document.getElementById("previewSection");
  if (!previewSection) return;

  // Check if we already have an iframe
  let existingIframe = previewSection.querySelector(".preview-iframe");
  if (!existingIframe) {
    // Create iframe for the preview
    existingIframe = document.createElement("iframe");
    existingIframe.className = "preview-iframe";
    existingIframe.title = "MMX Preview";
    existingIframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
    
    const previewContent = document.getElementById("previewContent");
    if (previewContent) {
      previewContent.innerHTML = "";
      previewContent.appendChild(existingIframe);
    }
  }
  previewIframe = existingIframe;

  // Set up scroll synchronization with editor
  setPreviewIframe(previewIframe);

  // Initialize the iframe document with styles
  initIframeDocument();

  // Subscribe to editor content changes
  state.subscribe("editorContent", debounce((content) => {
    if (content !== undefined) {
      updatePreview(content);
    }
  }, 400));

  // Also update when a new file is loaded
  state.subscribe("currentFile", (file) => {
    if (file) {
      updatePreview(file.content);
    } else {
      const previewEl = document.getElementById("previewContent");
      if (previewEl && previewIframe) {
        setIframeContent('<div class="preview-placeholder"><p>Open a file to see the live preview</p></div>');
      }
    }
  });

  // Table editor is now handled in the code editor only (not in preview)
  // window.addEventListener("edit-table", (e) => {
  //   handleTableEdit(e.detail);
  // });
}

/**
 * Handle table edit request from preview
 * Finds the corresponding #table block in the editor and opens the dialog
 * @param {object} detail - { html: string }
 */
function handleTableEdit(detail) {
  const editor = document.getElementById("codeEditor");
  if (!editor) return;

  const content = editor.value;
  // Match #table [mode] [optional classes] then body up to #endtable.
  // The optional "classes" group may capture the first data row when
  // it is written on the same line as the mode (e.g. "#table v Name|Score|State").
  // We detect this by checking for a pipe (|) in the captured text.
  const tableRegex = /#table\s+([vhb])(?:\s+([^\n]+))?\n([\s\S]*?)#endtable/g;
  let match;
  let tableIndex = 0;
  let targetTable = null;

  // Find which table the user clicked by matching tables in order
  // We need to find the nth table in the source that matches
  const tables = [];
  while ((match = tableRegex.exec(content)) !== null) {
    let mode = match[1];
    let classes = (match[2] || '').trim();
    let body = match[3].trim();

    // If the "classes" capture looks like table data (contains |),
    // it is actually the first row written on the same line as #table.
    // Prepend it to the body and clear classes.
    if (classes.includes('|')) {
      body = classes + '\n' + body;
      classes = '';
    }

    tables.push({
      mode: mode,
      classes: classes,
      body: body,
      fullMatch: match[0],
      index: match.index,
    });
  }

  if (tables.length === 0) return;

  // If there's only one table, use it. Otherwise, we'd need a smarter matching.
  // For now, try to find the table that best matches by looking at row/col counts
  const previewHtml = detail.html;
  const previewTable = previewHtml.match(/<table[^>]*>([\s\S]*?)<\/table>/);
  if (!previewTable) return;

  const previewRows = previewTable[1].match(/<tr>[\s\S]*?<\/tr>/g);
  const previewRowCount = previewRows ? previewRows.length : 0;
  const previewColCount = previewTable[1].match(/<t[hd][^>]*>/g) ? 
    Math.max(...(previewRows || []).map(r => (r.match(/<t[hd][^>]*>/g) || []).length)) : 0;

  // Find the table in source with closest row/col match
  let bestScore = Infinity;
  for (const t of tables) {
    const sourceRows = t.body.split('\n').filter(l => l.trim());
    const sourceCols = sourceRows.length > 0 ? sourceRows[0].split('|').length : 0;
    const score = Math.abs(sourceRows.length - previewRowCount) + Math.abs(sourceCols - previewColCount);
    if (score < bestScore) {
      bestScore = score;
      targetTable = t;
    }
  }

  if (!targetTable) return;

  // Open the table dialog with pre-filled values
  const modeSelect = document.getElementById("tableMode");
  const classInput = document.getElementById("tableClasses");
  if (modeSelect) modeSelect.value = targetTable.mode;
  if (classInput) classInput.value = targetTable.classes;

  // Calculate dimensions from source
  const sourceRows = targetTable.body.split('\n').filter(l => l.trim());
  const cols = sourceRows.length > 0 ? sourceRows[0].split('|').length : 3;
  const rows = sourceRows.length;

  const colsInput = document.getElementById("tableCols");
  const rowsInput = document.getElementById("tableRows");
  if (colsInput) colsInput.value = cols;
  if (rowsInput) rowsInput.value = rows;

  // Show the dialog
  const dialog = document.getElementById("dialogTable");
  const overlay = document.getElementById("dialogOverlay");
  if (dialog) dialog.style.display = "flex";
  if (overlay) overlay.style.display = "block";
}

/**
 * Initialize the iframe document with real output stylesheets
 */
async function initIframeDocument() {
  if (!previewIframe) return;

  try {
    // Wait for iframe to load
    if (!previewIframe.contentDocument) {
      await new Promise((resolve) => {
        previewIframe.addEventListener("load", resolve, { once: true });
      });
    }

    const doc = previewIframe.contentDocument || previewIframe.contentWindow.document;
    doc.open();
    doc.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Archivo+Black&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital@0;1&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/intAssets/style.css">
  <link rel="stylesheet" href="/intAssets/styleSidebar.css">
  <link rel="stylesheet" href="/intAssets/player/playerStyle.css">
  <style>
    body {
      display: block;
      margin: 0;
      padding: 0;
      background: #f3f7fb;
    }
    main {
      margin: 0 auto;
      max-width: 1000px;
      padding: 24px 32px;
      padding-bottom: 100px;
      min-height: 100vh;
      box-sizing: border-box;
    }
    #sidebar, #icon-btn2, #header-navigator {
      display: none !important;
    }
    .preview-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 300px;
      color: #999;
      font-size: 16px;
      font-family: "Lato", sans-serif;
    }
    /* Hide copy buttons in preview */
    .copy-btn { display: none !important; }
    /* Table wrapper needs position relative for edit button */
    .table-wrapper {
      position: relative;
    }
    /* Table hover edit button */
    .table-wrapper:hover{
      opacity: 1;
    }
  </style>
</head>
<body>
  <main id="preview-main"></main>
  <script src="/intAssets/imageZoom.js"></script>
  <script src="/intAssets/player/playerScript.js"></script>
  <script>
    // Initialize image zoom and players on initial load
    document.addEventListener('DOMContentLoaded', function() {
      if (typeof imageZoom === 'function') {
        imageZoom('img.img, main img:not(.inlineImg):not(.colorDisplay-swatch)');
      }
      if (typeof VsPlayer === 'function') {
        document.querySelectorAll('video, audio').forEach(function(el) {
          try { new VsPlayer(el); } catch(e) {}
        });
      }
    });
  </script>
</body>
</html>`);
    doc.close();
    iframeReady = true;
    
    // Re-attach scroll listeners for scroll sync after iframe reload
    attachPreviewScrollListeners(doc);
  } catch (e) {
    console.error("Failed to initialize preview iframe:", e);
    iframeReady = false;
  }
}

/**
 * Attach scroll event listeners to the preview iframe for bidirectional scroll sync
 * @param {Document} doc - The iframe's document
 */
function attachPreviewScrollListeners(doc) {
  try {
    // Use document.scrollingElement (html element) which is the actual scrollable container in the iframe
    const scrollingElement = doc.scrollingElement || doc.documentElement;
    if (scrollingElement) {
      scrollingElement.addEventListener("scroll", () => syncPreviewToEditor(previewIframe));
    }
  } catch (e) {
    // Ignore cross-origin errors
  }
}

/**
 * Set content inside the iframe
 * @param {string} html - HTML content to display
 */
function setIframeContent(html) {
  if (!previewIframe || !iframeReady) return;
  try {
    const doc = previewIframe.contentDocument || previewIframe.contentWindow.document;
    const main = doc.getElementById("preview-main");
    if (main) {
      main.innerHTML = html;
      // Trigger image zoom and player initialization for new content
      initPreviewFeatures(doc);
      // Re-sync scroll position now that content height may have changed
      syncEditorToPreview();
    }
  } catch (e) {
    console.error("Failed to set iframe content:", e);
  }
}

/**
 * Add edit buttons to all tables in the preview iframe
 * @param {Document} doc - The iframe's document
 */

/**
 * Initialize preview features (image zoom, players) on new content
 * @param {Document} doc - The iframe's document
 */
function initPreviewFeatures(doc) {
  // Re-run image zoom if the function exists
  if (typeof doc.defaultView.imageZoom === 'function') {
    try {
      doc.defaultView.imageZoom('img.img, main img:not(.inlineImg):not(.colorDisplay-swatch)');
    } catch(e) {}
  }
  // Re-init players
  if (typeof doc.defaultView.VsPlayer === 'function') {
    doc.querySelectorAll('video, audio').forEach(function(el) {
      try { new doc.defaultView.VsPlayer(el); } catch(e) {}
    });
  }
}

/**
 * Update the preview with new content
 * @param {string} content - MMX source text
 */
async function updatePreview(content) {
  const statusEl = document.getElementById("previewStatus");

  // Show loading state
  if (statusEl) {
    statusEl.textContent = "Rendering...";
    statusEl.className = "preview-status loading";
  }

  // Generate a request ID to cancel stale responses
  const requestId = ++lastRequestId;

  try {
    const currentFile = state.get('currentFile');
    const filePath = currentFile ? currentFile.path : undefined;
    const data = await api.preview(content, filePath);

    // Only apply if this is still the latest request
    if (requestId === lastRequestId) {
      if (iframeReady) {
        setIframeContent(data.html);
      } else {
        // Fallback: try reinitializing
        await initIframeDocument();
        if (iframeReady) {
          setIframeContent(data.html);
        }
      }
      state.set("lastPreview", data.html);

      if (statusEl) {
        statusEl.textContent = "✓ Live";
        statusEl.className = "preview-status";
      }
    }
  } catch (e) {
    if (requestId === lastRequestId) {
      console.error("Preview error:", e);
      if (iframeReady) {
        setIframeContent(`<div class="preview-placeholder"><p style="color:#e05050;">⚠️ Preview error: ${escapeHtml(e.message)}</p></div>`);
      }

      if (statusEl) {
        statusEl.textContent = "Error";
        statusEl.className = "preview-status error";
      }
    }
  }
}

/**
 * Escape HTML for safe display
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Manually refresh the preview
 */
export function refreshPreview() {
  const content = state.get("editorContent");
  if (content) {
    updatePreview(content);
  }
}
