const ANSI_RE = /\x1b\[[0-9;]*m/g

export const stripAnsi = (str) => str.replace(ANSI_RE, '')

export const ansiLength = (str) => stripAnsi(str).length

export const sliceAnsi = (str, start, end) => {
	if (end === undefined) end = Infinity

	let visible = 0
	let result = ''
	let activeCodes = []
	let i = 0

	while (i < str.length) {
		// Check for ANSI escape
		const match = str.slice(i).match(/^\x1b\[[0-9;]*m/)
		if (match) {
			const code = match[0]
			// Track active codes for state preservation
			if (code === '\x1b[0m') {
				activeCodes = []
			} else {
				activeCodes.push(code)
			}
			// Include codes if we're in range
			if (visible >= start && visible < end) {
				result += code
			}
			i += code.length
			continue
		}

		// Visible character
		if (visible >= start && visible < end) {
			// If this is the first visible char, prepend active codes
			if (result === '' && activeCodes.length > 0) {
				result = activeCodes.join('') + str[i]
			} else {
				result += str[i]
			}
		}

		visible++
		if (visible >= end) {
			result += '\x1b[0m'
			break
		}

		i++
	}

	return result
}

export const insertHighlight = (
	highlightedLine,
	plainLine,
	matchStart,
	matchEnd,
	hlOpen,
	hlClose
) => {
	// Build the result by walking both strings in sync
	let result = ''
	let visible = 0
	let i = 0
	let inHighlight = false

	while (i < highlightedLine.length) {
		// ANSI escape — pass through
		const match = highlightedLine.slice(i).match(/^\x1b\[[0-9;]*m/)
		if (match) {
			result += match[0]
			i += match[0].length
			continue
		}

		// Entering highlight range
		if (visible === matchStart && !inHighlight) {
			result += hlOpen
			inHighlight = true
		}

		// Exiting highlight range
		if (visible === matchEnd && inHighlight) {
			result += hlClose
			inHighlight = false
		}

		result += highlightedLine[i]
		visible++
		i++
	}

	// Close highlight if it extends to end of line
	if (inHighlight) {
		result += hlClose
	}

	return result
}
