/**
 * MMX Visual Editor — Server
 * 
 * A Bun/Node.js HTTP server that serves the editor frontend and provides
 * a REST API for file operations and MMX → HTML preview.
 * 
 * Run with: bun server.js  or  node server.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

// Try to load the MMX parser (relative to the project root, one level up)
let mmxToHtml = null;
try {
  const parserModule = await import("../scripts/parser.js");
  mmxToHtml = parserModule.mmxToHtml;
} catch (e) {
  console.warn("⚠️  Could not load MMX parser from ../scripts/parser.js");
  console.warn("   Live preview will show raw content only.");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Configuration ───────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3031;
const PROJECT_ROOT = path.resolve(__dirname, ".."); // parent of editor/
const PUBLIC_DIR = path.join(__dirname, "public");
const CONFIG_PATH = path.join(PROJECT_ROOT, "config.mcfg");

// In-memory cache of open files (avoids reading from disk on every preview)
const fileCache = new Map();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Read project config and extract input/output paths */
function getProjectConfig() {
  const config = {
    inputPath: "",
    outputPath: "",
    singleFile: false,
    title: "MMX Documentation",
    version: "",
    lang: "en",
  };
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("#") || trimmed === "") continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        // Strip surrounding quotes
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (key === "inputPath") config.inputPath = val;
        else if (key === "outputPath") config.outputPath = val;
        else if (key === "singleFile") config.singleFile = val === "true";
      }
    }
  } catch (e) {
    console.error("Error reading config:", e.message);
  }

  // Resolve paths relative to project root
  if (config.inputPath && !path.isAbsolute(config.inputPath)) {
    config.inputPath = path.resolve(PROJECT_ROOT, config.inputPath);
  }
  if (config.outputPath && !path.isAbsolute(config.outputPath)) {
    config.outputPath = path.resolve(PROJECT_ROOT, config.outputPath);
  }

  return config;
}

/** Get all .mmx files recursively from a directory */
function getMmxFiles(dir, baseDir = dir) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.name.startsWith(".")) continue; // skip hidden
      if (entry.name === "node_modules") continue;
      if (entry.isDirectory()) {
        results.push(...getMmxFiles(fullPath, baseDir));
      } else if (entry.name.endsWith(".mmx")) {
        results.push({
          name: entry.name,
          path: fullPath,
          relativePath: path.relative(baseDir, fullPath),
          dir: path.dirname(fullPath),
        });
      }
    }
  } catch (e) {
    console.error("Error reading directory:", e.message);
  }
  return results;
}

/** Build a tree structure from file list */
function buildFileTree(files, pagesDir) {
  const tree = { children: [] };

  for (const file of files) {
    const parts = file.relativePath.replace(/\\/g, "/").split("/");
    let current = tree;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      if (isLast) {
        current.children.push({
          name: part,
          type: "file",
          path: file.path,
          relativePath: file.relativePath,
        });
      } else {
        let existing = current.children.find(
          (c) => c.name === part && c.type === "folder"
        );
        if (!existing) {
          const folderPath = path.join(current.path || pagesDir || "", part);
          existing = {
            name: part,
            type: "folder",
            children: [],
            path: folderPath,
          };
          current.children.push(existing);
        }
        current = existing;
      }
    }
  }

  return tree;
}

/**
 * Inject empty directories into the tree (directories without .mmx files).
 * This ensures folders with no .mmx content still appear in the file explorer.
 */
