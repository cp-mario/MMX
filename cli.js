#!/usr/bin/env node
/**
 * MMX — CLI entry point
 *
 * Handles all subcommands and delegates the heavy lifting to main.js.
 *
 * Usage:
 *   mmx [command] [options]
 *
 * Commands:
 *   build / buildDoc [input] [output]   Build documentation from a folder.
 *                                       Default output: ./output
 *   blog  / buildBlog [path]            Build a blog from a folder of .mmx files
 *   page [options] <file>               Generate a standalone HTML page
 *   editor [port]                       Launch the MMX Visual Editor
 *   serve [dir] [port]                  Serve a docs directory via HTTP
 */

import fs from "fs";
import path from "path";
import http from "http";
import { parseMCFG } from "./scripts/MCFGParser.js";

import {
  CONFIG,
  processProjectStructure,
  clearOutputDir,
  buildBlog,
  buildStandalonePage,
  startEditor,
  startServe,
  initBlog,
  initDoc,
} from "./main.js";

// ─── Help ──────────────────────────────────────────────────────────────────

function showMainHelp() {
  console.log(`
MMX Documentation Generator & Blog Builder

USAGE
  mmx [command] [options]

COMMANDS
  build [input] [output]  Alias for buildDoc
  buildDoc [input] [output]  Generate a full documentation site from the
                        given folder. If the folder contains a config.mcfg
                        its settings are used. Default output: ./output

  blog [path]           Alias for buildBlog
  buildBlog [path]      Convert a folder of .mmx files into a blog with
                        a chronological index page. Filenames like
                        "2024-01-15-title.mmx" determine the post date.
                        Default path: ./src (or current dir if ./src
                        doesn't exist). Default output: ./output

  init blog [dir]       Scaffold a new blog project in the given directory
                        (default: current directory). Creates theme/ with
                        config.mcfg, nav.html, footer.html, styles.css,
                        and src/ with index.mmx and example posts.
  init doc [dir]        Scaffold a new documentation project in the given
                        directory (default: current directory). Creates
                        pages/ with config.mcfg, index.mmx, and example
                        documentation pages.

  page [options] <file> Generate a standalone HTML page from a single .mmx
                        file. All styles and scripts are inlined. No sidebar,
                        index, or navigation.

  editor [port]         Launch the MMX Visual Editor server
                        (default port: 3031)

  serve [dir] [port]    Serve a documentation directory via HTTP
                        (default dir: ./docs, default port: 8080)

  -h, --help            Show this help

GLOBAL FLAGS
  -nm, --no-minify      Disable minification (minified by default)

PAGE FLAGS
  -o, --output <path>   Output file path (default: input name with .html)
  -a, --assets <path>   Path prefix for assets directory (default: "./assets")

BUILD / BLOG FLAGS
  -o, --output <path>   Output directory
  -f, --force           Force rebuild all files (skip incremental check)

EXAMPLES
  mmx build ./my-project -o ./site
  mmx blog ./posts -o ./my-blog
  mmx blog ./src
  mmx page article.mmx -o article.html
  mmx editor
  mmx editor 4000
  mmx serve ./docs 3000
  mmx init blog ./my-blog
  mmx init doc ./my-docs
`);
}

