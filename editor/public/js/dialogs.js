/**
 * MMX Visual Editor — Dialogs
 *
 * Handles showing/hiding modal dialogs and processing their
 * form submissions to insert MMX syntax into the editor.
 */

import * as codeEditor from "./codeEditor.js";
import { suppressNextInput } from "./autocomplete.js";
import { showToast, loadIcon, escapeHtml } from "./utils.js";
import { listAssets, uploadAsset, createAssetFolder, deleteFile, deleteFolder, openAsset, revealAsset } from "./api.js";

// ─── Dialog management ───────────────────────────────────────────────────────

/**
 * Show a dialog by ID
 * @param {string} dialogId - Element ID of the dialog
 */
export function showDialog(dialogId) {
  const dialog = document.getElementById(dialogId);
  const overlay = document.getElementById("dialogOverlay");
  if (dialog) {
    dialog.style.display = "flex";
    // Dispatch a custom "show" event so dialogs can initialize content
    dialog.dispatchEvent(new CustomEvent("show"));
  }
  if (overlay) overlay.style.display = "block";
}

export function hideDialog(dialogId) {
  const dialog = document.getElementById(dialogId);
  if (dialog) {
    // Dispatch a custom "hide" event so listeners (e.g. table editor) can save/reset
    dialog.dispatchEvent(new CustomEvent("hide"));
    dialog.style.display = "none";
  }
  // Hide overlay only if no other dialogs are visible
  const anyVisible = Array.from(document.querySelectorAll(".dialog")).some(d => d.style.display === "flex");
  if (!anyVisible) {
    const overlay = document.getElementById("dialogOverlay");
    if (overlay) overlay.style.display = "none";
  }
}

/**
 * Hide all dialogs
 */
function hideAllDialogs() {
  // Dispatch "hide" event on all visible dialogs before hiding (e.g. for table editor)
  document.querySelectorAll(".dialog").forEach((d) => {
    if (d.style.display === "flex") {
      d.dispatchEvent(new CustomEvent("hide"));
    }
    d.style.display = "none";
  });
  const overlay = document.getElementById("dialogOverlay");
  if (overlay) overlay.style.display = "none";
  clearEditSession();
  removeDialogNavArrows('dialogLink');
  removeDialogNavArrows('dialogImage');
  removeDialogNavArrows('dialogVideo');
  removeDialogNavArrows('dialogAudio');
  removeDialogNavArrows('dialogInlineImage');
  // Reset all dialog modes to insert mode after hiding
  resetDialogMode('dialogImage', 'Insert Image', 'Insert');
  resetDialogMode('dialogVideo', 'Insert Video', 'Insert');
  resetDialogMode('dialogAudio', 'Insert Audio', 'Insert');
  resetDialogMode('dialogCodeFile', 'Insert Code File', 'Insert');
  resetDialogMode('dialogLink', 'Insert Link', 'Insert');
  resetDialogMode('dialogInlineImage', 'Insert Inline Image', 'Insert');
}

// ─── Helpers for edit/insert mode toggling ──────────────────────────────────

function setDialogEditMode(dialogId, label) {
  const header = document.querySelector(`#${dialogId} .dialog-header h3`);
  const btn = document.querySelector(`#${dialogId} .btn-primary`);
  if (header) {
    const icon = header.querySelector('svg');
    header.innerHTML = '';
    if (icon) header.appendChild(icon);
    header.appendChild(document.createTextNode(` Edit ${label}`));
  }
  if (btn) btn.textContent = `Update ${label}`;
}

function resetDialogMode(dialogId, defaultLabel, defaultBtnText) {
  const header = document.querySelector(`#${dialogId} .dialog-header h3`);
  const btn = document.querySelector(`#${dialogId} .btn-primary`);
  if (header) {
    const icon = header.querySelector('svg');
    header.innerHTML = '';
    if (icon) header.appendChild(icon);
    header.appendChild(document.createTextNode(` ${defaultLabel}`));
  }
  if (btn) btn.textContent = defaultBtnText;
}

// ─── Assets Path State (module-level) ────────────────────────────────────────
let currentAssetsPath = "";

// Callback for "From Assets" picker mode
let pendingAssetCallback = null;

// ─── Edit Session State ──────────────────────────────────────────────────────
let currentEditSession = null; // { type, start, end, oldContent, dialogId }

// ─── Multi-element navigation (generic for all dialogs) ───────────────────
let dialogNavSiblings = null; // array of sibling element data for the current dialog
let dialogNavIndex = -1;      // index of the currently displayed element
let dialogNavType = '';       // type of the current dialog ('link', 'image', 'video', 'audio', 'inlineimage')

function clearEditSession() {
  currentEditSession = null;
  dialogNavSiblings = null;
  dialogNavIndex = -1;
  dialogNavType = '';
}

/**
 * Initialize all dialogs
 */
