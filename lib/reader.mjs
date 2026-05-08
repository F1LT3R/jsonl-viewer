import { createReadStream } from 'fs'
import { open } from 'fs/promises'
import { createInterface } from 'readline'
import { createRequire } from 'module'

// Chromafi uses chalk which checks color support —
// force it on since we render to alt screen
process.env.FORCE_COLOR = '1'

const require = createRequire(import.meta.url)
const chromafi = require('chromafi')

class LRUCache {
	constructor(maxSize = 50) {
		this.maxSize = maxSize
		this.map = new Map()
	}

	get(key) {
		if (!this.map.has(key)) return undefined
		const val = this.map.get(key)
		// Move to end (most recent)
		this.map.delete(key)
		this.map.set(key, val)
		return val
	}

	set(key, val) {
		if (this.map.has(key)) {
			this.map.delete(key)
		} else if (this.map.size >= this.maxSize) {
			// Evict oldest (first key)
			const oldest = this.map.keys().next().value
			this.map.delete(oldest)
		}
		this.map.set(key, val)
	}
}

const formatRecord = (obj, tabWidth, useTabs) => {
	const indent = useTabs ? '\t' : tabWidth
	const plain = JSON.stringify(obj, null, indent)
	return plain
}

const highlightText = (text, tabWidth) => {
	try {
		const result = chromafi(text, {
			lang: 'json',
			lineNumbers: false,
			codePad: 0,
			indent: tabWidth,
			tabsToSpaces: tabWidth,
		})
		return result
	} catch {
		return null
	}
}

const processRecord = (text, tabWidth) => {
	const highlighted = highlightText(text, tabWidth)
	const plainLines = text.split('\n')
	let highlightedLines = highlighted
		? highlighted.split('\n')
		: [...plainLines]

	// Chromafi may add trailing empty lines — trim to match plain
	while (highlightedLines.length > plainLines.length) {
		highlightedLines.pop()
	}
	// Pad if chromafi produced fewer lines
	while (highlightedLines.length < plainLines.length) {
		highlightedLines.push(plainLines[highlightedLines.length])
	}

	return { plainLines, highlightedLines }
}

export const indexJsonlFile = async (filePath, config = {}) => {
	const { tabWidth = 2, useTabs = false } = config
	const index = []
	let offset = 0

	const stream = createReadStream(filePath, { encoding: 'utf8' })
	const rl = createInterface({ input: stream, crlfDelay: Infinity })

	for await (const line of rl) {
		const trimmed = line.trim()
		if (trimmed.length > 0) {
			index.push({
				offset,
				length: Buffer.byteLength(line, 'utf8'),
			})
		}
		// +1 for newline
		offset += Buffer.byteLength(line, 'utf8') + 1
	}

	const cache = new LRUCache(50)
	let fileHandle = null

	const getRecord = async (recordIndex) => {
		if (recordIndex < 0 || recordIndex >= index.length) {
			return null
		}

		const cached = cache.get(recordIndex)
		if (cached) return cached

		if (!fileHandle) {
			fileHandle = await open(filePath, 'r')
		}

		const entry = index[recordIndex]
		const buf = Buffer.alloc(entry.length)
		await fileHandle.read(buf, 0, entry.length, entry.offset)
		const raw = buf.toString('utf8')

		try {
			const obj = JSON.parse(raw)
			const plain = formatRecord(obj, tabWidth, useTabs)
			const result = processRecord(plain, tabWidth)
			cache.set(recordIndex, result)
			return result
		} catch {
			// Not valid JSON — return raw text
			const result = {
				plainLines: [raw],
				highlightedLines: [raw],
			}
			cache.set(recordIndex, result)
			return result
		}
	}

	const close = async () => {
		if (fileHandle) {
			await fileHandle.close()
			fileHandle = null
		}
	}

	return {
		totalRecords: index.length,
		getRecord,
		close,
	}
}

export const parseJsonInput = (content, config = {}) => {
	const { tabWidth = 2, useTabs = false } = config

	// Try as single JSON first
	const trimmed = content.trim()
	try {
		const obj = JSON.parse(trimmed)
		const plain = formatRecord(obj, tabWidth, useTabs)
		const result = processRecord(plain, tabWidth)
		return {
			records: [result],
			isSingleJson: true,
		}
	} catch {
		// Try as JSONL
	}

	// Parse as JSONL
	const lines = trimmed.split('\n')
	const records = []
	for (const line of lines) {
		const l = line.trim()
		if (l.length === 0) continue
		try {
			const obj = JSON.parse(l)
			const plain = formatRecord(obj, tabWidth, useTabs)
			records.push(processRecord(plain, tabWidth))
		} catch {
			records.push({
				plainLines: [l],
				highlightedLines: [l],
			})
		}
	}

	return {
		records,
		isSingleJson: false,
	}
}
