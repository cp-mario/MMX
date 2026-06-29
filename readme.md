# MMX

A file-based documentation generator that turns `.mmx` files into a static HTML site. The project now runs on **[Bun](https://bun.com)** for a noticeably faster build pipeline.

> ⚠️ This project is still under development.

---
## Requirements

- **[Bun](https://bun.com)** `>=1.1.0` (recommended)
- A terminal (PowerShell, bash, zsh, etc.)

### Install Bun

| OS | Command |
| --- | --- |
| **Windows (PowerShell)** | `irm bun.sh/install.ps1 \| iex` |
| **macOS / Linux** | `curl -fsSL https://bun.sh/install \| bash` |

Verify with:

```bash
bun --version
```

---

## Quick start

```bash
# 1. Clone the repository
git clone https://github.com/cp-mario/MMX.git
cd MMX

# 2. Build your documentation from a source folder
mmx build .
```

That's it — no `bun install` needed. MMX has **zero runtime dependencies**.

The default output goes to `./output`. You can change it:

```bash
mmx build ./mi-proyecto -o ./site
```

Or use two positional args:

```bash
mmx build ./mi-proyecto ./site
```

### Using the npm scripts

```bash
bun run main      # build the docs (alias of `bun main.js`)
bun run dev       # build with `--watch`, regenerates on file change
bun run build     # same as `bun run main`
bun run start     # same as `bun run main`
bun run node      # force Node even if Bun is installed
bun run mmx       # run the mmx CLI
```

### Using the CLI directly

If installed globally or via `npx`:

```bash
mmx build .
mmx build ./src -o ./output
mmx blog ./posts
mmx page article.mmx -o article.html
mmx editor
mmx serve ./output 8080
```

---

## CLI Commands

```
mmx <command> [options]
```

### `build [input] [output]`

Generate a full documentation site from a folder. If the folder contains a `config.mcfg`, its settings are used.

| Arg | Description | Default |
|-----|-------------|---------|
| `input` | Source folder with `.mmx` files | `.` (current dir) |
| `output` | Output directory for the generated site | `./output` |

Flags:
- `-o, --output <path>` — output directory (overrides positional arg)
- `-f, --force` — force rebuild all files (skip incremental check)
- `-nm, --no-minify` — disable minification

```bash
mmx build                          # . → ./output
mmx build ./src                    # ./src → ./output
mmx build ./src ./site             # ./src → ./site
mmx build ./src -o ./public/site   # ./src → ./public/site
```

### `blog [input] [output]`

Convert a folder of `.mmx` blog post files into a blog with a chronological index page. Blog posts use filenames like `2024-01-15-title.mmx` to determine the post date.

| Arg | Description | Default |
|-----|-------------|---------|
| `input` | Folder with `.mmx` blog posts | `.` (current dir) |
| `output` | Output directory | `../blog` relative to posts |

```bash
mmx blog ./posts              # ./posts → ./blog
mmx blog ./posts ./my-blog
```

### `page [options] <file>`

Generate a standalone HTML page from a single `.mmx` file. All styles and scripts are inlined — no sidebar, index, or navigation.

```bash
mmx page article.mmx -o article.html
mmx page article.mmx --assets ./assets
```

Flags:
- `-o, --output <path>` — output file path (default: same name as input with `.html`)
- `-a, --assets <path>` — path prefix for assets directory (default: `./assets`)

### `editor [port]`

Launch the MMX Visual Editor server with a live preview, file explorer, and toolbar.

```bash
mmx editor          # default port 3031
mmx editor 4000
```

### `serve [dir] [port]`

Serve a documentation directory via HTTP.

```bash
mmx serve            # serves ./output on port 8080
mmx serve ./site 3000
```

---

## Visual Editor

MMX includes a built-in **visual editor** that provides a comfortable environment for writing and previewing `.mmx` files in real time.

```bash
# Start the editor
mmx editor
# Or directly:
bun editor/server.js
```

Then open [http://localhost:3031](http://localhost:3031) in your browser. The editor works with both **Bun** and **Node.js**.

### Features

- **File explorer** — browse, create, rename, and delete `.mmx` files directly from the sidebar.
- **Code editor** with syntax highlighting, line numbers, and line wrapping.
- **Live preview** — see the rendered HTML as you type, with bidirectional scroll sync.
- **Toolbar** — insert headings, bold, italic, code blocks, tables, lists, admonitions (notes/tips/warnings), images, videos, audio, and more.
- **Table editor** — a visual grid for editing MMX tables without writing raw syntax.
- **Assets browser** — upload, browse, and manage files in the `assets/` folder.
- **Autocomplete** — smart suggestions for MMX syntax elements.
- **Build & preview output** — run the full MMX build from inside the editor and open the generated documentation.
- **Undo/redo** — full history support for your edits.

For a complete walkthrough of all features, see the [Visual Editor](1Example/input/pages/Visual%20Editor.mmx) documentation page.

> **Note:** The editor is still under development and may not cover every MMX feature yet.

---

```
MMX/
├── cli.js                  # CLI entry point (`mmx build`, `mmx blog`, etc.)
├── main.js                 # Library module (used by cli.js)
├── config.mcfg             # Generator configuration
├── template.html           # HTML template used for every page
├── bunfig.toml             # Bun runtime configuration
├── package.json            # Scripts and metadata (Bun-first)
├── scripts/                # Parser, minifiers, search index builder
│   ├── parser.js
│   ├── MCFGParser.js
│   ├── patterns.js
│   ├── kebabCase.js
│   ├── searchIndexBuilder.js
│   └── minifiers/
│       ├── minifyJs.js
│       └── minifyCss.js
├── intAssets/              # Internal assets copied into the output
│   ├── script.js
│   ├── style.css
│   ├── styleSidebar.css
│   ├── imageZoom.js
│   ├── player/
│   └── search/
├── editor/                 # Visual Editor server
│   ├── server.js
│   └── public/
└── 1Example/
    ├── input/              # Example project source
    │   ├── config.mcfg
    │   ├── index.mmx
    │   ├── assets/
    │   └── pages/
    └── output/             # Generated site (gitignored normally)


---

## Configuring the generator

Open `config.mcfg` and set:

```
# Multi-page mode (default)
singleFile = false
inputPath  = "./1Example/input"
outputPath = "./1Example/output"

# Single document mode — produces ONE HTML file
# singleFile = true
# singleInputPath  = "./path/to/page.mmx"
# singleOutputPath = "./output/page.html"

# Optional minification (keep as `true` for production)
minifyScripts = true
minifyCss     = true
```

---

## What you need in your own project

### `config.mcfg` (required)

```
title = "The title of your documentation"
version = "v1.1"
lang = "en"
sidebarBottomText = "Made with <a target=_blank href=https://github.com/cp-mario/MMX>MMX</a>"
```

> [!NOTE]
> `lang` follows the [BCP 47](https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry) standard.
> If you change `sidebarBottomText`, please keep it under 20 characters and consider crediting MMX.

#### Optional: `defaultCodeHighlight` (boolean, default `false`)

When set to `true` in your project's `config.mcfg`, every code block (`:::code ... :::` and `#code(path)`) is automatically highlighted with highlight.js, just as if you had added the `auto` class to each one.

- `defaultCodeHighlight = true` — every code block is highlighted by default.
- `defaultCodeHighlight = false` (default) — code blocks are only highlighted when they explicitly include the `auto` class.

Use the `noAuto` class on a specific block to opt out of the project-wide default:

```
:::code
defaultCodeHighlight = true
:::

:::code
#code(assets/code/note.txt) noAuto
:::

:::code
:::code noAuto
this block is not highlighted even when defaultCodeHighlight is true
:::
:::
```

### `assets/` (optional)

A folder for images, videos, or any other resources. Reference them with:

```
assets/path/to/resource
```

If you put a file named `icon.png` (or `.svg`, `.ico`, `.webp`, `.jpg`, `.jpeg`) it becomes the browser tab icon. A file named `title.<ext>` is used as the sidebar title image instead of the text.

### `pages/` (required)

All your `.mmx` files live here. Subfolders become categories, and can be nested.

#### Auto-generated folder indexes

Every subfolder of `pages/` automatically gets an `index.html` page that lists its contents as a nested tree of files and subfolders. The build creates a temporary `__index.mmx` for each folder, runs it through the regular MMX pipeline, and deletes the temp file when the build is done.

You do not need to do anything to get the auto-generated indexes — they exist purely to give every folder a clickable landing page in the sidebar.

If you want to take full control of a folder's landing page, just drop your own `index.mmx` (case-insensitive) into that folder. The build will detect it and skip the auto-generation step for that folder (but not for any nested subfolders, which keep their auto-generated indexes).

#### `indexText.mmx` — folder descriptions

If you want to give a folder a short textual description / introduction **without** replacing the auto-generated directory list, drop a file named `indexText.mmx` (case-insensitive) into that folder:

```text
pages/
└── Multimedia/
    ├── indexText.mmx   <-- folder description
    ├── Audios.mmx
    ├── Videos.mmx
    └── ...
```

The build will:

1. Compile the contents of `indexText.mmx` with the **same MMX pipeline** used for regular pages (so you can use paragraphs, lists, tables, images, code blocks, etc. — anything MMX supports).
2. Insert that compiled HTML **between the folder name (H1) and the auto-generated directory list** of the folder's `index.html`, separated by a thin dashed horizontal rule.
3. Skip the file everywhere else — it is **not** rendered as its own page, **not** listed in the sidebar, and **not** added to the search index or the sitemap.

If both `index.mmx` and `indexText.mmx` are present in the same folder, `index.mmx` wins (it fully replaces the auto-generated index, and `indexText.mmx` is ignored — it has no effect there).

> [!TIP]
> A few practical use cases for `indexText.mmx`:
> - A one-paragraph "what is in this folder" intro on a category landing page.
> - A short list of recommended reading order inside a tutorial folder.
> - A screenshot or callout block that should always be visible at the top of the folder.
>
> When the description grows beyond a screen of text, prefer dropping a real `index.mmx` instead — the build's `indexText.mmx` block is deliberately compact and is not a replacement for a proper landing page.

### `index.mmx` (required)

The main entry page of the documentation. Dont name any other file index.mmx except this.

---

## Alternative runtimes

MMX is plain ESM, so any modern runtime works:

| Runtime | Command |
| --- | --- |
| **Bun** (recommended) | `bun main.js` |
| **Node.js** `>=18` | `node main.js` |
| **Deno** | `deno run --allow-read --allow-write --allow-env main.js` |

> The `bun run node` npm script forces Node even when Bun is installed, which is handy for regression testing.

---

## Performance

The example project (116 `.mmx` files) generates in well under a second on Bun on a developer laptop. Compared to Node 24, expect roughly a 2x–4x speed-up on cold start and a smaller but consistent win on warm runs, mostly thanks to Bun's faster `fs` and faster module loader.

---

## Attribution

This project uses:

- [highlight.js](https://github.com/highlightjs/highlight.js/) — optional code highlighting
- [Google Fonts](https://fonts.google.com/) — typography

A live example built with MMX is at <https://mmxdocs.vercel.app> and <https://cp-mario.github.io/MMX-Documentation//>.

---

## License

[MIT](./LICENSE)
