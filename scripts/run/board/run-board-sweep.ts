import { MS_PER_SECOND } from '#scripts/lib/timeouts'

// The dot a live `run:board` sweeps across the header's fourth row once a second, under the time column
// (joshuafolkken/kit#8240). It runs twenty cells, one every `SWEEP_MS`, so it reaches the end on the second
// and starts again from the left. Its right end sits five cells past the third line's age `″`, whose place
// the renderer marks with a placeholder; it is drawn only on the empty line below that, on screen.

const SWEEP_MS = 50
const SWEEP_CELLS = 20
const SWEEP_MARGIN = 5
// The board's own one-column block: not pictographic, so the WarGames theme draws it as it is, and the
// sweep, written past the theme, looks the same with the theme on.
const SWEEP_DOT = '■'
const CSI = '\u{1B}['

// Where the sweep's twenty cells start on screen, 1-based.
interface Sweep {
	row: number
	left: number
}

// The `″` placeholder's place on screen and what is below it: the next line and the screen row it starts on.
interface SweepMark {
	row_below: number
	column: number
	line_below: string | undefined
}

// The cell the dot is in at `now_ms`: 0 on the second, 19 just before the next.
function sweep_index(now_ms: number): number {
	return Math.floor((now_ms % MS_PER_SECOND) / SWEEP_MS)
}

// The twenty cells written in full, the dot in its cell and blanks elsewhere, so the last dot is erased.
function sweep_bytes(sweep: Sweep, now_ms: number): string {
	const index = sweep_index(now_ms)
	const cells = Array.from({ length: SWEEP_CELLS }, (_, cell) => (cell === index ? SWEEP_DOT : ' '))

	return `${CSI}${String(sweep.row)};${String(sweep.left)}H${cells.join('')}`
}

// The sweep below the mark, only where the line below is empty, on screen and wide enough for its cells.
function sweep_of(mark: SweepMark, size: { rows: number; columns: number }): Sweep | undefined {
	const left = Math.max(1, mark.column + SWEEP_MARGIN - (SWEEP_CELLS - 1))
	const right = left + SWEEP_CELLS - 1
	const is_room = mark.row_below <= size.rows && right <= size.columns

	return is_room && mark.line_below === '' ? { row: mark.row_below, left } : undefined
}

const run_board_sweep = { SWEEP_MS, sweep_bytes, sweep_index, sweep_of }

export { run_board_sweep }
export type { Sweep, SweepMark }
