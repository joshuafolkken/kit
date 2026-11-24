import { run_board_cut_styled, type Piece } from './run-board-cut-styled'
import { run_board_drop_screen } from './run-board-drop-screen'
import type { TerminalSize } from './run-board-fit'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_labels } from './run-board-labels'
import { run_board_paint, type Painter } from './run-board-paint'
import { run_board_rain, type RainCell, type Random, type Scene } from './run-board-rain'
import type { Beat } from './run-board-reveal-blocks'
import { run_board_screen } from './run-board-screen'

// joshuafolkken/kit#8519: the matrix board's first frame revealed behind the code rain
// (`run-board-rain.ts`). The frame, as the theme draws it, is cut into its terminal columns once, each
// keeping its character and the colors and links it draws in; a column the rain has passed shows it,
// one the rain has not reached is blank, and the rain's own glyphs take one column each. A character
// two columns wide shows only once the rain has passed both its columns.

interface Column {
	// The column's character, '' on the second column of a wide one, and its width.
	text: string
	width: number
	// Every escape since the line began, replayed where the frame shows again after the rain, and the
	// escapes since the character before.
	lead: string
	between: string
}

interface Escapes {
	lead: string
	between: string
}

// How the rain reads its cells, the terminal it fills (a frame's own size without one), and its scene
// (the reveal's without one).
interface Rendering {
	read?: ((cell: RainCell) => RainCell) | undefined
	size?: TerminalSize | undefined
	scene?: Scene | undefined
}

interface Drawn {
	text: string
	// Whether the frame's colors are left on after the column.
	is_shown: boolean
}

// A row of the grid under one frame of the rain: its columns, the rain's cells as the frame reads
// them, and what each column draws on its own.
interface DrawnRow {
	columns: ReadonlyArray<Column>
	cells: ReadonlyArray<RainCell>
	keys: Array<string>
	paint: Painter
}

interface Run {
	start: number
	end: number
}

const ESC = '\u{1B}'
const CURSOR_HOME = `${ESC}[H`
// The cursor to the start of the next row: unlike a newline it never scrolls, and it ends a pending wrap.
const NEXT_LINE = `${ESC}[E`
// A cursor move or an erase: it takes no column and draws no color, so the columns leave it out.
const CURSOR_ESCAPE = new RegExp(String.raw`${ESC}\[[\d;?]*[A-Za-ln-z]`, 'gu')
const BLANK: Column = { text: ' ', width: 1, lead: '', between: '' }
const BEHIND: RainCell = { kind: 'behind' }
const { LINK_CLOSE, RESET, pieces_of } = run_board_cut_styled
const { WIDE_PAIR, wrapped } = run_board_drop_screen
const { synced } = run_board_screen
const CLOSE = `${LINK_CLOSE}${RESET}`
const PROBE = 'x'

// A character's columns: its own, then one empty column for each further column it draws over.
function spanned(piece: Piece, escapes: Escapes): Array<Column> {
	const rest = Array.from({ length: piece.width - 1 }, () => ({
		text: '',
		width: 0,
		lead: escapes.lead,
		between: '',
	}))

	return [{ text: piece.text, width: piece.width, ...escapes }, ...rest]
}

// A drawn line's columns; an escape, or a character that draws no column, rides on the next one.
function columns_of(line: string): Array<Column> {
	const escapes: Escapes = { lead: '', between: '' }

	return pieces_of(line.replaceAll(CURSOR_ESCAPE, '')).flatMap((piece) => {
		if (piece.width > 0) {
			const columns = spanned(piece, escapes)

			escapes.between = ''

			return columns
		}

		escapes.lead += piece.text
		escapes.between += piece.text

		return []
	})
}

function padded(row: ReadonlyArray<Column>, width: number): Array<Column> {
	return [...row, ...Array.from({ length: width - row.length }, () => BLANK)]
}

// The columns a column starts: two for a wide character's first, one otherwise.
function column_span(column: Column): number {
	return column.width > 1 ? WIDE_PAIR : 1
}