export function initDialogs() {
  // Close buttons
  document.querySelectorAll(".dialog-close, .btn-secondary[data-dialog]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      hideAllDialogs();
    });
  });

  // Overlay click to close, then re-dispatch click to underlying element
  const overlay = document.getElementById("dialogOverlay");
  if (overlay) {
    overlay.addEventListener("click", (e) => {
      // First hide all dialogs and overlay
      hideAllDialogs();
      
      // Then get the element now at the click coordinates (overlay is now hidden)
      // This allows clicking an edit icon behind the overlay to work in one click
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (target && target !== overlay) {
        // Check if it's an element that should receive a click
        const button = target.closest('button');
        if (button) {
          button.click();
        }
      }
    });
  }

  // Escape key to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideAllDialogs();
  });

  // ─── Table dialog ──────────────────────────────────────────────────────────
  // Reset table mode to 'h' (default) when dialog is shown
  document.getElementById("dialogTable")?.addEventListener("show", () => {
    const modeSelect = document.getElementById("tableMode");
    if (modeSelect) modeSelect.value = 'h';
  });
  
  document.getElementById("tableInsertBtn")?.addEventListener("click", () => {
    const mode = document.getElementById("tableMode").value;
    const cols = parseInt(document.getElementById("tableCols").value) || 3;
    const rows = parseInt(document.getElementById("tableRows").value) || 3;
    const classes = document.getElementById("tableClasses").value.trim();

    let table = `#table`;
    if (mode !== 'h') table += `(${mode})`;
    if (classes) table += ` ${classes}`;
    table += "\n";

    if (mode === 'v') {
      // Vertical: first column is header — generate rows with label in first cell
      for (let r = 0; r < rows; r++) {
        const row = [`Label ${r + 1}`];
        for (let c = 0; c < cols; c++) {
          row.push(`data ${r + 1}-${c + 1}`);
        }
        table += row.join("|") + "\n";
      }
    } else if (mode === 'b') {
      // Both: first row has leading spaces (visual placeholder for corner) + headers, rest have label + data
      const headerRow = [];
      for (let c = 0; c < cols; c++) {
        headerRow.push(`Header ${c + 1}`);
      }
      // Leading spaces indicate the empty corner cell (see MMX docs: `     Name|Score`)
      table += "        " + headerRow.join("|") + "\n";
      for (let r = 0; r < rows; r++) {
        const row = [`Label ${r + 1}`];
        for (let c = 0; c < cols; c++) {
          row.push(`data ${r + 1}-${c + 1}`);
        }
        table += row.join("|") + "\n";
      }
    } else {
      // Horizontal (default): first row is header
      const headerRow = [];
      for (let c = 0; c < cols; c++) {
        headerRow.push(`Header ${c + 1}`);
      }
      table += headerRow.join("|") + "\n";
      for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) {
          row.push(`data ${r + 1}-${c + 1}`);
        }
        table += row.join("|") + "\n";
      }
    }
    table += "#endtable";

    suppressNextInput();
    codeEditor.insertText("\n" + table + "\n");
    hideAllDialogs();
    showToast("Table inserted", "success");
  });

  // ─── Link dialog ───────────────────────────────────────────────────────────
  document.getElementById("linkInsertBtn")?.addEventListener("click", () => {
    const text = document.getElementById("linkText").value.trim();
    const url = document.getElementById("linkUrl").value.trim();

    if (!text || !url) {
      showToast("Please fill in both text and URL", "error");
      return;
    }

    if (currentEditSession && currentEditSession.type === 'link') {
      // Edit mode: replace old content in editor
      const newContent = `[${text}](${url})`;
      const editorContent = codeEditor.getEditorContent();
      const updatedContent = editorContent.substring(0, currentEditSession.start) + newContent + editorContent.substring(currentEditSession.end);
      codeEditor.setEditorContent(updatedContent, undefined, true);
      clearEditSession();
      hideAllDialogs();
      showToast("Link updated", "success");
    } else {
      // Insert mode
      suppressNextInput();
      codeEditor.insertText(`[${text}](${url})`);
      hideAllDialogs();
      showToast("Link inserted", "success");
    }
  });

  // ─── Image dialog ──────────────────────────────────────────────────────────
  document.getElementById("imageInsertBtn")?.addEventListener("click", () => {
    const alt = document.getElementById("imageAlt").value.trim();
    const path = document.getElementById("imagePath").value.trim();
    const classes = document.getElementById("imageClasses").value.trim();

    if (!path) {
      showToast("Please enter an image path", "error");
      return;
    }

    let img = `![${alt || "image"}](${path})`;
    if (classes) img += ` ${classes}`;

    if (currentEditSession && currentEditSession.type === 'image') {
      // Edit mode: replace old content in editor
      const editorContent = codeEditor.getEditorContent();
      const updatedContent = editorContent.substring(0, currentEditSession.start) + img + editorContent.substring(currentEditSession.end);
      codeEditor.setEditorContent(updatedContent, undefined, true);
      clearEditSession();
      hideAllDialogs();
      showToast("Image updated", "success");
    } else {
      // Insert mode
      suppressNextInput();
      codeEditor.insertText("\n" + img + "\n");
      hideAllDialogs();
      showToast("Image inserted", "success");
    }
  });

  // ─── Code block dialog ─────────────────────────────────────────────────────
  document.getElementById("codeBlockInsertBtn")?.addEventListener("click", () => {
    const flags = document.getElementById("codeBlockFlags").value.trim();
    const content = document.getElementById("codeBlockContent").value;

    let codeBlock = ":::code";
    if (flags) codeBlock += ` ${flags}`;
    codeBlock += "\n";
    codeBlock += content || "// your code here";
    codeBlock += "\n:::";

    suppressNextInput();
    codeEditor.insertText("\n" + codeBlock + "\n");
    hideAllDialogs();
    showToast("Code block inserted", "success");
  });

  // ─── Admonition dialog ─────────────────────────────────────────────────────
  document.getElementById("admonitionInsertBtn")?.addEventListener("click", () => {
    const type = document.getElementById("admonitionType").value;
    const classes = document.getElementById("admonitionClasses").value.trim();
    const content = document.getElementById("admonitionContent").value.trim();

    let admonition = `>>>${type}`;
    if (classes) admonition += ` ${classes}`;
    admonition += "\n";
    admonition += content || "Your content here";
    admonition += "\n>>>";

    suppressNextInput();
    codeEditor.insertText("\n" + admonition + "\n");
    hideAllDialogs();
    showToast(`${type} inserted`, "success");
  });

  // ─── Inline Image dialog ────────────────────────────────────────────────────
  document.getElementById("inlineImageInsertBtn")?.addEventListener("click", () => {
    const path = document.getElementById("inlineImagePath").value.trim();

    if (!path) {
      showToast("Please enter an image path", "error");
      return;
    }

    const inlineImg = `<-${path}->`;

    if (currentEditSession && currentEditSession.type === 'inlineimage') {
      // Edit mode: replace old content in editor
      const editorContent = codeEditor.getEditorContent();
      const updatedContent = editorContent.substring(0, currentEditSession.start) + inlineImg + editorContent.substring(currentEditSession.end);
      codeEditor.setEditorContent(updatedContent, undefined, true);
      clearEditSession();
      hideAllDialogs();
      showToast("Inline image updated", "success");
    } else {
      // Insert mode
      suppressNextInput();
      codeEditor.insertText(inlineImg);
      hideAllDialogs();
      showToast("Inline image inserted", "success");
    }
  });

  // ─── Video dialog ──────────────────────────────────────────────────────────
  document.getElementById("videoInsertBtn")?.addEventListener("click", () => {
    const path = document.getElementById("videoPath").value.trim();
    const classes = document.getElementById("videoClasses").value.trim();

    if (!path) {
      showToast("Please enter a video path", "error");
      return;
    }

    let video = `!!(${path})`;
    if (classes) video += ` ${classes}`;

    if (currentEditSession && currentEditSession.type === 'video') {
      // Edit mode: replace old content in editor
      const editorContent = codeEditor.getEditorContent();
      const updatedContent = editorContent.substring(0, currentEditSession.start) + video + editorContent.substring(currentEditSession.end);
      codeEditor.setEditorContent(updatedContent, undefined, true);
      clearEditSession();
      hideAllDialogs();
      showToast("Video updated", "success");
    } else {
      // Insert mode
      suppressNextInput();
      codeEditor.insertText("\n" + video + "\n");
      hideAllDialogs();
      showToast("Video inserted", "success");
    }
  });

  // ─── Audio dialog ──────────────────────────────────────────────────────────
  document.getElementById("audioInsertBtn")?.addEventListener("click", () => {
    const path = document.getElementById("audioPath").value.trim();
    const classes = document.getElementById("audioClasses").value.trim();

    if (!path) {
      showToast("Please enter an audio path", "error");
      return;
    }

    let audio = `!!!(${path})`;
    if (classes) audio += ` ${classes}`;

    if (currentEditSession && currentEditSession.type === 'audio') {
      // Edit mode: replace old content in editor
      const editorContent = codeEditor.getEditorContent();
      const updatedContent = editorContent.substring(0, currentEditSession.start) + audio + editorContent.substring(currentEditSession.end);
      codeEditor.setEditorContent(updatedContent, undefined, true);
      clearEditSession();
      hideAllDialogs();
      showToast("Audio updated", "success");
    } else {
      // Insert mode
      suppressNextInput();
      codeEditor.insertText("\n" + audio + "\n");
      hideAllDialogs();
      showToast("Audio inserted", "success");
    }
  });

  // Reset inline image dialog mode in hideAllDialogs
  const origHideAllDialogs = hideAllDialogs;
  // (inline image reset is handled in the resetDialogMode call below)

  // ─── Heading dialog ────────────────────────────────────────────────────────
  document.getElementById("headingInsertBtn")?.addEventListener("click", () => {
    const level = document.getElementById("headingLevel").value;
    const text = document.getElementById("headingText").value.trim();
    const id = document.getElementById("headingId").value.trim();

    if (!text) {
      showToast("Please enter heading text", "error");
      return;
    }

    let heading = "#".repeat(parseInt(level)) + " " + text;
    if (id) heading += ` %{${id}}%`;

    suppressNextInput();
    codeEditor.insertText("\n" + heading + "\n");
    hideAllDialogs();
    showToast("Heading inserted", "success");
  });

  // ─── List dialog ───────────────────────────────────────────────────────────
  document.getElementById("listInsertBtn")?.addEventListener("click", () => {
    const type = document.getElementById("listType").value;
    const itemsText = document.getElementById("listItems").value.trim();

    if (!itemsText) {
      showToast("Please enter list items", "error");
      return;
    }

    const items = itemsText.split("\n").filter((l) => l.trim());
    let list = "\n";

    for (const item of items) {
      switch (type) {
        case "unordered":
          list += `- ${item}\n`;
          break;
        case "ordered":
          list += `+ ${item}\n`;
          break;
        case "task":
          list += `[ ] ${item}\n`;
          break;
      }
    }

    suppressNextInput();
    codeEditor.insertText(list);
    hideAllDialogs();
    showToast("List inserted", "success");
  });

  // ─── Code File Include dialog (#code()) ─────────────────────────────────────
  document.getElementById("codeFileInsertBtn")?.addEventListener("click", () => {
    const path = document.getElementById("codeFilePath").value.trim();
    const flags = document.getElementById("codeFileFlags").value.trim();

    if (!path) {
      showToast("Please enter a file path", "error");
      return;
    }

    let codeInclude = `#code(${path})`;
    if (flags) codeInclude += ` ${flags}`;

    if (currentEditSession && currentEditSession.type === 'code') {
      // Edit mode: replace old content in editor
      const editorContent = codeEditor.getEditorContent();
      const updatedContent = editorContent.substring(0, currentEditSession.start) + codeInclude + editorContent.substring(currentEditSession.end);
      codeEditor.setEditorContent(updatedContent, undefined, true);
      clearEditSession();
      hideAllDialogs();
      showToast("Code file include updated", "success");
    } else {
      // Insert mode
      suppressNextInput();
      codeEditor.insertText("\n" + codeInclude + "\n");
      hideAllDialogs();
      showToast("Code include inserted", "success");
    }
  });

  // ─── Assets Browser Dialog ─────────────────────────────────────────────────
  document.getElementById("dialogAssets")?.addEventListener("show", () => {
    loadAssets(""); // Load root assets directory
  });

  // Drag and drop support for assets dialog
  const assetsDialogBody = document.querySelector("#dialogAssets .dialog-body");
  if (assetsDialogBody) {
    assetsDialogBody.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      assetsDialogBody.classList.add("drag-over");
    });

    assetsDialogBody.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      assetsDialogBody.classList.remove("drag-over");
    });

    assetsDialogBody.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      assetsDialogBody.classList.remove("drag-over");

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      showToast(`Uploading ${files.length} file(s)...`, "success");

      for (const file of files) {
        try {
          const base64 = await fileToBase64(file);
          await uploadAsset(file.name, base64, currentAssetsPath);
          showToast(`Uploaded: ${file.name}`, "success");
        } catch (err) {
          showToast(`Failed to upload ${file.name}: ${err.message}`, "error");
        }
      }

      loadAssets(currentAssetsPath);
    });
  }

  // Assets management buttons
  document.getElementById("assetsUploadBtn")?.addEventListener("click", () => {
    const input = document.getElementById("assetsDialogFileInput");
    if (!input) return;
    input.value = "";
    input.click();
  });

  document.getElementById("assetsDialogFileInput")?.addEventListener("change", async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    showToast(`Uploading ${files.length} file(s)...`, "success");

    for (const file of files) {
      try {
        const base64 = await fileToBase64(file);
        await uploadAsset(file.name, base64, currentAssetsPath);
        showToast(`Uploaded: ${file.name}`, "success");
      } catch (err) {
        showToast(`Failed to upload ${file.name}: ${err.message}`, "error");
      }
    }

    loadAssets(currentAssetsPath);
  });

  document.getElementById("assetsNewFolderBtn")?.addEventListener("click", async () => {
    const folderName = await showPromptDialog("Enter folder name:");
    if (!folderName || !folderName.trim()) return;
    const name = folderName.trim();

    try {
      await createAssetFolder(name, currentAssetsPath);
      showToast(`Folder created: ${name}`, "success");
      loadAssets(currentAssetsPath);
    } catch (err) {
      showToast(`Failed to create folder: ${err.message}`, "error");
    }
  });

  document.getElementById("assetsRefreshBtn")?.addEventListener("click", () => {
    loadAssets(currentAssetsPath);
    showToast("Assets refreshed", "success");
  });

  document.getElementById("assetsOpenExplorerBtn")?.addEventListener("click", () => {
    const dir = currentAssetsPath || "";
    revealAsset(dir).catch((err) => {
      showToast(`Failed to open explorer: ${err.message}`, "error");
    });
    showToast("Opening file explorer...", "success");
  });

  // ─── "From Assets" buttons in media dialogs ──────────────────────────────
  document.querySelectorAll(".btn-browse-assets").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target; // e.g. "imagePath"
      const targetInput = document.getElementById(targetId);
      if (!targetInput) return;

      // Set callback so assets grid click fills the input
      pendingAssetCallback = (assetRelativePath) => {
        targetInput.value = assetRelativePath;
        pendingAssetCallback = null;
        hideDialog("dialogAssets");
        showToast(`Selected: ${assetRelativePath}`, "success");
      };

      showDialog("dialogAssets");
    });
  });

  // ─── Drag & drop from assets grid to code editor ─────────────────────────
  const editorEl = codeEditor.getEditorElement();
  if (editorEl) {
    editorEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      editorEl.closest(".code-editor")?.classList.add("drag-over");
    });

    editorEl.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      editorEl.closest(".code-editor")?.classList.remove("drag-over");
    });

    editorEl.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      editorEl.closest(".code-editor")?.classList.remove("drag-over");

      const path = e.dataTransfer?.getData("text/asset-path");
      const ext = e.dataTransfer?.getData("text/asset-ext");
      if (!path) return;

      let insertContent = "";
      if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) {
        insertContent = `\n![${path.split("/").pop()}](${path})\n`;
      } else if (["mp4", "webm", "mov"].includes(ext)) {
        insertContent = `\n!!(${path})\n`;
      } else if (["mp3", "wav", "ogg"].includes(ext)) {
        insertContent = `\n!!!(${path})\n`;
      } else {
        insertContent = `\n[${path.split("/").pop()}](${path})\n`;
      }

      suppressNextInput();
      codeEditor.insertText(insertContent);
      showToast(`Inserted: ${path}`, "success");
    });
  }

  // ─── Edit event listeners for inline elements ──────────────────────────────
  // These events are dispatched from codeEditor.js when clicking an edit icon

  window.addEventListener('edit-image', (e) => {
    // Close any previously open dialog first
    hideAllDialogs();
    
    const { start, end, content, classes } = e.detail;
    // Parse image: ![alt](path) [classes]
    const imgMatch = content.match(/!\[([^\]]*)\]\(([^)]+)\)/);
    if (!imgMatch) return;
    const alt = imgMatch[1];
    const path = imgMatch[2];
    
    currentEditSession = { type: 'image', start, end, oldContent: content };
    
    document.getElementById('imageAlt').value = alt;
    document.getElementById('imagePath').value = path;
    document.getElementById('imageClasses').value = classes || '';
    
    // ── Multi-element navigation arrows ─────────────────────────────────
    const { siblings, siblingIndex } = e.detail;
    if (siblings && siblings.length > 1) {
      dialogNavSiblings = siblings;
      dialogNavIndex = typeof siblingIndex === 'number' ? siblingIndex : 0;
      dialogNavType = 'image';
      addDialogNavArrows('dialogImage');
    } else {
      dialogNavSiblings = null;
      dialogNavIndex = -1;
      dialogNavType = '';
      removeDialogNavArrows('dialogImage');
    }
    
    setDialogEditMode('dialogImage', 'Image');
    showDialog('dialogImage');
    showToast('Editing image', 'success');
  });

  window.addEventListener('edit-video', (e) => {
    // Close any previously open dialog first
    hideAllDialogs();
    
    const { start, end, content, classes } = e.detail;
    // Parse video: !!(path) [classes]
    const vidMatch = content.match(/!!\(([^)]+)\)/);
    if (!vidMatch) return;
    const path = vidMatch[1];
    
    currentEditSession = { type: 'video', start, end, oldContent: content };
    
    document.getElementById('videoPath').value = path;
    document.getElementById('videoClasses').value = classes || '';
    
    // ── Multi-element navigation arrows ─────────────────────────────────
    const { siblings, siblingIndex } = e.detail;
    if (siblings && siblings.length > 1) {
      dialogNavSiblings = siblings;
      dialogNavIndex = typeof siblingIndex === 'number' ? siblingIndex : 0;
      dialogNavType = 'video';
      addDialogNavArrows('dialogVideo');
    } else {
      dialogNavSiblings = null;
      dialogNavIndex = -1;
      dialogNavType = '';
      removeDialogNavArrows('dialogVideo');
    }
    
    setDialogEditMode('dialogVideo', 'Video');
    showDialog('dialogVideo');
    showToast('Editing video', 'success');
  });

  window.addEventListener('edit-audio', (e) => {
    // Close any previously open dialog first
    hideAllDialogs();
    
    const { start, end, content, classes } = e.detail;
    // Parse audio: !!!(path) [classes]
    const audMatch = content.match(/!!!\(([^)]+)\)/);
    if (!audMatch) return;
    const path = audMatch[1];
    
    currentEditSession = { type: 'audio', start, end, oldContent: content };
    
    document.getElementById('audioPath').value = path;
    document.getElementById('audioClasses').value = classes || '';
    
    // ── Multi-element navigation arrows ─────────────────────────────────
    const { siblings, siblingIndex } = e.detail;
    if (siblings && siblings.length > 1) {
      dialogNavSiblings = siblings;
      dialogNavIndex = typeof siblingIndex === 'number' ? siblingIndex : 0;
      dialogNavType = 'audio';
      addDialogNavArrows('dialogAudio');
    } else {
      dialogNavSiblings = null;
      dialogNavIndex = -1;
      dialogNavType = '';
      removeDialogNavArrows('dialogAudio');
    }
    
    setDialogEditMode('dialogAudio', 'Audio');
    showDialog('dialogAudio');
    showToast('Editing audio', 'success');
  });

  window.addEventListener('edit-link', (e) => {
    // Close any previously open dialog first
    hideAllDialogs();
    
    const { start, end, content, classes } = e.detail;
    // Parse link: [text](url) [classes]
    const linkMatch = content.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (!linkMatch) return;
    const text = linkMatch[1];
    const url = linkMatch[2];
    
    currentEditSession = { type: 'link', start, end, oldContent: content };
    
    document.getElementById('linkText').value = text;
    document.getElementById('linkUrl').value = url;
    
    setDialogEditMode('dialogLink', 'Link');
    
    // ── Multi-element navigation arrows ─────────────────────────────────
    const { siblings, siblingIndex } = e.detail;
    if (siblings && siblings.length > 1) {
      dialogNavSiblings = siblings;
      dialogNavIndex = typeof siblingIndex === 'number' ? siblingIndex : 0;
      dialogNavType = 'link';
      addDialogNavArrows('dialogLink');
    } else {
      dialogNavSiblings = null;
      dialogNavIndex = -1;
      dialogNavType = '';
      removeDialogNavArrows('dialogLink');
    }
    
    showDialog('dialogLink');
    showToast('Editing link', 'success');
  });

  window.addEventListener('edit-code', (e) => {
    // Close any previously open dialog first
    hideAllDialogs();
    
    const { start, end, content, path: codePath, flags } = e.detail;
    
    currentEditSession = { type: 'code', start, end, oldContent: content };
    
    document.getElementById('codeFilePath').value = codePath || '';
    document.getElementById('codeFileFlags').value = flags || '';
    
    setDialogEditMode('dialogCodeFile', 'Code File');
    showDialog('dialogCodeFile');
    showToast('Editing code file include', 'success');
  });

  window.addEventListener('edit-inlineimage', (e) => {
    // Close any previously open dialog first
    hideAllDialogs();
    
    const { start, end, content, path: imgPath } = e.detail;
    // Parse inline image: <-path->
    const imgMatch = content.match(/<-([^>]+)->/);
    if (!imgMatch) return;
    const path = imgMatch[1];
    
    currentEditSession = { type: 'inlineimage', start, end, oldContent: content };
    
    document.getElementById('inlineImagePath').value = path;
    
    // ── Multi-element navigation arrows ─────────────────────────────────
    const { siblings, siblingIndex } = e.detail;
    if (siblings && siblings.length > 1) {
      dialogNavSiblings = siblings;
      dialogNavIndex = typeof siblingIndex === 'number' ? siblingIndex : 0;
      dialogNavType = 'inlineimage';
      addDialogNavArrows('dialogInlineImage');
    } else {
      dialogNavSiblings = null;
      dialogNavIndex = -1;
      dialogNavType = '';
      removeDialogNavArrows('dialogInlineImage');
    }
    
    setDialogEditMode('dialogInlineImage', 'Inline Image');
    showDialog('dialogInlineImage');
    showToast('Editing inline image', 'success');
  });
}

