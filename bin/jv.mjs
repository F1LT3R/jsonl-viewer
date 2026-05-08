#!/usr/bin/env node

// Suppress highlight.js v9 deprecation warning from chromafi
const origWarn = process.emitWarning
process.emitWarning = (msg, ...args) => {
	if (typeof msg === 'string' && msg.includes('DEP0128')) return
	origWarn.call(process, msg, ...args)
}

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { indexJsonlFile, parseJsonInput } from '../lib/reader.mjs'
import { createApp } from '../lib/app.mjs'

const args = process.argv.slice(2)

const config = {
	tabWidth: 2,
	useTabs: false,
	wrap: false,
	showLineNumbers: true,
}

let filePath = null

// Parse args
for (let i = 0; i < args.length; i++) {
	const arg = args[i]

	if (arg === '-h' || arg === '--help') {
		printHelp()
		process.exit(0)
	}

	if (arg === '-t' || arg === '--tab-width') {
		config.tabWidth = parseInt(args[++i], 10) || 2
		continue
	}

	if (arg === '--use-tabs') {
		config.useTabs = true
		continue
	}

	if (arg === '--wrap') {
		config.wrap = true
		continue
	}

	if (arg === '--no-numbers') {
		config.showLineNumbers = false
		continue
	}

	if (arg === '-w' || arg === '--print-width') {
		// Stored but used by app via terminal cols
		i++
		continue
	}

	// Positional arg = file path
	if (!arg.startsWith('-')) {
		filePath = resolve(arg)
	}
}

function printHelp() {
	const help = `
jv — JSON/JSONL viewer

Usage: jv [options] [file]
       cat file.json | jv

Options:
  -t, --tab-width <n>   Indent width (default: 2)
  --use-tabs             Indent with tabs
  --wrap                 Enable line wrapping (default: off)
  --no-numbers           Hide line number gutter (default: shown)
  -h, --help             Show this help

Navigation:
  ↑/k, ↓/j              Scroll line by line
  PgUp/b, PgDn/f        Scroll by page
  Home/g, End/G          Jump to top/bottom
  ←/h, →/l              Horizontal scroll (no-wrap)
  Mouse wheel            Scroll up/down

Folding:
  Enter                  Toggle fold on current line
  Mouse click            Toggle fold on clicked line

Search:
  /                      Start search (regex)
  n                      Next match
  N                      Previous match
  Esc                    Clear search

  q                      Quit
`.trim()
	console.log(help)
}

async function main() {
	let dataSource

	if (filePath) {
		if (!existsSync(filePath)) {
			console.error(`Error: file not found: ${filePath}`)
			process.exit(1)
		}

		const isJsonl = filePath.endsWith('.jsonl') ||
			filePath.endsWith('.ndjson')

		if (isJsonl) {
			// Lazy loading for JSONL
			const reader = await indexJsonlFile(filePath, config)
			dataSource = {
				lazy: true,
				totalRecords: reader.totalRecords,
				getRecord: reader.getRecord,
				close: reader.close,
			}
		} else {
			// Read entire JSON file
			const content = readFileSync(filePath, 'utf8')
			dataSource = parseJsonInput(content, config)
		}
	} else if (!process.stdin.isTTY) {
		// Read from stdin
		const chunks = []
		for await (const chunk of process.stdin) {
			chunks.push(chunk)
		}
		const content = Buffer.concat(
			chunks.map((c) =>
				typeof c === 'string' ? Buffer.from(c) : c
			)
		).toString('utf8')
		dataSource = parseJsonInput(content, config)
	} else {
		printHelp()
		process.exit(0)
	}

	const app = await createApp(dataSource, config)
	await app.run()
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
