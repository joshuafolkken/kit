import xterm, { type IBufferCell } from '@xterm/headless'
import type { Beat } from '#scripts/run/board/run-board-replay'

// The screen each beat leaves (joshuafolkken/kit#8754): the beats' bytes fed through a terminal emulator,
// every cell read when a beat's bytes are written, so two byte streams that draw the same screen read
// the same and a clear mid-frame reads as the blanks it leaves.

// The emulator class; the package is CommonJS, so its named export is not reachable by name.
const { Terminal: TERMINAL } = xterm

interface Cell {
	readonly char: string
	readonly fg: string
	readonly bg: string
	// One letter per attribute set: b bold, d dim, i italic, u underline, r inverse.
	readonly style: string
}

interface Shot {
	// The time the beat's bytes are written: the waits of the beats before it summed.
	readonly at_ms: number
	readonly cells: ReadonlyArray<ReadonlyArray<Cell>>
}

interface Size {
	readonly columns: number
	readonly rows: number
}

type Emulator = InstanceType<typeof TERMINAL>

const BLANK = ' '
const EMPTY: Cell = { char: BLANK, fg: '0:-1', bg: '0:-1', style: '' }

function style_of(cell: IBufferCell): string {
	const flags: Array<[string, number]> = [
		['b', cell.isBold()],
		['d', cell.isDim()],
		['i', cell.isItalic()],
		['u', cell.isUnderline()],
		['r', cell.isInverse()],
	]

	return flags.map(([letter, flag]) => (flag === 0 ? '' : letter)).join('')
}

function cell_of(cell: IBufferCell | undefined): Cell {
	if (cell === undefined) return EMPTY

	return {
		char: cell.getChars() === '' ? BLANK : cell.getChars(),
		fg: `${String(cell.getFgColorMode())}:${String(cell.getFgColor())}`,
		bg: `${String(cell.getBgColorMode())}:${String(cell.getBgColor())}`,
		style: style_of(cell),
	}
}

function row_of(terminal: Emulator, y: number, columns: number): Array<Cell> {
	const line = terminal.buffer.active.getLine(terminal.buffer.active.viewportY + y)

	return Array.from({ length: columns }, (_, x) => cell_of(line?.getCell(x)))
}

function read(terminal: Emulator, size: Size): Array<Array<Cell>> {
	return Array.from({ length: size.rows }, (_, y) => row_of(terminal, y, size.columns))
}

// One shot per beat: its write time and the screen its bytes leave. The emulator runs each write's
// callback in order once its bytes are parsed, so each read sees its own beat's screen.
async function shots_of(beats: ReadonlyArray<Beat>, size: Size): Promise<Array<Shot>> {
	// `convertEol`: a bare `\n` starts its row at column 0, as the demos' and the board's line breaks do
	// on the tty, whose output processing adds the carriage return.
	const terminal = new TERMINAL({
		cols: size.columns,
		rows: size.rows,
		allowProposedApi: true,
		convertEol: true,
	})
	const shots: Array<Shot> = []
	let at_ms = 0

	for (const beat of beats) {
		const shot_at = at_ms

		terminal.write(beat.text, () => {
			shots.push({ at_ms: shot_at, cells: read(terminal, size) })
		})
		at_ms += beat.ms
	}

	await new Promise<void>((resolve) => {
		terminal.write('', resolve)
	})
	terminal.dispose()

	return shots
}

const board_compare_screen = { shots_of }

export { board_compare_screen }
export type { Cell, Shot, Size }
