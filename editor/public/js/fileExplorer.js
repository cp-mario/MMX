/**
 * MMX Visual Editor — File Explorer
 *
 * Renders a tree view of .mmx files in the project and handles
 * file selection / navigation.
 */

import { state } from "./state.js";
import * as api from "./api.js";
import * as codeEditor from "./codeEditor.js";
import * as dialogs from "./dialogs.js";
import { showToast, loadIcon } from "./utils.js";

/**
 * Initialize the file explorer
 */
export function initFileExplorer() {
  const refreshBtn = document.getElementById("btnRefreshFiles");
  refreshBtn?.addEventListener("click", loadFiles);

  const newFileBtn = document.getElementById("btnNewFile");
  newFileBtn?.addEventListener("click", () => showNewFileDialog());

  const newFolderBtn = document.getElementById("btnNewFolder");
  newFolderBtn?.addEventListener("click", () => showNewFolderDialog());

  const expandAllBtn = document.getElementById("btnExpandAll");
  expandAllBtn?.addEventListener("click", expandAllFolders);

  const collapseAllBtn = document.getElementById("btnCollapseAll");
  collapseAllBtn?.addEventListener("click", collapseAllFolders);

  // Subscribe to file tree changes
  state.subscribe("fileTree", (tree) => {
    renderTree(tree);
  });

  // Load files on init
  loadFiles();

  // ── Index button ────────────────────────────────────────────────────
  const btnIndex = document.getElementById("btnEditIndex");
  btnIndex?.addEventListener("click", openRootIndex);
}

/**
 * Open the visual documentation config editor dialog
 */
export async function openConfigEditor() {
  try {
    // Load current documentation config from server
    const config = await api.getDocConfig();
    populateConfigForm(config);
    dialogs.showDialog("dialogConfigEditor");
    // Set up save handler
    const saveBtn = document.getElementById("configSaveBtn");
    if (saveBtn) {
      // Remove any previous listener to avoid duplicates
      const newSaveBtn = saveBtn.cloneNode(true);
      saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
      newSaveBtn.addEventListener("click", saveConfigFromForm);
    }
  } catch (e) {
    console.error("Failed to load config:", e);
    showToast("Failed to load configuration", "error");
  }
}

/**
 * Populate the config form with values from the server
 * @param {object} config - Config object from server
 */
function populateConfigForm(config) {
  // Helper to get raw (unquoted) value preserving original formatting
  const getRaw = (key, fallback) => {
    if (config._raw && config._raw[key] !== undefined) {
      let val = config._raw[key];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      return val;
    }
    return fallback;
  };

  setFormValue("cfgTitle", getRaw("title", config.title || "MMX"));
  setFormValue("cfgVersion", getRaw("version", config.version || "v1.1"));
  setFormValue("cfgLang", getRaw("lang", config.lang || "en"));
  setFormValue("cfgSidebarBottomText", getRaw("sidebarBottomText", config.sidebarBottomText || ""));
  setFormValue("cfgDefaultCodeHighlight", String(config.defaultCodeHighlight ?? "false"));
  setFormValue("cfgNoDefaultIndex", String(config.noDefaultIndex ?? "false"));
}

/**
 * Set a form element value by id
 * @param {string} id
 * @param {string} value
 */
function setFormValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.tagName === "SELECT" || el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    el.value = value;
  }
}

/**
 * Save documentation config from the form to the server
 */
async function saveConfigFromForm() {
  const config = {
    title: document.getElementById("cfgTitle")?.value || "MMX",
    version: document.getElementById("cfgVersion")?.value || "",
    lang: document.getElementById("cfgLang")?.value || "en",
    sidebarBottomText: document.getElementById("cfgSidebarBottomText")?.value || "",
    defaultCodeHighlight: document.getElementById("cfgDefaultCodeHighlight")?.value === "true",
    noDefaultIndex: document.getElementById("cfgNoDefaultIndex")?.value === "true",
  };

  try {
    await api.saveDocConfig(config);
    showToast("Documentation config saved successfully", "success");
    // Close the dialog
    dialogs.hideDialog("dialogConfigEditor");
  } catch (e) {
    console.error("Failed to save config:", e);
    showToast("Failed to save configuration: " + e.message, "error");
  }
}