function injectEmptyDirectories(tree, pagesDir) {
  if (!pagesDir || !fs.existsSync(pagesDir)) return;

  // Collect all directory paths already present in the tree
  const existingPaths = new Set();
  (function walk(node) {
    if (node.type === "folder" && node.path) {
      existingPaths.add(node.path);
    }
    for (const child of node.children || []) {
      walk(child);
    }
  })(tree);
  if (tree.path) existingPaths.add(path.resolve(tree.path));

  // Recursively scan the filesystem for all directories
  function scanDirs(dir) {
    const dirs = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        if (entry.name === "node_modules") continue;
        const fullPath = path.resolve(dir, entry.name);
        if (entry.isDirectory()) {
          dirs.push({ name: entry.name, path: fullPath });
          dirs.push(...scanDirs(fullPath));
        }
      }
    } catch (e) {
      console.error("Error scanning directory:", e.message);
    }
    return dirs;
  }

  const actualDirs = scanDirs(path.resolve(pagesDir));

  // For each directory on disk not yet in the tree, inject it
  for (const dir of actualDirs) {
    if (existingPaths.has(dir.path)) continue;

    // Build the relative path from pages root
    const relPath = path.relative(path.resolve(pagesDir), dir.path);
    const parts = relPath.split(path.sep).filter(Boolean);
    if (parts.length === 0) continue;

    // Traverse the tree, creating missing folder nodes
    let current = tree;
    for (const part of parts) {
      let child = current.children.find(
        (c) => c.name === part && c.type === "folder"
      );
      if (!child) {
        const folderPath = path.join(current.path || pagesDir, part);
        child = {
          name: part,
          type: "folder",
          children: [],
          path: folderPath,
        };
        current.children.push(child);
      }
      current = child;
    }
  }
}

// ─── MIME types ──────────────────────────────────────────────────────────────

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
  ".ogv": "video/ogg",
  ".wav": "audio/wav",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

function getMime(ext) {
  return MIME[ext.toLowerCase()] || "application/octet-stream";
}

// ─── Router ──────────────────────────────────────────────────────────────────