/**
 * Add navigation arrow buttons to a dialog header
 * @param {string} dialogId - The dialog element ID (e.g. 'dialogLink', 'dialogImage')
 */
function addDialogNavArrows(dialogId) {
  const header = document.querySelector(`#${dialogId} .dialog-header`);
  if (!header) return;
  
  // Remove any existing nav arrows first
  removeDialogNavArrows(dialogId);
  
  const wrapper = document.createElement('div');
  wrapper.className = 'dialog-nav-wrapper';
  wrapper.style.cssText = 'display:flex;align-items:center;margin-left:auto;margin-right:8px;';
  
  const prevBtn = document.createElement('button');
  prevBtn.className = 'dialog-nav-arrow';
  prevBtn.innerHTML = '‹';
  prevBtn.title = 'Previous element';
  prevBtn.disabled = dialogNavIndex <= 0;
  prevBtn.addEventListener('click', (e) => {
    e.preventDefault();
    navigateDialogSibling(-1);
  });
  
  const nextBtn = document.createElement('button');
  nextBtn.className = 'dialog-nav-arrow';
  nextBtn.innerHTML = '›';
  nextBtn.title = 'Next element';
  nextBtn.disabled = dialogNavIndex >= dialogNavSiblings.length - 1;
  nextBtn.addEventListener('click', (e) => {
    e.preventDefault();
    navigateDialogSibling(1);
  });
  
  const counter = document.createElement('span');
  counter.className = 'dialog-nav-counter';
  counter.textContent = `${dialogNavIndex + 1}/${dialogNavSiblings.length}`;
  
  wrapper.appendChild(prevBtn);
  wrapper.appendChild(counter);
  wrapper.appendChild(nextBtn);
  
  // Insert before the close button
  const closeBtn = header.querySelector('.dialog-close');
  if (closeBtn) {
    header.insertBefore(wrapper, closeBtn);
  } else {
    header.appendChild(wrapper);
  }
}

