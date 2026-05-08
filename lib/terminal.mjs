const stdout = process.stdout
const stdin = process.stdin

const ESC = '\x1b'
const CSI = `${ESC}[`

export const enterAltScreen = () => stdout.write(`${CSI}?1049h`)
export const exitAltScreen = () => stdout.write(`${CSI}?1049l`)

export const enableMouse = () => {
	stdout.write(`${CSI}?1000h`) // basic mouse
	stdout.write(`${CSI}?1002h`) // button tracking
	stdout.write(`${CSI}?1006h`) // SGR extended mode
}

export const disableMouse = () => {
	stdout.write(`${CSI}?1006l`)
	stdout.write(`${CSI}?1002l`)
	stdout.write(`${CSI}?1000l`)
}

export const enableRawMode = () => {
	if (stdin.isTTY) {
		stdin.setRawMode(true)
		stdin.resume()
		stdin.setEncoding('utf8')
	}
}

export const disableRawMode = () => {
	if (stdin.isTTY) {
		stdin.setRawMode(false)
		stdin.pause()
	}
}

export const hideCursor = () => stdout.write(`${CSI}?25l`)
export const showCursor = () => stdout.write(`${CSI}?25h`)

export const moveTo = (row, col) => {
	stdout.write(`${CSI}${row + 1};${col + 1}H`)
}

export const clearScreen = () => stdout.write(`${CSI}2J`)
export const clearLine = () => stdout.write(`${CSI}2K`)

export const getSize = () => ({
	rows: stdout.rows || 24,
	cols: stdout.columns || 80,
})

export const onResize = (callback) => {
	process.on('SIGWINCH', callback)
}

export const write = (str) => stdout.write(str)

export const setup = () => {
	enterAltScreen()
	hideCursor()
	enableMouse()
	enableRawMode()
	clearScreen()
}

export const teardown = () => {
	disableMouse()
	showCursor()
	exitAltScreen()
	disableRawMode()
}
