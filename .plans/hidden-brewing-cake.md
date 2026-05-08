# Plan: JSONL Viewer CLI

## Context

Build a zero-dependency (except chromafi) Node.js CLI tool for viewing JSON and JSONL files in the terminal with syntax highlighting, fold/unfold, scrolling, and regex search.

**Constraints:** .mjs files, tabs, no semicolons, raw ANSI terminal (no blessed/ink), JSON.stringify for formatting (no prettier), chromafi for highlighting.

---

## Architecture

```
jsonl-viewer/
├── package.json
├── bin/jv.mjs              # CLI entry point, arg parsing, stdin/file read
├── lib/
│   ├── app.mjs             # Main app: state, render loop, event dispatch
│   ├── terminal.mjs        # Raw terminal control (alt screen, cursor, mouse)
│   ├── input.mjs           # Parse raw stdin → keyboard/mouse events
│   ├── reader.mjs          # Lazy JSONL reader: byte-offset index, on-demand record loading
│   ├── fold-model.mjs      # JSON → lines, bracket matching, fold state
│   ├── renderer.mjs        # Chromafi highlighting, visible line composition
│   ├── search.mjs          # Regex search, match tracking, ANSI highlight overlay
│   └── ansi.mjs            # ANSI string helpers (strip, length, slice)
├── CHANGELOG.md
└── README.md
```

Single external dependency: **chromafi** (CJS — loaded via `createRequire`).

**Critical: Lazy loading for JSONL.** JSONL files are NOT loaded into memory all at once. The file is scanned line-by-line to build a byte-offset index, then only the records near the current viewport are parsed/formatted/highlighted on demand. This allows viewing multi-GB JSONL files.

---

## Module Details

### `bin/jv.mjs` — Entry Point
- Parse CLI args manually from `process.argv`
- Read from file arg or stdin (detect with `process.stdin.isTTY`)
- **For JSONL files:** Call `reader.indexJsonlFile(path)` — builds byte-offset index without loading data. Pass the lazy reader to app.mjs.
- **For JSON files or stdin:** Read content, call `reader.parseJsonInput(content)` — immediate parse. Pass to app.mjs.
- Launch app with the reader handle

**CLI interface:**
```
jv [options] [file]
  -t, --tab-width <n>    Indent width (default: 2)
  -w, --print-width <n>  Max line width (default: terminal cols)
  --use-tabs             Indent with tabs
  --wrap                 Enable line wrapping (default: off, horizontal scroll)
  -h, --help             Show help
```

### `lib/reader.mjs` — Lazy JSONL Reader

Handles both JSON and JSONL files with lazy loading for JSONL.

**JSON mode (single file or stdin):**
- Read entire content, parse once, format with JSON.stringify
- Small files — no lazy loading needed

**JSONL mode (`.jsonl` extension or detected multi-line JSON objects):**
1. **Index pass:** Scan file with `fs.createReadStream` + readline to build byte-offset index:
   ```javascript
   // index: array of { offset, length } for each line
   [
     { offset: 0, length: 142 },      // record 0
     { offset: 143, length: 89 },     // record 1
     ...
   ]
   ```
2. **On-demand loading:** When a record is needed:
   - Open file, seek to `offset`, read `length` bytes via `fs.read()` with a Buffer
   - Parse JSON, format with JSON.stringify, highlight with chromafi
   - Cache result in an LRU cache (keep ~50 records around viewport)
3. **Navigation:** The app requests records by index. The reader returns formatted+highlighted lines for that record.

**Exports:**
- `indexJsonlFile(filePath)` → `{ totalRecords, getRecord(index) }`
  - `getRecord(index)` → `Promise<{ plain: string[], highlighted: string[] }>`
- `parseJsonInput(content)` → `{ records: [{ plain, highlighted }], isSingleJson }`
  - For stdin/JSON files — immediate, non-lazy
- `LRUCache` — internal, keeps ~50 most recently accessed records

**Why lazy:** A 10GB JSONL file with millions of records can't fit in memory. By indexing byte offsets, we can jump to any record in O(1) and only parse what's visible.

### `lib/terminal.mjs` — Terminal Control
Exports:
- `enterAltScreen()` — switch to alternate screen buffer
- `exitAltScreen()` — restore original screen
- `enableMouse()` / `disableMouse()` — SGR mouse mode (`\x1b[?1006h`)
- `enableRawMode()` / `disableRawMode()` — stdin raw mode
- `hideCursor()` / `showCursor()`
- `moveTo(row, col)` — `\x1b[row;colH`
- `clearScreen()` — `\x1b[2J`
- `clearLine()` — `\x1b[2K`
- `getSize()` → `{ rows, cols }`
- `onResize(callback)` — listen to SIGWINCH
- `write(str)` — process.stdout.write

