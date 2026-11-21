import { run_board_cut_styled, type StyledPiece } from './run-board-cut-styled'
import type { TerminalSize } from './run-board-fit'
import type { Spot } from './run-board-spot'
import type { Typing, TypingSpan } from './run-board-type-rows'

// joshuafolkken/kit#8367: the last frame a live matrix board drew, cell by cell on screen — each cell's
// character and the colors it was drawn in — so the drop falling down the board between redraws
// (`run-board-rain-drop.ts`) lights a cell and puts it back as the frame drew it. A line wraps every
// `columns` cells, as `run_board_fit.height_of` counts it; the frame is cut to the terminal's rows.

interface ScreenCell {
	text: string
	style: string
	// Either half of a character two columns wide, which the drop leaves whole.
	is_wide: boolean
}

interface DropScreen {
	rows: ReadonlyArray<ReadonlyArray<ScreenCell>>
	columns: number
	// The cells something else writes between redraws — spinners, lamps, traces — as `row;column`, and
	// the rows still typing.
	skips: ReadonlySet<string>
	typing_rows: ReadonlySet<number>
	// The merged spans the rain pours over (`run-board-rain-pour.ts`), kept across redraws while a drop
	// they sped up can still be on screen; none before a row types.
	pours?: ReadonlyArray<TypingSpan> | undefined
}

interface ScreenPlace {
	row: number
	column: number
}

// Where the frame drew what the spin writes between redraws.
interface FrameSpots {
	lines: ReadonlyArray<string>
	spots: ReadonlyArray<Spot>
	lamps?: ReadonlyArray<Pick<Spot, 'row' | 'column'>> | undefined
	traces?: ReadonlyArray<Spot> | undefined
}

const BLANK: ScreenCell = { text: ' ', style: '', is_wide: false }
const WIDE_PAIR = 2

function key_of(place: ScreenPlace): string {
	return `${String(place.row)};${String(place.column)}`
}

// One character's cells: one, or two for a character two columns wide, the second holding no text.
function cells_of(piece: StyledPiece): Array<ScreenCell> {
	if (piece.width < WIDE_PAIR) return [{ text: piece.text, style: piece.style, is_wide: false }]

	return [
		{ text: piece.text, style: piece.style, is_wide: true },
		{ text: '', style: piece.style, is_wide: true },
	]
}

// The line's cells cut into screen rows of `columns`; an empty line still takes its row.
function rows_of(line: string, columns: number): Array<Array<ScreenCell>> {
	const cells = run_board_cut_styled.styled_pieces(line).flatMap((piece) => cells_of(piece))
	const count = Math.max(1, Math.ceil(cells.length / columns))

	return Array.from({ length: count }, (_row, index) =>
		cells.slice(index * columns, (index + 1) * columns),
	)
}

function widest(rows: ReadonlyArray<ReadonlyArray<ScreenCell>>): number {
	return Math.max(1, ...rows.map((row) => row.length))
}

function skips_of(frame: FrameSpots): Set<string> {
	const places = [...frame.spots, ...(frame.lamps ?? []), ...(frame.traces ?? [])]

	return new Set(places.map((place) => key_of(place)))
}

// The frame's screen rows, wrapped at the terminal's columns and cut to its rows; unbounded without one.
function screen_rows(
	lines: ReadonlyArray<string>,
	size: TerminalSize | undefined,
): Array<Array<ScreenCell>> {
	if (size === undefined) return lines.flatMap((line) => rows_of(line, Infinity))

	return lines.flatMap((line) => rows_of(line, Math.max(1, size.columns))).slice(0, size.rows)
}

// The frame's screen: its lines wrapped and cut to the terminal, and the cells the drop leaves alone.
function screen_of(frame: FrameSpots, typing: Typing, size: TerminalSize | undefined): DropScreen {
	const rows = screen_rows(frame.lines, size)

	return {
		rows,
		columns: size?.columns ?? widest(rows),
		skips: skips_of(frame),
		typing_rows: new Set(typing.lines.map((line) => line.row)),
	}
}

// The cell at `place`, 1-based; a blank past a line's end.
function cell_at(screen: DropScreen, place: ScreenPlace): ScreenCell {
	return screen.rows[place.row - 1]?.[place.column - 1] ?? BLANK
}

// Whether the drop leaves the cell alone: something else writes it, or it is half a wide character.
function is_kept(screen: DropScreen, place: ScreenPlace): boolean {
	if (screen.typing_rows.has(place.row) || screen.skips.has(key_of(place))) return true

	return cell_at(screen, place).is_wide
}

const run_board_drop_screen = { cell_at, is_kept, key_of, screen_of }

export { run_board_drop_screen }
export type { DropScreen, FrameSpots, ScreenCell, ScreenPlace }
