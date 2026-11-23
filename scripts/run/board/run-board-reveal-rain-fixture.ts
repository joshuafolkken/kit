import { stripVTControlCharacters } from 'node:util'
import { run_board_fit } from './run-board-fit'
import { run_board_reveal_rain } from './run-board-reveal-rain'
import { run_board_screen } from './run-board-screen'

// The matrix rain's tests read a beat's rows: the first beat is written whole at once from the
// top-left corner, its rows joined by a cursor move rather than a newline (joshuafolkken/kit#8614);
// a later beat writes only the cells that changed, so tests read the screen the beats leave on a
// terminal (joshuafolkken/kit#8790).

const { CURSOR_HOME, NEXT_LINE } = run_board_reveal_rain
const ESC = '\u{1B}'
const MARK = '\u{0}'
const [SYNC_ON = '', SYNC_OFF = ''] = run_board_screen.synced(MARK).split(MARK)
const START = `${SYNC_ON}${CURSOR_HOME}`
// A control sequence (its parameters and final letter captured), a link or other string sequence,
// or a run of text between them.
const TOKEN = new RegExp(
	String.raw`${ESC}\[([\d;?]*)([A-Za-z])|${ESC}\][^\u{7}${ESC}]*(?:\u{7}|${ESC}\\)|[^${ESC}]+`,
	'gu',
)
// A cursor position's row and column.
const POSITION_PARTS = 2
const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' })

interface Terminal {
	// Sparse where the cursor jumped past rows never written.
	rows: Array<Array<string> | undefined>
	y: number
	x: number
}

// The rows a beat draws, as shown; none where it is not written whole from the top-left corner.
function drawn_rows(text: string): Array<string> {
	if (!text.startsWith(START) || !text.endsWith(SYNC_OFF)) return []

	return text
		.slice(START.length, -SYNC_OFF.length)
		.split(NEXT_LINE)
		.map((row) => stripVTControlCharacters(row))
}

// A one-based cursor position's parameter as a zero-based index; a missing one is the first.
function index_of(parameter = ''): number {
	return Math.max(1, Number(parameter)) - 1
}

// The cursor moves and the erase the rain writes, by their final letter; the colors and the
// synchronized-update marks change nothing a test reads.
const MOVES: Record<string, (terminal: Terminal, parameters: string) => void> = {
	E: (terminal) => {
		Object.assign(terminal, { y: terminal.y + 1, x: 0 })
	},
	H: (terminal, parameters) => {
		const [y, x] = parameters.split(';', POSITION_PARTS)

		Object.assign(terminal, { y: index_of(y), x: index_of(x) })
	},
	J: (terminal) => {
		terminal.rows.length = Math.min(terminal.rows.length, terminal.y)
	},
}

function moved(terminal: Terminal, parameters: string, final: string): void {
	MOVES[final]?.(terminal, parameters)
}

// A character at the cursor; a wide one also covers the column after it.
function put(terminal: Terminal, grapheme: string): void {
	const width = run_board_fit.width_of(grapheme)
	const row = terminal.rows[terminal.y] ?? []

	terminal.rows[terminal.y] = row
	row.push(...Array.from({ length: Math.max(0, terminal.x - row.length) }, () => ' '))
	row.splice(terminal.x, width, grapheme, ...Array.from({ length: width - 1 }, () => ''))
	terminal.x += width
}

function written(terminal: Terminal, match: RegExpMatchArray): void {
	const [token, parameters = '', final] = match

	if (final !== undefined) moved(terminal, parameters, final)
	if (token.startsWith(ESC)) return
	for (const { segment } of GRAPHEMES.segment(token)) put(terminal, segment)
}

// The screen's rows, as shown, after each text is written to a terminal in turn.
function screens(texts: ReadonlyArray<string>): Array<Array<string>> {
	const terminal: Terminal = { rows: [], y: 0, x: 0 }

	return texts.map((text) => {
		for (const match of text.matchAll(TOKEN)) written(terminal, match)

		return Array.from(terminal.rows, (row) => (row ?? []).join(''))
	})
}

const run_board_reveal_rain_fixture = { drawn_rows, screens }

export { run_board_reveal_rain_fixture }