/**
 * Remove navigation arrows from a dialog header
 * @param {string} dialogId - The dialog element ID
 */
function removeDialogNavArrows(dialogId) {
  const existing = document.querySelector(`#${dialogId} .dialog-nav-wrapper`);
  if (existing) existing.remove();
}

/**
 * Navigate to the previous/next sibling element in the current dialog
 * @param {number} direction - -1 for previous, +1 for next
 */
function navigateDialogSibling(direction) {
  if (!dialogNavSiblings || dialogNavSiblings.length === 0) return;
  
  const newIndex = dialogNavIndex + direction;
  if (newIndex < 0 || newIndex >= dialogNavSiblings.length) return;
  
  dialogNavIndex = newIndex;
  const sibling = dialogNavSiblings[dialogNavIndex];
  
  // Update the edit session
  currentEditSession = { type: dialogNavType, start: sibling.start, end: sibling.end, oldContent: sibling.content };
  
  // Parse and fill form fields based on element type
  if (dialogNavType === 'link') {
    const linkMatch = sibling.content.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      document.getElementById('linkText').value = linkMatch[1];
      document.getElementById('linkUrl').value = linkMatch[2];
    }
    setDialogEditMode('dialogLink', 'Link');
  } else if (dialogNavType === 'image') {
    const imgMatch = sibling.content.match(/!\[([^\]]*)\]\(([^)]+)\)/);
    if (imgMatch) {
      document.getElementById('imageAlt').value = imgMatch[1];
      document.getElementById('imagePath').value = imgMatch[2];
      document.getElementById('imageClasses').value = (sibling.classes || '').trim();
    }
    setDialogEditMode('dialogImage', 'Image');
  } else if (dialogNavType === 'video') {
    const vidMatch = sibling.content.match(/!!\(([^)]+)\)/);
    if (vidMatch) {
      document.getElementById('videoPath').value = vidMatch[1];
      document.getElementById('videoClasses').value = (sibling.classes || '').trim();
    }
    setDialogEditMode('dialogVideo', 'Video');
  } else if (dialogNavType === 'audio') {
    const audMatch = sibling.content.match(/!!!\(([^)]+)\)/);
    if (audMatch) {
      document.getElementById('audioPath').value = audMatch[1];
      document.getElementById('audioClasses').value = (sibling.classes || '').trim();
    }
    setDialogEditMode('dialogAudio', 'Audio');
  } else if (dialogNavType === 'inlineimage') {
    const imgMatch = sibling.content.match(/<-([^>]+)->/);
    if (imgMatch) {
      document.getElementById('inlineImagePath').value = imgMatch[1];
    }
    setDialogEditMode('dialogInlineImage', 'Inline Image');
  }
  
  // Update the nav arrows and counter (find any visible nav wrapper)
  document.querySelectorAll('.dialog-nav-wrapper').forEach(w => {
    const prevBtn = w.querySelector('.dialog-nav-arrow:first-child');
    const nextBtn = w.querySelector('.dialog-nav-arrow:last-child');
    const counter = w.querySelector('.dialog-nav-counter');
    if (prevBtn) prevBtn.disabled = dialogNavIndex <= 0;
    if (nextBtn) nextBtn.disabled = dialogNavIndex >= dialogNavSiblings.length - 1;
    if (counter) counter.textContent = `${dialogNavIndex + 1}/${dialogNavSiblings.length}`;
  });
  
  showToast(`Editing ${dialogNavType} (${dialogNavIndex + 1}/${dialogNavSiblings.length})`, 'info');
}