// The lines wrapped at the terminal's columns as a redraw wraps them, cut to its rows, and every
// screen row and cell of the terminal filled, so the rain falls over the whole screen.
function screen_grid(
	lines: ReadonlyArray<Array<Column>>,
	size: TerminalSize,
): Array<Array<Column>> {
	const columns = Math.max(1, size.columns)
	const rows = lines.flatMap((line) => wrapped(line, columns, column_span)).slice(0, size.rows)
	const blanks = Array.from({ length: size.rows - rows.length }, (): Array<Column> => [])

	return [...rows, ...blanks].map((row) => padded(row, columns))
}

// The frame's lines as columns on the terminal's screen; without one, each padded to the widest line.
function grid_of(frame: string, size?: TerminalSize): Array<Array<Column>> {
	const lines = frame.split('\n').map((line) => columns_of(line))
	if (size !== undefined) return screen_grid(lines, size)
	const width = Math.max(0, ...lines.map((row) => row.length))

	return lines.map((row) => padded(row, width))
}

function closed(is_shown: boolean): string {
	return is_shown ? CLOSE : ''
}

function hidden(text: string, is_shown: boolean): Drawn {
	return { text: `${closed(is_shown)}${text}`, is_shown: false }
}

function rain_text(cell: Exclude<RainCell, { kind: 'behind' }>, paint: Painter): string {
	return cell.kind === 'drop' ? paint(cell.paint, cell.glyph) : ' '
}

// Whether all of a character's columns the rain has passed: the next one too for a wide character.
function is_whole(column: Column, next: RainCell | undefined): boolean {
	return column.width === 1 || next?.kind === 'behind'
}

function shown(column: Column, is_shown: boolean): Drawn {
	return { text: `${is_shown ? column.between : column.lead}${column.text}`, is_shown: true }
}

// A column the rain has passed: the frame's own, unless it is half of a wide character the rain
// still covers the other half of; the second half of a shown wide character draws nothing.
function passed(column: Column, next: RainCell | undefined, is_shown: boolean): Drawn {
	if (column.width === 0) return { text: is_shown ? '' : ' ', is_shown }
	if (!is_whole(column, next)) return hidden(' ', is_shown)

	return shown(column, is_shown)
}

// One column of a frame of the rain, after a column that left the frame's colors on or off.
function frame_column(
	column: Column,
	cells: { cell: RainCell; next: RainCell | undefined; paint: Painter },
	is_shown: boolean,
): Drawn {
	const { cell, next, paint } = cells
	if (cell.kind !== 'behind') return hidden(rain_text(cell, paint), is_shown)

	return passed(column, next, is_shown)
}

// A row of the frame under a row of the rain, its colors and links closed at its end; `paint` colors
// the rain's glyphs, one per frame (joshuafolkken/kit#8897).
function row_of(
	columns: ReadonlyArray<Column>,
	cells: ReadonlyArray<RainCell>,
	paint: Painter = run_board_paint.painter(),
): string {
	let is_shown = false
	const texts = columns.map((column, x) => {
		const at = { cell: cells[x] ?? BEHIND, next: cells[x + 1], paint }
		const drawn = frame_column(column, at, is_shown)

		is_shown = drawn.is_shown

		return drawn.text
	})

	return `${texts.join('')}${closed(is_shown)}`
}

function same(cell: RainCell): RainCell {
	return cell
}

// The area the rain falls over: the grid's own.
function area_of(grid: ReadonlyArray<ReadonlyArray<Column>>): { width: number; height: number } {
	return { width: grid[0]?.length ?? 0, height: grid.length }
}

// The cursor to a zero-based row and column of the screen.
function cursor_to(y: number, x: number): string {
	return `${ESC}[${String(y + 1)};${String(x + 1)}H`
}

// What each column of a row draws on its own, so two frames compare by what the terminal shows.
function keys_of(
	columns: ReadonlyArray<Column>,
	cells: ReadonlyArray<RainCell>,
	paint: Painter,
): Array<string> {
	return columns.map(
		(column, x) =>
			frame_column(column, { cell: cells[x] ?? BEHIND, next: cells[x + 1], paint }, false).text,
	)
}

// Whether a column is half of a wide character whose other half changed: the pair is redrawn whole.
function is_paired(
	columns: ReadonlyArray<Column>,
	changed: ReadonlyArray<boolean>,
	x: number,
): boolean {
	if (columns[x]?.width === 0) return changed[x - 1] === true

	return columns[x + 1]?.width === 0 && changed[x + 1] === true
}

