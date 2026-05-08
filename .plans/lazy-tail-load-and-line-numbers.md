# Plan: Tail-First Lazy Loading + Scroll Pagination + Line Numbers

## Audience

A fresh Claude Opus agent picking this up cold. Read this plan, then read the codebase. Everything you need is here — don't re-derive decisions.

## Repo

`~/repos/jsonl-viewer` — symlinked via `npm link`, so the global `jv` command runs this code directly. No rebuild step. Just edit files and run `jv <file>`.

Starting commit: `64b4de2` (root commit, "Initial commit: jv v0.1.0"). Branch: `main`.

## What's already in place at the start commit

The starting commit already includes **partial WIP** for line numbers — finish it, don't redo it:

- `bin/jv.mjs`
  - `config.showLineNumbers = true` default — keep
  - `--no-numbers` flag parsing — keep
  - Help text mentions `--no-numbers` — keep
- `lib/app.mjs`
  - `showLineNumbers` destructured from config — keep
  - `computeGutterWidth()` helper exists, scans `allLines` for max `lineIndex` — keep
  - `gutterWidth` is computed and passed as the 9th and 10th args to `composeView` — keep, but `composeView`'s signature doesn't accept them yet, so they're ignored at runtime
  - TDZ fix: `loadedRangeStart` and `loadedRangeEnd` declared at the top of `createApp` before `loadRecordRange` is called — keep
- `lib/renderer.mjs` — **untouched**. Doesn't accept the new params. This is your starting point for the gutter work.
- Test fixtures
  - `test.json` — 24-line single JSON object
  - `test.jsonl` — 5 records
  - `test-big.jsonl` — 100 records (use this to validate paging)

## Goals (final state)

1. **Line numbers shown by default**, hidden with `--no-numbers`. Per-record numbering (`lineIndex + 1` within each record). Separator lines have a blank gutter. In `--wrap` mode, only the first wrapped segment of a logical line gets the number.
2. **Tail-first startup for `.jsonl`** — opening a JSONL file shows the *last* page of records, not the first. Cursor starts on the last line of the last record.
3. **Natural display order** — records appear top-to-bottom in file order (record 81 above record 100, not reversed).
4. **Scroll-up pagination** — when the user scrolls toward the top of the loaded window, the previous chunk is loaded and prepended, with `cursorRow`/`scrollRow` shifted so the on-screen view doesn't jump.
5. **Search remains scoped to loaded records** (deliberate, deferred work). As more records load via scroll, subsequent searches see them. Status bar should make this visible.

## Non-goals (explicitly out of scope — do not do)

- Searching unloaded records.
- Streaming/follow-mode (file appended while open).
- Reverse display order (newest-on-top).
- Async background prefetch / loading spinner.
- Persisting search match position across reloads.
- Touching the non-lazy path (single JSON, stdin, multi-record JSON via `parseJsonInput`) beyond what line numbers require.

---

## Design decisions (already made — don't re-litigate)

### Page size and prefetch threshold

```js
const PAGE_SIZE = 20         // records per chunk
const LOAD_THRESHOLD = 5     // visible rows from top of buffer that triggers preload
```

Put these as module-level `const`s in `lib/app.mjs`.

### Gutter format

- Width = `digits + 1` where `digits = String(maxLineIndex + 1).length`. Computed in `computeGutterWidth()`. Already exists.
- Numbered cell: `\x1b[2m${num.padStart(digits)} \x1b[22m`
  - `\x1b[2m` = dim
  - `\x1b[22m` = reset bold/dim only (does NOT clear cursor bg, unlike `\x1b[0m`)
- Blank cell (separator lines, wrap-continuation segments): `' '.repeat(gutterWidth)` — plain spaces, no SGR.

### Per-record numbering

`line.lineIndex` from `buildFoldModel` is the 0-based line within the record. Display `line.lineIndex + 1`. Separator lines (`isSeparator: true`, `lineIndex: -1`) get the blank cell.

