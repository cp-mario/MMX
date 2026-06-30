/**
 * MMX Documentation Generator — Library module
 *
 * Exported functions used by cli.js (the `mmx` command).
 * This module does NOT run any CLI logic when imported.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { mmxToHtml } from "./scripts/parser.js";
import { parseMCFG } from "./scripts/MCFGParser.js";
import { minifyJs } from "./scripts/minifiers/minifyJs.js";
import { minifyCss } from "./scripts/minifiers/minifyCss.js";
import { toKebabCase, normalizePageHref } from "./scripts/kebabCase.js";
import { collectSearchEntries, writeSearchIndex } from "./scripts/searchIndexBuilder.js";


//General config (populated by CLI)
export let CONFIG = { minifyScripts: true, minifyCss: true }

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cache template once at module level (from the module directory, not CWD)
const TEMPLATE = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf-8');

// Project-level caches (populated once per project)
const projectCache = new Map();

/**
 * Get or create cached project data (config + title image) for a project directory.
 * @param {string} projectDir - Absolute path to project root
 * @returns {Object} Cached project data
 */
function getProjectCache(projectDir) {
  if (projectCache.has(projectDir)) return projectCache.get(projectDir);
  const configPath = path.join(projectDir, "config.mcfg");
  const data = { configData: null, titleImageHtml: "", defaultCodeHighlight: false };
  if (fs.existsSync(configPath)) {
    try {
      data.configData = parseMCFG(fs.readFileSync(configPath, "utf8"));
    } catch (e) { /* ignore */ }
  }
  if (data.configData) {
    if (data.configData.title) data.title = data.configData.title;
    if (data.configData.version) data.version = data.configData.version;
    if (data.configData.lang) data.lang = data.configData.lang;
    if (data.configData.defaultCodeHighlight === true) data.defaultCodeHighlight = true;
    if (data.configData.sidebarBottomText !== undefined) data.sidebarBottomText = data.configData.sidebarBottomText;
    if (data.configData.noDefaultIndex === true) data.noDefaultIndex = true;
  }
  const assetsDir = path.join(projectDir, "assets");
  if (fs.existsSync(assetsDir)) {
    const files = fs.readdirSync(assetsDir);
    const titleImageFile = files.find(f =>
      f.toLowerCase().startsWith("title.") &&
      !fs.statSync(path.join(assetsDir, f)).isDirectory()
    );
    if (titleImageFile && data.configData) {
      data.titleImageHtml = `<img src="assets/${titleImageFile}" alt="${data.configData.title}" id="sidebar-title-image">`;
      data.titleImageFile = titleImageFile;
    }
  }
  projectCache.set(projectDir, data);
  return data;
}

/**
 * Recursively scans directory and builds JSON tree for navigation menu
 * @param {string} sourceDir - Directory to scan
 * @param {string} rootDir - Root directory for relative paths
 * @returns {Array} Tree structure with folders and files
 */
function generateIndexRecursive(sourceDir, rootDir) {
  const items = fs.readdirSync(sourceDir);
  const result = [];

  for (const item of items) {
    const fullPath = path.join(sourceDir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      result.push({
        type: "folder",
        name: item,
        path: toKebabCase(path.relative(rootDir, fullPath)),
        children: generateIndexRecursive(fullPath, rootDir)
      });
    } else if (item.endsWith('.mmx') && !item.startsWith('__') && item.toLowerCase() !== 'indextext.mmx') {
      // Skip internal/temp .mmx files (e.g. auto-generated __index.mmx)
      // and `indexText.mmx`, which is a special companion file consumed
      // by the folder-index generator (see generateFolderIndexPages)
      // and never rendered as its own page.
      const relativePath = path.relative(rootDir, fullPath);
      const safePath = toKebabCase(relativePath).replace(/\.mmx$/i, '.html');
      result.push({
        type: "file",
        name: item.replace(/\.mmx$/i, ""),
        path: safePath
      });
    }
  }

  // Sort: files first (alphabetical), then folders (alphabetical).
  // Within each group, sort by the user-visible name (case-insensitive)
  // so the sidebar order is stable and predictable regardless of the
  // underlying filesystem's readdir order (which is OS-dependent).
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "file" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return result;
}

/**
 * Builds a nested HTML list (<ul><li>...) with links to every file and
 * subfolder inside `dir`, recursively. Used to populate the auto-generated
 * `index.html` for each folder under pages/.
 *
 * Files become links to the kebab-case HTML. Subfolders become links to
 * the subfolder's own `index.html` (which is also auto-generated), and
 * the subfolder's children are nested inside the same <li> to reflect
 * the on-disk hierarchy.
 *
 * Uses raw HTML in the output (target="_self" + relative hrefs) so the
 * MMX parser leaves it untouched and `applyPathPrefix` does not rewrite
 * internal navigation links.
 *
 * IMPORTANT: all hrefs in the generated list are relative to the OUTPUT ROOT
 * (e.g., "pages/multimedia/audios.html"). The `applyPathPrefix` function
 * will prepend the calculated prefix (e.g., "../.././") when the page is
 * rendered, so the final href becomes "../.././pages/multimedia/audios.html"
 * which correctly resolves from any page depth.
 *
 * @param {string} dir - Absolute path to the folder being listed
 * @param {string} baseHref - Path from output root to this folder (e.g., "pages/multimedia/"), with trailing slash.
 * @param {string} [relDir] - Kebab-case relative path from the top-level
 *   folder being indexed to `dir`, with a trailing slash. Defaults to "".
 *   Used internally by recursive calls.
 * @returns {string} HTML fragment with the nested list
 */
function buildFolderListHtml(dir, baseHref, relDir = "") {
  const items = fs.readdirSync(dir);

  // Partition into folders and .mmx files, skipping our own temp index
  const subfolders = [];
  const files = [];
  for (const item of items) {
    // Don't list our own auto-generated index file, and don't list
    // `indexText.mmx` either — it's a companion file for the folder
    // description, never a navigable page of its own.
    if (item.toLowerCase() === '__index.mmx') continue;
    if (item.toLowerCase() === 'indextext.mmx') continue;
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      subfolders.push(item);
    } else if (item.endsWith('.mmx')) {
      files.push(item);
    }
  }

  // Case-insensitive alphabetical sort using the original (display) name
  const sortByName = (a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' });
  subfolders.sort(sortByName);
  files.sort(sortByName);

  if (subfolders.length === 0 && files.length === 0) {
    return '<p><em>Empty folder.</em></p>';
  }

  const lines = ['<ul class="folder-list">'];

  // Icons for the auto-generated folder index. The actual SVG is defined
  // once in `intAssets/style.css` and rendered as a CSS background-image,
  // so we don't pay the ~500 bytes of inline-SVG markup per <li> (which
  // multiplies fast in deeply nested or wide lists). The <span> is the
  // same size as the previous SVG (16x16) so the layout is unchanged.
  const fileIconSpan = '<span class="folder-list-icon folder-list-icon-file" aria-hidden="true"></span>';
  const folderIconSpan = '<span class="folder-list-icon folder-list-icon-folder" aria-hidden="true"></span>';

  // Files first (alphabetical), then folders (alphabetical), each
  // folder recursively nests its own list inside its <li>.
  // Files: link text is the file name without the .mmx extension.
  // The href is prefixed with baseHref + relDir so it's relative to the output root.
  // applyPathPrefix will later prepend the calculated prefix (e.g., "../.././").
  for (const file of files) {
    const baseName = file.replace(/\.mmx$/i, '');
    const href = baseHref + relDir + toKebabCase(file).replace(/\.mmx$/i, '.html');
    lines.push(`<li class="folder-list-item folder-list-file">${fileIconSpan} <a target="_self" href="${href}">${baseName}</a></li>`);
  }

  // Folders after files, with children nested in the same <li>.
  // The child call gets a `relDir` that appends this folder's kebab
  // name (with trailing slash) so every nested href includes the
  // chain of intermediate folders. baseHref is passed through unchanged.
  for (const folder of subfolders) {
    const kebab = toKebabCase(folder);
    const childRelDir = relDir + kebab + "/";
    const childHtml = buildFolderListHtml(path.join(dir, folder), baseHref, childRelDir);
    const folderHref = baseHref + childRelDir;
    lines.push(`<li class="folder-list-item folder-list-folder">${folderIconSpan} <a target="_self" href="${folderHref}">${folder}</a>`);
    lines.push(childHtml);
    lines.push('</li>');
  }

  lines.push('</ul>');
  return lines.join('\n');
}

/**
 * Walks the pages source directory and creates a temporary `__index.mmx`
 * inside every subfolder (recursively). The content is:
 *
 *     # {OriginalFolderName}
 *
 *     <optional user-provided description from `indexText.mmx`>
 *     <hr class="folder-index-divider">
 *     <nested list of children>
 *
 * The pipeline then picks up these files just like any other .mmx and
 * converts them to `index.html` in the output (kebab-case of `__index.mmx`
 * is `index.mmx`, which becomes `index.html`).
 *
 * The auto-generated index is skipped when the user already has a manual
 * `index.mmx` (case-insensitive) in the folder, so users can still
 * provide their own landing page for a folder.
 *
 * If the folder contains a companion file named `indexText.mmx`
 * (case-insensitive), its compiled HTML is inserted between the H1
 * (the folder name) and the auto-generated nested list. This is the
 * recommended way to add a textual description / introduction to a
 * folder without having to write a full manual `index.mmx`. The file
 * is never rendered as a standalone page and does not appear in the
 * sidebar or the search index — see `buildFolderListHtml` and
 * `collectFiles` for the matching skip rules.
 *
 * Per-folder index overrides (read from the FIRST LINE of `indexText.mmx`):
 *   `#noDefaultIndex` -> hide the auto-generated directory list for this folder
 *   `#defaultIndex`   -> show the auto-generated directory list for this folder
 * The per-folder directive (if any) always wins over the project-wide
 * `noDefaultIndex` config option (the `configDefaultNoIndex` arg).
 *
 * The temp files are deleted by `cleanupFolderIndexPages` after the
 * build finishes, so the source dir is left untouched.
 *
 * @param {string} pagesSourceDir - Absolute path to the project's `pages/` dir
 * @param {boolean} [configDefaultNoIndex] - Project-wide default from
 *   `config.mcfg`'s `noDefaultIndex` key. `true` means folders don't show
 *   the auto-generated directory list unless they opt back in with
 *   `#defaultIndex` in `indexText.mmx`. Defaults to `false`.
 * @returns {string[]} List of temp `__index.mmx` paths created (for cleanup)
 */
