# Spider Knits (蜘蛛织毛线)

English | [简体中文](README.zh-CN.md)

A fully client-side knitting chart editor for hand knitters: draw grids, place stitch symbols, marquee-select and copy, annotate regions, turn charts into row-by-row written instructions, and attach a how-to knit tutorial (image or text notes) to every stitch — with archiving and export built in. The build output is a single self-contained HTML file: double-click to run offline, no internet required.

![Chart editor](docs/images/editor.png)

## Features

### Projects & Charts

![Home page — project manager](docs/images/home.png)

- Two-level structure: one project can hold multiple charts (e.g. body, sleeves, neckline)
- Home page (project manager): card view with chart count and last-edited time; click a card to open the project, click a chart chip to jump straight to that chart; rename / delete right on the card; the last tile in the grid is "＋ New project"; the footer holds the copyright and project link
- Chart tabs: click to switch, double-click to rename inline, delete, create (auto-named "Chart N")
- Chart locking: one-click lock from the tab bar. When locked, all editing operations (place / erase / paste / annotate / grid resize / undo-redo) are blocked to protect finished charts; a lock icon shows on the tab and the state is saved with the archive
- Last-changed time: shown permanently at the right end of the top bar. Chart-content operations (place / erase / border / annotation / column labels / grid / undo-redo) update it; non-content operations (lock/unlock, rename, favorite) do not. Saved with the archive
- Themes: four hand-picked color themes (sage / rose / mist / mauve), switchable from the top bar "More" menu; the choice is remembered locally

### Canvas
- Grid up to 200 × 200 cells (stitches × rows), zoom 0.5 – 2.5
- Row 1 starting side is switchable: right side (knit right-to-left) / left side (left-to-right)
- Manual column labels, row highlighting
- The symbol layer renders as a canvas bitmap (zero DOM nodes): large charts (e.g. 40 rows × 117 columns, 3200+ symbols) still switch and edit smoothly

### Symbols

![Symbol library](docs/images/symbol-library.png)

- Built-in JIS standard knitting symbols, plus project-original symbols (e.g. 3×3 cable cross)
- Category filter (multi-select toggle), search by name / id
- "Favorites" pseudo-category (hover star at the top-left of a symbol)
- The home page "🧩 Symbol Library" manages symbols in one place: search + All / Built-in / Custom filter, hover a symbol and click the × at its top-right to remove —
  - **Built-in symbols**: only hidden from the chart-page palette; the definition stays, already-placed symbols are unaffected, and they can be restored anytime from the "Removed" section at the bottom of the library
  - **Custom symbols**: permanently deleted (with confirmation), and all references to them are cleaned up across every project and chart
- The library can also start a new symbol directly via "＋ New custom symbol" (see below)

### Editing Tools
- Marquee select: drag out a rectangular region, combine with copy / delete / annotate / paste
- Border: drag-select to draw a pattern border box
- Eraser: click or drag to remove symbols and borders
- Annotation: attach text to a selected region (e.g. "Pattern A · 12-st repeat"), displayed as a cyan dashed box above the region
- Copy / paste: the pasted block aligns its bottom-left corner to the clicked cell
- Undo / redo — all chart operations go into history

### Written Instructions

![Written instructions](docs/images/written-instructions.png)

- One click on "Written" in the top bar converts the current chart into row-by-row instructions in a wide, two-column modal:
  - **Left column**: a quick-reference of every symbol used in this chart (thumbnail + name + usage count, sorted by count descending, dashed underline when a tutorial — image or text — exists), copy-all / download txt, and usage tips
  - **Right column**: the row-by-row body, with row numbers + WS badge + stitch count at the end of each row
- Hover a stitch name to pop up its how-to knit tutorial — an image, a text note, or both side by side; click the image to view it full size
- RS / WS rows are derived automatically from the row 1 starting side (consistent with the canvas row-number position): RS rows read right→left as-is; WS rows read left→right with automatic conversion (knit ↔ purl swapped, twists become their purled counterparts, etc.)
- Blank cells are treated as background stitches (purled on RS rows, knitted on WS rows); consecutive identical stitches merge with a count; row prefix `r3:`, WS rows flagged "WS"
- File name: `ProjectName_ChartName.txt`

### Stitch Tutorials

![Stitch tutorial images](docs/images/stitch-tutorials.png)

- Home page "🧵 Tutorials" configures, per symbol, a how-to image (upload / replace / delete) and/or a short text note (auto-saved on blur, cleared when emptied); the two are independent — either alone or both together
- Tutorial images and text notes live in the local IndexedDB — never uploaded, never online; built-in tutorial assets can be placed in `public/tutorials/` (currently empty)
- Tutorial images and text notes are bundled into the "Archive project" zip (notes as `tutorials/<symbol-id>.txt`) and automatically restored to the local tutorial library when imported on another machine

