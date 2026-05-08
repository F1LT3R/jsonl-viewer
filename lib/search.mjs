import { stripAnsi, insertHighlight } from './ansi.mjs'

const HL_OPEN = '\x1b[2;43m'  // dim + yellow background
const HL_CLOSE = '\x1b[0m'

export const createSearch = () => ({
	pattern: '',
	regex: null,
	matches: [],
	currentMatch: -1,
	active: false,
})

export const executeSearch = (state, visibleLines) => {
	state.matches = []
	state.currentMatch = -1

	if (!state.regex) return

	for (let i = 0; i < visibleLines.length; i++) {
		const plain = stripAnsi(visibleLines[i].text)
		let m
		const re = new RegExp(state.regex.source, state.regex.flags)
		while ((m = re.exec(plain)) !== null) {
			state.matches.push({
				visibleLineIdx: i,
				startCol: m.index,
				endCol: m.index + m[0].length,
			})
			// Prevent infinite loop on zero-length matches
			if (m[0].length === 0) {
				re.lastIndex++
			}
		}
	}

	if (state.matches.length > 0) {
		state.currentMatch = 0
	}
}

export const setPattern = (state, pattern) => {
	state.pattern = pattern
	try {
		state.regex = new RegExp(pattern, 'gi')
	} catch {
		state.regex = null
	}
}

export const nextMatch = (state) => {
	if (state.matches.length === 0) return -1
	state.currentMatch = (state.currentMatch + 1) % state.matches.length
	return state.matches[state.currentMatch].visibleLineIdx
}

export const prevMatch = (state) => {
	if (state.matches.length === 0) return -1
	state.currentMatch =
		(state.currentMatch - 1 + state.matches.length) % state.matches.length
	return state.matches[state.currentMatch].visibleLineIdx
}

export const getCurrentMatchLine = (state) => {
	if (
		state.currentMatch < 0 ||
		state.currentMatch >= state.matches.length
	) {
		return -1
	}
	return state.matches[state.currentMatch].visibleLineIdx
}

export const highlightSearchLine = (
	visibleLineIdx,
	highlightedLine,
	plainText,
	searchState
) => {
	if (!searchState.regex || searchState.matches.length === 0) {
		return highlightedLine
	}

	// Find all matches on this line
	const lineMatches = searchState.matches.filter(
		(m) => m.visibleLineIdx === visibleLineIdx
	)
	if (lineMatches.length === 0) return highlightedLine

	// Apply highlights from right to left to preserve positions
	let result = highlightedLine
	const plain = stripAnsi(plainText)

	for (let i = lineMatches.length - 1; i >= 0; i--) {
		const m = lineMatches[i]
		result = insertHighlight(
			result,
			plain,
			m.startCol,
			m.endCol,
			HL_OPEN,
			HL_CLOSE
		)
	}

	return result
}
