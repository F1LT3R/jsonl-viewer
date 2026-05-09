import { sliceAnsi, ansiLength, stripAnsi } from './ansi.mjs'

const CURSOR_BG = '\x1b[48;5;236m'  // dark gray background
const RESET = '\x1b[0m'

export const composeLine = (highlightedLine, cols, wrap, hScrollOffset) => {
	const visLen = ansiLength(highlightedLine)

	if (wrap) {
		if (visLen <= cols) return [highlightedLine]
		const segments = []
		let pos = 0
		while (pos < visLen) {
			segments.push(sliceAnsi(highlightedLine, pos, pos + cols))
			pos += cols
		}
		return segments
	}

	if (hScrollOffset >= visLen) return ['']
	return [sliceAnsi(highlightedLine, hScrollOffset, hScrollOffset + cols)]
}

const applyCursorStyle = (line, cols) => {
	// Pad the line to full width so the cursor bg covers the row
	const visLen = ansiLength(line)
	const padding = Math.max(0, cols - visLen)
	return `${CURSOR_BG}${line}${' '.repeat(padding)}${RESET}`
}

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
) => {
	const output = []
	const useGutter = showLineNumbers && gutterWidth > 0
	const contentCols = useGutter
		? Math.max(1, viewportCols - gutterWidth)
		: viewportCols

	const formatGutter = (line, isContinuation) => {
		if (!useGutter) return ''
		if (isContinuation || line.lineIndex < 0) {
			return ' '.repeat(gutterWidth)
		}
		const digits = gutterWidth - 1
		const num = String(line.lineIndex + 1).padStart(digits)
		return `\x1b[2m${num} \x1b[22m`
	}

	if (wrap) {
		const allWrapped = []

		for (let i = 0; i < visibleLines.length; i++) {
			let hl = visibleLines[i].highlighted
			if (searchHighlighter) {
				hl = searchHighlighter(i, hl, visibleLines[i].text)
			}
			const segments = composeLine(hl, contentCols, true, 0)
			for (let s = 0; s < segments.length; s++) {
				allWrapped.push({
					text: segments[s],
					lineIdx: i,
					segIdx: s,
				})
			}
		}

		for (let r = 0; r < viewportRows; r++) {
			const idx = scrollRow + r
			if (idx < allWrapped.length) {
				const entry = allWrapped[idx]
				const line = visibleLines[entry.lineIdx]
				const gutter = formatGutter(line, entry.segIdx > 0)
				let row = `${gutter}${entry.text}`
				if (entry.lineIdx === cursorRow) {
					row = applyCursorStyle(row, viewportCols)
				}
				output.push(row)
			} else {
				output.push('')
			}
		}

		return { output, totalLines: allWrapped.length }
	}

	// No wrap mode
	for (let r = 0; r < viewportRows; r++) {
		const lineIdx = scrollRow + r
		if (lineIdx < visibleLines.length) {
			const line = visibleLines[lineIdx]
			let hl = line.highlighted
			if (searchHighlighter) {
				hl = searchHighlighter(lineIdx, hl, line.text)
			}
			const segments = composeLine(hl, contentCols, false, scrollCol)
			const gutter = formatGutter(line, false)
			let row = `${gutter}${segments[0]}`
			if (lineIdx === cursorRow) {
				row = applyCursorStyle(row, viewportCols)
			}
			output.push(row)
		} else {
			output.push('')
		}
	}

	return { output, totalLines: visibleLines.length }
}
