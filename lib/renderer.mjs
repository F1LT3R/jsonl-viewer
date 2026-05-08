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
	cursorRow
) => {
	const output = []

	if (wrap) {
		const allWrapped = []
		const lineMap = []

		for (let i = 0; i < visibleLines.length; i++) {
			let hl = visibleLines[i].highlighted
			if (searchHighlighter) {
				hl = searchHighlighter(i, hl, visibleLines[i].text)
			}
			const segments = composeLine(hl, viewportCols, true, 0)
			for (const seg of segments) {
				allWrapped.push({ text: seg, lineIdx: i })
				lineMap.push(i)
			}
		}

		for (let r = 0; r < viewportRows; r++) {
			const idx = scrollRow + r
			if (idx < allWrapped.length) {
				let line = allWrapped[idx].text
				if (allWrapped[idx].lineIdx === cursorRow) {
					line = applyCursorStyle(line, viewportCols)
				}
				output.push(line)
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
			let hl = visibleLines[lineIdx].highlighted
			if (searchHighlighter) {
				hl = searchHighlighter(
					lineIdx, hl, visibleLines[lineIdx].text
				)
			}
			const segments = composeLine(
				hl, viewportCols, false, scrollCol
			)
			let line = segments[0]
			if (lineIdx === cursorRow) {
				line = applyCursorStyle(line, viewportCols)
			}
			output.push(line)
		} else {
			output.push('')
		}
	}

	return { output, totalLines: visibleLines.length }
}
