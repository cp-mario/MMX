/**
 * MMX Visual Editor — Main Application (v2)
 *
 * Bootstraps all modules and handles editor split-pane resizing
 * and sidebar resizing.
 */

import { state } from "./state.js";
import { initFileExplorer } from "./fileExplorer.js";
import { initCodeEditor } from "./codeEditor.js";
import { initToolbar } from "./toolbar.js";
import { initPreview } from "./previewPanel.js";
import { initDialogs } from "./dialogs.js";
import { initAutocomplete } from "./autocomplete.js";
import { initTableEditor } from "./tableEditor.js";
import { replaceIcons } from "./utils.js";

// ═════════════════════════════════════════════════════════════════════════════
// BOOT
// ═════════════════════════════════════════════════════════════════════════════

async function init() {
  console.log("MMX Visual Editor starting…");

  try {
    const api = await import("./api.js");
    const projectInfo = await api.getProjectInfo();
    state.set("config", projectInfo.config || {});
  } catch (e) {
    console.warn("Could not load project info:", e.message);
  }

  initDialogs();
  initToolbar();
  initFileExplorer();
  initCodeEditor();
  initPreview();
  initAutocomplete();
  initTableEditor();
  initSplitPane();
  initSidebarResizer();

  // Replace all [data-icon] elements with inline SVG icons
  replaceIcons();

  // Global Ctrl+S
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      document.querySelector('[data-cmd="save"]')?.click();
    }
  });

  console.log("MMX Visual Editor ready!");
}

// ═════════════════════════════════════════════════════════════════════════════
// SPLIT PANE (editor ↔ preview)
// ═════════════════════════════════════════════════════════════════════════════

function initSplitPane() {
  const divider = document.getElementById("splitDivider");
  const editorSection = document.getElementById("editorSection");
  const previewSection = document.getElementById("previewSection");
  if (!divider || !editorSection || !previewSection) return;

  divider.addEventListener("mousedown", (e) => {
    e.preventDefault();
    divider.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev) => {
      const pane = editorSection.parentElement;
      if (!pane) return;
      const paneRect = pane.getBoundingClientRect();
      let newWidth = ev.clientX - paneRect.left;
      const minW = 200;
      const maxW = paneRect.width - 200;
      newWidth = Math.max(minW, Math.min(maxW, newWidth));
      editorSection.style.width = newWidth + "px";
      window.dispatchEvent(new Event("resize"));
    };

    // Disable iframe pointer events while dragging so it doesn't steal mousemove
    const previewIframe = previewSection.querySelector("iframe");
    if (previewIframe) previewIframe.style.pointerEvents = "none";

    const onUp = () => {
      divider.classList.remove("active");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Restore iframe pointer events
      if (previewIframe) previewIframe.style.pointerEvents = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  divider.addEventListener("dblclick", () => {
    editorSection.style.width = "50%";
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// SIDEBAR RESIZER
// ═════════════════════════════════════════════════════════════════════════════

function initSidebarResizer() {
  const divider = document.getElementById("sidebarDivider");
  const sidebar = document.getElementById("sidebar");
  if (!divider || !sidebar) return;

  divider.addEventListener("mousedown", (e) => {
    e.preventDefault();
    divider.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev) => {
      let newWidth = ev.clientX;
      newWidth = Math.max(200, Math.min(500, newWidth));
      sidebar.style.width = newWidth + "px";
      window.dispatchEvent(new Event("resize"));
    };

    const onUp = () => {
      divider.classList.remove("active");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  divider.addEventListener("dblclick", () => {
    sidebar.style.width = "260px";
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Start
// ═════════════════════════════════════════════════════════════════════════════

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