### Custom Symbol Editor

![Custom symbol editor](docs/images/custom-symbol-editor.png)

- Primitives: line, rectangle, ellipse, path, cubic Bézier curve (drag the start-end chord, then click twice to set the two curve points)
- Canvas size adapts to the symbol's width/height; size changes take effect as you type
- Two entry points: home page "🧩 Symbol Library › ＋ New custom symbol", or the chart-page palette "＋ Custom"

### Save & Export
- Archive project: packs the whole project as a zip (`ProjectName.zip`) containing `work.json` (v2 format, all charts) and `tutorials/` (local tutorial images and text notes as-is)
- Load: accepts zip project bundles and JSON archives; importing always appends, never overwrites — a project bundle becomes a new project, a single chart is appended as a new chart
- Export chart: current chart only, as JSON (`ProjectName_ChartName.json`, v1-compatible format for older versions)
- SVG export: vector output (`ProjectName_ChartName.svg`, with an embedded `<title>`) for printing or sharing
- Saving uses the File System Access API to pop the system "Save As" dialog and can overwrite existing files; unsupported browsers fall back to a download
- Edits are auto-saved to browser localStorage

## Usage

### Quick Start

```bash
npm install
npm run dev-open    # start the dev server and open the editor page (entry /knitting-chart.html)
```

Production build:

```bash
npm run build       # regenerate symbol data first, then emit the single-file dist/knitting-chart.html
```