### `lib/input.mjs` — Input Parser
Exports: `parseInput(buffer)` → array of events

Event types:
- `{ type: 'key', name: 'up'|'down'|'left'|'right'|'pageup'|'pagedown'|'home'|'end'|'enter'|'escape'|'backspace'|'tab' }`
- `{ type: 'key', name: 'char', char: 'q' }` — printable character
- `{ type: 'mouse', action: 'click'|'wheel-up'|'wheel-down', row, col }`

Parse ANSI escape sequences:
- `\x1b[A` → up, `\x1b[B` → down, etc.
- `\x1b[5~` → pageup, `\x1b[6~` → pagedown
- `\x1b[H` → home, `\x1b[F` → end
- SGR mouse: `\x1b[<button;col;row[Mm]`

### `lib/fold-model.mjs` — Fold Model

**Data structure:**
```javascript
// Each line in the document
{
	lineIndex,        // index in full line array
	text,             // plain text content
	highlighted,      // ANSI-highlighted content
	depth,            // nesting depth
	foldable,         // true if line ends with { or [
	foldId,           // unique id for foldable lines
	foldEndIndex,     // lineIndex of matching } or ]
	isSeparator,      // true for JSONL separator lines
}

// Fold state: Map<foldId, boolean> (true = folded)
```

**Algorithm — bracket matching:**
1. Walk lines top-to-bottom with a stack
2. When line ends with `{` or `[` (ignoring trailing comma/whitespace): push onto stack, mark as foldable
3. When line is `}` or `]` (with optional comma): pop stack, record foldEnd on the matching open line

**Visible lines computation:**
1. Walk lines top-to-bottom
2. If line is inside a folded range → skip
3. If line is a fold-start and folded → emit summary line: `  { ... 3 keys }` or `  [ ... 5 items ]`
4. Otherwise → emit line as-is

Exports:
- `buildFoldModel(plainLines, highlightedLines)` → `{ lines, foldState }`
- `getVisibleLines(lines, foldState)` → array of visible line objects
- `toggleFold(foldState, foldId)` — flip fold state
- `getFoldIdAtLine(visibleLines, visibleIndex)` — returns foldId if line is foldable

### `lib/renderer.mjs` — Rendering

**Strategy:** Run chromafi ONCE on the full formatted JSON string. Split into lines. Store both plain and highlighted versions. Fold/unfold selects from pre-highlighted lines.

Exports:
- `highlight(jsonString)` → array of highlighted lines
- `renderFoldSummary(text, depth)` → highlighted summary for folded section
- `composeLine(highlightedLine, cols, wrap, hScrollOffset)` → final string to write
  - If `wrap`: soft-wrap at `cols`
  - If no wrap: slice at `hScrollOffset` to `hScrollOffset + cols`

Chromafi config:
```javascript
chromafi(jsonString, {
	lang: 'json',
	lineNumbers: false,
	codePad: 0,
	indent: tabWidth,
	tabsToSpaces: tabWidth,
})
```

### `lib/search.mjs` — Search Engine

**State:**
```javascript
{
	pattern: '',        // current regex string
	regex: null,        // compiled RegExp
	matches: [],        // [{ visibleLineIdx, startCol, endCol }, ...]
	currentMatch: -1,   // index into matches array
}
```

**ANSI-aware highlight overlay:**
1. For each visible line, strip ANSI codes to get plain text
2. Run regex.exec() in a loop to find all matches
3. For each match: use ansi.mjs `sliceAnsi()` to split the highlighted line at match boundaries
4. Wrap match segment with `\x1b[2;43m` (dim yellow background) + `\x1b[0m` reset after

Exports:
- `createSearch()` → search state object
- `executeSearch(state, visiblePlainLines)` → updates matches array
- `nextMatch(state)` / `prevMatch(state)` → navigate
- `highlightLine(highlightedLine, plainLine, regex)` → line with match highlights
- `getCurrentMatchLine(state)` → visible line index of current match

### `lib/ansi.mjs` — ANSI Utilities

Exports:
- `stripAnsi(str)` → plain text (regex: `/\x1b\[[0-9;]*m/g`)
- `ansiLength(str)` → visible character count
- `sliceAnsi(str, start, end)` → slice by visible char positions, preserving ANSI state
  - Walk character by character, tracking active ANSI codes
  - When entering the slice range: prepend active codes
  - When exiting: append reset

### `lib/app.mjs` — Main Application

**State:**
```javascript
{
	// Data
	lines: [],              // full fold model lines
	foldState: Map,         // fold states
	visibleLines: [],       // current visible lines

	// Viewport
	scrollRow: 0,           // top visible line
	scrollCol: 0,           // horizontal scroll offset (no-wrap mode)
	viewportRows: 0,        // terminal rows - 1 (status bar)
	viewportCols: 0,        // terminal cols

	// Mode
	mode: 'normal',         // 'normal' | 'search'

	// Search
	search: searchState,

	// Config
	config: { tabWidth, printWidth, useTabs, wrap },
}
```