/**
 * Insert an asset file MMX reference into the editor based on its extension.
 * @param {string} fileName - The file name
 */
function insertAssetIntoEditor(fileName) {
  const ext = fileName.split(".").pop().toLowerCase();
  const relativePath = currentAssetsPath ? "assets/" + currentAssetsPath + "/" + fileName : "assets/" + fileName;
  let content = "";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) {
    content = `\n![${fileName}](${relativePath})\n`;
  } else if (["mp4", "webm", "mov"].includes(ext)) {
    content = `\n!!(${relativePath})\n`;
  } else if (["mp3", "wav", "ogg"].includes(ext)) {
    content = `\n!!!(${relativePath})\n`;
  } else {
    content = `\n[${fileName}](${relativePath})\n`;
  }
  suppressNextInput();
  codeEditor.insertText(content);
  showToast(`Inserted: ${relativePath}`, "success");
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Show a custom prompt dialog (replaces window.prompt which is blocked in sandboxed contexts).
 * @param {string} message - The message to display
 * @param {string} defaultValue - Optional default value
 * @returns {Promise<string|null>} - The entered value, or null if cancelled
 */
function showPromptDialog(message, defaultValue = "") {
  return new Promise((resolve) => {
    const overlay = document.getElementById("dialogOverlay");
    const container = document.createElement("div");
    container.className = "prompt-dialog";
    container.innerHTML = `
      <div class="prompt-dialog-content">
        <div class="prompt-message">${message}</div>
        <input type="text" class="prompt-input" value="${defaultValue}" autofocus />
        <div class="prompt-actions">
          <button class="prompt-btn prompt-cancel">Cancel</button>
          <button class="prompt-btn prompt-ok">OK</button>
        </div>
      </div>
    `;

    const input = container.querySelector(".prompt-input");
    const okBtn = container.querySelector(".prompt-ok");
    const cancelBtn = container.querySelector(".prompt-cancel");

    const cleanup = (result) => {
      container.remove();
      overlay.style.display = "none";
      resolve(result);
    };

    okBtn.addEventListener("click", () => cleanup(input.value));
    cancelBtn.addEventListener("click", () => cleanup(null));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") cleanup(input.value);
      if (e.key === "Escape") cleanup(null);
    });

    overlay.style.display = "block";
    document.body.appendChild(container);
    setTimeout(() => input.focus(), 50);
  });
}

