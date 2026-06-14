/**
 * MMX Documentation Generator
 * Converts .mmx files to HTML documentation
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


//General config
const CONFIG = parseMCFG(fs.readFileSync('./config.mcfg', 'utf-8'))

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cache template once at module level
const TEMPLATE = fs.readFileSync('./template.html', 'utf-8');

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
function generatePagesIndexHtml(pagesDestDir) {
  if (!fs.existsSync(pagesDestDir)) return;
  const target = path.join(pagesDestDir, 'index.html');
  // Don't overwrite a user-provided pages/index.html that came in via
  // a non-.mmx file in the source (the copy step in processPagesRecursive
  // would have placed it here). We only write when no file exists yet.
  if (fs.existsSync(target)) return;
  fs.writeFileSync(target, PAGES_INDEX_REDIRECT_HTML, 'utf-8');
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
function processProjectStructure(sourceDir, outputDir, options = {}) {
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

  processPagesRecursive(pagesSource, pagesDest, stats, { deleteOriginals, log, outputRoot: outputDir });

  // Remove the temp `__index.mmx` files from the source dir so they
  // don't pollute the user's project after the build.
  cleanupFolderIndexPages(tempIndexFiles);

  // Write a small redirect page at `pages/index.html` so anyone who
  // lands on the bare `pages/` URL gets sent back to the project root.
  generatePagesIndexHtml(pagesDest);

  // Process root index.mmx
  const rootIndexMmx = path.join(sourceDir, "index.mmx");
  if (fs.existsSync(rootIndexMmx)) {
    const rootIndexHtml = path.join(outputDir, "index.html");
    log(`index.mmx → index.html`);
    convertMmxFile(rootIndexMmx, rootIndexHtml, outputDir);
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
  const { deleteOriginals = false, log, outputRoot } = options;

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
        convertMmxFile(srcPath, destPath, outputRoot);
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
function applyPathPrefix(html, prefix) {
  const normalizedHtml = html.replace(/(href=)(["'])([^"']*pages\/[^"']+)\2/g, (match, prefix, quote, href) => {
    return `${prefix}${quote}${normalizePageHref(href)}${quote}`;
  });

  return normalizedHtml
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
}

//If it's single file insert the scripts in the html else leave it in blank
let singleFileContent = "";
let singleFileSearchContent = "";
if (CONFIG.singleFile) {
  const scriptPath = path.join(__dirname, "intAssets", "script.js");
  if (fs.existsSync(scriptPath)) {
    const scriptContent = fs.readFileSync(scriptPath, "utf8");
    singleFileContent = `<script>${scriptContent}</script>`;
  }

  const searchScriptPath = path.join(__dirname, "intAssets", "search", "search.js");
  if (fs.existsSync(searchScriptPath)) {
    const searchContent = fs.readFileSync(searchScriptPath, "utf8");
    singleFileSearchContent = `<script>${searchContent}</script>`;
  }
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
function convertMmxFile(inputPath, outputPath, outputRoot) {
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

  let searchScript = CONFIG.singleFile
    ? singleFileSearchContent
    : `<script src="${prefix}intAssets/search/search.js"></script>`;

  let highlightJS = "", highlightCSSTheme = "";
  if (media.anyCodeAuto) {
    highlightJS = '<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js"></script>';
    highlightCSSTheme = '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github-dark.min.css">';
  }

  const sidebarTitle = titleImageWithPrefix ? titleImageWithPrefix : pageTitle;
  const sidebarBottomText = pdata.sidebarBottomText ?? "";

  let finalTemplate = TEMPLATE
    .replaceAll("{{title}}", title)
    .replaceAll("{{sidebarTitle}}", sidebarTitle)
    .replaceAll("{{version}}", version)
    .replaceAll("{{content}}", htmlContent)
    .replaceAll("{{singlePageScript}}", singleFileContent)
    .replaceAll("{{prefix}}", prefix)
    .replaceAll("{{lang}}", lang)
    .replaceAll("{{playerCSS}}", playerCSS)
    .replaceAll("{{playerJS}}", playerJS)
    .replaceAll("{{imageZoom}}", imageZoom)
    .replaceAll("{{folderIndexIcons}}", folderIndexIcons)
    .replaceAll("{{searchScript}}", searchScript)
    .replaceAll("{{highlightJS}}", highlightJS)
    .replaceAll("{{highlightCSSTheme}}", highlightCSSTheme)
    .replaceAll("{{sidebarBottomText}}", sidebarBottomText);

  finalTemplate = applyPathPrefix(finalTemplate, prefix);

  fs.writeFileSync(outputPath, finalTemplate, "utf8");
}

// Clear output directory before generation
if (!CONFIG.singleFile) {
  const dir = CONFIG.outputPath;

  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, file);

      if (fs.statSync(fullPath).isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(fullPath);
      }
    }
  }
}

/**
 * Main execution function
 * Two modes: full project (singleFile=false) or single file (singleFile=true)
 */
function main() {
  if (!CONFIG.singleFile) {
    if (!fs.existsSync(CONFIG.inputPath)) {
      console.error(`Error: Input folder does not exist: ${CONFIG.inputPath}`);
      process.exit(1);
    }
    
    processProjectStructure(CONFIG.inputPath, CONFIG.outputPath, {
      deleteOriginals: false,
      verbose: true,
      outputRoot: CONFIG.outputPath
    });

  } else {
    // Single file mode - ensure output directory exists, then convert
    const dir = path.dirname(CONFIG.singleOutputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    convertMmxFile(CONFIG.singleInputPath, CONFIG.singleOutputPath, dir);
    console.log(`Generated: ${CONFIG.singleOutputPath}`);
  }
}

main();