// The columns to rewrite: each that draws otherwise than before, with the other half of its wide character.
function changed_of(row: DrawnRow, before: ReadonlyArray<string>): Array<boolean> {
	const changed = row.keys.map((key, x) => key !== before[x])

	return changed.map((is_changed, x) => is_changed || is_paired(row.columns, changed, x))
}

// Where a run of columns to rewrite starting at `start` ends: the first column left as it was.
function run_end(changed: ReadonlyArray<boolean>, start: number): number {
	const end = changed.indexOf(false, start)

	return end === -1 ? changed.length : end
}

// The runs of consecutive columns to rewrite, each from its start up to its end.
function runs_of(changed: ReadonlyArray<boolean>): Array<Run> {
	return [...changed.keys()]
		.filter((x) => changed[x] === true && changed[x - 1] !== true)
		.map((start) => ({ start, end: run_end(changed, start) }))
}

// A run of a row written where it starts, its colors and links closed at its end.
function run_text(row: DrawnRow, run: Run, y: number): string {
	const { start, end } = run
	const text = row_of(row.columns.slice(start, end), row.cells.slice(start, end + 1), row.paint)

	return `${cursor_to(y, start)}${text}`
}

// A row's changed runs, each written where it starts.
function row_changes(row: DrawnRow, before: ReadonlyArray<string>, y: number): string {
	return runs_of(changed_of(row, before))
		.map((run) => run_text(row, run, y))
		.join('')
}

// The grid's rows under the rain, each with the rain's cells as the frame reads them and what its
// columns draw, the glyphs colored by one `painter` for the whole frame.
function drawn_rows_of(
	grid: ReadonlyArray<ReadonlyArray<Column>>,
	cells: ReadonlyArray<ReadonlyArray<RainCell>>,
	read: (cell: RainCell) => RainCell,
): Array<DrawnRow> {
	const paint = run_board_paint.painter()

	return grid.map((columns, y) => {
		const read_cells = (cells[y] ?? []).map((cell) => read(cell))

		return { columns, cells: read_cells, keys: keys_of(columns, read_cells, paint), paint }
	})
}

// One frame of the rain: the first written whole from the top-left corner, its rows joined by a
// cursor move; every later one only the columns that draw otherwise than in the frame before
// (joshuafolkken/kit#8790), so a column the rain has passed is not written again.
function beat_text(
	rows: ReadonlyArray<DrawnRow>,
	before?: ReadonlyArray<ReadonlyArray<string>>,
): string {
	if (before === undefined) {
		const lines = rows.map((row) => row_of(row.columns, row.cells, row.paint))

		return `${CURSOR_HOME}${lines.join(NEXT_LINE)}`
	}

	return rows.map((row, y) => row_changes(row, before[y] ?? [], y)).join('')
}

// Every frame of one pass of the rain over the drawn frame, each a beat `RAIN_MS` long written whole
// at once (`beat_text`); made one at a time, so a skipped pass makes no more. Rows are reached by a
// cursor move, not a newline, so a row as wide as the terminal or the bottom row never scrolls it.
// `read` turns each rain cell into what the frame shows under it: the frame behind the rain as it is,
// or another reading of it (`run-board-exit-rain.ts`); `size` is the terminal the rain fills
// (joshuafolkken/kit#8614).
function* beats_of(frame: string, random: Random, rendering: Rendering = {}): Generator<Beat> {
	const { read = same, size, scene } = rendering
	const grid = grid_of(frame, size)
	const passes = run_board_rain.passes(area_of(grid), random, scene)
	const drawn: { before?: Array<Array<string>> } = {}

	for (const cells of passes) {
		const rows = drawn_rows_of(grid, cells, read)

		yield { text: synced(beat_text(rows, drawn.before)), ms: run_board_rain.RAIN_MS }
		drawn.before = rows.map((row) => row.keys)
	}
}

// Whether stdout draws the rain's colors; where it draws none (a pipe, `NO_COLOR`) no rain falls.
function is_colored(): boolean {
	return run_board_labels.painted(run_board_header_trace.SHADES.head, PROBE) !== PROBE
}

const run_board_reveal_rain = {
	CLOSE,
	CURSOR_HOME,
	NEXT_LINE,
	beats_of,
	grid_of,
	is_colored,
	row_of,
}

export { run_board_reveal_rain }
export type { Column, Rendering }
