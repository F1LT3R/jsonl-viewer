import * as terminal from './terminal.mjs'
import { parseInput } from './input.mjs'
import {
	buildFoldModel,
	buildSeparatorLine,
	getVisibleLines,
	toggleFold,
	getFoldIdAtLine,
} from './fold-model.mjs'
import { composeView } from './renderer.mjs'
import {
	createSearch,
	executeSearch,
	setPattern,
	nextMatch,
	prevMatch,
	getCurrentMatchLine,
	highlightSearchLine,
} from './search.mjs'
import { ansiLength } from './ansi.mjs'

const PAGE_SIZE = 20
const LOAD_THRESHOLD = 5

export const createApp = async (dataSource, config = {}) => {
	const {
		tabWidth = 2,
		wrap = false,
		showLineNumbers = true,
	} = config

	// Build the document model
	let allLines = []
	let foldState = new Map()
	let isJsonl = false
	let totalRecords = 0
	let loadedRangeStart = 0
	let loadedRangeEnd = 0

	if (dataSource.lazy) {
		isJsonl = true
		totalRecords = dataSource.totalRecords
		const initStart = Math.max(0, totalRecords - PAGE_SIZE)
		await loadRecordRange(dataSource, initStart, totalRecords, 'replace')
	} else {
		const { records, isSingleJson } = dataSource
		isJsonl = !isSingleJson && records.length > 1
		totalRecords = records.length

		for (let i = 0; i < records.length; i++) {
			if (records.length > 1) {
				allLines.push(
					buildSeparatorLine(i, records.length)
				)
			}

			const { plainLines, highlightedLines } = records[i]
			const model = buildFoldModel(plainLines, highlightedLines)
			for (const line of model.lines) {
				allLines.push(line)
			}
			for (const [k, v] of model.foldState) {
				foldState.set(`${i}_${k}`, v)
			}
			const offset = allLines.length - model.lines.length
			for (let j = offset; j < allLines.length; j++) {
				if (allLines[j].foldId !== null) {
					const oldId = allLines[j].foldId
					allLines[j].foldId = `${i}_${oldId}`
				}
			}
		}
	}

	// Lazy loading helpers
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

			for (const line of model.lines) {
				newLines.push(line)
			}
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

	// State
	let cursorRow = 0       // cursor position in visible lines
	let scrollRow = 0       // top of viewport in visible lines
	let scrollCol = 0       // horizontal scroll offset
	let mode = 'normal'     // 'normal' | 'search'
	const search = createSearch()
	let visibleLines = getVisibleLines(allLines, foldState)
	let running = true

	const getViewport = () => {
		const size = terminal.getSize()
		return {
			rows: size.rows - 1, // reserve bottom for status
			cols: size.cols,
		}
	}

	const clampCursor = () => {
		const maxCursor = Math.max(0, visibleLines.length - 1)
		cursorRow = Math.max(0, Math.min(cursorRow, maxCursor))
	}

	const ensureCursorVisible = () => {
		const vp = getViewport()
		// Scroll to keep cursor in view
		if (cursorRow < scrollRow) {
			scrollRow = cursorRow
		} else if (cursorRow >= scrollRow + vp.rows) {
			scrollRow = cursorRow - vp.rows + 1
		}
		const maxScroll = Math.max(0, visibleLines.length - vp.rows)
		scrollRow = Math.max(0, Math.min(scrollRow, maxScroll))
		scrollCol = Math.max(0, scrollCol)
	}

	const computeGutterWidth = () => {
		if (!showLineNumbers) return 0
		let maxIdx = 0
		for (const line of allLines) {
			if (line.lineIndex > maxIdx) maxIdx = line.lineIndex
		}
		return String(maxIdx + 1).length + 1
	}

	const render = () => {
		const vp = getViewport()

		const searchHighlighter = search.regex
			? (lineIdx, hl, plain) =>
				highlightSearchLine(lineIdx, hl, plain, search)
			: null

		const gutterWidth = computeGutterWidth()

		const { output, totalLines } = composeView(
			visibleLines,
			vp.rows,
			vp.cols,
			scrollRow,
			scrollCol,
			wrap,
			searchHighlighter,
			cursorRow,
			showLineNumbers,
			gutterWidth
		)

		for (let r = 0; r < vp.rows; r++) {
			terminal.moveTo(r, 0)
			terminal.clearLine()
			if (output[r]) {
				terminal.write(output[r])
			}
		}

		terminal.moveTo(vp.rows, 0)
		terminal.clearLine()
		terminal.write(buildStatusBar(vp.cols, totalLines))
	}

	const buildStatusBar = (cols, totalLines) => {
		const inv = '\x1b[7m'
		const reset = '\x1b[0m'

		let left = ''
		let right = ''

		const curLine = visibleLines[cursorRow]
		const foldHint = curLine && curLine.foldable
			? ' [foldable]'
			: ''

		const partialLoad = dataSource.lazy && (
			loadedRangeStart > 0 || loadedRangeEnd < totalRecords
		)

		if (mode === 'search') {
			left = `/${search.pattern}\u2588`
			right = 'Enter=confirm Esc=cancel'
		} else if (search.active && search.matches.length > 0) {
			left = `Match ${search.currentMatch + 1}` +
				`/${search.matches.length}`
			if (partialLoad) {
				left += ` (loaded ${loadedRangeStart + 1}-` +
					`${loadedRangeEnd}/${totalRecords})`
			}
			right = 'n=next N=prev Esc=clear /=new q=quit'
		} else {
			left = `Line ${cursorRow + 1}/${totalLines}${foldHint}`
			if (isJsonl) {
				if (dataSource.lazy) {
					left += ` | Records ${loadedRangeStart + 1}-` +
						`${loadedRangeEnd}/${totalRecords}`
				} else {
					left += ` | ${totalRecords} records`
				}
			}
			right = '/=search Enter=fold q=quit'
		}

		const gap = Math.max(1, cols - left.length - right.length)
		const bar = `${left}${' '.repeat(gap)}${right}`
		return `${inv}${bar.slice(0, cols)}${reset}`
	}

	const recomputeVisible = () => {
		visibleLines = getVisibleLines(allLines, foldState)
		if (search.regex) {
			executeSearch(search, visibleLines)
		}
	}

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

	const moveCursor = (delta) => {
		cursorRow += delta
		clampCursor()
		ensureCursorVisible()
	}

	const moveCursorTo = (row) => {
		cursorRow = row
		clampCursor()
		ensureCursorVisible()
	}

	const handleNormalInput = (event) => {
		const vp = getViewport()

		if (event.type === 'key') {
			switch (event.name) {
				case 'ctrl-c':
					running = false
					return

				case 'char':
					if (event.char === 'q') {
						running = false
						return
					}
					if (event.char === 'j') {
						moveCursor(1)
						return
					}
					if (event.char === 'k') {
						moveCursor(-1)
						return
					}
					if (event.char === 'f' || event.char === ' ') {
						moveCursor(vp.rows)
						return
					}
					if (event.char === 'b') {
						moveCursor(-vp.rows)
						return
					}
					if (event.char === 'g') {
						moveCursorTo(0)
						return
					}
					if (event.char === 'G') {
						moveCursorTo(visibleLines.length - 1)
						return
					}
					if (event.char === 'h') {
						scrollCol = Math.max(0, scrollCol - 4)
						return
					}
					if (event.char === 'l') {
						scrollCol += 4
						return
					}
					if (event.char === '/') {
						mode = 'search'
						search.pattern = ''
						search.regex = null
						return
					}
					if (event.char === 'n') {
						if (search.active) {
							const line = nextMatch(search)
							if (line >= 0) moveCursorTo(line)
						}
						return
					}
					if (event.char === 'N') {
						if (search.active) {
							const line = prevMatch(search)
							if (line >= 0) moveCursorTo(line)
						}
						return
					}
					break

				case 'up':
					moveCursor(-1)
					return

				case 'down':
					moveCursor(1)
					return

				case 'left':
					scrollCol = Math.max(0, scrollCol - 4)
					return

				case 'right':
					scrollCol += 4
					return

				case 'pageup':
					moveCursor(-vp.rows)
					return

				case 'pagedown':
					moveCursor(vp.rows)
					return

				case 'home':
					moveCursorTo(0)
					return

				case 'end':
					moveCursorTo(visibleLines.length - 1)
					return

				case 'enter': {
					const foldId = getFoldIdAtLine(
						visibleLines,
						cursorRow
					)
					if (foldId !== null) {
						toggleFold(foldState, foldId)
						recomputeVisible()
						clampCursor()
						ensureCursorVisible()
					}
					return
				}

				case 'escape':
					if (search.active) {
						search.active = false
						search.pattern = ''
						search.regex = null
						search.matches = []
						search.currentMatch = -1
					}
					return
			}
		}

		if (event.type === 'mouse') {
			if (event.action === 'wheel-up') {
				moveCursor(-3)
				return
			}
			if (event.action === 'wheel-down') {
				moveCursor(3)
				return
			}
			if (event.action === 'click') {
				const clickedLine = scrollRow + event.row
				if (clickedLine < visibleLines.length) {
					cursorRow = clickedLine
					const foldId = getFoldIdAtLine(
						visibleLines,
						cursorRow
					)
					if (foldId !== null) {
						toggleFold(foldState, foldId)
						recomputeVisible()
						clampCursor()
						ensureCursorVisible()
					}
				}
				return
			}
		}
	}

	const handleSearchInput = (event) => {
		if (event.type !== 'key') return

		switch (event.name) {
			case 'escape':
				mode = 'normal'
				search.pattern = ''
				search.regex = null
				search.matches = []
				search.currentMatch = -1
				search.active = false
				return

			case 'enter':
				mode = 'normal'
				if (search.regex) {
					search.active = true
					executeSearch(search, visibleLines)
					const line = getCurrentMatchLine(search)
					if (line >= 0) moveCursorTo(line)
				}
				return

			case 'backspace':
				if (search.pattern.length > 0) {
					search.pattern = search.pattern.slice(0, -1)
					if (search.pattern.length > 0) {
						setPattern(search, search.pattern)
						executeSearch(search, visibleLines)
					} else {
						search.regex = null
						search.matches = []
					}
				}
				return

			case 'char':
				search.pattern += event.char
				setPattern(search, search.pattern)
				executeSearch(search, visibleLines)
				return

			case 'ctrl-c':
				running = false
				return
		}
	}

	const run = async () => {
		terminal.setup()
		recomputeVisible()
		if (dataSource.lazy) {
			cursorRow = Math.max(0, visibleLines.length - 1)
		}
		clampCursor()
		ensureCursorVisible()
		render()

		terminal.onResize(() => {
			clampCursor()
			ensureCursorVisible()
			render()
		})

		process.stdin.on('data', async (data) => {
			const events = parseInput(data)
			for (const event of events) {
				if (mode === 'search') {
					handleSearchInput(event)
				} else {
					handleNormalInput(event)
				}

				if (!running) {
					terminal.teardown()
					if (dataSource.close) dataSource.close()
					process.exit(0)
				}
			}
			await maybeLoadAbove()
			render()
		})

		const cleanup = () => {
			terminal.teardown()
			if (dataSource.close) dataSource.close()
			process.exit(0)
		}

		process.on('SIGINT', cleanup)
		process.on('SIGTERM', cleanup)
	}

	return { run }
}
