export const buildFoldModel = (plainLines, highlightedLines) => {
	const lines = []
	const foldState = new Map()
	const stack = []
	let foldIdCounter = 0

	for (let i = 0; i < plainLines.length; i++) {
		const text = plainLines[i]
		const highlighted = highlightedLines[i] || text
		const trimmed = text.trimEnd()

		const line = {
			lineIndex: i,
			text,
			highlighted,
			depth: text.length - text.trimStart().length,
			foldable: false,
			foldId: null,
			foldEndIndex: null,
			isSeparator: false,
		}

		// Check if line opens a block: ends with { or [ (with optional comma)
		const openMatch = trimmed.match(/[{[\s]*$/)
		const endsWithOpen =
			trimmed.endsWith('{') ||
			trimmed.endsWith('[') ||
			trimmed.endsWith('{,') ||
			trimmed.endsWith('[,')

		if (endsWithOpen) {
			const foldId = foldIdCounter++
			line.foldable = true
			line.foldId = foldId
			foldState.set(foldId, false) // unfolded by default
			stack.push({ foldId, lineIndex: i })
		}

		// Check if line closes a block: trimmed starts with } or ]
		const closeTrimmed = text.trim()
		if (
			(closeTrimmed.startsWith('}') || closeTrimmed.startsWith(']')) &&
			stack.length > 0
		) {
			const top = stack.pop()
			lines[top.lineIndex].foldEndIndex = i
		}

		lines.push(line)
	}

	return { lines, foldState }
}

export const buildSeparatorLine = (recordIndex, totalRecords) => {
	const label = ` Record ${recordIndex + 1}/${totalRecords} `
	const pad = '─'.repeat(Math.max(3, 20 - Math.floor(label.length / 2)))
	const text = `${pad}${label}${pad}`
	const highlighted = `\x1b[2m${text}\x1b[0m` // dim
	return {
		lineIndex: -1,
		text,
		highlighted,
		depth: 0,
		foldable: false,
		foldId: null,
		foldEndIndex: null,
		isSeparator: true,
	}
}

export const getVisibleLines = (lines, foldState) => {
	const visible = []
	let skip = 0

	for (let i = 0; i < lines.length; i++) {
		if (skip > 0) {
			if (i >= skip) {
				skip = 0
			} else {
				continue
			}
		}

		const line = lines[i]

		if (line.foldable && line.foldId !== null && foldState.get(line.foldId)) {
			// This line is folded — emit summary
			const endIdx = line.foldEndIndex
			if (endIdx !== null) {
				const innerCount = countInnerItems(lines, i, endIdx)
				const bracket = line.text.trimEnd().slice(-1)
				const label =
					bracket === '{'
						? `{ ... ${innerCount} keys }`
						: `[ ... ${innerCount} items ]`

				// Reuse everything before the opening bracket
				const bracketIdx = line.text.lastIndexOf(bracket)
				const prefix = line.text.slice(0, bracketIdx)
				const summaryText = `${prefix}${label}`
				const summaryHighlighted =
					`\x1b[2m${summaryText}\x1b[0m`

				visible.push({
					...line,
					text: summaryText,
					highlighted: summaryHighlighted,
					_isFoldSummary: true,
				})

				skip = endIdx + 1
				continue
			}
		}

		visible.push(line)
	}

	return visible
}

const countInnerItems = (lines, startIdx, endIdx) => {
	// Count direct children (lines at depth = startDepth + indentStep)
	const startDepth = lines[startIdx].depth
	let count = 0
	let i = startIdx + 1

	while (i < endIdx) {
		const line = lines[i]
		const trimmed = line.text.trim()
		if (trimmed.length === 0) {
			i++
			continue
		}
		// A direct child is one indent level deeper
		if (line.depth > startDepth) {
			count++
			// Skip nested blocks
			if (line.foldable && line.foldEndIndex !== null) {
				i = line.foldEndIndex + 1
				continue
			}
		}
		i++
	}

	return count
}

const extractKey = (text) => {
	// Extract key portion from lines like `  "name": {`
	const match = text.match(/^(\s*"[^"]+"\s*:\s*)/)
	if (match) return match[1]
	return ''
}

export const toggleFold = (foldState, foldId) => {
	const current = foldState.get(foldId)
	foldState.set(foldId, !current)
}

export const getFoldIdAtLine = (visibleLines, visibleIndex) => {
	if (visibleIndex < 0 || visibleIndex >= visibleLines.length) {
		return null
	}
	const line = visibleLines[visibleIndex]
	if (line.foldable && line.foldId !== null) {
		return line.foldId
	}
	return null
}
