import { stripVTControlCharacters } from 'node:util'
import { run_board_codes, type RuleCell } from './run-board-codes'
import type { Lamp } from './run-board-lamp-spots'
import { run_board_lamps, type LampLook } from './run-board-lamps'
import { run_board_screen } from './run-board-screen'
import type { BoardPorts } from './run-board-state'
import { run_board_type_rows, type Typing } from './run-board-type-rows'

// joshuafolkken/kit#8376: while the rules run launch codes on a wargames live board, the blank line right
// above each section rule holds a strip of lamps in the lamp panel's columns. It fills from the left as
// far as the typing has gone — yellow lamps twinkling on their own, the front one red and steady, out
// ahead — stays full while the lock crosses the rules, and goes out at once when the lock is done. The
// cells are written between redraws, like the lamps and the codes.

const TWINKLE_MS = 100
const PERCENT = 100
const LIT_PERCENT = 80
const BLANK = ' '
const CSI = '\u{1B}['

// One lamp of a strip on screen, its place along the strip and the strip's lamp count.
interface StripCell {
	row: number
	column: number
	index: number
	count: number
}

// What a strip cell shows: a lamp, or the blank line once the strip is out.
type StripLook = LampLook | 'blank'

// The rules, the strips' cells and the typing they follow.
interface Striped {
	typing: Typing
	cells: ReadonlyArray<RuleCell>
	strips: ReadonlyArray<StripCell>
}

type StripPorts = Pick<BoardPorts, 'write' | 'write_drawn'>

function is_blank(line: string | undefined): boolean {
	return line !== undefined && stripVTControlCharacters(line).trim() === ''
}

// The strips: on each blank line right above a section rule, a lamp in each column of the panel's first
// row — none where the frame has no panel. The usage rule's line above holds the panel, so no strip.
function strip_cells(
	lines: ReadonlyArray<string>,
	starts: ReadonlyArray<number>,
	panel: { lamps: ReadonlyArray<Lamp>; rules: ReadonlyArray<RuleCell> },
): Array<StripCell> {
	const columns = panel.lamps.filter((lamp) => lamp.panel_row === 0).map((lamp) => lamp.column)
	const rule_rows = new Set(panel.rules.map((cell) => cell.row))
	const rows = starts.filter(
		(_start, index) => is_blank(lines[index]) && rule_rows.has(starts[index + 1] ?? 0),
	)

	return rows.flatMap((row) =>
		columns.map((column, index) => ({ row, column, index, count: columns.length })),
	)
}

function is_twinkled(cell: StripCell, at_ms: number): boolean {
	const step = Math.floor(at_ms / TWINKLE_MS)

	return run_board_lamps.mixed([cell.row, cell.column, step]) % PERCENT < LIT_PERCENT
}

// The lamps the typing has filled at `at_ms`, every one while the lock crosses; none while the rules
// run no code.
function filled_of(striped: Striped, count: number, at_ms: number): number | undefined {
	if (!run_board_codes.is_coding(striped.typing, striped.cells, at_ms)) return undefined

	return Math.round(run_board_type_rows.progress(striped.typing, at_ms) * count)
}

function look_of(striped: Striped, cell: StripCell, at_ms: number): StripLook {
	const filled = filled_of(striped, cell.count, at_ms)

	if (filled === undefined) return 'blank'
	if (cell.index >= filled) return 'out'
	if (cell.index === filled - 1) return 'red'

	return is_twinkled(cell, at_ms) ? 'yellow' : 'out'
}

function cell_bytes(cell: StripCell, look: StripLook): string {
	const text = look === 'blank' ? BLANK : run_board_lamps.look_text(look)

	return `${CSI}${String(cell.row)};${String(cell.column)}H${text}`
}

// The strip cells that changed since `since_ms`, the last write; with none — a redraw drew the blank
// lines — every cell a lamp shows in.
function strip_bytes(striped: Striped, at_ms: number, since_ms: number | undefined): string {
	return striped.strips
		.map((cell) => ({ cell, look: look_of(striped, cell, at_ms) }))
		.filter(
			({ cell, look }) =>
				look !== (since_ms === undefined ? 'blank' : look_of(striped, cell, since_ms)),
		)
		.map(({ cell, look }) => cell_bytes(cell, look))
		.join('')
}

// The strip cells that changed, written outside the theme's restyling, as the lamps are.
function write_strips(
	striped: Striped,
	ports: StripPorts,
	at_ms: number,
	since_ms: number | undefined,
): void {
	const bytes = strip_bytes(striped, at_ms, since_ms)

	if (bytes === '') return
	const write = ports.write_drawn ?? ports.write

	write(run_board_screen.synced(bytes))
}

const run_board_strip = { strip_bytes, strip_cells, write_strips }

export { run_board_strip }
export type { StripCell }
