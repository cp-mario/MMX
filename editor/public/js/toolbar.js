/**
 * MMX Visual Editor — Toolbar (v2)
 *
 * Handles toolbar button clicks: formatting insertion, save, preview toggle.
 * Also manages the save-status indicator in the header.
 */

import { state } from "./state.js";
import * as api from "./api.js";
import * as codeEditor from "./codeEditor.js";
import * as dialogs from "./dialogs.js";
import { suppressNextInput } from "./autocomplete.js";
import { showToast } from "./utils.js";

// ─── Auto-save & exit warning ────────────────────────────────────────────────

let autoSaveInterval = null;
let originalContentOnOpen = null; // Track original content when file opened

function startAutoSave() {
  if (autoSaveInterval) return;
  autoSaveInterval = setInterval(async () => {
    const dirty = state.get("dirty");
    const currentFile = state.get("currentFile");
    if (dirty && currentFile) {
      try {
        const content = codeEditor.getEditorContent();
        await api.saveFile(currentFile.path, content);
        state.update({
          dirty: false,
          saving: false,
          currentFile: { ...currentFile, content, originalContent: currentFile.originalContent },
        });
        // originalContent is preserved - it's the content when file was first opened
      } catch (e) {
        console.error("Auto-save failed:", e);
      }
    }
  }, 30000); // Every 30 seconds
}

function stopAutoSave() {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
  }
}

// ─── Exit warning ────────────────────────────────────────────────────────────

