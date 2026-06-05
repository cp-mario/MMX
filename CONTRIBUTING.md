# Contributing

Thank you for your interest in contributing to **MMX**!

## How to contribute

You can:

- Open an **issue** to report bugs, request features, or ask questions.
- Open a **pull request** with improvements, fixes, or new features.

Please make sure your contributions follow the project's [Code of Conduct](./CODE_OF_CONDUCT.md) and, if possible, write in **English or Spanish**.

---

## Development setup

MMX runs on **[Bun](https://bun.com)** (recommended) and is also compatible with Node.js `>=18` and Deno.

### 1. Install Bun

```bash
# Windows (PowerShell)
irm bun.sh/install.ps1 | iex

# macOS / Linux
curl -fsSL https://bun.sh/install | bash
```

### 2. Clone and run

```bash
git clone https://github.com/cp-mario/MMX.git
cd MMX
bun main.js
```

There is no `bun install` step — MMX has zero runtime dependencies.

### 3. Watch mode (optional)

```bash
bun run dev
```

This regenerates the docs every time you save a `.mmx`, `.html`, `.mcfg`, or any script under `scripts/`. Great for iterating on the generator itself.

### 4. Verify with Node (recommended before opening a PR)

The CI / production deployment may still use Node. Make sure your changes work on both runtimes:

```bash
bun run node
```

---

## Project layout

```
main.js                     # Entry point, orchestrates the build
config.mcfg                 # Generator configuration (input/output/minify)
template.html               # Page template
bunfig.toml                 # Bun runtime configuration
scripts/
  parser.js                 # MMX → HTML converter
  patterns.js               # Regex patterns used by the parser
  MCFGParser.js             # .mcfg key=value parser
  kebabCase.js              # Path/filename normalisation
  searchIndexBuilder.js     # Builds intAssets/search-index.json
  minifiers/
    minifyJs.js
    minifyCss.js
intAssets/                  # Copied as-is into the output (with script.js inlined + minified)
1Example/                   # Example project used for development and tests
```

---

## Code style

- The project is pure **ESM** (`"type": "module"` in `package.json`).
- 2-space indentation, single quotes, semicolons are not used.
- Keep the parser, minifiers and the search index builder framework-free — no external packages.
- If you need a new dependency, justify it in the PR. The project's strength is being a zero-dep tool.

---

## Testing

There is no automated test suite yet. Manual checks:

1. `bun main.js` — must finish with `There have been no errors`.
2. Open `1Example/output/index.html` in a browser and click around.
3. Try a `.mmx` file that exercises every block type (text formatting, lists, tables, code, media).
4. Run `bun run node` to confirm Node compatibility.

---

## Commit messages

Short and descriptive. Examples:

- `fix: correct asset prefix in nested pages`
- `feat: support per-page title image`
- `chore: migrate generator to Bun`
- `docs: update README with Bun instructions`

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