// ─── Assets Browser Logic ───────────────────────────────────────────────────

async function loadAssets(subPath) {
  currentAssetsPath = subPath;
  const breadcrumb = document.getElementById("assetsBreadcrumb");
  const grid = document.getElementById("assetsGrid");

  // Update breadcrumb
  if (breadcrumb) {
    const parts = subPath.split("/").filter(p => p);
    const folderIcon = await loadIcon("folder");
    let html = `<span class="assets-breadcrumb-item" data-path="">${folderIcon} Assets</span>`;
    let pathSoFar = "";
    for (const part of parts) {
      pathSoFar = pathSoFar ? pathSoFar + "/" + part : part;
      html += ` / <span class="assets-breadcrumb-item" data-path="${pathSoFar}">${part}</span>`;
    }
    breadcrumb.innerHTML = html;
    breadcrumb.querySelectorAll(".assets-breadcrumb-item").forEach(item => {
      item.addEventListener("click", () => loadAssets(item.dataset.path));
    });
  }

  // Load assets
  if (grid) {
    grid.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">Loading...</div>';
    try {
      const data = await listAssets(subPath);
      await renderAssetsGrid(data.files, data.folders);
    } catch (e) {
      grid.innerHTML = `<div style="text-align:center;color:var(--red);padding:20px;">Error: ${e.message}</div>`;
    }
  }
}