### Tail-first initial load

Initial load range: `[max(0, totalRecords - PAGE_SIZE), totalRecords)`. Cursor starts at `visibleLines.length - 1`.

### Append/prepend semantics for `loadRecordRange`

The current implementation rebuilds `allLines = []` on every call (replace-only). Refactor to support a `mode` parameter:

```js
async function loadRecordRange(ds, start, end, mode = 'replace')
// mode: 'replace' | 'prepend' | 'append'
// returns: { prependedLineCount }
```

- `'replace'`: current behavior. Used at startup.
- `'prepend'`: build new lines into a temp array, then `allLines = newLines.concat(allLines)`. Update `loadedRangeStart`. Add new fold-state entries to the existing `foldState` map.
- `'append'`: opposite of prepend. Used by future scroll-down work — leave the branch in even if not wired to a UI path yet, since pagination from a non-tail starting position would need it. (Currently dead code; that's fine.)

### View-stability after prepend

After prepending N visible lines:

```js
cursorRow += prependedLineCount
scrollRow += prependedLineCount
```

This keeps the same actual content under the cursor. The fold-state for prepended records starts unfolded (default), so prepended **all-lines count == prepended visible-lines count**. This identity is what makes the shift trivially correct. Don't break it (e.g. don't pre-fold prepended chunks).

### When to trigger prepend

In the input handler, after any cursor-moving event, check:

```js
if (loadedRangeStart > 0 && scrollRow <= LOAD_THRESHOLD) {
  await loadRecordRange(ds, max(0, loadedRangeStart - PAGE_SIZE),
                        loadedRangeStart, 'prepend')
  recomputeVisible()
  cursorRow += prependedLineCount
  scrollRow += prependedLineCount
  clampCursor()
  ensureCursorVisible()
}
```

Convert the `process.stdin.on('data', ...)` handler in `app.mjs:run()` to an `async` callback so you can `await` the load. Acceptable to block input for one chunk-load duration (~tens of ms for typical JSONL).

### Search across reloads

`recomputeVisible()` already calls `executeSearch(search, visibleLines)` if `search.regex`. After a prepend, this re-runs and the matches array now includes prepended records. **Reset `search.currentMatch = 0`** after re-execute — don't try to preserve prior position. This is a known minor UX hit.

### Status bar additions

Update `buildStatusBar` in `app.mjs` so the normal-mode left side shows loaded-range info for lazy mode:

- Single JSON / non-lazy: unchanged (`Line N/M [foldable]`)
- Lazy JSONL: `Line N/M [foldable] | Records {loadedStart+1}-{loadedEnd}/{total}`

For search-active mode, append a `(loaded {x}-{y})` hint when not all records are loaded:

- All loaded: `Match 3/12`
- Partial: `Match 3/12 (loaded 41-100/200)`

---

## Implementation steps

Each step ends with a commit. Use `Co-Authored-By: SunGun™ Orchestrator <noreply@sungun.dev>` per `~/.claude/CLAUDE.md`.

### Step 1 — Finish line numbers in renderer

Edit `lib/renderer.mjs`. Update `composeView` signature to accept the trailing two args:

```js
export const composeView = (
  visibleLines,
  viewportRows,
  viewportCols,
  scrollRow,
  scrollCol,
  wrap,
  searchHighlighter,
  cursorRow,
  showLineNumbers = false,
  gutterWidth = 0,
)
```

Add a helper local to `composeView`:

```js
const formatGutter = (line, isContinuation) => {
  if (!showLineNumbers || gutterWidth === 0) return ''
  if (isContinuation || line.lineIndex < 0) {
    return ' '.repeat(gutterWidth)
  }
  const digits = gutterWidth - 1
  const num = String(line.lineIndex + 1).padStart(digits)
  return `\x1b[2m${num} \x1b[22m`
}
```

Compute `contentCols = showLineNumbers ? Math.max(1, viewportCols - gutterWidth) : viewportCols`.

In both wrap and no-wrap paths:

- Pass `contentCols` (not `viewportCols`) to `composeLine`.
- After getting the segment(s), prepend `formatGutter(line, segIdx > 0)`.
- Then call `applyCursorStyle(line, viewportCols)` if `lineIdx === cursorRow`. (Pad target stays full viewport, so cursor highlight covers the gutter too.)

For the wrap path, when iterating segments, track index — first segment gets the number, rest get blanks.

#### Verification

```sh
jv test.json                # gutter visible, dim numbers, cursor highlight covers gutter
jv --no-numbers test.json   # no gutter
jv --wrap test.json         # wrapped continuations have blank gutter
jv test.jsonl               # separator lines have blank gutter
```

#### Commit

> `feat: line number gutter with --no-numbers opt-out`

### Step 2 — Refactor `loadRecordRange` for prepend/append

Edit `lib/app.mjs`. Add module-level constants near the top of the file (above `createApp`):

```js
const PAGE_SIZE = 20
const LOAD_THRESHOLD = 5
```

Refactor `loadRecordRange` to:

```js
async function loadRecordRange(ds, start, end, mode = 'replace') {
  const actualEnd = Math.min(end, ds.totalRecords)
  const newLines = []
  const newFoldEntries = []

  for (let i = start; i < actualEnd; i++) {
    newLines.push(buildSeparatorLine(i, ds.totalRecords))
    const record = await ds.getRecord(i)
    if (!record) continue
    const { plainLines, highlightedLines } = record
    const model = buildFoldModel(plainLines, highlightedLines)
    const offset = newLines.length
    for (const line of model.lines) newLines.push(line)
    for (const [k, v] of model.foldState) {
      newFoldEntries.push([`${i}_${k}`, v])
    }
    for (let j = offset; j < newLines.length; j++) {
      if (newLines[j].foldId !== null) {
        const oldId = newLines[j].foldId
        newLines[j].foldId = `${i}_${oldId}`
      }
    }
  }

  let prependedLineCount = 0
  if (mode === 'replace') {
    allLines = newLines
    foldState = new Map(newFoldEntries)
    loadedRangeStart = start
    loadedRangeEnd = actualEnd
  } else if (mode === 'prepend') {
    prependedLineCount = newLines.length
    allLines = newLines.concat(allLines)
    for (const [k, v] of newFoldEntries) foldState.set(k, v)
    loadedRangeStart = start
  } else if (mode === 'append') {
    allLines = allLines.concat(newLines)
    for (const [k, v] of newFoldEntries) foldState.set(k, v)
    loadedRangeEnd = actualEnd
  }

  return { prependedLineCount }
}
```

Update the **initial** call (currently at `app.mjs:37`) to tail-first:

```js
if (dataSource.lazy) {
  isJsonl = true
  totalRecords = dataSource.totalRecords
  const start = Math.max(0, totalRecords - PAGE_SIZE)
  await loadRecordRange(dataSource, start, totalRecords, 'replace')
}
```

#### Verification

`jv test-big.jsonl` opens. Status bar shows records 81-100/100 (assuming you've finished Step 4 — for now just confirm no crash and you see the last page). Cursor will be at top until Step 3.

#### Commit

> `refactor: loadRecordRange supports replace/prepend/append modes; tail-first init`

### Step 3 — Cursor starts at bottom

Right after the initial `recomputeVisible()` call in `run()` (in `app.mjs`), set:

```js
if (dataSource.lazy) {
  cursorRow = Math.max(0, visibleLines.length - 1)
}
```

This must happen **after** `recomputeVisible()` populates `visibleLines`. Then `clampCursor()` and `ensureCursorVisible()` will adjust `scrollRow` to bring the bottom into view.

#### Verification

`jv test-big.jsonl` → cursor on last line of record 100, viewport scrolled to bottom.

#### Commit

> `feat: tail-first cursor placement on jsonl open`

### Step 4 — Status bar shows loaded range

Edit `buildStatusBar` in `app.mjs`. Add the records count when in lazy mode and not all loaded:

```js
if (isJsonl) {
  if (dataSource.lazy) {
    left += ` | Records ${loadedRangeStart + 1}-${loadedRangeEnd}/${totalRecords}`
  } else {
    left += ` | ${totalRecords} records`
  }
}
```

For search-active mode:

```js
if (search.active && search.matches.length > 0) {
  let matchPart = `Match ${search.currentMatch + 1}/${search.matches.length}`
  if (dataSource.lazy && (loadedRangeStart > 0 || loadedRangeEnd < totalRecords)) {
    matchPart += ` (loaded ${loadedRangeStart + 1}-${loadedRangeEnd}/${totalRecords})`
  }
  left = matchPart
  // ...
}
```

(`dataSource` is in scope inside `createApp` — reference it directly.)

#### Verification

`jv test-big.jsonl` shows `Records 81-100/100`. After Step 5, scroll up, watch the range expand.

#### Commit

> `feat: status bar shows loaded record range`

### Step 5 — Scroll-triggered prepend

In `app.mjs`, add a helper near `recomputeVisible`:

```js
const maybeLoadAbove = async () => {
  if (!dataSource.lazy) return
  if (loadedRangeStart === 0) return
  if (scrollRow > LOAD_THRESHOLD) return

  const newStart = Math.max(0, loadedRangeStart - PAGE_SIZE)
  const { prependedLineCount } = await loadRecordRange(
    dataSource, newStart, loadedRangeStart, 'prepend',
  )
  recomputeVisible()
  cursorRow += prependedLineCount
  scrollRow += prependedLineCount
  clampCursor()
  ensureCursorVisible()
}
```

Convert the stdin data handler in `run()` to async and call `maybeLoadAbove` after each event batch:

```js
process.stdin.on('data', async (data) => {
  const events = parseInput(data)
  for (const event of events) {
    if (mode === 'search') handleSearchInput(event)
    else handleNormalInput(event)
    if (!running) {
      terminal.teardown()
      if (dataSource.close) dataSource.close()
      process.exit(0)
    }
  }
  await maybeLoadAbove()
  render()
})
```

#### Verification

`jv test-big.jsonl` → cursor at record 100 line N. Press `g` (or repeated `k`) to go to top → as `scrollRow` drops to ≤ 5, the next chunk loads, status bar shows `Records 61-100/100`, view stays anchored on the same content. Continue until `Records 1-100/100`.

Edge cases:

- File with `total ≤ PAGE_SIZE` (e.g. `test.jsonl` 5 records): `loadedRangeStart === 0` from the start, `maybeLoadAbove` no-ops.
- Plain JSON: `dataSource.lazy` is undefined, `maybeLoadAbove` no-ops.

#### Commit

> `feat: scroll-up triggers chunk prepend with stable view`

### Step 6 — Update CHANGELOG and README

Edit `CHANGELOG.md` — add a new section above `[0.1.0]`:

```md
## [0.2.0] - 2026-05-08

### Added
- Line number gutter (default on; `--no-numbers` to hide)
- Tail-first startup for JSONL — opens at the last page, cursor on last record
- Scroll-up pagination — earlier records load in 20-record chunks as you scroll up
- Status bar shows loaded-record range for lazy JSONL

### Changed
- `loadRecordRange` now supports `replace` / `prepend` / `append` modes (internal)

### Fixed
- TDZ crash in lazy JSONL load (`loadedRangeStart` accessed before initialization)
```

Edit `README.md` — add `--no-numbers` to the flags list and a short note about tail-first behavior:

```md
JSONL files open at the last record (tail-first). Scroll up to load earlier records in 20-record pages. Search currently covers loaded records only — scroll first to expand the search window.
```

Bump `package.json` version to `0.2.0`.

Run `npm link` (binary entry didn't change but version did; safe).

#### Commit

> `chore: bump v0.2.0; document tail-load and line numbers`

### Step 7 — Manual smoke test (record results)

Run each and confirm:

- [ ] `jv test.json` — line numbers visible, cursor at top, no records-bar (single JSON, non-lazy)
- [ ] `jv --no-numbers test.json` — no gutter
- [ ] `jv test.jsonl` — 5 records, all loaded, cursor at last line of record 5, status shows `Records 1-5/5`
- [ ] `jv test-big.jsonl` — opens at records 81-100, cursor at last line of record 100
- [ ] In `test-big.jsonl`, press `g` → scrolls to top, status updates to `Records 61-100/100`, then `41-100/100`, etc., until `1-100/100`. View doesn't jump.
- [ ] Search `/Alice` in `test-big.jsonl` immediately after open → matches found only in records 81-100. Scroll up to load all, run `/Alice` again → matches across full file.
- [ ] Fold a key inside record 95, scroll up to load earlier records → fold state preserved.
- [ ] `jv --wrap test.json` — wrap on, line numbers only on first segment of each logical line.

If anything fails, debug; don't proceed to Step 8 with known regressions.

### Step 8 — Final review

Run through the diff (`git diff 64b4de2..HEAD`) and check:

- No leftover `console.log` / debug code.
- No comments narrating what the code is doing or why this PR exists.
- `loadedRangeStart`/`End` are honest (always reflect actual loaded range).
- No path that does `allLines = []` outside of the `replace` branch in `loadRecordRange`.

---

## Things that will trip you up

- **`composeView` signature is positional, not keyed.** When passing `showLineNumbers`/`gutterWidth`, they're args 9 and 10. If you reorder, update the call site in `app.mjs`.
- **`applyCursorStyle` uses `\x1b[0m` reset.** Don't worry about cursor bg bleeding across the gutter — `\x1b[0m` at the very end clears everything together. The reason the gutter uses `\x1b[22m` instead is so the *content's* color escapes that follow don't get cleared *before* `applyCursorStyle` wraps. (If you accidentally write `\x1b[0m` in the gutter, the cursor row's bg highlight will visually break at the gutter/content boundary.)
- **Don't pre-fold prepended chunks.** The `cursorRow += prependedLineCount` shift relies on `prependedLineCount === prepended-visible-line-count`. Pre-folding breaks that.
- **Don't `await` inside `render()`.** Loading goes in the input handler. Render must remain synchronous.
- **`search.matches` indices are into `visibleLines`.** After `recomputeVisible` they get rebuilt. Don't cache match positions outside `executeSearch`.
- **`reader.mjs` LRU cache (size 50).** Means after scrolling around a 200+ record file, the same record is decoded multiple times. Acceptable. If you want to bump the cap, edit `reader.mjs:14`. Don't make it unbounded.
- **`buildFoldModel` and `buildSeparatorLine` are imported in `app.mjs`.** They're used by `loadRecordRange` only — don't accidentally drop the imports during refactor.

## Files you will touch

- `bin/jv.mjs` — no changes needed (line-numbers flag already plumbed)
- `lib/app.mjs` — major: refactor loadRecordRange, add maybeLoadAbove, async input handler, status-bar updates, tail-first init, cursor placement
- `lib/renderer.mjs` — moderate: gutter rendering in `composeView`
- `package.json` — version bump
- `CHANGELOG.md` — new section
- `README.md` — flag + behavior notes

Files you should **not** need to touch: `lib/reader.mjs`, `lib/fold-model.mjs`, `lib/search.mjs`, `lib/input.mjs`, `lib/terminal.mjs`, `lib/ansi.mjs`.

## Done criteria

All items in Step 7's checklist pass. Diff is clean. CHANGELOG entry covers the changes. Commits use SunGun co-author. Branch is on `main`.