async function handleRequest(req) {
  // Construct full URL from the request (req.url may be just a path in Node.js)
  const fullUrl = req.url.startsWith("http") ? req.url : `http://${req.headers.host || "localhost:3031"}${req.url}`;
  const url = new URL(fullUrl);
  const method = req.method;
  let body = null;

  if (method === "POST" || method === "PUT") {
    try {
      body = await req.json();
    } catch {
      // ignore
    }
  }

  // ─── API routes ────────────────────────────────────────────────────────────

  // GET /api/project-info — project structure info
  if (url.pathname === "/api/project-info" && method === "GET") {
    const config = getProjectConfig();
    return jsonResponse({ config });
  }

  // GET /api/files — list all .mmx files as a tree
  if (url.pathname === "/api/files" && method === "GET") {
    const config = getProjectConfig();
    const pagesDir = config.inputPath
      ? path.join(config.inputPath, "pages")
      : path.join(PROJECT_ROOT, "1Example/input/pages");

    if (!fs.existsSync(pagesDir)) {
      return jsonResponse({ error: "Pages directory not found", pagesDir }, 404);
    }

    const files = getMmxFiles(pagesDir, pagesDir);
    const tree = buildFileTree(files, pagesDir);
    // Include empty directories in the tree so they appear in the explorer
    injectEmptyDirectories(tree, pagesDir);
    return jsonResponse({ files, tree, pagesDir });
  }

  // GET /api/file?path=... — read a file
  if (url.pathname === "/api/file" && method === "GET") {
    const filePath = url.searchParams.get("path");
    if (!filePath) return jsonResponse({ error: "Missing path parameter" }, 400);

    // Security: resolve and ensure it's within the project
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(PROJECT_ROOT)) {
      return jsonResponse({ error: "Access denied" }, 403);
    }

    try {
      if (!fs.existsSync(resolved)) {
        return jsonResponse({ error: "File not found" }, 404);
      }
      const content = fs.readFileSync(resolved, "utf-8");
      fileCache.set(resolved, content);
      return jsonResponse({ content, path: resolved });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  // POST /api/file — save a file
  if (url.pathname === "/api/file" && method === "POST") {
    const { filePath, content } = body || {};
    if (!filePath || content === undefined) {
      return jsonResponse({ error: "Missing filePath or content" }, 400);
    }

    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(PROJECT_ROOT)) {
      return jsonResponse({ error: "Access denied" }, 403);
    }

    try {
      // ── Preserve original line endings ──────────────────────────────
      // Determine whether the original file uses CRLF or LF so we can
      // write back the same convention.  The browser textarea always
      // normalises to LF (\n) internally, so without this step every
      // save would quietly convert CRLF → LF.
      let lineEnding = "\n"; // default: LF (Unix / modern macOS)
      try {
        if (fs.existsSync(resolved)) {
          const existing = fs.readFileSync(resolved, "utf-8");
          // If the file contains at least one CRLF we treat it as CRLF.
          if (existing.includes("\r\n")) lineEnding = "\r\n";
        }
      } catch {
        // Ignore read errors – fall back to LF.
      }

      // Normalise every line break to the detected convention.
      const normalizedContent = content.replace(/\r?\n/g, lineEnding);
      // ─────────────────────────────────────────────────────────────────

      // Ensure directory exists
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(resolved, normalizedContent, "utf-8");
      fileCache.set(resolved, normalizedContent);
      return jsonResponse({ success: true, path: resolved });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  // POST /api/preview — convert MMX to HTML
  if (url.pathname === "/api/preview" && method === "POST") {
    const { content, filePath } = body || {};
    if (content === undefined) {
      return jsonResponse({ error: "Missing content" }, 400);
    }

    // Reset heading tracker for each preview
    try {
      const { resetHeadingIdTracker } = await import("../scripts/patterns.js");
      if (typeof resetHeadingIdTracker === "function") resetHeadingIdTracker();
    } catch {
      // patterns.js may not have this export in older versions
    }

    try {
      let html = "";
      if (mmxToHtml) {
        html = mmxToHtml(content);
      } else {
        // Fallback: basic escape
        html = content
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\n/g, "<br>");
      }

      // ── Resolve #code() includes ────────────────────────────────────────
      // Find <pre class="fileCode ..." path="..."> and embed the file content
      html = html.replace(/<pre class="fileCode[^"]*" path="([^"]*)"(?: auto="true")?><\/pre>/g, (match, filePathAttr) => {
        try {
          // Try to resolve the file path
          let resolvedPath = null;

          // Method 1: resolve relative to the MMX file's directory
          if (filePath) {
            const mmxDir = path.dirname(filePath);
            const candidate = path.resolve(mmxDir, filePathAttr);
            if (fs.existsSync(candidate)) {
              resolvedPath = candidate;
            }
          }

          // Method 2: resolve relative to project root
          if (!resolvedPath) {
            const candidate = path.resolve(PROJECT_ROOT, filePathAttr);
            if (fs.existsSync(candidate)) {
              resolvedPath = candidate;
            }
          }

          // Method 3: resolve relative to input directory (from config)
          if (!resolvedPath) {
            const config = getProjectConfig();
            if (config.inputPath) {
              const candidate = path.resolve(config.inputPath, filePathAttr);
              if (fs.existsSync(candidate)) {
                resolvedPath = candidate;
              }
            }
          }

          if (resolvedPath) {
            const fileContent = fs.readFileSync(resolvedPath, "utf-8");
            // Escape HTML entities
            const escaped = fileContent
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;");
            // Extract language from file extension for syntax highlighting class
            const ext = path.extname(resolvedPath).replace(/^\./, '');
            const langClass = ext ? ` language-${ext}` : '';
            return `<pre class="fileCode multiline-code${langClass}"><code>${escaped}</code></pre>`;
          } else {
            // File not found — show error message in preview
            const errorMsg = `⚠️ File not found: ${filePathAttr}`;
            return `<pre class="fileCode multiline-code error"><code>${errorMsg}</code></pre>`;
          }
        } catch (e) {
          const errorMsg = `⚠️ Error reading ${filePathAttr}: ${e.message}`;
          return `<pre class="fileCode multiline-code error"><code>${errorMsg}</code></pre>`;
        }
      });

      return jsonResponse({ html });
    } catch (e) {
      return jsonResponse({ error: e.message, html: `<pre>Error: ${e.message}</pre>` }, 500);
    }
  }

  // POST /api/build — run the full MMX documentation build
  if (url.pathname === "/api/build" && method === "POST") {
    const config = getProjectConfig();
    const outputDir = config.outputPath || path.join(PROJECT_ROOT, "1Example/output");

    try {
      // Run the build as a child process
      const buildResult = await new Promise((resolve, reject) => {
        const isBun = typeof Bun !== "undefined";
        const cmd = isBun ? "bun" : "node";
        const args = isBun ? ["main.js"] : ["main.js"];
        const child = spawn(cmd, args, {
          cwd: PROJECT_ROOT,
          stdio: ["ignore", "pipe", "pipe"],
          shell: true,
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (data) => { stdout += data.toString(); });
        child.stderr.on("data", (data) => { stderr += data.toString(); });

        child.on("close", (code) => {
          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            reject(new Error(`Build failed with code ${code}\n${stderr}`));
          }
        });

        child.on("error", (err) => {
          reject(new Error(`Failed to start build: ${err.message}`));
        });
      });

      return jsonResponse({
        success: true,
        outputPath: outputDir,
        log: buildResult.stdout,
      });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  // GET /api/build/status — check if output files exist
  if (url.pathname === "/api/build/status" && method === "GET") {
    const config = getProjectConfig();
    const outputDir = config.outputPath || path.join(PROJECT_ROOT, "1Example/output");
    const indexPath = path.join(outputDir, "index.html");
    const exists = fs.existsSync(indexPath);
    return jsonResponse({
      built: exists,
      outputPath: outputDir,
      outputUrl: "/output/",
    });
  }

  // POST /api/file/create — create a new file
  if (url.pathname === "/api/file/create" && method === "POST") {
    const { filePath } = body || {};
    if (!filePath) return jsonResponse({ error: "Missing filePath" }, 400);

    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(PROJECT_ROOT)) {
      return jsonResponse({ error: "Access denied" }, 403);
    }

    try {
      if (fs.existsSync(resolved)) {
        return jsonResponse({ error: "File already exists" }, 409);
      }
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(resolved, "", "utf-8");
      return jsonResponse({ success: true, path: resolved });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  // POST /api/folder/create — create a new folder
  if (url.pathname === "/api/folder/create" && method === "POST") {
    const { folderPath } = body || {};
    if (!folderPath) return jsonResponse({ error: "Missing folderPath" }, 400);

    const resolved = path.resolve(folderPath);
    if (!resolved.startsWith(PROJECT_ROOT)) {
      return jsonResponse({ error: "Access denied" }, 403);
    }

    try {
      if (fs.existsSync(resolved)) {
        return jsonResponse({ error: "Folder already exists" }, 409);
      }
      fs.mkdirSync(resolved, { recursive: true });
      return jsonResponse({ success: true, path: resolved });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  // DELETE /api/file — delete a file
  if (url.pathname === "/api/file" && method === "DELETE") {
    const filePath = url.searchParams.get("path") || body?.filePath;
    if (!filePath) return jsonResponse({ error: "Missing path" }, 400);

    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(PROJECT_ROOT)) {
      return jsonResponse({ error: "Access denied" }, 403);
    }

    try {
      if (!fs.existsSync(resolved)) {
        return jsonResponse({ error: "File not found" }, 404);
      }
      fs.unlinkSync(resolved);
      fileCache.delete(resolved);
      return jsonResponse({ success: true });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  // DELETE /api/folder — delete a folder
  if (url.pathname === "/api/folder" && method === "DELETE") {
    const folderPath = url.searchParams.get("path") || body?.folderPath;
    if (!folderPath) return jsonResponse({ error: "Missing path" }, 400);

    const resolved = path.resolve(folderPath);
    if (!resolved.startsWith(PROJECT_ROOT)) {
      return jsonResponse({ error: "Access denied" }, 403);
    }

    try {
      if (!fs.existsSync(resolved)) {
        return jsonResponse({ error: "Folder not found" }, 404);
      }
      fs.rmSync(resolved, { recursive: true, force: true });
      return jsonResponse({ success: true });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  // GET /api/assets/list — list asset files in input/assets
  if (url.pathname === "/api/assets/list" && method === "GET") {
    const config = getProjectConfig();
    const inputDir = config.inputPath || path.join(PROJECT_ROOT, "1Example/input");
    const assetsDir = path.join(inputDir, "assets");
    const subPath = url.searchParams.get("sub") || "";

    try {
      const targetDir = subPath ? path.join(assetsDir, subPath) : assetsDir;
      if (!fs.existsSync(targetDir)) {
        return jsonResponse({ files: [], folders: [] });
      }
      // Security: ensure we don't escape the assets directory
      const resolvedDir = path.resolve(targetDir);
      if (!resolvedDir.startsWith(path.resolve(assetsDir))) {
        return jsonResponse({ error: "Access denied" }, 403);
      }
      const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
      const files = [];
      const folders = [];
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const fullPath = path.join(resolvedDir, entry.name);
        const stat = fs.statSync(fullPath);
        if (entry.isDirectory()) {
          folders.push({ name: entry.name, path: fullPath });
        } else {
          files.push({
            name: entry.name,
            path: fullPath,
            size: stat.size,
            mtime: stat.mtimeMs,
          });
        }
      }
      return jsonResponse({ files, folders, assetsDir });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  // GET /api/assets?path=... — get an asset file (image, code snippet, etc.)
  if (url.pathname === "/api/assets" && method === "GET") {
    const assetPath = url.searchParams.get("path");
    if (!assetPath) return jsonResponse({ error: "Missing path" }, 400);

    const resolved = path.resolve(assetPath);
    if (!resolved.startsWith(PROJECT_ROOT)) {
      return jsonResponse({ error: "Access denied" }, 403);
    }

    try {
      if (!fs.existsSync(resolved)) {
        return jsonResponse({ error: "Asset not found" }, 404);
      }
      const content = fs.readFileSync(resolved, "utf-8");
      return jsonResponse({ content, path: resolved });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  // POST /api/assets/upload — upload a file to the assets directory
  if (url.pathname === "/api/assets/upload" && method === "POST") {
    const { filename, base64, subPath } = body || {};
    if (!filename || !base64) {
      return jsonResponse({ error: "Missing filename or base64 data" }, 400);
    }

    const config = getProjectConfig();
    const inputDir = config.inputPath || path.join(PROJECT_ROOT, "1Example/input");
    const assetsDir = path.join(inputDir, "assets");
    const targetDir = subPath ? path.join(assetsDir, subPath) : assetsDir;
    const filePath = path.join(targetDir, filename);

    // Security: ensure we don't escape the assets directory
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(assetsDir))) {
      return jsonResponse({ error: "Access denied" }, 403);
    }

    try {
      // Create target directory if it doesn't exist
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      // Decode base64 and write file
      const buffer = Buffer.from(base64, "base64");
      fs.writeFileSync(resolved, buffer);
      return jsonResponse({ success: true, path: resolved, size: buffer.length });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  // POST /api/assets/folder/create — create a folder inside the assets directory
  if (url.pathname === "/api/assets/folder/create" && method === "POST") {
    const { name, subPath } = body || {};
    if (!name) {
      return jsonResponse({ error: "Missing folder name" }, 400);
    }

    const config = getProjectConfig();
    const inputDir = config.inputPath || path.join(PROJECT_ROOT, "1Example/input");
    const assetsDir = path.join(inputDir, "assets");
    const targetDir = subPath ? path.join(assetsDir, subPath) : assetsDir;
    const folderPath = path.join(targetDir, name);

    const resolved = path.resolve(folderPath);
    if (!resolved.startsWith(path.resolve(assetsDir))) {
      return jsonResponse({ error: "Access denied" }, 403);
    }

    try {
      if (fs.existsSync(resolved)) {
        return jsonResponse({ error: "Folder already exists" }, 409);
      }
      fs.mkdirSync(resolved, { recursive: true });
      return jsonResponse({ success: true, path: resolved });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  // POST /api/assets/open — open a file in the default OS application
  if (url.pathname === "/api/assets/open" && method === "POST") {
    const { assetPath } = body || {};
    if (!assetPath) {
      return jsonResponse({ error: "Missing assetPath" }, 400);
    }

    const config = getProjectConfig();
    const inputDir = config.inputPath || path.join(PROJECT_ROOT, "1Example/input");
    const assetsDir = path.join(inputDir, "assets");
    const resolved = path.resolve(path.join(assetsDir, assetPath));

    if (!resolved.startsWith(path.resolve(assetsDir))) {
      return jsonResponse({ error: "Access denied" }, 403);
    }

    if (!fs.existsSync(resolved)) {
      return jsonResponse({ error: "File not found" }, 404);
    }

    try {
      const plat = process.platform;
      let cmd, args;
      if (plat === "win32") {
        cmd = "start";
        args = ["", resolved];
      } else if (plat === "darwin") {
        cmd = "open";
        args = [resolved];
      } else {
        cmd = "xdg-open";
        args = [resolved];
      }
      const child = spawn(cmd, args, {
        stdio: "ignore",
        detached: true,
        shell: true,
      });
      child.unref();
      return jsonResponse({ success: true, path: resolved });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  // POST /api/assets/reveal — reveal a file/folder in the system explorer
  if (url.pathname === "/api/assets/reveal" && method === "POST") {
    const { assetPath } = body || {};

    const config = getProjectConfig();
    const inputDir = config.inputPath || path.join(PROJECT_ROOT, "1Example/input");
    const assetsDir = path.join(inputDir, "assets");
    const resolved = assetPath
      ? path.resolve(path.join(assetsDir, assetPath))
      : path.resolve(assetsDir);

    if (resolved !== path.resolve(assetsDir) && !resolved.startsWith(path.resolve(assetsDir))) {
      return jsonResponse({ error: "Access denied" }, 403);
    }

    if (!fs.existsSync(resolved)) {
      return jsonResponse({ error: "File not found" }, 404);
    }

    try {
      const plat = process.platform;
      let cmd, args;
      if (plat === "win32") {
        cmd = "explorer";
        args = [`/select,${resolved}`];
      } else if (plat === "darwin") {
        cmd = "open";
        args = ["-R", resolved];
      } else {
        cmd = "xdg-open";
        args = [path.dirname(resolved)];
      }
      const child = spawn(cmd, args, {
        stdio: "ignore",
        detached: true,
      });
      child.unref();
      return jsonResponse({ success: true, path: resolved });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  // GET /api/config — get parsed config
  if (url.pathname === "/api/config" && method === "GET") {
    const config = getProjectConfig();
    return jsonResponse(config);
  }

  // POST /api/shutdown — gracefully stop the server
  if (url.pathname === "/api/shutdown" && method === "POST") {
    // Don't await — let the response return first
    setTimeout(() => shutdownServer(), 100);
    return jsonResponse({ success: true, message: "Server shutting down..." });
  }

  // ─── Static files ──────────────────────────────────────────────────────────

  // Serve files from the project's output directory (built documentation)
  if (url.pathname.startsWith("/output/")) {
    const config = getProjectConfig();
    const outputDir = config.outputPath || path.join(PROJECT_ROOT, "1Example/output");
    let relativePath = url.pathname.replace(/^\/output\//, "");
    // Default to index.html when accessing just /output/
    if (!relativePath) relativePath = "index.html";
    const outputFilePath = path.join(outputDir, relativePath);
    if (fs.existsSync(outputFilePath)) {
      const ext = path.extname(outputFilePath);
      const content = fs.readFileSync(outputFilePath);
      return new Response(content, {
        headers: {
          "Content-Type": getMime(ext),
          "Cache-Control": "no-cache",
        },
      });
    }
    // Fallback: try index.html inside subdirectories (e.g. /output/pages/something/)
    const fallbackIndex = path.join(outputFilePath, "index.html");
    if (fs.existsSync(fallbackIndex)) {
      const content = fs.readFileSync(fallbackIndex);
      return new Response(content, {
        headers: {
          "Content-Type": "text/html",
          "Cache-Control": "no-cache",
        },
      });
    }
  }

  // Serve files from intAssets/ directory (project root)
  if (url.pathname.startsWith("/intAssets/")) {
    const intAssetPath = path.join(PROJECT_ROOT, url.pathname.slice(1));
    if (fs.existsSync(intAssetPath)) {
      const ext = path.extname(intAssetPath);
      const content = fs.readFileSync(intAssetPath);
      return new Response(content, {
        headers: {
          "Content-Type": getMime(ext),
          "Cache-Control": "no-cache",
        },
      });
    }
  }

  // Serve files from intAssets/icons/ directory
  if (url.pathname.startsWith("/icons/")) {
    const relativePath = url.pathname.replace(/^\//, "");
    const iconPath = path.join(PROJECT_ROOT, "intAssets", relativePath);
    if (fs.existsSync(iconPath)) {
      const ext = path.extname(iconPath);
      const content = fs.readFileSync(iconPath);
      return new Response(content, {
        headers: {
          "Content-Type": getMime(ext),
          "Cache-Control": "no-cache",
        },
      });
    }
  }

  // Serve asset files from the project's input assets directory
  // (so preview can load images, videos, audio, etc.)
  if (url.pathname.startsWith("/assets/")) {
    const config = getProjectConfig();
    const inputDir = config.inputPath || path.join(PROJECT_ROOT, "1Example/input");
    // Strip leading "/" to avoid path.join treating it as absolute on Windows
    const relativePath = url.pathname.replace(/^\//, "");
    const assetPath = path.join(inputDir, relativePath);
    if (fs.existsSync(assetPath)) {
      const ext = path.extname(assetPath);
      const content = fs.readFileSync(assetPath);
      return new Response(content, {
        headers: {
          "Content-Type": getMime(ext),
          "Cache-Control": "no-cache",
        },
      });
    }
    // Fallback: try the output assets directory
    const outputDir = config.outputPath || path.join(PROJECT_ROOT, "1Example/output");
    const outputAssetPath = path.join(outputDir, relativePath);
    if (fs.existsSync(outputAssetPath)) {
      const ext = path.extname(outputAssetPath);
      const content = fs.readFileSync(outputAssetPath);
      return new Response(content, {
        headers: {
          "Content-Type": getMime(ext),
          "Cache-Control": "no-cache",
        },
      });
    }
  }

  // Serve static files from public/
  let filePath = path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname);
  
  // If the path doesn't exist, serve index.html (SPA fallback)
  if (!fs.existsSync(filePath)) {
    filePath = path.join(PUBLIC_DIR, "index.html");
  }

  try {
    const ext = path.extname(filePath);
    const content = fs.readFileSync(filePath);
    return new Response(content, {
      headers: {
        "Content-Type": getMime(ext),
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    return new Response("Not found", { status: 404 });
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

let serverInstance = null;
let isShuttingDown = false;

async function shutdownServer() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log("\n⏳ Shutting down server...");

  try {
    if (serverInstance) {
      if (typeof Bun !== "undefined" && serverInstance && typeof serverInstance.stop === "function") {
        serverInstance.stop();
      } else if (serverInstance && typeof serverInstance.close === "function") {
        await new Promise((resolve) => serverInstance.close(resolve));
      }
    }
  } catch (e) {
    console.error("Error during shutdown:", e.message);
  }

  console.log("👋 Server stopped. Goodbye!");
  process.exit(0);
}

// Handle SIGINT (Ctrl+C) and SIGTERM
process.on("SIGINT", async () => {
  console.log("\n\n⚠️  Received shutdown signal.");
  await shutdownServer();
});
process.on("SIGTERM", async () => {
  console.log("\n\n⚠️  Received termination signal.");
  await shutdownServer();
});

// ─── Start server ────────────────────────────────────────────────────────────

const BOX_W = 42;
const rpad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));

const projectRootDisplay = path.basename(PROJECT_ROOT) || ".";

console.log(
  '\n' +
  '╔' + '═'.repeat(BOX_W) + '╗\n' +
  '║' + rpad('         MMX Visual Editor', BOX_W) + '║\n' +
  '║' + rpad('', BOX_W) + '║\n' +
  '║' + rpad('  Running on http://localhost:' + PORT, BOX_W) + '║\n' +
  '║' + rpad('  Project root: ' + projectRootDisplay, BOX_W) + '║\n' +
  '║' + rpad('  Stop:         Ctrl+C or /api/shutdown', BOX_W) + '║\n' +
  '╚' + '═'.repeat(BOX_W) + '╝\n'
);

if (typeof Bun !== "undefined") {
  // Bun
  serverInstance = Bun.serve({
    port: PORT,
    fetch: handleRequest,
  });
  console.log(`  Bun server started on http://localhost:${PORT}`);
} else {
  // Node.js
  const http = await import("http");
  serverInstance = http.createServer(async (req, res) => {
    // Collect body for POST/PUT
    let body = null;
    if (req.method === "POST" || req.method === "PUT") {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const rawBody = Buffer.concat(chunks).toString("utf-8");
      try {
        body = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        body = null;
      }
    }

    // Create a minimal Request-like object
    const wrappedReq = {
      url: `http://${req.headers.host || "localhost:3031"}${req.url}`,
      method: req.method,
      headers: req.headers,
      json: async () => body,
    };

    try {
      const response = await handleRequest(wrappedReq);
      const status = response.status || 200;
      const headers = response.headers || {};
      const responseBody = await response.text();
      res.writeHead(status, Object.fromEntries(headers));
      res.end(responseBody);
    } catch (e) {
      console.error("Server error:", e);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  serverInstance.listen(PORT, () => {
    console.log(`  Node.js server listening on http://localhost:${PORT}`);
  });
}
