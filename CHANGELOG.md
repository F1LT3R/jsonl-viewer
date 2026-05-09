# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - 2026-05-08

### Added

- Line number gutter, shown by default; hide with `--no-numbers`
- Tail-first startup for JSONL — opens at the last page with the cursor on the last line of the last record
- Scroll-up pagination — earlier records load in 20-record chunks as the cursor approaches the top of the loaded window, with the on-screen view kept stable
- Status bar shows the loaded record range (`Records {start}-{end}/{total}`) and annotates search matches with `(loaded x-y/total)` when the window is partial

### Changed

- `loadRecordRange` now supports `replace` / `prepend` / `append` modes (internal)

### Fixed

- TDZ crash in lazy JSONL load (`loadedRangeStart` accessed before initialization)

## [0.1.0] - 2026-03-26

### Added

- Interactive CLI viewer for JSON and JSONL files
- Syntax highlighting via chromafi
- Fold/unfold JSON objects and arrays (Enter key or mouse click)
- Regex search with dim yellow background highlights (/, n, N navigation)
- Keyboard navigation: arrow keys, j/k, PgUp/PgDn, Home/End, g/G
- Mouse support: scroll wheel, click to fold/unfold
- Horizontal scrolling for wide JSON (h/l or arrow keys)
- `--wrap` mode for soft line wrapping
- Configurable indent width (`-t`, `--tab-width`)
- Tab indentation (`--use-tabs`)
- Lazy loading for JSONL files — byte-offset indexing with LRU cache for massive files
- JSONL records displayed with separator lines
- Reads from file argument or stdin pipe
- Alt screen buffer for clean terminal restore on exit
