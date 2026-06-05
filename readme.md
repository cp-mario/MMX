# MMX

A file-based documentation generator that turns `.mmx` files into a static HTML site. The project now runs on **[Bun](https://bun.com)** for a noticeably faster build pipeline.

> ⚠️ This project is still under development.

---

## Why Bun?

MMX is a pure ESM JavaScript tool with no runtime dependencies. Migrating to Bun gives us:

- **Faster startup** — Bun's runtime boots much faster than Node.
- **Faster I/O** — the generator reads/writes a lot of small files; Bun's optimised `fs` shows up here.
- **One tool** — Bun replaces Node + a package manager in a single binary.
- **Drop-in compatibility** — `import fs from "fs"`, `path`, `process`, ESM, etc. all just work.

You can still run the generator with Node if you prefer — see the *Alternative runtimes* section below.

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

# 2. (Optional) Edit config.mcfg so inputPath / outputPath match your project
# 3. Run the generator
bun main.js
```

That is it — there is no `bun install` step because MMX has **zero runtime dependencies**. Bun reads the source files directly via ESM.

### Using the npm scripts

```bash
bun run main      # build the docs (alias of `bun main.js`)
bun run dev       # build with `--watch`, regenerates on file change
bun run build     # same as `bun run main`
bun run start     # same as `bun run main`
bun run node      # force Node even if Bun is installed
```

---

## Project structure

```
MMX/
├── main.js                 # Entry point (run with `bun main.js`)
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
└── 1Example/
    ├── input/              # Example project source
    │   ├── config.mcfg
    │   ├── index.mmx
    │   ├── assets/
    │   └── pages/
    └── output/             # Generated site (gitignored normally)
```

---

## Configuring the generator

Open `config.mcfg` and set:

```
# Multi-page mode (default)
singleFile = false
inputPath  = "./1Example/input"
outputPath = "./1Example/output/"

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

### `index.mmx` (required)

The main entry page of the documentation.

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

A live example built with MMX is at <https://mmxdocs.vercel.app> and <https://cp-mario.github.io/MMX/>.

---

## License

[MIT](./LICENSE)
