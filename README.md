# Spider Knits (蜘蛛织毛线)

English | [简体中文](README.zh-CN.md)

A fully client-side knitting chart editor for hand knitters: draw grids, place stitch symbols, marquee-select and copy, annotate regions, and turn charts into row-by-row written instructions — with archiving and export built in. The build output is a single self-contained HTML file: double-click to run offline, no internet required.

## Features

### Projects & Charts
- Two-level structure: one project can hold multiple charts (e.g. body, sleeves, neckline)
- Project manager page: card view with last-edited time; click a chart chip to jump straight to that chart
- Chart tabs: click to switch, double-click to rename inline, delete, create (auto-named "Chart N")
- Chart locking: one-click lock from the tab bar. When locked, all editing operations (place / erase / paste / annotate / grid resize / undo-redo) are blocked to protect finished charts; a lock icon shows on the tab and the state is saved with the archive
- Last-changed time: shown at the right end of the tab bar. Chart-content operations (place / erase / border / annotation / column labels / grid / undo-redo) update it; non-content operations (lock/unlock, rename, favorite) do not. Saved with the archive

### Canvas
- Grid up to 200 × 200 cells (stitches × rows), zoom 0.5 – 2.5
- Row 1 starting side is switchable: right side (knit right-to-left) / left side (left-to-right)
- Manual column labels, row highlighting
- The symbol layer renders as a canvas bitmap (zero DOM nodes): large charts (e.g. 40 rows × 117 columns, 3200+ symbols) still switch and edit smoothly

### Symbols
- Built-in JIS standard knitting symbols, plus project-original symbols (e.g. 3×3 cable cross)
- Category filter (multi-select toggle) and a "favorites" pseudo-category (hover star at the top-left of a symbol)
- Symbols can only be deleted in manage mode (mistouch-proof); hide / restore supported

### Editing Tools
- Marquee select: drag out a rectangular region, combine with copy / delete / annotate / paste
- Border: drag-select to draw a pattern border box
- Eraser: click or drag to remove symbols and borders
- Annotation: attach text to a selected region (e.g. "Pattern A · 12-st repeat"), displayed as a cyan dashed box above the region
- Copy / paste: the pasted block aligns its bottom-left corner to the clicked cell
- Undo / redo — all chart operations go into history

### Written Instructions
- One click on "Written" in the top bar converts the current chart into row-by-row instructions: a modal with word-wrapped display (row numbers / WS badge / stitch highlighting), copy-all, and txt download
- RS / WS rows are derived automatically from the row 1 starting side (consistent with the canvas row-number position): RS rows read right→left as-is; WS rows read left→right with automatic conversion (knit ↔ purl swapped, twists become their purled counterparts, etc.)
- Blank cells are treated as background stitches (purled on RS rows, knitted on WS rows); consecutive identical stitches merge with a count; row prefix `r3:`, WS rows flagged "WS"
- File name: `ProjectName_ChartName.txt`

### Custom Symbol Editor
- Primitives: line, rectangle, ellipse, path, cubic Bézier curve (drag the start-end chord, then click twice to set the two curve points)
- Canvas size adapts to the symbol's width/height; size changes take effect as you type

### Save & Export
- Archive: save an entire project as JSON (v2 format, all charts included)
- Export chart: current chart only, as JSON (v1-compatible format for older versions)
- Importing always appends, never overwrites — a project bundle becomes a new project, a single chart is appended to the current project
- Saving uses the File System Access API to pop the system "Save As" dialog and can overwrite existing files; unsupported browsers fall back to a download
- SVG export: file name `ProjectName_ChartName.json/svg`, with an embedded `<title>`
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

1. Create a project → create a chart; set the grid width (stitches) and rows in the top bar, then click "Apply"
2. Click a symbol in the left palette, then click cells on the canvas to place it
3. Drag a region with the marquee tool: copy / delete / annotate the selection; with the paste tool, click a target cell to drop the block
4. Drag with the border tool to draw a pattern frame; use the eraser to remove mistakes
5. Top bar "Save" archives the whole project; "Export chart" saves only the current chart; "Load" appends from JSON; "Export SVG" for printing or sharing
6. Top bar "Written" shows the row-by-row instructions for the current chart; copy them or download as txt

### Keyboard Shortcuts

| Key | Action |
| --- | --- |
| Ctrl+Z | Undo |
| Ctrl+Y / Ctrl+Shift+Z | Redo |
| Ctrl+C | Copy selection |
| Ctrl+V | Paste |
| Delete / Backspace | Delete selection |
| Esc | Cancel selection / exit paste mode |

### Data & Archive Formats

- Autosave key `knitChartProto1` (localStorage)
- v2 project bundle: `{version:2, works:[...]}`; legacy v1 single-chart JSON can still be imported
- Legacy flat localStorage data auto-migrates into "My Project / Chart 1"

## Development

### Tech Stack

- Vue 3 (`<script setup>` Composition API), no other runtime dependencies
- Vite 7 + vite-plugin-singlefile (single-file output)
- Tailwind CSS 4 (@tailwindcss/vite plugin)
- Symbol pipeline: fast-xml-parser + svg-path-commander

### Directory Structure

```
├─ knitting-chart.html        # App entry HTML
├─ vite.config.js             # Single-file build config; entry: knitting-chart.html
├─ scripts/
│  └─ generate-symbols.mjs    # Extracts paths from external JIS symbol library SVGs, generates symbol data
├─ local-symbols/             # Project-original symbol SVGs (missing from the source library, e.g. 3×3 cable cross)
└─ src/
   ├─ main.js                 # Bootstrap
   ├─ App.vue                 # View switching (home = project manager / editor)
   ├─ ui.js                   # Session state (current view, loading overlay)
   ├─ store.js                # All business state & operations (centralized reactive store)
   ├─ util.js                 # Shared symbol rendering (symbolInnerMarkup / symDataUrl)
   ├─ symbols.js              # Symbol definitions (incl. dir field for local symbols)
   ├─ symbols.generated.js    # Generated file — do not edit by hand
   ├─ exportSvg.js            # SVG export
   ├─ textChart.js            # Pure chart→text conversion module (no Vue deps; callable from Node)
   ├─ selftest.js             # In-page self-test script
   ├─ style.css
   └─ components/
      ├─ HomeView.vue         # Project manager page
      ├─ TopBar.vue           # Top bar: project switcher, grid size, zoom, save/export, written instructions
      ├─ ChartTabs.vue        # Chart tabs
      ├─ ToolBar.vue          # Toolbar & global shortcuts
      ├─ ChartCanvas.vue      # Canvas: bitmap symbol layer + border/annotation/selection rendering & interaction
      ├─ PalettePanel.vue     # Symbol palette (categories / favorites / manage)
      ├─ SymbolArt.vue        # Single-symbol renderer
      ├─ TextChartModal.vue   # Written-instructions modal (display / copy / download)
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
- Self-test `runSelfTest`: switch to the editor view and tick first (the canvas DOM otherwise doesn't exist), and call `save()` at the end to leave a clean state; symbol-layer assertions use pixel sampling (the `window.__symLayer` hook + `blockHasInk`)