function generateFolderIndexPages(pagesSourceDir, configDefaultNoIndex = false) {
  const tempFiles = [];

  function processFolder(dir) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir);

    // Recurse into subfolders FIRST. The recursion must happen even when
    // this folder has a user-provided `index.mmx` — the user override is
    // per-folder, not per-tree, so subfolders still need their own
    // auto-generated `index.html`. (The previous version returned early
    // before reaching the recursion, which silently broke navigation
    // for any folder that mixed a custom `index.mmx` with subfolders.)
    for (const item of items) {
      const fullPath = path.join(dir, item);
      let stat;
      try { stat = fs.statSync(fullPath); } catch { continue; }
      if (stat.isDirectory()) {
        processFolder(fullPath);
      }
    }

    // Respect a user-provided `index.mmx` (case-insensitive). If the user
    // has written their own landing page for this folder, do NOT overwrite
    // it with the auto-generated one. Subfolders above are already done.
    const hasUserIndex = items.some(item => item.toLowerCase() === 'index.mmx');
    if (hasUserIndex) return;

    // Look for the optional companion file `indexText.mmx`. When present,
    // parse it with the same MMX pipeline used for regular pages so the
    // user can use the full MMX feature set (lists, tables, images, code
    // blocks, etc.) in their folder description. The parsed output is
    // wrapped in a `<div class="folder-index-text">` so it can be styled
    // distinctly from the auto-generated list that follows it.
    const indexTextItem = items.find(item => item.toLowerCase() === 'indextext.mmx');
    let descriptionHtml = "";
    // Per-folder override for "should we emit the auto-generated directory
    // list for this folder?". `null` means "no per-folder directive was
    // found, fall back to the project-wide config default". A boolean
    // value (true/false) means the per-folder directive wins.
    let perFolderOverride = null;
    if (indexTextItem) {
      const indexTextPath = path.join(dir, indexTextItem);
      try {
        let rawMmx = fs.readFileSync(indexTextPath, "utf-8");

        // The first non-blank line of `indexText.mmx` may carry a single
        // directive token that controls whether the auto-generated
        // directory list is shown for this folder:
        //   `#noDefaultIndex` -> hide the index in this folder
        //   `#defaultIndex`   -> show the index in this folder
        // We match case-insensitively on either a token by itself on a
        // line or a token followed by a space + comment (anything after
        // the directive on the same line is treated as a comment and
        // discarded). The directive is stripped from the content before
        // the rest of the file is passed to `mmxToHtml`, so it never
        // shows up in the rendered page.
        const lines = rawMmx.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (!trimmed) continue;
          const lower = trimmed.toLowerCase();
          if (lower === '#nodefaultindex' || lower.startsWith('#nodefaultindex ')) {
            perFolderOverride = true; // hide the index
            lines.splice(i, 1);
          } else if (lower === '#defaultindex' || lower.startsWith('#defaultindex ')) {
            perFolderOverride = false; // show the index
            lines.splice(i, 1);
          }
          // First non-blank line handled (whether it was a directive or
          // not), so we stop scanning. If it was not a directive the
          // file is left untouched and the fallback to the project
          // default applies.
          break;
        }
        rawMmx = lines.join('\n');

        // Skip emitting the description block entirely when the
        // companion file is empty (or contained only a directive). An
        // empty wrapper would otherwise create a visible gap before the
        // auto-generated list.
        if (rawMmx.trim().length > 0) {
          descriptionHtml = `<div class="folder-index-text">\n${mmxToHtml(rawMmx)}\n</div>`;
        }
      } catch (e) {
        // Failing to parse the description should not break the whole
        // build; log a warning and fall back to no description.
        console.warn(`Could not read/parse ${indexTextPath}: ${e.message}`);
      }
    }

    // Resolve the final `showIndex` decision for this folder:
    //   - per-folder directive (if present) wins;
    //   - otherwise fall back to the project-wide `noDefaultIndex` config
    //     option (inverted: `noDefaultIndex = true` -> `showIndex = false`).
    const showIndex = perFolderOverride !== null
      ? !perFolderOverride
      : !configDefaultNoIndex;

    // Write a temp `__index.mmx` with the folder name as H1 and the
    // nested list as the body. The H1 is needed for the <title>, the
    // heading-link button, and the search index title extraction.
    const folderName = path.basename(dir);
    
    // Calculate baseHref: path from output root to this folder (e.g., "pages/multimedia/")
    // This is the relative path from pagesSourceDir to dir, prefixed with "pages/", kebab-cased.
    const relFromPagesSource = path.relative(pagesSourceDir, dir);
    const baseHref = relFromPagesSource
      ? "pages/" + relFromPagesSource.split(path.sep).map(toKebabCase).join("/") + "/"
      : "pages/";
    
    const listHtml = showIndex ? buildFolderListHtml(dir, baseHref) : "";

    // Build the body. When the auto-generated index is suppressed we
    // emit only the H1 + (optional) description, with no divider and
    // no directory list, so the folder reads as a normal description
    // page. When the index is shown we slot the description between
    // the H1 and the list, separated by an `<hr class="folder-index-divider">`
    // so the user content is visually distinct from the auto-generated
    // directory list that follows. The list is always preceded by an
    // `<h2 class="folder-index-heading">Index</h2>` so it has a clear,
    // consistent title (and a dedicated anchor target for links).
    let content;
    if (showIndex) {
      const indexHeading = '<h2 class="folder-index-heading" id="index">Index</h2>';
      if (descriptionHtml) {
        content = `# ${folderName}\n\n${descriptionHtml}\n\n<hr class="folder-index-divider">\n\n${indexHeading}\n\n${listHtml}\n`;
      } else {
        content = `# ${folderName}\n\n${indexHeading}\n\n${listHtml}\n`;
      }
    } else {
      // Index suppressed. Emit ONLY the folder name and (optionally)
      // the description, with no divider and no directory list.
      if (descriptionHtml) {
        content = `# ${folderName}\n\n${descriptionHtml}\n`;
      } else {
        content = `# ${folderName}\n`;
      }
    }

    const tempPath = path.join(dir, '__index.mmx');
    fs.writeFileSync(tempPath, content, 'utf-8');
    tempFiles.push(tempPath);
  }

  if (!fs.existsSync(pagesSourceDir)) return tempFiles;

  // Only enter subfolders of pages/ (not pages/ itself).
  for (const item of fs.readdirSync(pagesSourceDir)) {
    const fullPath = path.join(pagesSourceDir, item);
    let stat;
    try { stat = fs.statSync(fullPath); } catch { continue; }
    if (stat.isDirectory()) {
      processFolder(fullPath);
    }
  }

  return tempFiles;
}

/**
 * Removes the temp `__index.mmx` files created by
 * `generateFolderIndexPages`. Best-effort: a missing file is fine.
 *
 * @param {string[]} files - Paths returned by `generateFolderIndexPages`
 */
function cleanupFolderIndexPages(files) {
  for (const f of files) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
}

/**
 * Static HTML used for `pages/index.html` in the output. When a user
 * navigates to the bare `pages/` URL (e.g. clicking the sidebar title
 * when already inside `pages/`, or following a stale link), this page
 * strips the trailing `/pages` (and anything after it) and redirects
 * back to the project root.
 *
 * The redirect is intentionally client-side: when the site is served
 * from a sub-path (e.g. `https://example.com/docs/pages/`), stripping
 * the suffix in the browser is the only way to land on the correct
 * absolute URL without knowing the deployment prefix at build time.
 */
const PAGES_INDEX_REDIRECT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Redirecting...</title>
    {{favicon}}
</head>
<body>

<div class="container">
    <h2>Redirecting you...</h2>
    <p>If you are not redirected automatically, click <a href="#" id="manualRedirect">here</a>.</p>
</div>

<script>
    (function() {
        const currentUrl = window.location.href;

        // Regex to match '/pages' at the end, optionally followed by '/' and anything else
        // Matches: /pages, /pages/, /pages/something, /pages/something/more
        const regex = /\\/pages(\\/.*)?$/;

        if (regex.test(currentUrl)) {
            // Remove the matched part
            const newUrl = currentUrl.replace(regex, '');

            // Redirect
            window.location.replace(newUrl);
        }
    })();

    // Manual link logic
    document.getElementById('manualRedirect').addEventListener('click', function(e) {
        e.preventDefault();
        const currentUrl = window.location.href;
        const regex = /\\/pages(\\/.*)?$/;

        if (regex.test(currentUrl)) {
            const newUrl = currentUrl.replace(regex, '');
            window.location.href = newUrl;
        }
    });
</script>

</body>
</html>
`;

/**
 * Writes a small redirect page at `pages/index.html` in the output.
 * This catches the case where a user lands on the bare `pages/` URL
 * (e.g. via a stale link or the file:// scheme showing the folder
 * listing) and sends them back to the project root.
 *
 * Skipped silently when the output `pages/` dir doesn't exist or
 * when the user has already placed a custom `index.html` next to the
 * generated folder indexes (unlikely, but the build is non-destructive
 * here so we don't clobber user content).
 *
 * @param {string} pagesDestDir - Absolute path to the output `pages/` dir
 */
function generatePagesIndexHtml(pagesDestDir, favicon = "") {
  if (!fs.existsSync(pagesDestDir)) return;
  const target = path.join(pagesDestDir, 'index.html');
  // Don't overwrite a user-provided pages/index.html that came in via
  // a non-.mmx file in the source (the copy step in processPagesRecursive
  // would have placed it here). We only write when no file exists yet.
  if (fs.existsSync(target)) return;
  const html = PAGES_INDEX_REDIRECT_HTML.replace("{{favicon}}", favicon);
  fs.writeFileSync(target, html, 'utf-8');
}

/**
 * Generates sitemap.xml with relative URLs
 * @param {string} pagesDir - Directory containing HTML files
 * @param {string} outputDir - Output directory for sitemap
 */
function generateSitemap(pagesDir, outputDir) {
  const urls = [];
  
  function scanDirectory(dir, prefix = "./") {
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        scanDirectory(fullPath, prefix + item + "/");
      } else if (item.endsWith(".html") && item !== "index.html") {
        const url = prefix + item;
        urls.push(url);
      }
    }
  }
  
  if (fs.existsSync(pagesDir)) {
    scanDirectory(pagesDir);
  }
  
  // Sort URLs alphabetically
  urls.sort();
  
  // Generate sitemap XML with relative URLs
  let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;
  
  // Add root index.html
  sitemap += `  <url>
    <loc>./index.html</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
`;
  
  for (const url of urls) {
    sitemap += `  <url>
    <loc>${url}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