**Render cycle:**
1. Recompute visibleLines from fold model
2. For each viewport row (0 to viewportRows-1):
   - Get visible line at `scrollRow + rowIndex`
   - Apply search highlights if active
   - Compose line (truncate/wrap, handle hScroll)
   - Write to terminal at row position
3. Draw status bar at bottom row

**Event dispatch (normal mode):**
| Input | Action |
|-------|--------|
| `↑` / `k` | scrollRow-- |
| `↓` / `j` | scrollRow++ |
| `PgUp` / `b` | scrollRow -= viewportRows |
| `PgDn` / `f` / `Space` | scrollRow += viewportRows |
| `Home` / `g` | scrollRow = 0 |
| `End` / `G` | scrollRow = visibleLines.length - viewportRows |
| `←` / `h` | scrollCol -= 4 (no-wrap only) |
| `→` / `l` | scrollCol += 4 (no-wrap only) |
| `Enter` on foldable | toggleFold, recompute |
| Mouse wheel up | scrollRow -= 3 |
| Mouse wheel down | scrollRow += 3 |
| Mouse click on foldable | toggleFold, recompute |
| `/` | enter search mode |
| `n` | next search match, scroll to it |
| `N` | prev search match, scroll to it |
| `q` | quit |

**Event dispatch (search mode):**
| Input | Action |
|-------|--------|
| Printable char | append to search pattern, live-update matches |
| `Backspace` | remove last char from pattern |
| `Enter` | confirm search, jump to first match, return to normal mode |
| `Esc` | cancel search, clear pattern, return to normal mode |

**Status bar content:**
- Normal (no search): `Line X/Y │ /search │ Enter=fold │ q=quit`
- Normal (with search): `Match X/Y │ n=next N=prev Esc=clear │ q=quit`
- Search mode: `/pattern█` (blinking cursor)

---

## Key Behaviors

**Wrap mode:** When `--wrap` is set, long lines soft-wrap at terminal width. Scroll is vertical only. When wrap is off (default), long lines extend beyond viewport and horizontal scroll (`←`/`→`/`h`/`l`) pans the view.

**JSONL separators:** Separator lines (`─── Record N ───`) are rendered with dim styling, are NOT foldable, and are included in search.

**JSONL lazy loading flow:**
1. On startup: index file (fast scan, no parsing)
2. App state tracks `currentRecordStart` (first visible record index) + how many records fit in viewport
3. When viewport changes: load visible records via `getRecord(index)` (async, cached)
4. Each loaded record gets its own fold model instance
5. Scrolling within a record: normal line-based scroll
6. Scrolling past a record boundary: load the next/prev record on demand
7. Status bar shows `Record X/Y` for JSONL files

**Resize handling:** On SIGWINCH, recalculate viewport dimensions and re-render.

**Graceful exit:** On quit or SIGINT: disable mouse, restore cursor, exit alt screen, disable raw mode.

**Large files:** chromafi runs once upfront. All fold/unfold/search ops work on pre-computed line arrays — no re-highlighting needed (except small fold summary strings).

---

## Implementation Order

1. **package.json** + **terminal.mjs** + **input.mjs** — get a raw terminal with keyboard/mouse
2. **ansi.mjs** — ANSI string utilities
3. **reader.mjs** — lazy JSONL indexer + on-demand record loader + LRU cache
4. **fold-model.mjs** — line model, bracket matching, fold state
5. **renderer.mjs** — chromafi integration, line composition
6. **app.mjs** — main loop, scrolling, fold toggle, status bar, lazy record stitching
7. **search.mjs** — regex search, match navigation, highlight overlay
8. **bin/jv.mjs** — CLI arg parsing, stdin/file reading, launch app
9. Wire everything together, test end-to-end with large JSONL files

---

## Verification

1. `echo '{"a":1,"b":{"c":[1,2,3]}}' | node bin/jv.mjs` — view piped JSON
2. `node bin/jv.mjs test.json` — view file
3. `node bin/jv.mjs test.jsonl` — view JSONL with separators
4. Test scrolling: arrow keys, j/k, PgUp/PgDn, mouse wheel
5. Test folding: Enter on `{`/`[` lines, click on them
6. Test search: `/` type regex, Enter, `n`/`N` navigation, dim yellow highlights
7. Test resize: resize terminal window during viewing
8. Test horizontal scroll: view wide JSON without `--wrap`, use `←`/`→`
9. Test `--wrap` mode: confirm soft wrapping
10. Test `--tab-width 4` and `--use-tabs`
