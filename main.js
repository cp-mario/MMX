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


//General config
const CONFIG = parseMCFG(fs.readFileSync('./config.mcfg', 'utf-8'))

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    } else if (item.endsWith('.mmx')) {
      const relativePath = path.relative(rootDir, fullPath);
      const safePath = toKebabCase(relativePath).replace(/\.mmx$/i, '.html');
      result.push({
        type: "file",
        name: item.replace(/\.mmx$/i, ""),
        path: safePath
      });
    }
  }

  return result;
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
  const assetsInternosSource = path.join(__dirname, "assetsInternos");
  const assetsInternosDest = path.join(outputDir, "assetsInternos");

  if (fs.existsSync(assetsInternosSource)) {
    // Insert MCFGParser into script.js at runtime
    const scriptJsSource = path.join(assetsInternosSource, "script.js");
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
      if (!fs.existsSync(assetsInternosDest)) {
        fs.mkdirSync(assetsInternosDest, { recursive: true });
      }
      fs.writeFileSync(path.join(assetsInternosDest, "script.js"), scriptContent, 'utf-8');
      log(`script.js copied${CONFIG.minifyScripts ? ' (minified)' : ''}`);
    }
    
    // Copy rest of assetsInternos (excluding script.js which we handled)
    const items = fs.readdirSync(assetsInternosSource);
    for (const item of items) {
      if (item === 'script.js') continue; // Already handled
      
      const srcPath = path.join(assetsInternosSource, item);
      const destPath = path.join(assetsInternosDest, item);
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
    log(`assetsInternos/ copied`);
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

  processPagesRecursive(pagesSource, pagesDest, stats, { deleteOriginals, log, outputRoot: outputDir });
  
  // Process root index.mmx
  const rootIndexMmx = path.join(sourceDir, "index.mmx");
  if (fs.existsSync(rootIndexMmx)) {
    const rootIndexHtml = path.join(outputDir, "index.html");
    log(`index.mmx → index.html`);
    convertMmxFile(rootIndexMmx, rootIndexHtml, outputDir);
    stats.processed++;
  }


  // Generate index.json for navigation (in assetsInternos)
  const indexData = generateIndexRecursive(pagesSource, pagesSource);
  const indexPath = path.join(outputDir, "assetsInternos", "index.json");
  fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), "utf8");
  log(`Generated index: assetsInternos/index.json`);

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
 * Recursively processes .mmx files in pages directory
 * @param {string} sourceDir - Source pages directory
 * @param {string} outputDir - Destination pages directory
 * @param {Object} stats - Statistics object
 * @param {Object} options - Configuration options
 */