`;
  }
  
  sitemap += `</urlset>`;
  
  const sitemapPath = path.join(outputDir, "sitemap.xml");
  fs.writeFileSync(sitemapPath, sitemap, "utf8");
  return urls.length + 1;
}

/**
 * Main orchestrator for processing documentation project
 * @param {string} sourceDir - Input directory with .mmx files
 * @param {string} outputDir - Output directory for generated HTML
 * @param {Object} options - Configuration options
 */
export function processProjectStructure(sourceDir, outputDir, options = {}) {
  const { deleteOriginals = false, verbose = true } = options;
  const log = (msg) => verbose && console.log(msg);

  log(`\nProcessing project: ${sourceDir}`);
  log(`Output: ${outputDir}\n`);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const stats = { processed: 0, errors: 0, copied: 0 };

  // Copy internal assets
  const intAssetsSource = path.join(__dirname, "intAssets");
  const intAssetsDest = path.join(outputDir, "intAssets");

  if (fs.existsSync(intAssetsSource)) {
    // Insert MCFGParser into script.js at runtime
    const scriptJsSource = path.join(intAssetsSource, "script.js");
    const mcfgParserSource = path.join(__dirname, "scripts", "MCFGParser.js");
    
    if (fs.existsSync(scriptJsSource) && fs.existsSync(mcfgParserSource)) {
      let scriptContent = fs.readFileSync(scriptJsSource, 'utf-8');
      let parserContent = fs.readFileSync(mcfgParserSource, 'utf-8');
      
      // Remove export keyword from MCFGParser
      parserContent = parserContent.replace(/export\s+(function|const|let|var)/g, '$1');
      
      // Extract just the function/mcgparser content (remove comments at the start)
      const functionMatch = parserContent.match(/\/\*\*[\s\S]*?\*\/\s*(function\s+parseMCFG\([\s\S]*?)$/);
      if (functionMatch) {
        parserContent = functionMatch[1];
      }
      
      // Insert at //MCFGParser line
      scriptContent = scriptContent.replace('//MCFGParser', parserContent);
      
      // Then minify if configured
      if (CONFIG.minifyScripts) {
        scriptContent = minifyJs(scriptContent);
      }
      
      // Write the modified script.js
      if (!fs.existsSync(intAssetsDest)) {
        fs.mkdirSync(intAssetsDest, { recursive: true });
      }
      fs.writeFileSync(path.join(intAssetsDest, "script.js"), scriptContent, 'utf-8');
      log(`script.js copied${CONFIG.minifyScripts ? ' (minified)' : ''}`);
    }
    
    // Copy rest of intAssets (excluding script.js which we handled)
    const items = fs.readdirSync(intAssetsSource);
    for (const item of items) {
      if (item === 'script.js') continue; // Already handled
      
      const srcPath = path.join(intAssetsSource, item);
      const destPath = path.join(intAssetsDest, item);
      const stat = fs.statSync(srcPath);
      
      if (stat.isDirectory()) {
        copyDirectoryRecursive(srcPath, destPath);
      } else if (item.endsWith('.js') && CONFIG.minifyScripts) {
        const original = fs.readFileSync(srcPath, 'utf-8');
        const minified = minifyJs(original);
        fs.writeFileSync(destPath, minified, 'utf-8');
      } else if (item.endsWith('.css') && CONFIG.minifyCss) {
        const original = fs.readFileSync(srcPath, 'utf-8');
        const minified = minifyCss(original);
        fs.writeFileSync(destPath, minified, 'utf-8');
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
    log(`intAssets/ copied`);
  }

  // Copy project assets
  const assetsSource = path.join(sourceDir, 'assets');
  if (fs.existsSync(assetsSource)) {
    copyDirectoryRecursive(assetsSource, path.join(outputDir, 'assets'));
    log(`assets/ copied`);
  }

  // Detect and copy theme icon (icon.*) to output
  let iconFile = null;
  const themeDir = path.join(sourceDir, 'theme');
  if (fs.existsSync(themeDir)) {
    const themeFiles = fs.readdirSync(themeDir);
    iconFile = themeFiles.find(f => f.toLowerCase().startsWith('icon.') && !fs.statSync(path.join(themeDir, f)).isDirectory());
  }
  if (!iconFile && fs.existsSync(sourceDir)) {
    const rootFiles = fs.readdirSync(sourceDir);
    iconFile = rootFiles.find(f => f.toLowerCase().startsWith('icon.') && !fs.statSync(path.join(sourceDir, f)).isDirectory());
  }
  if (iconFile) {
    const iconSource = path.join(themeDir, iconFile);
    const iconDest = path.join(outputDir, iconFile);
    fs.copyFileSync(iconSource, iconDest);
    log(`  Copied theme icon: ${iconFile}`);
    // Store icon filename in project cache for favicon injection
    const pdata = getProjectCache(sourceDir);
    pdata.iconFile = iconFile;
  }

  // Generate favicon HTML for template injection
  const faviconHTML = iconFile
    ? `<link rel="icon" href="${iconFile}">`
    : "";

  // Process pages directory
  const pagesSource = path.join(sourceDir, 'pages');
  const pagesDest = path.join(outputDir, 'pages');
  if (!fs.existsSync(pagesDest)) fs.mkdirSync(pagesDest, { recursive: true });

  // Generate auto `index.html` for every subfolder of pages/ (recursively).
  // We do this BEFORE `processPagesRecursive` so the synthetic `__index.mmx`
  // files are picked up by the normal pipeline (and therefore also end up
  // in the search index, sitemap, etc.). They are deleted at the end.
  // The project-level `noDefaultIndex` config option (boolean) is the
  // default for every folder; individual `indexText.mmx` files can
  // override that with `#noDefaultIndex` or `#defaultIndex` on their
  // first line. See `generateFolderIndexPages` for the full resolution
  // rules.
  const projectData = getProjectCache(sourceDir);
  const configDefaultNoIndex = !!(projectData && projectData.noDefaultIndex);
  const tempIndexFiles = generateFolderIndexPages(pagesSource, configDefaultNoIndex);

  processPagesRecursive(pagesSource, pagesDest, stats, { deleteOriginals, log, outputRoot: outputDir, favicon: faviconHTML });

  // Remove the temp `__index.mmx` files from the source dir so they
  // don't pollute the user's project after the build.
  cleanupFolderIndexPages(tempIndexFiles);

  // Write a small redirect page at `pages/index.html` so anyone who
  // lands on the bare `pages/` URL gets sent back to the project root.
  generatePagesIndexHtml(pagesDest, faviconHTML);

  // Process root index.mmx
  const rootIndexMmx = path.join(sourceDir, "index.mmx");
  if (fs.existsSync(rootIndexMmx)) {
    const rootIndexHtml = path.join(outputDir, "index.html");
    log(`index.mmx → index.html`);
    convertMmxFile(rootIndexMmx, rootIndexHtml, outputDir, faviconHTML);
    stats.processed++;
  }


  // Generate index.json for navigation (in intAssets)
  const indexData = generateIndexRecursive(pagesSource, pagesSource);
  const indexPath = path.join(outputDir, "intAssets", "index.json");
  fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), "utf8");
  log(`Generated index: intAssets/index.json`);

  // Generate search-index.json (powers the sidebar search box)
  // Includes: index page + all .mmx pages with title, path, headings, plain-text body
  // Build logic lives in scripts/searchIndexBuilder.js
  const searchEntries = collectSearchEntries(pagesSource, rootIndexMmx);
  writeSearchIndex(outputDir, searchEntries);
  log(`Generated search index: intAssets/search-index.json (${searchEntries.length} entries)`);

  // Generate sitemap.xml with relative URLs
  const sitemapCount = generateSitemap(pagesDest, outputDir);
  log(`Generated sitemap.xml with ${sitemapCount} URLs`);

  log(`\nSummary:`);
  log(`Converted: ${stats.processed}`);
  log(`Copied: ${stats.copied}`);
  log(`Minified scripts: ${CONFIG.minifyScripts}`)
  if (stats.errors >= 1){
    log(`\x1b[41mErrors: ${stats.errors}\x1b[0m`);
  }else{
    console.log("\x1b[42mThere have been no errors\x1b[0m")
  }
  
  log(`Process completed\n`);
}

/**
 * Recursively copies directory structure
 * @param {string} source - Source directory
 * @param {string} destination - Destination directory
 */