/**
 * Open the root index.mmx file (not in pages)
 */
async function openRootIndex() {
  // Get the project config to find the input path
  let inputPath = "";
  try {
    const config = await api.getConfig();
    inputPath = config.inputPath || "";
  } catch (e) {
    console.error("Failed to get config:", e);
  }

  if (!inputPath) {
    showToast("Could not determine input path from config", "error");
    return;
  }

  // The index.mmx is at inputPath/index.mmx
  const indexPath = inputPath.replace(/\\/g, "/").replace(/\/$/, "") + "/index.mmx";
  openFileByPath(indexPath);
}

// ─── Context menu ──────────────────────────────────────────────────────────

let contextMenu = null;
let contextTarget = null;

async function showContextMenu(e, node) {
  e.preventDefault();
  contextTarget = node;
  removeContextMenu();

  contextMenu = document.createElement("div");
  contextMenu.className = "context-menu";

  const items = [];
  if (node.type === "folder") {
    const [newFileIcon, newFolderIcon, deleteIcon] = await Promise.all([
      loadIcon("file-new"),
      loadIcon("folder-new"),
      loadIcon("delete")
    ]);
    items.push(
      { label: "New File", icon: newFileIcon, action: () => showNewFileDialog(node.path) },
      { label: "New Folder", icon: newFolderIcon, action: () => showNewFolderDialog(node.path) },
      { label: "Delete Folder", icon: deleteIcon, action: () => deleteNode(node) }
    );
  } else {
    const deleteIcon = await loadIcon("delete");
    items.push(
      { label: "Delete File", icon: deleteIcon, action: () => deleteNode(node) }
    );
  }

  for (const item of items) {
    const btn = document.createElement("button");
    btn.className = "context-menu-item";
    btn.innerHTML = item.icon + " " + item.label;
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      removeContextMenu();
      item.action();
    });
    contextMenu.appendChild(btn);
  }

  // Position menu
  const x = Math.min(e.clientX, window.innerWidth - 200);
  const y = Math.min(e.clientY, window.innerHeight - 100);
  contextMenu.style.left = x + "px";
  contextMenu.style.top = y + "px";
  document.body.appendChild(contextMenu);

  // Close on click outside
  setTimeout(() => {
    document.addEventListener("click", removeContextMenu, { once: true });
  }, 0);
}

function removeContextMenu() {
  if (contextMenu) {
    contextMenu.remove();
    contextMenu = null;
  }
  contextTarget = null;
}

async function createFileAt(dirPath, fileName) {
  const filePath = dirPath + "/" + fileName;
  try {
    await api.createFile(filePath);
    showToast("File created: " + fileName, "success");
    loadFiles();
  } catch (e) {
    showToast("Failed to create file: " + e.message, "error");
  }
}

async function createFolderAt(dirPath, folderName) {
  const folderPath = dirPath + "/" + folderName;
  try {
    await api.createFolder(folderPath);
    showToast("Folder created: " + folderName, "success");
    loadFiles();
  } catch (e) {
    showToast("Failed to create folder: " + e.message, "error");
  }
}

async function deleteNode(node) {
  const name = node.name;
  const confirmed = confirm(`Delete "${name}"?\nThis action cannot be undone.`);
  if (!confirmed) return;

  try {
    if (node.type === "folder") {
      await api.deleteFolder(node.path);
    } else {
      await api.deleteFile(node.path);
    }
    showToast("Deleted: " + name, "success");
    // Clear editor if deleted file was open
    const currentFile = state.get("currentFile");
    if (currentFile && currentFile.path === node.path) {
      state.update({ currentFile: null, dirty: false });
    }
    loadFiles();
  } catch (e) {
    showToast("Failed to delete: " + e.message, "error");
  }
}

// ─── Create File/Folder dialog with path selector ──────────────────────────

let createDialogActive = false;