function processPagesRecursive(sourceDir, outputDir, stats, options) {
  const { deleteOriginals, log, outputRoot } = options;
  const items = fs.readdirSync(sourceDir);

  for (const item of items) {
    const srcPath = path.join(sourceDir, item);
    const stat = fs.statSync(srcPath);
    const safeItem = stat.isDirectory()
      ? toKebabCase(item)
      : item.endsWith('.mmx')
        ? toKebabCase(item)
        : item;
    const destPath = path.join(outputDir, safeItem);

    if (stat.isDirectory()) {
      if (!fs.existsSync(destPath)) fs.mkdirSync(destPath, { recursive: true });
      processPagesRecursive(srcPath, destPath, stats, {
        deleteOriginals,
        log,
        outputRoot
      });

    } else if (item.endsWith('.mmx')) {
      try {
        const htmlName = safeItem.replace(/\.mmx$/i, '.html');
        const htmlDest = path.join(outputDir, htmlName);

        log(`${item} → ${htmlName}`);
        convertMmxFile(srcPath, htmlDest, outputRoot);
        stats.processed++;
        if (deleteOriginals) fs.unlinkSync(srcPath);
      } catch (error) {
        console.error(`Error processing ${item}:`, error.message);
        stats.errors++;
      }
    } else {
      if (!fs.existsSync(path.dirname(destPath))) fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      stats.copied++;
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

//If it's single file insert the script in the html else leave it in blank
let singleFileContent = "";
if (CONFIG.singleFile) {
  const scriptPath = path.join(__dirname, "assetsInternos", "script.js");
  if (fs.existsSync(scriptPath)) {
    const scriptContent = fs.readFileSync(scriptPath, "utf8");
    singleFileContent = `<script>${scriptContent}</script>`;
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
 * Converts single .mmx file to HTML
 * @param {string} inputPath - .mmx input file path
 * @param {string} outputPath - HTML output file path
 * @param {string} outputRoot - Root directory for path calculations
 */
function convertMmxFile(inputPath, outputPath, outputRoot) {
  const content = fs.readFileSync(inputPath, "utf8");
  const template = fs.readFileSync("./template.html", "utf8");
  const htmlContent = mmxToHtml(content);

  // Detect media content
  const media = detectMediaContent(content);

  // Title from content heading (for <title> tag)
  const headerTitle = content.match(/^# (.+)$/m)?.[1] || "Documentation";

  // Get project directory from inputPath (handles root index.mmx, pages/*.mmx, and pages/subfolder/*.mmx)
  const inputDir = path.dirname(inputPath);
  // Find /pages/ anywhere in the path and go up one level to get project root
  const pagesPos = inputDir.lastIndexOf(path.sep + "pages");
  let projectDir;
  if (pagesPos !== -1) {
    // Go up one level from /pages/
    projectDir = inputDir.slice(0, pagesPos);
  } else {
    // For root index.mmx (directly in project folder), use inputDir itself
    projectDir = inputDir;
  }
  
  // Try to read title and version from project's config.mcfg
  let pageTitle = headerTitle; // Default to content title
  let version = ""; // Default empty version
  let lang = "en" //Default english lang
  let configData
  const configPath = path.join(projectDir, "config.mcfg");
  let configTitle = ""; // For browser title
  if (fs.existsSync(configPath)) {
    try {
      const configContent = fs.readFileSync(configPath, "utf8");
      configData = parseMCFG(configContent);
      if (configData.title) {
        pageTitle = configData.title;
        configTitle = configData.title;
      }
      if (configData.version) {
        version = configData.version;
      }
      if (configData.lang) {
        lang = configData.lang;
      }
    } catch (e) {
      // Ignore config parse errors, use default values
    }
  }

  // Build browser title: "Header - Documentation Name"
  const title = configTitle ? `${headerTitle} - ${configTitle}` : headerTitle;

  const prefix = calculatePrefix(outputPath, outputRoot);

  // Handle titleImage - replace title text with image if enabled
  let titleImageHtml = "";
  const assetsDir = path.join(projectDir, "assets");
  if (fs.existsSync(assetsDir)) {
    const files = fs.readdirSync(assetsDir);
    const titleImageFile = files.find(f => 
      f.toLowerCase().startsWith("title.") && 
      !fs.statSync(path.join(assetsDir, f)).isDirectory()
    );
    if (titleImageFile) {
      const imagePath = prefix + "assets/" + titleImageFile;
      titleImageHtml = `<img src="${imagePath}" alt="${configData.title}" id="sidebar-title-image">`;
    }
  }

  

  //If any plyr elements (Audio or video) make the html load it
  let plyrCSS = "";
  let plyrJS = "";
  if (media.anyVideo || media.anyAudio) {
    plyrCSS = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/plyr@3.8.4/dist/plyr.css"/>';
    plyrJS = '<script src="https://cdn.jsdelivr.net/npm/plyr@3.8.4/dist/plyr.polyfilled.min.js"></script>'
  }

  let mediumZoomJS = "";
  if (media.anyImage) {
    mediumZoomJS = '<script src="https://cdn.jsdelivr.net/npm/medium-zoom@1.1.0/dist/medium-zoom.min.js"></script>'
  }

  let highlightJS = "";
  let highlightCSSTheme = "";
  if (media.anyCodeAuto) {
    highlightJS = '<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js"></script>'
    highlightCSSTheme = '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github-dark.min.css">'

  }

  let sidebarTitle = pageTitle
  if (titleImageHtml.length > 0){
    sidebarTitle = titleImageHtml
  }

  
  let finalTemplate = template
    .replaceAll("{{title}}", title)
    .replaceAll("{{sidebarTitle}}", sidebarTitle)
    .replaceAll("{{version}}", version)
    .replaceAll("{{content}}", htmlContent)
    .replaceAll("{{singlePageScript}}", singleFileContent)
    .replaceAll("{{prefix}}", prefix)
    .replaceAll("{{lang}}", lang)
    .replaceAll("{{plyrCSS}}", plyrCSS)
    .replaceAll("{{plyrJS}}", plyrJS)
    .replaceAll("{{mediumZommJS}}", mediumZoomJS)
    .replaceAll("{{highlightJS}}", highlightJS)
    .replaceAll("{{highlightCSSTheme}}", highlightCSSTheme);

    
  
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