`dist/knitting-chart.html` works by double-clicking (file://) and can be copied to any machine for offline use.

### Basic Workflow

1. On the home page click "＋ New project" → open the project → create a chart, then set the grid width (stitches) and rows under the top bar "⋯ › Chart settings"
2. Click a symbol in the left palette, then click cells on the canvas to place it (hold and drag to keep drawing)
3. Drag a region with the marquee tool: copy / delete / annotate the selection; with the paste tool, click a target cell to drop the block
4. Drag with the border tool to draw a pattern frame; use the eraser to remove mistakes
5. Top bar "File": load zip / JSON, export chart JSON, export SVG, archive project zip
6. Top bar "Written" shows the row-by-row instructions for the current chart; the left column can copy or download as txt, and hovering a stitch name shows its tutorial (image or text note)
7. Home page "🧵 Tutorials" attaches images / text notes to stitches; home page "🧩 Symbol Library" removes / deletes symbols and creates new custom ones
8. The "?" at the top-right opens the help guide at any time

### Keyboard Shortcuts

| Key | Action |
| --- | --- |
| Ctrl+Z | Undo |
| Ctrl+Y / Ctrl+Shift+Z | Redo |
| Ctrl+C | Copy selection |
| Ctrl+V | Paste |
| Delete / Backspace | Delete selection |
| Esc | Cancel selection / exit paste mode / close modals |

### Data & Archive Formats

- Autosave key `knitChartProto1` (localStorage)
- Project bundle zip: `work.json` (`{version:2, works:[...]}`) + `tutorials/` (tutorial images as-is + `<symbol-id>.txt` text notes)
- Tutorial images and text notes are stored separately in IndexedDB (database `knitChartTutor`), not in localStorage
- The custom symbol library and the "removed built-in symbols" list are **global** (not per project) and travel with the archive and undo history; deleting a custom symbol cleans up references in every project
- Legacy v1 single-chart JSON can still be imported
- Legacy flat localStorage data auto-migrates into "My Project / Chart 1"

## Development

### Tech Stack

- Vue 3 (`<script setup>` Composition API)
- Vite 7 + vite-plugin-singlefile (single-file output)
- Tailwind CSS 4 (@tailwindcss/vite plugin)
- fflate (zip bundle packing / unpacking)
- Symbol pipeline: fast-xml-parser + svg-path-commander

### Directory Structure

```
├─ knitting-chart.html        # App entry HTML
├─ vite.config.js             # Single-file build config; entry: knitting-chart.html
├─ scripts/
│  └─ generate-symbols.mjs    # Extracts paths from external JIS symbol library SVGs, generates symbol data
├─ local-symbols/             # Project-original symbol SVGs (missing from the source library, e.g. 3×3 cable cross)
├─ public/tutorials/          # Built-in tutorial images (optional, named by symbol id)
└─ src/
   ├─ main.js                 # Bootstrap
   ├─ App.vue                 # View switching (home / editor) and global modal mounting
   ├─ ui.js                   # Session state (current view, modal flags, loading, toast, in-app dialogs)
   ├─ store.js                # All business state & operations (centralized reactive store)
   ├─ util.js                 # Shared symbol rendering (symbolInnerMarkup / symDataUrl)
   ├─ symbols.js              # Symbol definitions (incl. dir field for local symbols)
   ├─ symbols.generated.js    # Generated file — do not edit by hand
   ├─ exportSvg.js            # SVG export
   ├─ textChart.js            # Pure chart→text conversion module (no Vue deps; callable from Node)
   ├─ tutorials.js            # Tutorial lookup (image / text; local upload first → built-in static)
   ├─ tutorialStore.js        # Tutorial image & text IndexedDB storage (incl. zip import/export)
   ├─ selftest.js             # In-page self-test script
   ├─ style.css
   └─ components/
      ├─ HomeView.vue         # Home page: project manager + tutorials / symbol library entries
      ├─ TopBar.vue           # Top bar: back home, project switcher, chart tabs, last-changed, written, file, help, more
      ├─ ChartTabs.vue        # Chart tabs (switch / rename / lock / delete / new)
      ├─ ChartSettings.vue    # Chart settings (grid size / row direction / column labels)
      ├─ ToolBar.vue          # Toolbar & global shortcuts
      ├─ ChartCanvas.vue      # Canvas: bitmap symbol layer + border/annotation/selection rendering & interaction
      ├─ ZoomControl.vue      # Zoom control
      ├─ PalettePanel.vue     # Symbol palette (search / categories / favorites)
      ├─ SymbolArt.vue        # Single-symbol renderer
      ├─ SymbolManagerModal.vue # Symbol library modal (remove / delete / restore / new custom symbol)
      ├─ TutorialModal.vue    # Tutorial manager (per-symbol image / text note)
      ├─ TextChartModal.vue   # Written-instructions modal (symbol reference + body + tutorial popover)
      ├─ HelpModal.vue        # Help guide
      ├─ AppDialog.vue        # In-app confirm / prompt dialog
      └─ EditorModal.vue      # Custom symbol editor
```

### Symbol Pipeline

```bash
npm run gen-symbols   # regenerate src/symbols.generated.js only
```

- The external JIS symbol library path is configured in `scripts/generate-symbols.mjs`
- Local symbols go in `local-symbols/*.svg` and share the same conversion pipeline
- Note: `npm run build` runs gen-symbols automatically first; running gen-symbols alone does not update dist — rebuild afterwards

### Development Conventions (Hard-Won Lessons)

- Store operation functions stay synchronous (self-tests call them directly); UI entry points wrap with `withLoading(fn)` from ui.js — switching large charts triggers a full canvas re-render and needs the loading overlay up first
- The canvas symbol layer is a canvas bitmap (`#chartWrap` sandwich: bottom SVG hotzones/highlights/row numbers < `#symCanvas` grid + symbol bitmaps < top SVG borders/annotations/selection). Each symbol is cached as a data-URL bitmap via `symDataUrl` (WeakMap keyed on the symbol object); redraw is just drawImage calls. Do not revert to SVG node rendering — v-html inline paths caused 8–10s long tasks on large charts, and `<defs>`+`<use>` dedup was even slower in Chrome (both measured, both failed)
- Undo history hangs off `save()` with chart-content fingerprint dedup; snapshots are stored as JSON strings (parsed only on restore); session state like zoom / tool / highlight never enters history; after undo/redo always call `syncHistUI()`
- Marquee/border drag must set the `skipClick` flag to swallow the browser's synthetic click afterwards, or the selection resets to a single cell
- `persistObject` performs a single `JSON.stringify`; no extra deep copies inside; after a project-tree array is wholesale-replaced, call `projectActive()` to re-align the editing projection
- `.modal-shell { overflow: hidden }` is plain CSS with **no layer**, so it outranks Tailwind's `overflow-auto` inside `@layer utilities`. A scrollable modal must use a custom flex-column shell plus an inner scroll body with `overflow-y:auto; min-height:0` (see `.tcm-shell` / `.help-shell`)
- The home page project grid `.home-grid` uses `align-content: start`; pinning the footer to the bottom is left to `.home-foot`'s `margin-top:auto` (giving the grid `flex:1 0 auto` stretches the cards)
- Hover-only badges (such as `.sym-remove`) must sit **inside** the card; placed on the card's outer edge they get clipped by the scroll container's `overflow`
- Self-test `runSelfTest`: switch to the editor view and tick first (the canvas DOM otherwise doesn't exist), and call `save()` at the end to leave a clean state; symbol-layer assertions use pixel sampling (the `window.__symLayer` hook + `blockHasInk`)
