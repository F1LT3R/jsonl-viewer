export const parseInput = (data) => {
	const events = []
	const str = typeof data === 'string' ? data : data.toString('utf8')
	let i = 0

	while (i < str.length) {
		// Ctrl+C
		if (str[i] === '\x03') {
			events.push({ type: 'key', name: 'ctrl-c' })
			i++
			continue
		}

		// Escape sequence
		if (str[i] === '\x1b') {
			// SGR mouse: \x1b[<btn;col;rowM or \x1b[<btn;col;rowm
			const sgrMatch = str.slice(i).match(
				/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/
			)
			if (sgrMatch) {
				const btn = parseInt(sgrMatch[1], 10)
				const col = parseInt(sgrMatch[2], 10) - 1
				const row = parseInt(sgrMatch[3], 10) - 1
				const released = sgrMatch[4] === 'm'

				if (btn === 64) {
					events.push({
						type: 'mouse',
						action: 'wheel-up',
						row,
						col,
					})
				} else if (btn === 65) {
					events.push({
						type: 'mouse',
						action: 'wheel-down',
						row,
						col,
					})
				} else if (btn === 0 && released) {
					events.push({
						type: 'mouse',
						action: 'click',
						row,
						col,
					})
				}

				i += sgrMatch[0].length
				continue
			}

			// CSI sequences: \x1b[...
			if (i + 1 < str.length && str[i + 1] === '[') {
				const rest = str.slice(i + 2)

				// Arrow keys
				if (rest[0] === 'A') {
					events.push({ type: 'key', name: 'up' })
					i += 3
					continue
				}
				if (rest[0] === 'B') {
					events.push({ type: 'key', name: 'down' })
					i += 3
					continue
				}
				if (rest[0] === 'C') {
					events.push({ type: 'key', name: 'right' })
					i += 3
					continue
				}
				if (rest[0] === 'D') {
					events.push({ type: 'key', name: 'left' })
					i += 3
					continue
				}

				// Home / End
				if (rest[0] === 'H') {
					events.push({ type: 'key', name: 'home' })
					i += 3
					continue
				}
				if (rest[0] === 'F') {
					events.push({ type: 'key', name: 'end' })
					i += 3
					continue
				}

				// Extended keys: \x1b[N~
				const tildeMatch = rest.match(/^(\d+)~/)
				if (tildeMatch) {
					const code = parseInt(tildeMatch[1], 10)
					const len = 2 + tildeMatch[0].length
					if (code === 5) {
						events.push({ type: 'key', name: 'pageup' })
					} else if (code === 6) {
						events.push({ type: 'key', name: 'pagedown' })
					} else if (code === 1 || code === 7) {
						events.push({ type: 'key', name: 'home' })
					} else if (code === 4 || code === 8) {
						events.push({ type: 'key', name: 'end' })
					}
					i += len
					continue
				}

				// Unknown CSI — skip
				i += 2
				while (
					i < str.length &&
					str[i] >= '\x20' &&
					str[i] <= '\x3f'
				) {
					i++
				}
				if (i < str.length) i++
				continue
			}

			// Bare escape
			events.push({ type: 'key', name: 'escape' })
			i++
			continue
		}

		// Enter
		if (str[i] === '\r' || str[i] === '\n') {
			events.push({ type: 'key', name: 'enter' })
			i++
			continue
		}

		// Backspace
		if (str[i] === '\x7f' || str[i] === '\x08') {
			events.push({ type: 'key', name: 'backspace' })
			i++
			continue
		}

		// Tab
		if (str[i] === '\t') {
			events.push({ type: 'key', name: 'tab' })
			i++
			continue
		}

		// Printable character
		if (str.charCodeAt(i) >= 32) {
			events.push({ type: 'key', name: 'char', char: str[i] })
			i++
			continue
		}

		// Skip unknown control
		i++
	}

	return events
}