async function renderAssetsGrid(files, folders) {
  const grid = document.getElementById("assetsGrid");
  if (!grid) return;

  grid.innerHTML = "";

  // Load folder icon
  const folderIcon = await loadIcon("folder");
  
  // Render folders first
  for (const folder of folders) {
    const item = document.createElement("div");
    item.className = "assets-item assets-folder";
    item.innerHTML = `
      <span class="assets-icon" style="width:32px;height:32px;">${folderIcon}</span>
      <span class="assets-name">${folder.name}</span>
    `;
    item.addEventListener("click", () => loadAssets(currentAssetsPath ? currentAssetsPath + "/" + folder.name : folder.name));
    item.addEventListener("contextmenu", (e) => showAssetContextMenu(e, { name: folder.name, type: "folder" }));
    grid.appendChild(item);
  }

  // Load file type icons once
  const [fileIcon, imageIcon, videoIcon, audioIcon, codeIcon] = await Promise.all([
    loadIcon("file"),
    loadIcon("file-image"),
    loadIcon("file-video"),
    loadIcon("file-audio"),
    loadIcon("file-code")
  ]);
  
  // Render files
  for (const file of files) {
    const item = document.createElement("div");
    item.className = "assets-item assets-file";
    const ext = file.name.split(".").pop().toLowerCase();
    let icon = fileIcon;
    if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) icon = imageIcon;
    else if (["mp4", "webm", "mov"].includes(ext)) icon = videoIcon;
    else if (["mp3", "wav", "ogg"].includes(ext)) icon = audioIcon;
    else if (["js", "ts", "css", "html", "json", "md", "txt", "mmx"].includes(ext)) icon = codeIcon;

    const relativePath = currentAssetsPath ? "assets/" + currentAssetsPath + "/" + file.name : "assets/" + file.name;

    item.innerHTML = `
      <span class="assets-icon">${icon}</span>
      <span class="assets-name">${file.name}</span>
      <span class="assets-size">${formatFileSize(file.size)}</span>
    `;

    // Draggable: allows dragging asset items into the editor
    item.draggable = true;
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/asset-path", relativePath);
      e.dataTransfer.setData("text/asset-ext", ext);
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
    });

    // Single click: show insert popup (unless in pick mode from "From Assets" button)
    item.addEventListener("click", (e) => {
      if (pendingAssetCallback) {
        e.stopPropagation();
        e.preventDefault();
        pendingAssetCallback(relativePath);
        return;
      }
      // Show floating insert menu with options based on file type
      e.stopPropagation();
      e.preventDefault();
      showAssetInsertPopup(e, file.name, ext, relativePath);
    });

    item.addEventListener("dblclick", () => {
      if (pendingAssetCallback) return; // ignore in pick mode
      const assetRelPath = currentAssetsPath ? currentAssetsPath + "/" + file.name : file.name;
      openAsset(assetRelPath).catch((err) => {
        showToast(`Failed to open ${file.name}: ${err.message}`, "error");
      });
    });
    item.addEventListener("contextmenu", (e) => showAssetContextMenu(e, { name: file.name, type: "file" }));
    grid.appendChild(item);
  }

  if (files.length === 0 && folders.length === 0) {
    grid.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">No files or folders</div>';
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Asset Item Context Menu (Delete) ─────────────────────────────────────

let assetContextMenu = null;

async function showAssetContextMenu(e, asset) {
  e.preventDefault();
  removeAssetContextMenu();

  // Load icons for context menu
  const [deleteIcon, revealIcon, insertIcon, openIcon] = await Promise.all([
    loadIcon("delete"),
    loadIcon("file-new"),
    loadIcon("table"),
    loadIcon("file")
  ]);

  const menu = document.createElement("div");
  menu.className = "context-menu asset-context-menu";

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "context-menu-item";
  deleteBtn.innerHTML = `${deleteIcon} Delete ${asset.type === "folder" ? "Folder" : "File"}`;
  deleteBtn.addEventListener("click", async () => {
    removeAssetContextMenu();
    const confirmed = confirm(`Delete "${asset.name}"?\nThis action cannot be undone.`);
    if (!confirmed) return;

    try {
      const configResp = await fetch("/api/config");
      const config = await configResp.json();
      const inputDir = config.inputPath || "";
      const assetsDir = inputDir ? inputDir + "/assets" : "";
      const fullPath = assetsDir + (currentAssetsPath ? "/" + currentAssetsPath : "") + "/" + asset.name;

      if (asset.type === "folder") {
        await deleteFolder(fullPath);
      } else {
        await deleteFile(fullPath);
      }
      showToast(`Deleted: ${asset.name}`, "success");
      loadAssets(currentAssetsPath);
    } catch (err) {
      showToast(`Failed to delete: ${err.message}`, "error");
    }
  });
  menu.appendChild(deleteBtn);

  // Add "Reveal in Explorer" for folders, "Open" & "Insert" for files
  if (asset.type === "folder") {
    const revealBtn = document.createElement("button");
    revealBtn.className = "context-menu-item";
    revealBtn.innerHTML = `${revealIcon} Reveal in Explorer`;
    revealBtn.addEventListener("click", async () => {
      removeAssetContextMenu();
      const relPath = currentAssetsPath ? currentAssetsPath + "/" + asset.name : asset.name;
      try {
        await revealAsset(relPath);
        showToast("Opening file explorer...", "success");
      } catch (err) {
        showToast(`Failed to reveal: ${err.message}`, "error");
      }
    });
    menu.appendChild(revealBtn);
  } else {
    // Insert button — inserts MMX reference into the editor
    const insertBtn = document.createElement("button");
    insertBtn.className = "context-menu-item";
    insertBtn.innerHTML = `${insertIcon} Insert`;
    insertBtn.addEventListener("click", () => {
      removeAssetContextMenu();
      insertAssetIntoEditor(asset.name);
    });
    menu.appendChild(insertBtn);

    const openBtn = document.createElement("button");
    openBtn.className = "context-menu-item";
    openBtn.innerHTML = `${openIcon} Open`;
    openBtn.addEventListener("click", async () => {
      removeAssetContextMenu();
      const relPath = currentAssetsPath ? currentAssetsPath + "/" + asset.name : asset.name;
      try {
        await openAsset(relPath);
        showToast(`Opening ${asset.name}...`, "success");
      } catch (err) {
        showToast(`Failed to open: ${err.message}`, "error");
      }
    });
    menu.appendChild(openBtn);
  }

  menu.style.left = Math.min(e.clientX, window.innerWidth - 160) + "px";
  menu.style.top = Math.min(e.clientY, window.innerHeight - 60) + "px";
  document.body.appendChild(menu);
  assetContextMenu = menu;

  setTimeout(() => {
    document.addEventListener("click", removeAssetContextMenu, { once: true });
  }, 0);
}

function removeAssetContextMenu() {
  if (assetContextMenu) {
    assetContextMenu.remove();
    assetContextMenu = null;
  }
}

// ─── Asset Single-Click Insert Popup ─────────────────────────────────────

let assetInsertPopup = null;

/**
 * Show a floating popup with insertion options for an asset file,
 * auto-detecting the file type to suggest the most relevant insert mode.
 */
async function showAssetInsertPopup(e, fileName, ext, relativePath) {
  removeAssetInsertPopup();

  // Determine file type categories
  const isImage = ["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext);
  const isVideo = ["mp4", "webm", "mov"].includes(ext);
  const isAudio = ["mp3", "wav", "ogg"].includes(ext);
  const isCode = ["js", "ts", "css", "html", "json", "md", "txt", "mmx", "py", "rb", "java", "c", "cpp", "h", "php", "sh", "bat", "ps1", "xml", "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "gitignore"].includes(ext);

  // Load icons
  const [imageIcon, videoIcon, audioIcon, codeIcon, linkIcon] = await Promise.all([
    loadIcon("file-image"),
    loadIcon("file-video"),
    loadIcon("file-audio"),
    loadIcon("file-code"),
    loadIcon("link")
  ]);

  // Build menu items based on detected file type
  const items = [];

  // Auto-detected primary option — content without leading/trailing \n
  const baseInsert = (code) => code;

  if (isImage) {
    items.push({
      icon: imageIcon,
      label: "Insert as Image",
      insert: `![${fileName}](${relativePath})`
    });
  } else if (isVideo) {
    items.push({
      icon: videoIcon,
      label: "Insert as Video",
      insert: `!!(${relativePath})`
    });
  } else if (isAudio) {
    items.push({
      icon: audioIcon,
      label: "Insert as Audio",
      insert: `!!!(${relativePath})`
    });
  }

  // Always offer "Insert as Link"
  items.push({
    icon: linkIcon,
    label: "Insert as Link",
    insert: `[${fileName}](${relativePath})`
  });

  // Offer "#code() include" for code/text files or any non-media file
  if (isCode || (!isImage && !isVideo && !isAudio)) {
    items.push({
      icon: codeIcon,
      label: "Include as #code()",
      insert: `#code(${relativePath})`
    });
  }

  // Create the popup element
  const popup = document.createElement("div");
  popup.className = "asset-insert-popup";

  let html = `<div class="asset-insert-popup-header">
    <span class="asset-insert-popup-filename">${escapeHtml(fileName)}</span>
    <span class="asset-insert-popup-ext">.${ext}</span>
  </div>`;
  html += `<div class="asset-insert-popup-items">`;
  for (const item of items) {
    html += `<button class="asset-insert-popup-item" title="${escapeHtml(item.label)}">
      <span class="asset-insert-popup-item-icon">${item.icon}</span>
      <span class="asset-insert-popup-item-label">${escapeHtml(item.label)}</span>
    </button>`;
  }
  html += `</div>`;
  popup.innerHTML = html;

  // Attach click handlers to each item
  const buttons = popup.querySelectorAll(".asset-insert-popup-item");
  buttons.forEach((btn, idx) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const item = items[idx];
      
      // Smart insertion: only add \n before if cursor is NOT already at line start,
      // and always add \n after so next content goes on a fresh line.
      const content = codeEditor.getEditorContent();
      const cursor = codeEditor.getCursorOffset();
      const charBefore = cursor > 0 ? content[cursor - 1] : null;
      const needsLeadingNewline = charBefore !== null && charBefore !== '\n';
      const finalInsert = (needsLeadingNewline ? '\n' : '') + item.insert + '\n';

      suppressNextInput();
      codeEditor.insertText(finalInsert);
      showToast(`Inserted: ${item.label} — ${relativePath}`, "success");
      removeAssetInsertPopup();
    });
  });

  // Position popup near the click, clamping to viewport
  const popupWidth = 220;
  const popupHeight = Math.min(buttons.length * 36 + 60, 300);
  let x = e.clientX;
  let y = e.clientY;
  if (x + popupWidth > window.innerWidth - 10) x = window.innerWidth - popupWidth - 10;
  if (y + popupHeight > window.innerHeight - 10) y = window.innerHeight - popupHeight - 10;
  if (x < 10) x = 10;
  if (y < 10) y = 10;
  popup.style.left = x + "px";
  popup.style.top = y + "px";

  document.body.appendChild(popup);
  assetInsertPopup = popup;

  // Close on click outside (with delay to avoid immediate close from this click)
  setTimeout(() => {
    document.addEventListener("click", removeAssetInsertPopup, { once: true });
  }, 0);
}

function removeAssetInsertPopup() {
  if (assetInsertPopup) {
    assetInsertPopup.remove();
    assetInsertPopup = null;
  }
  // Also remove any lingering esc listener
  document.removeEventListener("click", removeAssetInsertPopup);
}

/**
 * Refresh the current assets view
 */
export function refreshAssets() {
  loadAssets(currentAssetsPath);
}