function copyDirectoryRecursive(source, destination) {
  if (!fs.existsSync(destination)) fs.mkdirSync(destination, { recursive: true });
  
  const items = fs.readdirSync(source);
  
  for (const item of items) {
    const srcPath = path.join(source, item);
    const destPath = path.join(destination, item);
    const stat = fs.statSync(srcPath);
    
    if (stat.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath);
    } else if (item.endsWith('.js') && CONFIG.minifyScripts) {
      // Minify JS files
      const original = fs.readFileSync(srcPath, 'utf-8');
      const minified = minifyJs(original);
      fs.writeFileSync(destPath, minified, 'utf-8');
    } else if (item.endsWith('.css') && CONFIG.minifyCss) {
      // Minify CSS files
      const original = fs.readFileSync(srcPath, 'utf-8');
      const minified = minifyCss(original);
      fs.writeFileSync(destPath, minified, 'utf-8');
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Collects all files to process without doing heavy work.
 * Returns { mmxFiles: [{srcPath, destPath, relItem}], dirs: [destPath], others: [{srcPath, destPath}] }
 *
 * `indexText.mmx` (case-insensitive) is intentionally skipped — it is
 * a special companion file for folder descriptions, consumed by
 * `generateFolderIndexPages`. It must never be rendered as its own
 * page (`index-text.html`), listed in the sidebar, or added to the
 * search index.
 */
function collectFiles(sourceDir, outputDir) {
  const mmxFiles = [], dirs = new Set(), others = [];
  function walk(src, dest) {
    const items = fs.readdirSync(src);
    for (const item of items) {
      const srcPath = path.join(src, item);
      const stat = fs.statSync(srcPath);
      // Skip the special companion file used by the folder-index generator
      if (stat.isFile() && item.toLowerCase() === 'indextext.mmx') continue;
      const safeItem = stat.isDirectory()
        ? toKebabCase(item)
        : item.endsWith('.mmx')
          ? toKebabCase(item)
          : item;
      const destPath = path.join(dest, safeItem);

      if (stat.isDirectory()) {
        dirs.add(destPath);
        walk(srcPath, destPath);
      } else if (item.endsWith('.mmx')) {
        const htmlName = safeItem.replace(/\.mmx$/i, '.html');
        mmxFiles.push({ srcPath, destPath: path.join(dest, htmlName), relItem: item });
      } else {
        others.push({ srcPath, destPath });
      }
    }
  }
  walk(sourceDir, outputDir);
  return { mmxFiles, dirs: [...dirs], others };
}

/**
 * Recursively processes .mmx files in pages directory using parallel batches
 * @param {string} sourceDir - Source pages directory
 * @param {string} outputDir - Destination pages directory
 * @param {Object} stats - Statistics object
 * @param {Object} options - Configuration options
 */
function processPagesRecursive(sourceDir, outputDir, stats, options) {
  const { deleteOriginals = false, log, outputRoot, favicon } = options;

  // Phase 1: collect all work
  const { mmxFiles, dirs, others } = collectFiles(sourceDir, outputDir);

  // Phase 2: create all directories
  for (const d of dirs) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }

  // Phase 3: copy non-mmx files (fast, no parsing)
  for (const { srcPath, destPath } of others) {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    stats.copied++;
  }

  // Phase 4: process .mmx files in parallel batches
  const BATCH_SIZE = 32;
  for (let i = 0; i < mmxFiles.length; i += BATCH_SIZE) {
    const batch = mmxFiles.slice(i, i + BATCH_SIZE);
    const results = batch.map(({ srcPath, destPath, relItem }) => {
      try {
        const htmlName = path.basename(destPath);
        log(`${relItem} → ${htmlName}`);
        convertMmxFile(srcPath, destPath, outputRoot, favicon);
        if (deleteOriginals) fs.unlinkSync(srcPath);
        return { ok: true };
      } catch (error) {
        return { ok: false, error, relItem };
      }
    });
    for (const r of results) {
      if (r.ok) stats.processed++;
      else {
        console.error(`Error processing ${r.relItem}: ${r.error.message}`);
        stats.errors++;
      }
    }
  }
}

/**
 * Calculates relative path prefix for asset references based on file depth
 * @param {string} outputPath - Output HTML file path
 * @param {string} outputRoot - Root output directory
 * @returns {string} Relative path prefix (e.g., "./" or "../../")
 */
function calculatePrefix(outputPath, outputRoot) {
  const normalizedOutput = path.normalize(outputPath);
  const normalizedRoot = path.normalize(outputRoot);
  const fileDir = path.dirname(normalizedOutput);
  const relativeDir = path.relative(normalizedRoot, fileDir);
  
  if (!relativeDir || relativeDir === '.' || relativeDir.startsWith('..')) {
    return './';
  }
  
  const depth = relativeDir.split(path.sep).filter(p => p && p !== '/').length;
  return '../'.repeat(depth) + './';
}

/**
 * Applies path prefixes to relative asset references in HTML
 * @param {string} html - HTML content
 * @param {string} prefix - Relative path prefix
 * @returns {string} HTML with corrected paths
 */
/**
 * Prefixes all recognised asset/page URLs in HTML with a relative path prefix.
 * Handles:
 *  - src="assets/..." → src="<prefix>assets/..."
 *  - src="intAssets/..." → src="<prefix>intAssets/..."
 *  - href="pages/..." → href="<prefix>pages/..." (normalised via normalizePageHref)
 *  - href="assets/..." → href="<prefix>assets/..."
 *  - path="assets/..." → path="<prefix>assets/..."
 *  - Any other relative href/src (bare filename like "index.html", "archive.html")
 *    that does NOT start with http, https, //, #, /, data:, mailto:, tel:, ./, ../
 *    → <prefix>
 *
 * @param {string} html - HTML content
 * @param {string} prefix - Relative path prefix (e.g. "./" or "../../")
 * @returns {string} HTML with corrected paths
 */
function applyPathPrefix(html, prefix) {
  const normalizedHtml = html.replace(/(href=)(["'])([^"']*pages\/[^"']+)\2/g, (match, pfx, quote, href) => {
    return `${pfx}${quote}${normalizePageHref(href)}${quote}`;
  });

  let result = normalizedHtml
    .replace(/(src=["'])(assets\/[^"']+)/g, `$1${prefix}$2`)
    .replace(/(src=["'])(intAssets\/[^"']+)/g, `$1${prefix}$2`)
    .replace(/<a\s+target="_blank"\s+href=["'](pages\/[^"']+)["']/g,
      `<a target="_self" href="${prefix}$1"`)
    .replace(/<a\s+target="_blank"\s+href=["'](#[^"']+)["']/g,
      `<a target="_self" href="$1"`)
    .replace(/<a\s+target="_blank"\s+href=["'](assets\/[^"']+)["']/g,
      `<a target="_self" href="${prefix}$1"`)
    .replace(/(href=["'])(pages\/[^"']+)/g, `$1${prefix}$2`)
    .replace(/(href=["'])(assets\/[^"']+)/g, `$1${prefix}$2`)
    .replace(/(path=["'])(assets\/[^"']+)/g, `$1${prefix}$2`);

  // Prefix any remaining relative href/src/path values that are bare filenames
  // (not starting with http, https, //, #, /, data:, mailto:, tel:, ./, ../)
  // This ensures nav/footer links like href="index.html" get the correct prefix.
  result = result.replace(
    /(\b(?:href|src|path)=["'])(?!https?:\/\/|\/\/|#|\/|data:|mailto:|tel:|\.\/|\.\.\/)([^"']+)/g,
    `$1${prefix}$2`
  );

  return result;
}

/**
 * Detects if content contains any images, audios, videos, or code with auto flag
 * @param {string} mmxContent - Raw MMX content
 * @returns {Object} Object with anyImage, anyAudio, anyVideo, anyCodeAuto booleans
 */
function detectMediaContent(mmxContent) {
  // Image pattern: ![alt](path) [classes]
  const imageRegex = /!\[([^\]]*)\]\([^)]+\)/;
  // Audio pattern: !!!( path ) [classes]
  const audioRegex = /!{3}\([^)]+\)/;
  // Video pattern: !!( path ) [classes]
  const videoRegex = /!{2}\([^)]+\)/;
  // Code with auto flag: #code(path) auto
  const codeAutoRegex = /#code\([^)]+\)\s+auto/;
  // Code block with auto tag: :::code auto or :::code(auto)
  const codeBlockAutoRegex = /:::code[^\n]*auto/;

  return {
    anyImage: imageRegex.test(mmxContent),
    anyAudio: audioRegex.test(mmxContent),
    anyVideo: videoRegex.test(mmxContent),
    anyCodeAuto: codeAutoRegex.test(mmxContent) || codeBlockAutoRegex.test(mmxContent)
  };
}

/**
 * When the project sets `defaultCodeHighlight = true` in its config.mcfg,
 * apply the `auto` class to every code block / directive that did not opt
 * out with `noAuto`. This makes highlight.js the project-wide default while
 * still allowing per-block opt-out. The transformation is purely textual so
 * it works on raw .mmx content before the parser runs.
 *
 *   :::code                  ->  :::code auto
 *   :::code auto             ->  :::code auto          (unchanged)
 *   :::code noAuto           ->  :::code noAuto        (unchanged)
 *   #code(path)              ->  #code(path) auto
 *   #code(path) auto         ->  #code(path) auto      (unchanged)
 *   #code(path) noAuto       ->  #code(path) noAuto    (unchanged)
 *
 * @param {string} mmxContent - Raw .mmx content
 * @returns {string} Content with `auto` injected where appropriate
 */
function applyDefaultCodeHighlight(mmxContent) {
  // Handle multi-line `:::code ... :::` blocks. We rewrite only the opening
  // line so the body of the block is left untouched. If the opening line
  // already contains a class token, we only inject `auto` when neither
  // `auto` nor `noAuto` is already present.
  const lines = mmxContent.split('\n');
  const out = [];
  let insideCode = false;

  for (const line of lines) {
    if (!insideCode && /^:::code(\s|$)/.test(line)) {
      // Opening line of a :::code block
      const tokens = line.trim().split(/\s+/).slice(1).filter(Boolean);
      const hasAuto = tokens.includes('auto');
      const hasNoauto = tokens.includes('noAuto');
      if (!hasAuto && !hasNoauto) {
        out.push(`${line.trimEnd()} auto`);
      } else {
        out.push(line);
      }
      insideCode = true;
    } else if (insideCode && /^:::\s*$/.test(line)) {
      // Closing line of a :::code block
      out.push(line);
      insideCode = false;
    } else {
      out.push(line);
    }
  }

  let result = out.join('\n');

  // Handle `#code(path) [flags]` directives. Only the trailing class list
  // is rewritten, the path is left as-is.
  result = result.replace(
    /^#code\((.+?)\)(?:\s+([\w\s]+))?\s*$/gm,
    (match, _path, flags) => {
      const tokens = flags ? flags.trim().split(/\s+/).filter(Boolean) : [];
      const hasAuto = tokens.includes('auto');
      const hasNoauto = tokens.includes('noAuto');
      if (hasAuto || hasNoauto) return match;
      return `${match.trimEnd()} auto`;
    }
  );

  return result;
}

/**
 * Converts single .mmx file to HTML
 * @param {string} inputPath - .mmx input file path
 * @param {string} outputPath - HTML output file path
 * @param {string} outputRoot - Root directory for path calculations
 */
function convertMmxFile(inputPath, outputPath, outputRoot, favicon = "") {
  const content = fs.readFileSync(inputPath, "utf8");

  // Resolve project directory once via cache
  const inputDir = path.dirname(inputPath);
  const pagesPos = inputDir.lastIndexOf(path.sep + "pages");
  const projectDir = pagesPos !== -1 ? inputDir.slice(0, pagesPos) : inputDir;
  const pdata = getProjectCache(projectDir);

  const headerTitle = content.match(/^# (.+)$/m)?.[1] || "Documentation";
  const configTitle = pdata.title || "";
  const pageTitle = configTitle || headerTitle;
  const version = pdata.version || "";
  const lang = pdata.lang || "en";

  let processedContent = content;
  if (pdata.defaultCodeHighlight) {
    processedContent = applyDefaultCodeHighlight(processedContent);
  }

  const htmlContent = mmxToHtml(processedContent);
  const media = detectMediaContent(processedContent);
  const title = configTitle ? `${headerTitle} - ${configTitle}` : headerTitle;
  const prefix = calculatePrefix(outputPath, outputRoot);

  // titleImageHtml already includes raw "assets/" path; prefix will be prepended
  // by applyPathPrefix for href/src attributes, but img src is an attribute itself
  // so we need to inject the prefix into the already-cached src string
  let titleImageWithPrefix = "";
  if (pdata.titleImageHtml) {
    titleImageWithPrefix = pdata.titleImageHtml.replace(
      'src="assets/',
      `src="${prefix}assets/`
    );
  }

  let playerCSS = "", playerJS = "";
  if (media.anyVideo || media.anyAudio) {
    playerCSS = `<link rel="stylesheet" href="${prefix}intAssets/player/playerStyle.css"/>`;
    playerJS = `<script src="${prefix}intAssets/player/playerScript.js"></script>`;
  }

  let imageZoom = "";
  if (media.anyImage) {
    imageZoom = `<script src="${prefix}intAssets/imageZoom.js"></script>`;
  }

  // The folder-index icon stylesheet is only useful for pages that
  // actually contain the auto-generated folder list. We detect that by
  // looking for the `folder-list` class in the rendered HTML and only
  // inject the <link> (which in turn pulls in the two icon SVG files)
  // on those pages. Everything else skips the stylesheet and the SVGs
  // entirely, which is the whole point of this optimization — regular
  // pages should not pay for assets they never use.
  const hasFolderList = htmlContent.includes('class="folder-list"');
  const folderIndexIcons = hasFolderList
    ? `<link rel="stylesheet" href="${prefix}intAssets/folderIndexIcons.css">`
    : "";

  const searchScript = `<script src="${prefix}intAssets/search/search.js"></script>`;

  let highlightJS = "", highlightCSSTheme = "";
  if (media.anyCodeAuto) {
    highlightJS = '<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js"></script>';
    highlightCSSTheme = '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github-dark.min.css">';
  }

  const sidebarTitle = titleImageWithPrefix ? titleImageWithPrefix : pageTitle;
  const sidebarBottomText = pdata.sidebarBottomText ?? "";

  let finalTemplate = TEMPLATE
    .replaceAll("{{title}}", title)
    .replaceAll("{{pageTitle}}", pageTitle)
    .replaceAll("{{sidebarTitle}}", sidebarTitle)
    .replaceAll("{{version}}", version)
    .replaceAll("{{content}}", htmlContent)
    .replaceAll("{{prefix}}", prefix)
    .replaceAll("{{lang}}", lang)
    .replaceAll("{{playerCSS}}", playerCSS)
    .replaceAll("{{playerJS}}", playerJS)
    .replaceAll("{{imageZoom}}", imageZoom)
    .replaceAll("{{folderIndexIcons}}", folderIndexIcons)
    .replaceAll("{{searchScript}}", searchScript)
    .replaceAll("{{highlightJS}}", highlightJS)
    .replaceAll("{{highlightCSSTheme}}", highlightCSSTheme)
    .replaceAll("{{sidebarBottomText}}", sidebarBottomText)
    .replaceAll("{{favicon}}", favicon);

  finalTemplate = applyPathPrefix(finalTemplate, prefix);

  fs.writeFileSync(outputPath, finalTemplate, "utf8");
}

/**
 * Clear a directory's contents recursively.
 * @param {string} dirPath
 */
export function clearOutputDir(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  for (const file of fs.readdirSync(dirPath)) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(fullPath);
    }
  }
}

/**
 * Extracts a date from a filename following common blog conventions:
 *   YYYY-MM-DD-title.mmx   →   { year, month, day, label: "YYYY-MM-DD" }
 * Falls back to the file's mtime date when the name has no date prefix.
 * @param {string} fileName
 * @param {string} filePath
 * @returns {{ year: string, month: string, day: string, label: string, ts: number }}
 */
function extractPostDate(fileName, filePath) {
  const match = fileName.match(/^(\d{4})-(\d{2})-(\d{2})-/);
  if (match) {
    const [, y, m, d] = match;
    return { year: y, month: m, day: d, label: `${y}-${m}-${d}`, ts: new Date(y, m - 1, d).getTime() };
  }
  const stat = fs.statSync(filePath);
  const d = stat.mtime;
  const y = d.getFullYear().toString();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return { year: y, month: m, day, label: `${y}-${m}-${day}`, ts: d.getTime() };
}

/**
 * Reads all .mmx files from a flat folder, converts each to a blog post,
 * and generates:
 *   - index.html  → blog home with chronological list of posts
 *   - post-slug.html → individual post pages
 *
 * By default only rebuilds posts whose source .mmx is newer than the
 * existing .html output (incremental build). Use `{ force: true }` to
 * rebuild everything.
 *
 * @param {string} postsDir    - Folder containing .mmx files (one per post)
 * @param {string} outputDir   - Where to write the generated blog
 * @param {{ force?: boolean }} [options]
 */
export function buildBlog(postsDir, outputDir, options = {}) {
  const log = (msg) => console.log(msg);
  log(`\nBuilding blog from: ${postsDir}`);
  log(`Output: ${outputDir}\n`);

  if (!fs.existsSync(postsDir)) {
    console.error(`Error: Blog posts folder not found: ${postsDir}`);
    process.exit(1);
  }

  const { force } = options;
  if (force) {
    // Full rebuild: wipe the output dir first
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    } else {
      clearOutputDir(outputDir);
    }
  } else {
    // Incremental: ensure the output dir exists but don't delete anything
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  // ── Resolve project root ─────────────────────────────────────────────
  // When the user runs `mmx blog ./src`, shared files (config, nav, footer, etc.)
  // can live inside ./src/, in ./theme/, or in the project root.
  // Detect if postsDir IS the project root (has theme/ or config.mcfg) or a
  // subdirectory (like src/).
  const projectRoot = (
    fs.existsSync(path.join(postsDir, "theme")) ||
    fs.existsSync(path.join(postsDir, "config.mcfg"))
  ) ? postsDir : path.resolve(postsDir, "..");

  /**
   * Resolve a blog asset file by checking in order:
   *   1. postsDir (e.g. ./src/)
   *   2. projectRoot/theme/  (e.g. ./theme/)
   *   3. projectRoot         (e.g. ./)
   * Returns the file content if found, or null otherwise.
   * @param {string} filename
   * @returns {string|null}
   */
  function resolveAsset(filename) {
    const local = path.join(postsDir, filename);
    if (fs.existsSync(local)) return fs.readFileSync(local, "utf-8");
    const theme = path.join(projectRoot, "theme", filename);
    if (fs.existsSync(theme)) return fs.readFileSync(theme, "utf-8");
    const parent = path.join(projectRoot, filename);
    if (fs.existsSync(parent)) return fs.readFileSync(parent, "utf-8");
    return null;
  }

  // ── Read config.mcfg ────────────────────────────────────────────────
  let sourceConfig = null;
  const configRaw = resolveAsset("config.mcfg");
  if (configRaw) {
    try {
      sourceConfig = parseMCFG(configRaw);
    } catch (e) {
      console.warn(`Warning: Could not parse config.mcfg: ${e.message}`);
    }
  }

  const blogTitle = sourceConfig?.title || "Blog";
  const defaultLang = sourceConfig?.lang || "en";
  const blogDescription = sourceConfig?.description || "";
  const blogAuthor = sourceConfig?.author || "";
  const blogKeywords = sourceConfig?.keywords || "";
  const blogBaseUrl = sourceConfig?.baseUrl || "";
  const blogOgImage = sourceConfig?.ogImage || "";
  const blogTwitterCreator = sourceConfig?.twitterCreator || "";

  // Build SEO meta tags
  const seoMeta = buildSeoMetaTags({
    description: blogDescription,
    author: blogAuthor,
    keywords: blogKeywords,
    baseUrl: blogBaseUrl,
    ogImage: blogOgImage,
    twitterCreator: blogTwitterCreator,
  });

  // ── Read nav.html, footer.html, styles.css (from either location) ───
  let navHtml = "", footerHtml = "", customCSS = "";
  const navRaw = resolveAsset("nav.html");
  if (navRaw) { navHtml = navRaw; log(`  Using nav.html`); }

  const footerRaw = resolveAsset("footer.html");
  if (footerRaw) { footerHtml = footerRaw; log(`  Using footer.html`); }

  const cssRaw = resolveAsset("styles.css");
  if (cssRaw) { customCSS = cssRaw; log(`  Using styles.css`); }

  // Detect and copy theme icon (icon.*) to output
  let iconFile = null;
  const themeDir = path.join(projectRoot, 'theme');
  if (fs.existsSync(themeDir)) {
    const themeFiles = fs.readdirSync(themeDir);
    iconFile = themeFiles.find(f => f.toLowerCase().startsWith('icon.') && !fs.statSync(path.join(themeDir, f)).isDirectory());
  }
  if (!iconFile && fs.existsSync(projectRoot)) {
    const rootFiles = fs.readdirSync(projectRoot);
    iconFile = rootFiles.find(f => f.toLowerCase().startsWith('icon.') && !fs.statSync(path.join(projectRoot, f)).isDirectory());
  }
  if (iconFile) {
    const iconSource = fs.existsSync(path.join(themeDir, iconFile)) 
      ? path.join(themeDir, iconFile) 
      : path.join(projectRoot, iconFile);
    const iconDest = path.join(outputDir, iconFile);
    fs.copyFileSync(iconSource, iconDest);
    log(`  Copied theme icon: ${iconFile}`);
  }

  // Generate favicon HTML for template injection
  const faviconHTML = iconFile
    ? `<link rel="icon" href="${iconFile}">`
    : "";

  // ── Check for optional index.html or index.mmx (user-provided blog home) ─
  let indexContentRaw = null;
  let indexContentHtml = null;
  let indexIsHtml = false;
  let indexLang = defaultLang;

  // Prefer index.html over index.mmx (served as-is)
  const indexHtmlPath = path.join(postsDir, "index.html");
  const indexMmxPath = path.join(postsDir, "index.mmx");

  if (fs.existsSync(indexHtmlPath)) {
    indexIsHtml = true;
    log(`  Using index.html (copied as-is)`);
  } else if (fs.existsSync(indexMmxPath)) {
    indexContentRaw = fs.readFileSync(indexMmxPath, "utf-8");
    // Detect per-file lang in index.mmx too
    const langResult = extractPerFileLang(indexContentRaw);
    indexContentRaw = langResult.content;
    indexLang = langResult.lang || defaultLang;
    // Parse to HTML
    indexContentHtml = mmxToHtml(indexContentRaw);
    log(`  Using index.mmx`);
  }

  // Read, parse, and convert every .mmx file (skip companion files and index.mmx)
  const posts = [];
  const files = fs.readdirSync(postsDir).filter(f =>
    f.endsWith('.mmx') &&
    f.toLowerCase() !== 'indextext.mmx' &&
    f.toLowerCase() !== 'index.mmx' &&
    !f.startsWith('__')
  );

  for (const file of files) {
    const srcPath = path.join(postsDir, file);
    let raw = fs.readFileSync(srcPath, 'utf-8');

    // Detect per-file language: first line can be `#lang: <code>`
    const langResult = extractPerFileLang(raw);
    raw = langResult.content;
    const fileLang = langResult.lang || defaultLang;

    const title = raw.match(/^# (.+)$/m)?.[1] || path.basename(file, '.mmx');

    // Extract first paragraph as excerpt
    const firstPara = raw
      .replace(/^# .+/m, '')           // remove title
      .replace(/^:::.*$/gm, '')         // strip block directives
      .replace(/^\[.*?\]\(.*?\)/gm, '') // strip reference-style lines
      .trim()
      .split(/\n\s*\n/)[0]             // first block
      ?.replace(/\*\*(.+?)\*\*/g, '$1') // strip bold markers
      .replace(/\*(.+?)\*/g, '$1')      // strip italic markers
      .trim() || '';

    const htmlContent = mmxToHtml(raw);
    const date = extractPostDate(file, srcPath);

    // Build filename for the output page (kebab-case)
    let slug = file
      .replace(/\.mmx$/i, '')
      .replace(/^\d{4}-\d{2}-\d{2}-/, '')  // strip date prefix for the slug
      .replace(/\s+/g, '-')
      .toLowerCase();

    // Append language code to filename if it differs from blog default
    if (fileLang && fileLang !== defaultLang) {
      slug += '.' + fileLang;
    }

    // Build page title: blog title - post title
    const pageTitle = blogTitle ? `${blogTitle} - ${title}` : title;

    posts.push({
      title,
      pageTitle,
      slug: slug + '.html',
      date,
      content: htmlContent,
      excerpt: firstPara,
      srcPath,
      lang: fileLang,
    });
  }

  // Sort posts newest-first by date
  posts.sort((a, b) => b.date.ts - a.date.ts);

  // ── Read & prepare assets (same as cli.js) ──────────────
  const intAssetsDir = path.join(__dirname, "intAssets");
  let styleCSS        = fs.readFileSync(path.join(intAssetsDir, "style.css"), "utf-8");
  let styleSidebarCSS = fs.readFileSync(path.join(intAssetsDir, "styleSidebar.css"), "utf-8");
  let scriptJS        = fs.readFileSync(path.join(intAssetsDir, "script.js"), "utf-8");

  // Inject MCFGParser
  const mcfgParserPath = path.join(__dirname, "scripts", "MCFGParser.js");
  if (fs.existsSync(mcfgParserPath)) {
    let pc = fs.readFileSync(mcfgParserPath, "utf-8");
    pc = pc.replace(/export\s+(function|const|let|var)/g, '$1');
    const m = pc.match(/\/\*\*[\s\S]*?\*\/\s*(function\s+parseMCFG\([\s\S]*?)$/);
    if (m) pc = m[1];
    scriptJS = scriptJS.replace('//MCFGParser', pc);
  }

  // Strip redirectIndexHtml from scriptJS (it breaks relative URLs in blog pages
  // by redirecting /output/index.html → /output without trailing slash)
  scriptJS = scriptJS.replace(/\(\s*function\s+redirectIndexHtml\s*\([\s\S]*?\}\s*\)\s*\(\s*\)\s*;?\s*/g, '');

  if (CONFIG.minifyScripts) scriptJS = minifyJs(scriptJS);
  if (CONFIG.minifyCss) { styleCSS = minifyCss(styleCSS); styleSidebarCSS = minifyCss(styleSidebarCSS); }

  // ── Detect media needs across all posts so we include the right bundles ──
  const anyImage    = posts.some(p => /!\[([^\]]*)\]\([^)]+\)/.test(p.content));
  const anyAudio    = posts.some(p => /!{3}\([^)]+\)/.test(p.content));
  const anyVideo    = posts.some(p => /!{2}\([^)]+\)/.test(p.content));
  const anyCodeAuto = posts.some(p => /auto/.test(p.content));
  let imageZoomJS = "", playerCSS = "", playerJS = "", highlightJS = "", highlightCSS = "";
  if (anyImage)    imageZoomJS = fs.readFileSync(path.join(intAssetsDir, "imageZoom.js"), "utf-8");
  if (anyAudio || anyVideo) {
    playerCSS = fs.readFileSync(path.join(intAssetsDir, "player", "playerStyle.css"), "utf-8");
    playerJS  = fs.readFileSync(path.join(intAssetsDir, "player", "playerScript.js"), "utf-8");
  }
  if (anyCodeAuto) {
    highlightJS  = '<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js"></script>';
    highlightCSS = '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github-dark.min.css">';
  }
  if (CONFIG.minifyScripts) { if (imageZoomJS) imageZoomJS = minifyJs(imageZoomJS); if (playerJS) playerJS = minifyJs(playerJS); }
  if (CONFIG.minifyCss) { if (playerCSS) playerCSS = minifyCss(playerCSS); }

  // If customCSS is present, optionally minify it
  if (customCSS && CONFIG.minifyCss) {
    customCSS = minifyCss(customCSS);
  }

  // ── Render each post page (incremental: skip if output is newer) ──
  let built = 0, skipped = 0;
  for (const post of posts) {
    const outPath = path.join(outputDir, post.slug);

    // Check if the output is already up to date
    if (!force && fs.existsSync(outPath)) {
      const srcMtime = fs.statSync(post.srcPath).mtimeMs;
      const outMtime = fs.statSync(outPath).mtimeMs;
      if (outMtime >= srcMtime) {
        skipped++;
        continue;
      }
    }

    const postPrefix = calculatePrefix(outPath, outputDir);
    // Inject language badge next to title (inside <h1>)
    let postContent = post.content;
    if (post.lang) {
      const langBadge = `<span class="post-lang">${escapeHtml(post.lang)}</span>`;
      postContent = postContent.replace('</h1>', ` ${langBadge}</h1>`);
    }
    // Ensure .post-lang styling is available on individual post pages
    const postCss = customCSS + '\n.post-lang { display: inline-block; font-size: 0.65em; font-weight: 600; background: var(--link-color, #66b0ff); color: #fff; padding: 1px 5px; border-radius: 3px; vertical-align: middle; margin-left: 4px; text-transform: uppercase; letter-spacing: 0.5px; }';
    const pageHtml = buildStandaloneHtml({
      title: post.pageTitle,
      content: postContent,
      styleCSS, styleSidebarCSS, scriptJS,
      playerCSS, playerJS, imageZoomJS,
      highlightJS, highlightCSS,
      lang: post.lang,
      seoMeta,
      navHtml,
      footerHtml,
      customCSS: postCss,
      prefix: postPrefix,
      favicon: faviconHTML,
    });
    fs.writeFileSync(outPath, pageHtml, "utf-8");
    log(`  ${post.slug}  ← ${path.basename(post.srcPath)}`);
    built++;
  }

  // ── Render blog index ──────────────────────────────────
  if (indexIsHtml) {
    // index.html exists — copy it directly to output and inject favicon
    const srcIndexHtml = fs.readFileSync(indexHtmlPath, "utf-8");
    const faviconTag = faviconHTML ? `<link rel="icon" href="${iconFile}">` : "";
    const indexHtmlWithFavicon = srcIndexHtml.replace('</head>', `${faviconTag}\n</head>`);
    fs.writeFileSync(path.join(outputDir, "index.html"), indexHtmlWithFavicon, "utf-8");
    log(`  index.html  (copied with favicon)`);
  } else {
    // Generate index page (auto or from index.mmx)
    const showRecent = !!indexContentHtml; // limit post list when index.mmx is used
    const indexPrefix = calculatePrefix(path.join(outputDir, "index.html"), outputDir);
    const indexHtml = buildBlogIndexHtml({
      title: blogTitle,
      posts,
      styleCSS, styleSidebarCSS, scriptJS,
      playerCSS, playerJS, imageZoomJS,
      highlightJS, highlightCSS,
      seoMeta,
      navHtml,
      footerHtml,
      customCSS,
      indexContent: indexContentHtml,
      lang: indexLang,
      showRecent,
      prefix: indexPrefix,
      favicon: faviconHTML,
    });
    fs.writeFileSync(path.join(outputDir, "index.html"), indexHtml, "utf-8");

    // ── Render archive page (all posts) ─────────────────
    const archivePrefix = calculatePrefix(path.join(outputDir, "archive.html"), outputDir);
    const archiveHtml = buildBlogIndexHtml({
      title: `${blogTitle} - Archive`,
      posts,
      styleCSS, styleSidebarCSS, scriptJS,
      playerCSS, playerJS, imageZoomJS,
      highlightJS, highlightCSS,
      seoMeta,
      navHtml,
      footerHtml,
      customCSS,
      lang: defaultLang,
      isArchive: true,
      prefix: archivePrefix,
      favicon: faviconHTML,
    });
    fs.writeFileSync(path.join(outputDir, "archive.html"), archiveHtml, "utf-8");

    log(`  index.html  (${posts.length} posts)`);
    log(`  archive.html`);
  }

  const summary = built > 0 ? `${built} built` : "none built";
  const skipNote = skipped > 0 ? `, ${skipped} up to date` : "";
  log(`\nBlog generated in ${outputDir} (${summary}${skipNote})`);
}

/**
 * Extracts a per-file language directive from .mmx content.
 * If the first non-blank line matches `#lang: <code>`, the directive is
 * removed from the content and the language code is returned.
 *
 * @param {string} raw - Raw .mmx content
 * @returns {{ content: string, lang: string|null }} Cleaned content and extracted lang (or null)
 */
function extractPerFileLang(raw) {
  const lines = raw.split('\n');
  let lang = null;
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue; // skip blank lines

    const match = trimmed.match(/^#lang:\s*(\S+)/i);
    if (match) {
      lang = match[1];
      lines.splice(i, 1); // remove the directive line
      found = true;
    }
    break; // only check the first non-blank line
  }

  return { content: lines.join('\n'), lang };
}

/**
 * Builds an HTML string of SEO <meta> tags from a config object.
 *
 * @param {Object} cfg - SEO configuration
 * @param {string} [cfg.description]
 * @param {string} [cfg.author]
 * @param {string} [cfg.keywords]
 * @param {string} [cfg.baseUrl]
 * @param {string} [cfg.ogImage]
 * @param {string} [cfg.twitterCreator]
 * @returns {string} HTML meta tags (empty string if none provided)
 */
function buildSeoMetaTags(cfg) {
  if (!cfg) return "";
  const tags = [];
  const { description, author, keywords, baseUrl, ogImage, twitterCreator } = cfg;

  if (description) {
    tags.push(`  <meta name="description" content="${escapeHtml(description)}">`);
    tags.push(`  <meta property="og:description" content="${escapeHtml(description)}">`);
  }
  if (author) {
    tags.push(`  <meta name="author" content="${escapeHtml(author)}">`);
  }
  if (keywords) {
    tags.push(`  <meta name="keywords" content="${escapeHtml(keywords)}">`);
  }
  if (baseUrl) {
    tags.push(`  <link rel="canonical" href="${escapeHtml(baseUrl)}">`);
    tags.push(`  <meta property="og:url" content="${escapeHtml(baseUrl)}">`);
  }
  if (ogImage) {
    tags.push(`  <meta property="og:image" content="${escapeHtml(ogImage)}">`);
  }
  if (twitterCreator) {
    tags.push(`  <meta name="twitter:creator" content="@${escapeHtml(twitterCreator.replace(/^@/, ''))}">`);
  }

  // Add basic Open Graph / Twitter card defaults
  tags.push(`  <meta property="og:type" content="website">`);
  tags.push(`  <meta name="twitter:card" content="summary_large_image">`);

  return tags.join('\n');
}

// ─── init blog ─────────────────────────────────────────────────────────────

/**
 * Scaffolds a new blog project in the given directory by copying the
 * blog template files (templates/blog/) from the MMX installation folder.
 *
 * @param {string} targetDir - Absolute path where the blog project is created
 */
export function initBlog(targetDir) {
  const log = (msg) => console.log(msg);
  const templateDir = path.join(__dirname, "templates", "blog");

  if (!fs.existsSync(templateDir)) {
    console.error(`Error: Blog template not found at ${templateDir}`);
    process.exit(1);
  }

  log(`\nCreating blog project in: ${targetDir}\n`);

  // Copy template directory recursively (skips existing files)
  copyTemplateRecursive(templateDir, targetDir, log);

  log(`\nBlog project created successfully!\n`);
  log(`  cd ${targetDir}`);
  log(`  Customise theme/:  theme/config.mcfg  theme/nav.html  theme/footer.html  theme/styles.css`);
  log(`  Add posts in:      src/`);
  log(`  Build:             mmx blog ./src -o ./output`);
  log(`  Serve:             mmx serve ./output 8080\n`);
}

// ─── init doc ──────────────────────────────────────────────────────────────

/**
 * Scaffolds a new documentation project in the given directory by copying the
 * doc template files (templates/doc/) from the MMX installation folder.
 *
 * @param {string} targetDir - Absolute path where the doc project is created
 */
export function initDoc(targetDir) {
  const log = (msg) => console.log(msg);
  const templateDir = path.join(__dirname, "templates", "doc");

  if (!fs.existsSync(templateDir)) {
    console.error(`Error: Doc template not found at ${templateDir}`);
    process.exit(1);
  }

  log(`\nCreating documentation project in: ${targetDir}\n`);

  // Copy template directory recursively (skips existing files)
  copyTemplateRecursive(templateDir, targetDir, log);

  log(`\nDocumentation project created successfully!\n`);
  log(`  cd ${targetDir}`);
  log(`  mmx build . -o ./output`);
  log(`  mmx serve ./output 8080\n`);
}

/**
 * Recursively copies a source directory to a destination, creating
 * directories as needed. Logs each file created.
 *
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 * @param {function} log - Logging function
 */
function copyTemplateRecursive(src, dest, log) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const items = fs.readdirSync(src);
  for (const item of items) {
    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);
    const stat = fs.statSync(srcPath);

    if (stat.isDirectory()) {
      copyTemplateRecursive(srcPath, destPath, log);
    } else {
      if (fs.existsSync(destPath)) {
        log(`  Skipped (already exists): ${destPath}`);
      } else {
        fs.copyFileSync(srcPath, destPath);
        log(`  Created: ${destPath}`);
      }
    }
  }
}

/**
 * Builds a blog index HTML page listing all posts chronologically.
 * Uses the same CSS/JS inlining as standalone pages.
 */
function buildBlogIndexHtml({ title, posts, styleCSS, styleSidebarCSS, scriptJS, playerCSS, playerJS, imageZoomJS, highlightJS, highlightCSS, seoMeta = "", navHtml = "", footerHtml = "", customCSS = "", indexContent = null, lang = "en", showRecent = false, isArchive = false, prefix = "./", favicon = "" }) {
  // ── Render a single post preview ──────────────────────────
  const renderPost = (p) => {
    const dateLabel = p.date.label;
    const excerptHtml = p.excerpt ? `<p class="blog-excerpt">${escapeHtml(p.excerpt)}</p>` : '';
    const langBadge = p.lang ? ` <span class="post-lang">${escapeHtml(p.lang)}</span>` : '';
    return [
      '<article class="blog-post-preview">',
      `  <time datetime="${dateLabel}">${dateLabel}${langBadge}</time>`,
      `  <h2><a href="${prefix}${p.slug}">${escapeHtml(p.title)}</a></h2>`,
      excerptHtml,
      '</article>',
    ].join('\n');
  };

  const allPostItems = posts.map(p => renderPost(p)).join('\n');

  // ── Assemble main content according to mode ────────────────
  let mainContent = "";

  if (isArchive) {
    // Archive page: show all posts with search
    mainContent += `    <header class="blog-header">\n      <h1>${escapeHtml(title)}</h1>\n    </header>\n`;
    mainContent += [
      '    <div class="blog-search-wrap">',
      '      <input type="text" id="blog-search" placeholder="Search posts…" oninput="filterPosts(this.value)">',
      '    </div>',
    ].join('\n') + '\n';
    mainContent += allPostItems;

  } else if (showRecent && indexContent) {
    // Enhanced index with custom index.mmx: user content + search + recent + view all
    mainContent += `<div class="blog-index-user-content">\n${indexContent}\n</div>\n`;
    // Search bar
    mainContent += [
      '    <div class="blog-search-wrap">',
      '      <input type="text" id="blog-search" placeholder="Search posts…" oninput="filterPosts(this.value)">',
      '    </div>',
    ].join('\n');
    // Recent posts (up to 5)
    const recentPosts = posts.slice(0, 5).map(p => renderPost(p)).join('\n');
    mainContent += `    <div id="blog-recent-posts">\n${recentPosts}\n    </div>\n`;
    // View all button
    mainContent += [
      '    <div class="blog-view-all-wrap">',
      `      <button class="blog-view-all-btn" id="blog-view-all-btn" onclick="toggleAllPosts()">View all posts (${posts.length})</button>`,
      '    </div>',
    ].join('\n');
    // All posts (hidden initially)
    mainContent += `    <div class="blog-all-posts" id="blog-all-posts">\n${allPostItems}\n    </div>\n`;

  } else if (indexContent) {
    // index.mmx but no recent limit (fallback — should not normally happen)
    mainContent += `<div class="blog-index-user-content">\n${indexContent}\n</div>\n`;
    mainContent += allPostItems;

  } else {
    // Auto-generated index (no custom index file)
    mainContent += `    <header class="blog-header">\n      <h1>${escapeHtml(title)}</h1>\n    </header>\n`;
    mainContent += allPostItems;
  }

  const headParts = [
    '<!DOCTYPE html>',
    `<html lang="${lang}">`,
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `  <title>${escapeHtml(title)}</title>`,
    '  <script>',
    "    (function(){",
    "      var p=location.pathname;",
    "      var b=document.createElement('base');",
    "      if(p.endsWith('/')){b.href=p}else{b.href=p.substring(0,p.lastIndexOf('/')+1)}",
    "      document.head.appendChild(b);",
    "    })();",
    '  </script>',
    seoMeta,
    favicon ? `  ${favicon}` : '',
    '  <style>', styleCSS, '  </style>',
    '  <style>', styleSidebarCSS, '  </style>',
  ];
  if (playerCSS) headParts.push(`  <style>${playerCSS}</style>`);
  if (highlightCSS) headParts.push(highlightCSS);
  headParts.push(
    '  <style>',
    '    /* Blog index overrides */',
    '    *, *::before, *::after { box-sizing: border-box; }',
'    #sidebar, #icon-btn2, #sidebar-search { display: none !important; }',
    '    #header-navigator, #header-navigator-title, #header-navigator-toggle, #header-navigator-dropdown { display: none !important; }',
    '    main { max-width: 760px !important; width: 100%; margin: 0 auto !important; padding-inline: 24px !important; float: none !important; }',
    '    body { margin: 0; padding: 0; display: flex; flex-direction: column; min-height: 100vh; background: var(--bg-color, #000); color: var(--text-color, #fff); justify-content: flex-start; }',
    '    main { flex: 1; }',
    '    @media (max-width: 600px) { main { padding-inline: 14px !important; } }',
    '    pre, code, table { overflow-x: auto; max-width: 100%; }',
    '    code, .inline-code { background: #2a2a2a !important; color: #e0e0e0 !important; border-radius: 3px; padding-inline: 3px; }',
    '    .blog-post-preview { margin-bottom: 2.5em; padding-bottom: 1.5em; border-bottom: 1px solid var(--border-color); }',
    '    .blog-post-preview time { font-size: 0.85em; color: #999; display: block; margin-bottom: 0.2em; }',
    '    .blog-post-preview h2 { margin: 0 0 0.3em 0; }',
    '    .blog-post-preview h2 a { color: var(--text-color, #fff); text-decoration: none; }',
    '    .blog-post-preview h2 a:hover { text-decoration: underline; }',
    '    .blog-excerpt { margin: 0; color: #ccc; }',
    '    .blog-header { margin-bottom: 2em; }',
    '    .blog-header h1 { margin: 0; }',
    '    .blog-index-user-content { margin-bottom: 2em; }',
    '    .post-lang { display: inline-block; font-size: 0.7em; font-weight: 600; background: var(--link-color, #66b0ff); color: #fff; padding: 1px 5px; border-radius: 3px; vertical-align: middle; margin-left: 4px; text-transform: uppercase; letter-spacing: 0.5px; }',
    customCSS,
    '    /* Search bar */',
    '    #blog-search {',
    '      width: 100%; padding: 10px 14px; margin-bottom: 1.5rem;',
    '      background: var(--sidebar-bg, #111); color: var(--text-color, #fff);',
    '      border: 1px solid var(--border-color, #333); border-radius: 6px;',
    '      font-size: 1rem; outline: none; box-sizing: border-box;',
    '    }',
    '    #blog-search:focus { border-color: var(--link-color, #66b0ff); }',
    '    /* View all button */',
    '    .blog-view-all-btn {',
    '      display: inline-block; padding: 8px 20px; margin-top: 1rem;',
    '      background: var(--link-color, #66b0ff); color: #fff;',
    '      border: none; border-radius: 6px; font-size: 0.95rem;',
    '      cursor: pointer; transition: background 0.2s;',
    '    }',
    '    .blog-view-all-btn:hover { background: var(--link-hover-color, #99ccff); }',
    '    .blog-all-posts { display: none; margin-top: 2rem; }',
    '    .blog-all-posts.visible { display: block; }',
    '    .blog-view-all-wrap { text-align: center; }',
    '    .blog-search-wrap { margin-top: 1rem; }',
    '  </style>',
    '  <script>',
    '    function filterPosts(q) {',
    '      q = q.toLowerCase();',
    '      document.querySelectorAll(".blog-post-preview").forEach(el => {',
    '        const title = el.querySelector("h2 a")?.textContent?.toLowerCase() || "";',
    '        const excerpt = el.querySelector(".blog-excerpt")?.textContent?.toLowerCase() || "";',
    '        const time = el.querySelector("time")?.textContent?.toLowerCase() || "";',
    '        el.style.display = (title.includes(q) || excerpt.includes(q) || time.includes(q)) ? "" : "none";',
    '      });',
    '    }',
    '    function toggleAllPosts() {',
    '      const allPosts = document.getElementById("blog-all-posts");',
    '      const btn = document.getElementById("blog-view-all-btn");',
    '      if (!allPosts || !btn) return;',
    '      const isHidden = !allPosts.classList.contains("visible");',
    '      allPosts.classList.toggle("visible", isHidden);',
    '      btn.textContent = isHidden ? "Show less" : "View all posts (' + posts.length + ')";',
    '      // Reveal matching posts in the all-posts section',
    '      if (isHidden) {',
    '        const q = document.getElementById("blog-search")?.value || "";',
    '        if (q) filterPosts(q);',
    '      }',
    '    }',
    '  </script>',
    '</head>',
    '<body>',
    navHtml,
    '  <main>',
    mainContent,
    '  </main>',
    footerHtml,
    `  <script>const prefix="${prefix}";</script>`,
    `  <script>${scriptJS}</script>`,
  );
  if (imageZoomJS) headParts.push(`  <script>${imageZoomJS}</script>`);
  if (playerJS) headParts.push(`  <script>${playerJS}</script>`);
  if (highlightJS) headParts.push(highlightJS);
  headParts.push('</body>', '</html>');

  let html = headParts.join('\n');
  html = applyPathPrefix(html, prefix);
  return html;
}

/**
 * Escapes HTML special characters in a string.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Builds a standalone HTML page inlining all CSS and JS.
 * Reused for both cli.js-style pages and individual blog posts.
 */
function buildStandaloneHtml({ title, content, styleCSS, styleSidebarCSS, scriptJS, playerCSS, playerJS, imageZoomJS, highlightJS, highlightCSS, lang = "en", seoMeta = "", navHtml = "", footerHtml = "", customCSS = "", prefix = "./", favicon = "" }) {
  const headParts = [
    '<!DOCTYPE html>',
    `<html lang="${lang}">`,
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `  <title>${escapeHtml(title)}</title>`,
    '  <script>',
    "    (function(){",
    "      var p=location.pathname;",
    "      var b=document.createElement('base');",
    "      if(p.endsWith('/')){b.href=p}else{b.href=p.substring(0,p.lastIndexOf('/')+1)}",
    "      document.head.appendChild(b);",
    "    })();",
    '  </script>',
    seoMeta,
    '  <style>', styleCSS, '  </style>',
    '  <style>', styleSidebarCSS, '  </style>',
  ];
  if (favicon) headParts.push(`  ${favicon}`);
  if (highlightCSS) headParts.push(highlightCSS);
  if (playerCSS) headParts.push(`  <style>${playerCSS}</style>`);
  headParts.push(
    '  <style>',
    '    /* Standalone page: no sidebar → override sidebar-dependent rules */',
    '    *, *::before, *::after { box-sizing: border-box; }',
'    #sidebar, #icon-btn2, #sidebar-search { display: none !important; }',
    '    #header-navigator, #header-navigator-title, #header-navigator-toggle, #header-navigator-dropdown { display: none !important; }',
    '    main {',
    '      max-width: 860px !important;',
    '      width: 100%;',
    '      margin: 0 auto !important;',
    '      padding-inline: 24px !important;',
    '      float: none !important;',
    '    }',
    '    pre, code, table { overflow-x: auto; max-width: 100%; }',
    '    code, .inline-code { background: #2a2a2a !important; color: #e0e0e0 !important; border-radius: 3px; padding-inline: 3px; }',
    '    body { margin: 0; padding: 0; display: flex; flex-direction: column; min-height: 100vh; background: var(--bg-color, #000); color: var(--text-color, #fff); justify-content: flex-start; }',
    '    main { flex: 1; }',
    '    @media (max-width: 600px) {',
    '      main { padding-inline: 14px !important; }',
    '    }',
    customCSS,
    '  </style>',
    '</head>',
    '<body>',
    navHtml,
    '  <main>', content, '  </main>',
    footerHtml,
    `  <script>const prefix="${prefix}";</script>`,
    `  <script>${scriptJS}</script>`,
  );
  if (imageZoomJS) headParts.push(`  <script>${imageZoomJS}</script>`);
  if (playerJS) headParts.push(`  <script>${playerJS}</script>`);
  if (highlightJS) headParts.push(highlightJS);
  headParts.push('</body>', '</html>');
  let html = headParts.join('\n');
  html = applyPathPrefix(html, prefix);
  return html;
}

// ─── Page command: standalone HTML from a single .mmx file ──────────────

/**
 * Builds a standalone HTML page from a single .mmx file.
 *
 * @param {string} inputFile  Path to the .mmx source file
 * @param {string} outputFile Path for the generated .html file
 * @param {{ assetsPrefix?: string, minify?: boolean }} [options]
 */
export function buildStandalonePage(inputFile, outputFile, options = {}) {
  const { assetsPrefix = './assets', minify = true } = options;

  if (!fs.existsSync(inputFile)) {
    console.error(`Error: Input file not found: ${inputFile}`);
    process.exit(1);
  }

  // Read the source .mmx file
  const mmxContent = fs.readFileSync(inputFile, 'utf-8');

  // Extract title from the first H1 heading, or fall back to file name
  const headerTitle = mmxContent.match(/^# (.+)$/m)?.[1] || path.basename(inputFile, '.mmx');

  // Convert MMX to HTML
  const htmlContent = mmxToHtml(mmxContent);

  // Detect which media features are needed
  const media = detectMediaContent(mmxContent);

  // ── Read and inline all assets from intAssets/ ────────────────────────
  const intAssetsDir = path.join(__dirname, 'intAssets');

  let styleCSS        = fs.readFileSync(path.join(intAssetsDir, 'style.css'), 'utf-8');
  let styleSidebarCSS = fs.readFileSync(path.join(intAssetsDir, 'styleSidebar.css'), 'utf-8');
  let scriptJS        = fs.readFileSync(path.join(intAssetsDir, 'script.js'), 'utf-8');

  // Inject MCFGParser into script.js
  const mcfgParserPath = path.join(__dirname, 'scripts', 'MCFGParser.js');
  if (fs.existsSync(mcfgParserPath)) {
    let parserContent = fs.readFileSync(mcfgParserPath, 'utf-8');
    parserContent = parserContent.replace(/export\s+(function|const|let|var)/g, '$1');
    const functionMatch = parserContent.match(/\/\*\*[\s\S]*?\*\/\s*(function\s+parseMCFG\([\s\S]*?)$/);
    if (functionMatch) {
      parserContent = functionMatch[1];
    }
    scriptJS = scriptJS.replace('//MCFGParser', parserContent);
  }

  // Player assets (only included when the source uses audio/video)
  let playerCSS = '', playerJS = '';
  if (media.anyVideo || media.anyAudio) {
    playerCSS = fs.readFileSync(path.join(intAssetsDir, 'player', 'playerStyle.css'), 'utf-8');
    playerJS  = fs.readFileSync(path.join(intAssetsDir, 'player', 'playerScript.js'), 'utf-8');
  }

  // Image zoom (only included when the source uses images)
  let imageZoomJS = '';
  if (media.anyImage) {
    imageZoomJS = fs.readFileSync(path.join(intAssetsDir, 'imageZoom.js'), 'utf-8');
  }

  // highlight.js (only included when code blocks use the `auto` flag)
  let highlightJS = '', highlightCSS = '';
  if (media.anyCodeAuto) {
    highlightJS  = '<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js"></script>';
    highlightCSS = '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github-dark.min.css">';
  }

  // ── Optional minification ────────────────────────────────────────────
  if (minify) {
    styleCSS        = minifyCss(styleCSS);
    styleSidebarCSS = minifyCss(styleSidebarCSS);
    scriptJS        = minifyJs(scriptJS);
    if (playerCSS)  playerCSS  = minifyCss(playerCSS);
    if (playerJS)   playerJS   = minifyJs(playerJS);
    if (imageZoomJS) imageZoomJS = minifyJs(imageZoomJS);
  }

  // ── Assemble the final HTML using the existing buildStandaloneHtml ────
  const standaloneHtml = buildStandaloneHtml({
    title:        headerTitle,
    content:      htmlContent,
    styleCSS,
    styleSidebarCSS,
    scriptJS,
    playerCSS,
    playerJS,
    imageZoomJS,
    highlightJS,
    highlightCSS,
    lang: 'en',
  });

  // Rewrite asset references if a custom prefix was given
  let finalHtml = standaloneHtml;
  if (assetsPrefix && assetsPrefix !== './assets') {
    finalHtml = finalHtml.replace(/(src=["'])assets\//g, `$1${assetsPrefix.replace(/\/?$/, '/')}`);
    finalHtml = finalHtml.replace(/(href=["'])assets\//g, `$1${assetsPrefix.replace(/\/?$/, '/')}`);
    finalHtml = finalHtml.replace(/(path=["'])assets\//g, `$1${assetsPrefix.replace(/\/?$/, '/')}`);
  }

  // Write the output file, creating directories as needed
  const outputDir = path.dirname(outputFile);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(outputFile, finalHtml, 'utf-8');

  console.log(`Generated standalone page: ${outputFile}`);
  if (!minify) console.log('  (not minified)');
}

// ─── Editor command ───────────────────────────────────────────────────────

/**
 * Launches the MMX Visual Editor server.
 * Dynamically imports the editor module to avoid loading its dependencies
 * when not needed.
 *
 * @param {number} port
 */
export async function startEditor(port) {
  try {
    const { startServer } = await import('./editor/server.js');
    await startServer({ port: Number(port) });
  } catch (err) {
    console.error('Failed to start the editor server:', err.message);
    process.exit(1);
  }
}

// ─── Serve command ───────────────────────────────────────────────────────

/**
 * Serves a directory via a simple HTTP static file server.
 *
 * @param {string} dir  Absolute path to the directory to serve
 * @param {number} port Port to listen on
 */
export function startServe(dir, port) {
  port = Number(port) || 8080;

  if (!fs.existsSync(dir)) {
    console.error(`Error: Directory not found: ${dir}`);
    process.exit(1);
  }

  const mimeTypes = {
    '.html': 'text/html',
    '.css':  'text/css',
    '.js':   'application/javascript',
    '.json': 'application/json',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.webp': 'image/webp',
    '.mp4':  'video/mp4',
    '.webm': 'video/webm',
    '.mp3':  'audio/mpeg',
    '.wav':  'audio/wav',
    '.ogg':  'audio/ogg',
    '.pdf':  'application/pdf',
    '.zip':  'application/zip',
    '.xml':  'application/xml',
    '.txt':  'text/plain',
    '.woff': 'font/woff',
    '.woff2':'font/woff2',
    '.ttf':  'font/ttf',
  };

  const server = http.createServer((req, res) => {
    // Sanitize the URL to prevent directory traversal
    let url = req.url.split('?')[0];
    if (url.endsWith('/')) url += 'index.html';

    const filePath = path.join(dir, url);

    // Ensure the resolved path stays within the served directory
    if (!filePath.startsWith(dir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404);
          res.end('404 Not Found');
        } else {
          res.writeHead(500);
          res.end('Internal Server Error');
        }
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const mime = mimeTypes[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    });
  });

  server.listen(port, () => {
    console.log(`\n  Serving: ${dir}`);
    console.log(`  URL:     http://localhost:${port}\n`);
  });
}

