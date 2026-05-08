# jv — JSON/JSONL Viewer

Interactive CLI viewer for JSON and JSONL files with syntax highlighting, folding, and search.

## Install

```bash
npm install -g jsonl-viewer
```

## Usage

```bash
jv data.json
jv records.jsonl
cat data.json | jv
curl -s https://api.example.com/data | jv
```

## Options

```
-t, --tab-width <n>   Indent width (default: 2)
--use-tabs             Indent with tabs
--wrap                 Enable line wrapping (default: off)
-h, --help             Show help
```

## Navigation

| Key | Action |
|-----|--------|
| `↑` / `k` | Scroll up |
| `↓` / `j` | Scroll down |
| `PgUp` / `b` | Page up |
| `PgDn` / `f` | Page down |
| `Home` / `g` | Jump to top |
| `End` / `G` | Jump to bottom |
| `←` / `h` | Scroll left (no-wrap) |
| `→` / `l` | Scroll right (no-wrap) |
| Mouse wheel | Scroll up/down |

## Folding

| Key | Action |
|-----|--------|
| `Enter` | Toggle fold on current line |
| Mouse click | Toggle fold on clicked line |

Folded sections show a summary like `{ ... 3 keys }` or `[ ... 5 items ]`.

## Search

| Key | Action |
|-----|--------|
| `/` | Start regex search |
| `n` | Next match |
| `N` | Previous match |
| `Esc` | Clear search |

Matches are highlighted with a dim yellow background.

## JSONL Support

JSONL files are lazy-loaded — only records near the viewport are parsed. This allows viewing multi-GB JSONL files with millions of records. Each record is displayed with a separator line.

## Dependencies

- [chromafi](https://github.com/F1LT3R/chromafi) — syntax highlighting

## License

MIT