function showCreateDialog(type, parentPath, callback) {
  if (createDialogActive) return;
  createDialogActive = true;

  const pagesDir = state.get("pagesDir") || "";
  const tree = state.get("fileTree");

  // Build list of all directories from the file tree with hierarchy info
  const directories = [{ name: "/", path: pagesDir, depth: 0, fullPath: "" }];
  if (tree && tree.children) {
    collectDirectories(tree.children, directories, "", 0);
  }

  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  overlay.style.display = "block";

  const dialog = document.createElement("div");
  dialog.className = "dialog create-dialog";

  const optionsHtml = directories.map(dir => {
    const selected = dir.path === parentPath ? " selected" : "";
    const label = dir.depth === 0 ? dir.name : dir.fullPath;
    return `<option value="${dir.path}"${selected} title="${dir.fullPath}">${label}</option>`;
  }).join("");

  dialog.innerHTML = `
    <div class="dialog-header">
      <h3>${type === "file" ? "New File" : "New Folder"}</h3>
      <button class="dialog-close create-close">&times;</button>
    </div>
    <div class="dialog-body">
      <div class="form-row">
        <label for="createPathSelect">Location:</label>
        <select id="createPathSelect" class="create-path-select">${optionsHtml}</select>
      </div>
      <div id="createPathPreview" class="create-path-preview"></div>
      <div class="form-row">
        <label for="createNameInput">Name:</label>
        <div class="create-name-wrapper">
          <input type="text" id="createNameInput" class="create-name-input" placeholder="${type === "file" ? "example" : "my-folder"}" autofocus>
          ${type === "file" ? '<span class="create-suffix">.mmx</span>' : ''}
        </div>
      </div>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary create-cancel">Cancel</button>
      <button class="btn btn-primary create-ok">Create</button>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(dialog);

  const pathSelect = dialog.querySelector(".create-path-select");
  const nameInput = dialog.querySelector(".create-name-input");
  const okBtn = dialog.querySelector(".create-ok");
  const cancelBtns = dialog.querySelectorAll(".create-cancel, .create-close");
  const pathPreview = dialog.querySelector("#createPathPreview");

  // Update path preview when selection or name changes
  function updatePathPreview() {
    const selectedOption = pathSelect.options[pathSelect.selectedIndex];
    const fullPath = selectedOption?.getAttribute("title") || "";
    const name = nameInput.value.trim() || "…";
    if (pathPreview) {
      const suffix = type === "file" ? ".mmx" : "";
      pathPreview.textContent = "→ " + fullPath + "/" + name + suffix;
    }
  }

  pathSelect.addEventListener("change", updatePathPreview);
  nameInput.addEventListener("input", updatePathPreview);

  function close() {
    createDialogActive = false;
    dialog.remove();
    overlay.remove();
  }

  function submit() {
    const val = nameInput.value.trim();
    const selectedPath = pathSelect.value;
    if (!val) {
      showToast("Please enter a name", "error");
      nameInput.focus();
      return;
    }
    close();
    callback(selectedPath, val, type);
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

// Update showNewFileDialog and showNewFolderDialog to use the new dialog
function showNewFileDialog(parentPath) {
  const pagesDir = state.get("pagesDir") || "";
  showCreateDialog("file", parentPath || pagesDir, (targetDir, name, type) => {
    if (!name.endsWith(".mmx")) name += ".mmx";
    createFileAt(targetDir, name);
  });
}

function showNewFolderDialog(parentPath) {
  const pagesDir = state.get("pagesDir") || "";
  showCreateDialog("folder", parentPath || pagesDir, (targetDir, name, type) => {
    createFolderAt(targetDir, name);
  });
}

/**
 * Load file list from the server
 */
async function loadFiles() {
  try {
    const data = await api.getFiles();
    state.update({
      files: data.files,
      fileTree: data.tree,
      pagesDir: data.pagesDir,
    });
  } catch (e) {
    console.error("Failed to load files:", e);
    showToast("Failed to load files from server", "error");
  }
}

/**
 * Render the file tree
 * @param {object} tree - Tree structure
 */
function renderTree(tree) {
  const container = document.getElementById("fileTree");
  if (!container) return;

  container.innerHTML = "";

  if (!tree || !tree.children || tree.children.length === 0) {
    container.innerHTML = `<div class="tree-item" style="color:var(--text-muted);cursor:default;padding:20px 14px;text-align:center;">
      No .mmx files found
    </div>`;
    return;
  }

  // Pre-load tree icons
  Promise.all([
    loadIcon("chevron"),
    loadIcon("folder"),
    loadIcon("file")
  ]).then(([chevronSvg, folderSvg, fileSvg]) => {
    const icons = { chevron: chevronSvg, folder: folderSvg, file: fileSvg };
    const ul = document.createElement("ul");
    ul.style.listStyle = "none";
    // Sort root children: files first, then folders
    const sorted = [...tree.children].sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    for (const child of sorted) {
      ul.appendChild(renderNode(child, 0, icons));
    }
    container.appendChild(ul);
  });
}

/**
 * Render a tree node (folder or file)
 * @param {object} node
 * @param {number} depth
 * @param {object} icons - Pre-loaded SVG icon strings
 * @returns {HTMLElement}
 */
function renderNode(node, depth, icons) {
  const li = document.createElement("li");

  if (node.type === "folder") {
    // Folder
    const folderDiv = document.createElement("div");
    folderDiv.className = "tree-item folder";
    folderDiv.style.paddingLeft = `${12 + depth * 16}px`;
    folderDiv.dataset.path = node.path || "";

    const chevron = document.createElement("span");
    chevron.className = "chevron";
    chevron.innerHTML = icons.chevron;
    folderDiv.appendChild(chevron);

    const icon = document.createElement("span");
    icon.className = "icon";
    icon.innerHTML = icons.folder;
    folderDiv.appendChild(icon);

    const nameSpan = document.createElement("span");
    nameSpan.textContent = node.name;
    folderDiv.appendChild(nameSpan);

    folderDiv.addEventListener("click", (e) => {
      e.stopPropagation();
      const childContainer = li.querySelector(".tree-children");
      if (childContainer) {
        childContainer.classList.toggle("collapsed");
        chevron.classList.toggle("open");
      }
    });

    folderDiv.addEventListener("contextmenu", (e) => showContextMenu(e, node));

    li.appendChild(folderDiv);

    // Children
    if (node.children && node.children.length > 0) {
      const childContainer = document.createElement("ul");
      childContainer.className = "tree-children collapsed";
      childContainer.style.listStyle = "none";
      // Sort: files first, then folders
      const sorted = [...node.children].sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
      for (const child of sorted) {
        childContainer.appendChild(renderNode(child, depth + 1, icons));
      }
      li.appendChild(childContainer);
    }
  } else {
    // File
    const fileDiv = document.createElement("div");
    fileDiv.className = "tree-item file";
    fileDiv.style.paddingLeft = `${12 + depth * 16}px`;
    fileDiv.dataset.path = node.path;
    fileDiv.dataset.relativePath = node.relativePath;

    const icon = document.createElement("span");
    icon.className = "icon";
    icon.innerHTML = icons.file;
    fileDiv.appendChild(icon);

    const nameSpan = document.createElement("span");
    nameSpan.textContent = node.name;
    fileDiv.appendChild(nameSpan);

    fileDiv.addEventListener("click", () => {
      openFile(node.path, node.relativePath);
    });

    fileDiv.addEventListener("contextmenu", (e) => showContextMenu(e, node));

    li.appendChild(fileDiv);
  }

  return li;
}

/**
 * Show a custom save-prompt dialog (replaces native confirm)
 * @returns {Promise<'save'|'discard'>}
 */
function showSavePrompt() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.style.display = "block";

    const dialog = document.createElement("div");
    dialog.className = "dialog prompt-dialog";
    dialog.innerHTML = `
      <div class="dialog-header">
        <h3>Unsaved Content</h3>
        <button class="dialog-close save-prompt-close">&times;</button>
      </div>
      <div class="dialog-body">
        <p style="margin:0;font-size:14px;color:var(--text-primary);">
          You have unsaved content. What do you want to do?
        </p>
      </div>
      <div class="dialog-footer">
        <button class="btn btn-secondary save-prompt-discard">Discard</button>
        <button class="btn btn-primary save-prompt-save">Save As…</button>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(dialog);

    function close() {
      dialog.remove();
      overlay.remove();
    }

    function handleDiscard() {
      close();
      resolve("discard");
    }

    function handleSave() {
      close();
      resolve("save");
    }

    dialog.querySelector(".save-prompt-close").addEventListener("click", handleDiscard);
    dialog.querySelector(".save-prompt-discard").addEventListener("click", handleDiscard);
    dialog.querySelector(".save-prompt-save").addEventListener("click", handleSave);
    overlay.addEventListener("click", handleDiscard);

    // Close on Escape key
    function onKeyDown(e) {
      if (e.key === "Escape") {
        handleDiscard();
        document.removeEventListener("keydown", onKeyDown);
      }
    }
    document.addEventListener("keydown", onKeyDown);
  });
}