// ─── Main CLI router ───────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  function flagValue(short, long) {
    const idx = args.indexOf(short) !== -1 ? args.indexOf(short) : args.indexOf(long);
    if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
    return null;
  }
  function hasFlag(short, long) {
    return args.includes(short) || args.includes(long);
  }

  if (args[0] === "--help" || args[0] === "-h") {
    showMainHelp();
    return;
  }

  // ── No args: read config.mcfg ────────────────────────────────────────
  if (args.length === 0) {
    const configPath = path.resolve("config.mcfg");
    if (!fs.existsSync(configPath)) {
      console.error("Error: config.mcfg not found in current directory.");
      console.error("Use: mmx <command> [options]");
      showMainHelp();
      process.exit(1);
    }
    Object.assign(CONFIG, parseMCFG(fs.readFileSync(configPath, "utf-8")));
    clearOutputDir(CONFIG.outputPath);
    if (!fs.existsSync(CONFIG.inputPath)) {
      console.error(`Error: Input folder does not exist: ${CONFIG.inputPath}`);
      process.exit(1);
    }
    processProjectStructure(CONFIG.inputPath, CONFIG.outputPath, {
      deleteOriginals: false,
      verbose: true,
      outputRoot: CONFIG.outputPath,
    });
    return;
  }

  const command = args[0];
  const rest = args.slice(1);

  // Apply global minification flag
  if (hasFlag("-nm", "--no-minify")) {
    CONFIG.minifyScripts = false;
    CONFIG.minifyCss = false;
  }

  // ── build / buildDoc ─────────────────────────────────────────────────
  if (command === "buildDoc" || command === "build") {
    const positional = rest.filter(a => !a.startsWith("-"));
    const cmdInput = positional[0] || process.cwd();
    const cmdOutput = positional[1] || null;
    const explicitOutput = flagValue("-o", "--output") || cmdOutput;
    const inputDir = path.resolve(cmdInput);
    const cfgPath = path.join(inputDir, "config.mcfg");

    let outputDir, sourceDir;
    if (fs.existsSync(cfgPath)) {
      const projConfig = parseMCFG(fs.readFileSync(cfgPath, "utf-8"));
      Object.assign(CONFIG, projConfig);

      sourceDir = CONFIG.inputPath
        ? path.isAbsolute(CONFIG.inputPath)
          ? CONFIG.inputPath
          : path.resolve(inputDir, CONFIG.inputPath)
        : inputDir;

      if (explicitOutput) {
        outputDir = path.resolve(explicitOutput);
      } else if (CONFIG.outputPath) {
        outputDir = path.isAbsolute(CONFIG.outputPath)
          ? CONFIG.outputPath
          : path.resolve(inputDir, CONFIG.outputPath);
      } else {
        outputDir = path.resolve("output");
      }
    } else {
      sourceDir = inputDir;
      outputDir = path.resolve(explicitOutput || "output");
      CONFIG.inputPath = sourceDir;
      CONFIG.outputPath = outputDir;
    }

    clearOutputDir(outputDir);
    if (!fs.existsSync(sourceDir)) {
      console.error(`Error: Input folder does not exist: ${sourceDir}`);
      process.exit(1);
    }
    processProjectStructure(sourceDir, outputDir, {
      deleteOriginals: false,
      verbose: true,
      outputRoot: outputDir,
    });

  // ── blog / buildBlog ─────────────────────────────────────────────────
  } else if (command === "buildBlog" || command === "blog") {
    const cmdInput = rest.find(a => !a.startsWith("-"));
    // Default to ./src when no path given (matches blog template structure)
    const resolvedInput = cmdInput
      ? path.resolve(cmdInput)
      : (fs.existsSync(path.resolve("src")) ? path.resolve("src") : process.cwd());
    const explicitOutput = flagValue("-o", "--output");
    const force = hasFlag("-f", "--force");
    const postsDir = resolvedInput;
    const outputDir = explicitOutput ? path.resolve(explicitOutput) : path.resolve("output");
    buildBlog(postsDir, outputDir, { force });

  // ── page ─────────────────────────────────────────────────────────────
  } else if (command === "page") {
    const pageArgs = rest;
    const pageOptions = {
      input: null,
      output: null,
      assets: "./assets",
      minify: !hasFlag("-nm", "--no-minify"),
    };

    for (let i = 0; i < pageArgs.length; i++) {
      const arg = pageArgs[i];
      if (arg === "--output" || arg === "-o") {
        pageOptions.output = pageArgs[++i];
      } else if (arg === "--assets" || arg === "-a") {
        pageOptions.assets = pageArgs[++i];
      } else if (!arg.startsWith("-")) {
        pageOptions.input = arg;
      }
    }

    if (!pageOptions.input) {
      console.error("Error: No input file specified for the page command.");
      console.error("Usage: mmx page [options] <file.mmx>");
      process.exit(1);
    }
    if (!pageOptions.output) {
      const parsed = path.parse(pageOptions.input);
      pageOptions.output = path.join(parsed.dir, parsed.name + ".html");
    }
    buildStandalonePage(pageOptions.input, pageOptions.output, {
      assetsPrefix: pageOptions.assets,
      minify: pageOptions.minify,
    });

  // ── editor ───────────────────────────────────────────────────────────
  } else if (command === "editor") {
    const portArg = rest.find(a => !a.startsWith("-"));
    const port = portArg ? parseInt(portArg, 10) : (flagValue("-p", "--port") || 3031);
    startEditor(port);

  // ── serve ────────────────────────────────────────────────────────────
  } else if (command === "serve") {
    const nonFlagArgs = rest.filter(a => !a.startsWith("-"));
    const dir = path.resolve(nonFlagArgs[0] || "./docs");
    const port = parseInt(nonFlagArgs[1], 10) || parseInt(flagValue("-p", "--port"), 10) || 8080;
    startServe(dir, port);

  // ── init blog / init doc ────────────────────────────────────────────
  } else if (command === "init") {
    const subcommand = rest[0];
    const targetDir = rest[1] || process.cwd();

    if (subcommand === "blog") {
      initBlog(path.resolve(targetDir));
    } else if (subcommand === "doc") {
      initDoc(path.resolve(targetDir));
    } else {
      console.error(`Unknown init subcommand: "${subcommand}"`);
      console.error('Usage: mmx init <blog|doc> [target-dir]');
      process.exit(1);
    }

  } else {
    console.error(`Unknown command: ${command}`);
    console.error('Usage: mmx <command> [options]');
    console.error('Run "mmx --help" for available commands.');
    process.exit(1);
  }
}

main();