function initExitWarning() {
  window.addEventListener("beforeunload", (e) => {
    const dirty = state.get("dirty");
    if (dirty) {
      e.preventDefault();
      e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
      return e.returnValue;
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═════════════════════════════════════════════════════════════════════════════

export function initToolbar() {
  // Attach click handlers to all tool buttons
  document.querySelectorAll(".tool-btn[data-cmd]").forEach((btn) => {
    btn.addEventListener("click", () => handleCommand(btn.dataset.cmd));
  });

  // Subscribe to state changes for save status indicator
  state.subscribe("dirty", (dirty) => {
    updateSaveStatus(dirty ? "unsaved" : "saved");
  });

  state.subscribe("saving", (saving) => {
    const dirty = state.get("dirty");
    updateSaveStatus(saving ? "saving" : dirty ? "unsaved" : "saved");
  });

  state.subscribe("currentFile", (file) => {
    if (file) {
      // File opened - let the dirty subscriber handle save status
      // Track original content when file is opened (for auto-save reference)
      originalContentOnOpen = file.content;
      startAutoSave();
    } else {
      // No file open - clear save status
      updateSaveStatus("");
      originalContentOnOpen = null;
    }
  });

  // Initialize exit warning
  initExitWarning();

  // Start auto-save if there's already a file open
  const currentFile = state.get("currentFile");
  if (currentFile) {
    startAutoSave();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// COMMAND DISPATCHER
// ═════════════════════════════════════════════════════════════════════════════

function handleCommand(cmd) {
  // Suppress autocomplete so that programmatic insertions
  // (bold, italic, separator, etc.) don't trigger the dropdown.
  suppressNextInput();

  switch (cmd) {
    case "save":
      saveCurrentFile();
      break;
    case "bold":
      codeEditor.wrapSelection("**", "**");
      break;
    case "italic":
      codeEditor.wrapSelection("*", "*");
      break;
    case "strikethrough":
      codeEditor.wrapSelection("~", "~");
      break;
    case "underline":
      codeEditor.wrapSelection("__", "__");
      break;
    case "code":
      codeEditor.wrapSelection("`", "`");
      break;
    case "heading":
      dialogs.showDialog("dialogHeading");
      break;
    case "codeblock":
      dialogs.showDialog("dialogCodeBlock");
      break;
    case "code-file":
      dialogs.showDialog("dialogCodeFile");
      break;
    case "link":
      dialogs.showDialog("dialogLink");
      break;
    case "image":
      dialogs.showDialog("dialogImage");
      break;
    case "inline-image":
      dialogs.showDialog("dialogInlineImage");
      break;
    case "video":
      dialogs.showDialog("dialogVideo");
      break;
    case "audio":
      dialogs.showDialog("dialogAudio");
      break;
    case "assets":
      dialogs.showDialog("dialogAssets");
      break;
    case "table":
      dialogs.showDialog("dialogTable");
      break;
    case "list":
      dialogs.showDialog("dialogList");
      break;
    case "admonition":
      dialogs.showDialog("dialogAdmonition");
      break;
    case "separator":
      codeEditor.insertText("\n#s\n");
      break;
    case "color":
      showColorPopup();
      break;
    case "preview-toggle":
      togglePreview();
      break;
    case "scroll-sync-toggle":
      toggleScrollSync();
      break;
    case "wrap-toggle":
      toggleLineWrap();
      break;
    case "view-output":
      viewOutput();
      break;
    case "refresh-build":
      refreshBuild();
      break;
    case "show-build-log":
      showBuildLog();
      break;
    case "stop":
      stopServer();
      break;
    default:
      console.warn("Toolbar: unknown command —", cmd);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// COLOR POPUP
// ═════════════════════════════════════════════════════════════════════════════

// Expose globally for table editor to use
window.showColorPopup = function(target) {
  const popup = document.getElementById('colorPopup');
  if (!popup) return;

  // If target is a table editor color button, handle differently
  if (target && target.id === 'teColorBtn') {
    // Store the currently focused table cell input so we can apply formatting later
    const activeInput = document.querySelector('.table-cell-input:focus') || window.lastActiveTableInput || null;
    showPopupAt(popup, target);
    popup._target = 'table';
    popup._activeInput = activeInput;
    return;
  }

  // For main editor, show popup near the color toolbar button
  const btn = document.querySelector('.tool-btn[data-cmd="color"]');
  if (btn) showPopupAt(popup, btn);
  popup._target = 'editor';
}

function showPopupAt(popup, anchor) {
  const rect = anchor.getBoundingClientRect();
  popup.style.position = 'fixed';
  popup.style.top = (rect.bottom + 4) + 'px';
  popup.style.left = Math.max(4, rect.left - 100) + 'px';
  popup.style.display = 'block';
  popup._anchor = anchor;
}

// Close color popup when clicking outside
document.addEventListener('click', (e) => {
  const popup = document.getElementById('colorPopup');
  if (!popup || popup.style.display === 'none') return;
  if (!popup.contains(e.target) && !e.target.closest('[data-cmd="color"]') && !e.target.closest('#teColorBtn')) {
    popup.style.display = 'none';
  }
});

// Handle color popup button clicks
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.color-btn');
  if (!btn) return;
  const popup = document.getElementById('colorPopup');
  if (!popup) return;

  const mode = btn.dataset.mode; // 'color' or 'highlight'
  const color = btn.dataset.color;
  const target = popup._target;

    if (target === 'table') {
      // Apply formatting to the stored active input (may have lost focus)
      const storedInput = popup._activeInput;
      if (!storedInput) {
        showToast('Click on a cell first', 'warning');
        popup.style.display = 'none';
        return;
      }
      applyTableColorFormat(storedInput, mode, color);
  } else {
    // Apply formatting to main editor
    if (mode === 'color') {
      codeEditor.wrapSelection(`<c="${color}">`, '</c>');
    } else {
      codeEditor.wrapSelection(`<ch="${color}">`, '</ch>');
    }
  }
  popup.style.display = 'none';
});

// Handle custom color apply
document.getElementById('colorPopupApply')?.addEventListener('click', () => {
  const popup = document.getElementById('colorPopup');
  const picker = document.getElementById('colorPopupPicker');
  const modeSelect = document.getElementById('colorPopupMode');
  if (!popup || !picker || !modeSelect) return;

  const color = picker.value;
  const mode = modeSelect.value;
  const target = popup._target;

  if (target === 'table') {
    const storedInput = popup._activeInput;
    if (!storedInput) {
      showToast('Click on a cell first', 'warning');
      popup.style.display = 'none';
      return;
    }
    applyTableColorFormat(storedInput, mode, color);
  } else {
    if (mode === 'color') {
      codeEditor.wrapSelection(`<c="${color}">`, '</c>');
    } else {
      codeEditor.wrapSelection(`<ch="${color}">`, '</ch>');
    }
  }
  popup.style.display = 'none';
});

function applyTableColorFormat(input, mode, color) {
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const text = input.value;
  const selected = text.substring(start, end) || 'text';

  let formatted;
  if (mode === 'color') {
    formatted = `<c="${color}">${selected}</c>`;
  } else {
    formatted = `<ch="${color}">${selected}</ch>`;
  }

  const newCursor = start + formatted.length;
  input.setRangeText(formatted, start, end, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
  input.setSelectionRange(newCursor, newCursor);
}

// ═════════════════════════════════════════════════════════════════════════════
// SAVE
// ═════════════════════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════════════════════
// BUILD LOG STORAGE
// ═════════════════════════════════════════════════════════════════════════════

let lastBuildLog = null; // Stores the last build output text

// ═════════════════════════════════════════════════════════════════════════════
// LINE WRAP TOGGLE
// ═════════════════════════════════════════════════════════════════════════════

let _wrapOn = true;

function toggleLineWrap() {
  _wrapOn = !_wrapOn;
  codeEditor.setLineWrapEnabled(_wrapOn);

  // Update button visual
  const btn = document.querySelector('[data-cmd="wrap-toggle"]');
  if (btn) {
    btn.classList.toggle("active", _wrapOn);
    btn.title = _wrapOn
      ? "Toggle line wrap (Alt+W)"
      : "Line wrap OFF";
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// VIEW OUTPUT / REFRESH BUILD
// ═════════════════════════════════════════════════════════════════════════════

/** Open the built documentation in a new browser tab */
function viewOutput() {
  const outputUrl = "/output/";
  window.open(outputUrl, "mmx-output");
}

/** Run the build and then open the output */
async function refreshBuild() {
  const btn = document.querySelector('[data-cmd="refresh-build"]');
  if (btn) btn.disabled = true;

  showToast("Building documentation...", "info");

  try {
    const result = await api.buildProject();
    // Store the build log
    lastBuildLog = result.log || "Build completed with no output.";
    showToast("Build completed successfully! ✅", "success");
    // Open the output in a new tab
    const outputUrl = "/output/";
    window.open(outputUrl, "mmx-output");
  } catch (e) {
    lastBuildLog = `Build failed:\n${e.message}`;
    showToast(`Build failed: ${e.message}`, "error");
    console.error("Build error:", e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** Show the build log dialog */
function showBuildLog() {
  const dialog = document.getElementById("dialogBuildLog");
  const overlay = document.getElementById("dialogOverlay");
  const content = document.getElementById("buildLogContent");
  if (!dialog || !content) return;

  if (lastBuildLog) {
    content.textContent = lastBuildLog;
  } else {
    content.textContent = "No build has been run yet.\n\nClick the 'Build & refresh' button to generate the documentation.";
  }

  dialog.style.display = "flex";
  if (overlay) overlay.style.display = "block";
}

// Hook the Clear button
const clearBtn = document.getElementById("buildLogClearBtn");
if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    lastBuildLog = null;
    const content = document.getElementById("buildLogContent");
    if (content) content.textContent = "No build has been run yet.";
    const dialog = document.getElementById("dialogBuildLog");
    if (dialog) {
      const hideEvent = new CustomEvent("hide");
      dialog.dispatchEvent(hideEvent);
      dialog.style.display = "none";
    }
    const overlay = document.getElementById("dialogOverlay");
    if (overlay) overlay.style.display = "none";
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// STOP SERVER
// ═════════════════════════════════════════════════════════════════════════════

let stopConfirmActive = false;

async function stopServer() {
  if (stopConfirmActive) return;
  const dirty = state.get("dirty");
  const currentFile = state.get("currentFile");

  // If there are unsaved changes, ask the user what to do
  if (dirty && currentFile) {
    stopConfirmActive = true;

    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.style.display = "block";

    const dialog = document.createElement("div");
    dialog.className = "dialog";
    dialog.innerHTML = `
      <div class="dialog-header">
        <h3>Unsaved Changes</h3>
      </div>
      <div class="dialog-body">
        <p>You have unsaved changes in <strong>${currentFile.name}</strong>.</p>
        <p>What would you like to do before stopping the server?</p>
      </div>
      <div class="dialog-footer" style="gap:8px;">
        <button class="btn btn-secondary" id="stopCancelBtn">Cancel</button>
        <button class="btn btn-primary" id="stopSaveBtn">Save &amp; Stop</button>
        <button class="btn btn-danger" id="stopDiscardBtn" style="background:var(--red);color:var(--bg-primary);">Discard &amp; Stop</button>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(dialog);

    return new Promise((resolve) => {
      function cleanup() {
        stopConfirmActive = false;
        dialog.remove();
        overlay.remove();
      }

      document.getElementById("stopCancelBtn").addEventListener("click", () => {
        cleanup();
        resolve();
      });

      document.getElementById("stopSaveBtn").addEventListener("click", async () => {
        cleanup();
        // Save first, then stop
        try {
          const content = codeEditor.getEditorContent();
          await api.saveFile(currentFile.path, content);
          state.update({ dirty: false, saving: false });
          showToast("File saved. Stopping server...", "success");
        } catch (e) {
          console.error("Save error:", e);
        }
        await doShutdown();
        resolve();
      });

      document.getElementById("stopDiscardBtn").addEventListener("click", async () => {
        cleanup();
        await doShutdown();
        resolve();
      });

      overlay.addEventListener("click", () => {
        cleanup();
        resolve();
      });
    });
  } else {
    // No unsaved changes, just shut down
    await doShutdown();
  }
}

async function doShutdown() {
  const btn = document.querySelector('[data-cmd="stop"]');
  if (btn) btn.disabled = true;

  showToast("Stopping server...", "info");

  try {
    const result = await api.shutdown();
    console.log("Shutdown response:", result);

    // Show a final message before the server goes down
    showToast("Server stopped. You may close this tab.", "success");

    // Disable the editor to prevent further edits
    const textarea = document.getElementById("codeEditor");
    if (textarea) textarea.disabled = true;

    // Update save status
    const statusEl = document.getElementById("saveStatus");
    if (statusEl) {
      statusEl.textContent = "● Stopped";
      statusEl.className = "save-status";
      statusEl.classList.add("error");
    }
  } catch (e) {
    console.error("Shutdown error:", e);
    showToast("Failed to stop server: " + e.message, "error");
    if (btn) btn.disabled = false;
  }
}

// ═════════════════════════════════════════════════════════════════════════════

async function saveCurrentFile() {
  const currentFile = state.get("currentFile");
  if (!currentFile) {
    showSaveAsDialog();
    return;
  }

  const content = codeEditor.getEditorContent();
  state.set("saving", true);

  try {
    await api.saveFile(currentFile.path, content);
    state.update({
      dirty: false,
      saving: false,
      currentFile: { ...currentFile, content, originalContent: currentFile.originalContent },
    });
  } catch (e) {
    state.set("saving", false);
    console.error("Save error:", e);
  }
}

// ─── "Save As" dialog (when no file is open) ────────────────────────────────

let saveAsDialogActive = false;

function showSaveAsDialog() {
  if (saveAsDialogActive) return;
  saveAsDialogActive = true;

  const pagesDir = state.get("pagesDir") || "";
  const tree = state.get("fileTree");

  // Build list of all directories from the file tree
  const directories = [{ name: "/", path: pagesDir, depth: 0, fullPath: "" }];
  if (tree && tree.children) {
    collectDirectories(tree.children, directories, "", 0);
  }

  // Create dialog elements
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  overlay.style.display = "block";

  const dialog = document.createElement("div");
  dialog.className = "dialog create-dialog";

  const optionsHtml = directories.map(dir => {
    const label = dir.depth === 0 ? dir.name : dir.fullPath;
    return `<option value="${dir.path}" title="${dir.fullPath}">${label}</option>`;
  }).join("");

  dialog.innerHTML = `
    <div class="dialog-header">
      <h3>Save As</h3>
      <button class="dialog-close save-as-close">&times;</button>
    </div>
    <div class="dialog-body">
      <div class="form-row">
        <label for="saveAsPathSelect">Location:</label>
        <select id="saveAsPathSelect" class="create-path-select">${optionsHtml}</select>
      </div>
      <div id="saveAsPathPreview" class="create-path-preview"></div>
      <div class="form-row">
        <label for="saveAsNameInput">Name:</label>
        <div class="create-name-wrapper">
          <input type="text" id="saveAsNameInput" class="create-name-input" placeholder="my-file" autofocus>
          <span class="create-suffix">.mmx</span>
        </div>
      </div>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary save-as-cancel">Cancel</button>
      <button class="btn btn-primary save-as-ok">Save</button>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(dialog);

  const pathSelect = dialog.querySelector("#saveAsPathSelect");
  const nameInput = dialog.querySelector("#saveAsNameInput");
  const okBtn = dialog.querySelector(".save-as-ok");
  const cancelBtns = dialog.querySelectorAll(".save-as-cancel, .save-as-close");
  const pathPreview = dialog.querySelector("#saveAsPathPreview");

  // Update path preview when selection or name changes
  function updatePathPreview() {
    const selectedOption = pathSelect.options[pathSelect.selectedIndex];
    const fullPath = selectedOption?.getAttribute("title") || "";
    const name = nameInput.value.trim() || "…";
    if (pathPreview) {
      pathPreview.textContent = "→ " + fullPath + "/" + name + ".mmx";
    }
  }

  pathSelect.addEventListener("change", updatePathPreview);
  nameInput.addEventListener("input", updatePathPreview);

  function close() {
    saveAsDialogActive = false;
    dialog.remove();
    overlay.remove();
  }

  async function submit() {
    const val = nameInput.value.trim();
    const selectedPath = pathSelect.value;
    if (!val) {
      showToast("Please enter a file name", "error");
      nameInput.focus();
      return;
    }

    const fileName = val.endsWith(".mmx") ? val : val + ".mmx";
    const fullPath = selectedPath + "/" + fileName;
    const content = codeEditor.getEditorContent();

    close();

    state.set("saving", true);

    try {
      const result = await api.saveFile(fullPath, content);
      const savedPath = result.path || fullPath;
      state.update({
        dirty: false,
        saving: false,
        currentFile: {
          path: savedPath,
          name: fileName,
          content,
          originalContent: content,
        },
      });
      showToast("File saved: " + fileName, "success");
      // Refresh the file tree to show the new file
      refreshFileTree();
    } catch (e) {
      state.set("saving", false);
      showToast("Failed to save: " + e.message, "error");
      console.error("Save error:", e);
    }
  }

  okBtn.addEventListener("click", submit);
  cancelBtns.forEach((b) => b.addEventListener("click", close));
  overlay.addEventListener("click", close);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") close();
  });

  // Focus name input and show initial preview
  setTimeout(() => {
    nameInput.focus();
    updatePathPreview();
  }, 50);
}

/**
 * Collect all directories from the file tree (recursive helper)
 */
function collectDirectories(children, directories, prefix, depth) {
  for (const child of children) {
    if (child.type === "folder") {
      const fullPath = prefix + "/" + child.name;
      directories.push({
        name: child.name,
        path: child.path,
        depth: depth + 1,
        fullPath
      });
      if (child.children && child.children.length > 0) {
        collectDirectories(child.children, directories, fullPath, depth + 1);
      }
    }
  }
}

/**
 * Refresh the file tree from the server
 */
async function refreshFileTree() {
  try {
    const data = await api.getFiles();
    state.update({
      files: data.files,
      fileTree: data.tree,
      pagesDir: data.pagesDir,
    });
  } catch (e) {
    console.error("Failed to refresh file tree:", e);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SAVE STATUS INDICATOR
// ═════════════════════════════════════════════════════════════════════════════

function updateSaveStatus(status) {
  const el = document.getElementById("saveStatus");
  if (!el) return;

  el.className = "save-status";
  switch (status) {
    case "saved":
      el.textContent = "✓ Saved";
      el.classList.add("saved");
      break;
    case "unsaved":
      el.textContent = "● Unsaved";
      el.classList.add("error");
      break;
    case "saving":
      el.textContent = "⟳ Saving...";
      el.classList.add("saving");
      break;
    default:
      el.textContent = "";
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PREVIEW TOGGLE
// ═════════════════════════════════════════════════════════════════════════════

function togglePreview() {
  const preview = document.getElementById("previewSection");
  const divider = document.getElementById("splitDivider");
  const editor = document.getElementById("editorSection");
  if (!preview) return;

  const isVisible = preview.style.display !== "none";
  preview.style.display = isVisible ? "none" : "flex";

  // Also hide/show the split divider and expand/shrink the editor
  if (divider) {
    divider.style.display = isVisible ? "none" : "";
  }
  if (editor) {
    if (isVisible) {
      // Store current editor width before hiding the preview, then expand to full
      editor.dataset.prevWidth = editor.style.width || "50%";
      editor.style.width = "100%";
    } else {
      // Restore the previous editor width when showing the preview again
      editor.style.width = editor.dataset.prevWidth || "50%";
    }
  }

  state.set("previewVisible", !isVisible);
}

// ═════════════════════════════════════════════════════════════════════════════
// SCROLL SYNC TOGGLE
// ═════════════════════════════════════════════════════════════════════════════

let _scrollSyncOn = true;

function toggleScrollSync() {
  _scrollSyncOn = !_scrollSyncOn;
  codeEditor.setScrollSyncEnabled(_scrollSyncOn);

  // Update button visual
  const btn = document.querySelector('[data-cmd="scroll-sync-toggle"]');
  if (btn) {
    btn.classList.toggle("active", _scrollSyncOn);
    btn.title = _scrollSyncOn
      ? "Scroll sync (bidirectional)"
      : "Scroll sync OFF";
  }
}