/**
 * Open a file in the editor
 * @param {string} filePath - Absolute path
 * @param {string} relativePath - Relative path for display
 */
async function openFile(filePath, relativePath) {
  // If opening the same file, just do nothing (no need to re-read)
  const currentFile = state.get("currentFile");
  if (currentFile && currentFile.path === filePath) return;

  // If no file is open but there's unsaved content, ask user what to do
  if (!currentFile) {
    const unsavedContent = codeEditor.getEditorContent();
    if (unsavedContent && unsavedContent.trim()) {
      const action = await showSavePrompt();
      if (action === "save") {
        // Trigger the Save button — since there's no currentFile, the toolbar
        // will show the "Save As" dialog so the user can choose a location.
        document.querySelector('[data-cmd="save"]')?.click();
        return; // Don't open the clicked file yet; user can click it again after saving
      }
      // If discard, proceed to open the new file (unsaved content is lost)
    }
  }

  // Auto-save current file if dirty before switching
  const dirty = state.get("dirty");
  if (currentFile && dirty) {
    try {
      const content = codeEditor.getEditorContent();
      await api.saveFile(currentFile.path, content);
    } catch (e) {
      console.error("Auto-save on switch failed:", e);
    }
  }

  try {
    const data = await api.readFile(filePath);

    state.update({
      dirty: false,
      currentFile: {
        path: filePath,
        name: relativePath || filePath.split("/").pop() || filePath.split("\\").pop(),
        content: data.content,
        originalContent: data.content,
      },
    });

    // Update active state in tree
    document.querySelectorAll(".tree-item.active").forEach((el) => el.classList.remove("active"));
    const treeItem = document.querySelector(`.tree-item[data-path="${CSS.escape(filePath)}"]`);
    if (treeItem) treeItem.classList.add("active");

    // Update file info
    const fileNameEl = document.getElementById("currentFileName");
    if (fileNameEl) fileNameEl.textContent = relativePath || filePath;

    // Focus the editor so the user can start typing immediately
    const editor = document.getElementById("codeEditor");
    if (editor) {
      editor.focus();
    }

  } catch (e) {
    console.error("Failed to open file:", e);
    showToast(`Failed to open file: ${e.message}`, "error");
  }
}

/**
 * Collapse all folders in the file tree
 */
function collapseAllFolders() {
  document.querySelectorAll(".tree-children").forEach(el => {
    el.classList.add("collapsed");
  });
  document.querySelectorAll(".chevron").forEach(el => {
    el.classList.remove("open");
  });
}

/**
 * Expand all folders in the file tree
 */
function expandAllFolders() {
  document.querySelectorAll(".tree-children").forEach(el => {
    el.classList.remove("collapsed");
  });
  document.querySelectorAll(".chevron").forEach(el => {
    el.classList.add("open");
  });
}

/**
 * Expose openFile for other modules to use
 * @param {string} filePath
 */
export function openFileByPath(filePath) {
  // Find the file in the state
  const files = state.get("files");
  const file = files.find((f) => f.path === filePath);
  if (file) {
    openFile(file.path, file.relativePath);
  } else {
    // Just try to open the path directly
    openFile(filePath, filePath.split("/").pop() || filePath.split("\\").pop());
  }
}
