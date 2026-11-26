import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import type { Cell, Channel } from './run-board-theme-host-types'
import { run_board_theme_nixie_data, type NixieDraw } from './run-board-theme-nixie-data'

// STEINS;GATE while an event types (joshuafolkken/kit#8917), ported from the confirmed theme demo:
// the newest letters roll in as digits, the board's digits spin, and sparks of digits fly while a
// lane rolls in.

const { BOLD, digit, fg, put } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { COLOR } = run_board_theme_nixie_data

// The newest letters roll: the last of a short tail rolls least often.
const ROLL = { tail: 4, odds: 0.95, fall: 0.72 }
const SPIN_SHARE = 0.3
const SPARK = { share: 0.012, salt: 300 }
const DIGIT_CHAR = /\d/u

interface Line {
	row: Array<Cell>
	y: number
}

function roll_letter(frame: NixieDraw, typed: Channel, back: number, tail: number): void {
	const { tick } = frame
	const index = typed.length - back

	if (index < 0 || hash(tick, index, back) >= ROLL.odds - (back * ROLL.fall) / tail) return
	const at = { y: typed.span.y, x: typed.span.x + index }

	put(frame.grid, at, digit(hash(tick, back, index)), `${fg(COLOR.landed)}${BOLD}`)
}

// The newest letters arrive as rolling digits before they settle.
function rolling_letters(frame: NixieDraw, typed: Channel, tail = ROLL.tail): void {
	if (!typed.is_typing) return

	for (let back = 1; back <= tail; back++) roll_letter(frame, typed, back, tail)
}

// The rows whose digits spin, and the column they spin up to.
interface SpinReach {
	rows: ReadonlyArray<number>
	reach: number
}

function is_spun(frame: NixieDraw, ch: string, x: number, y: number): boolean {
	return DIGIT_CHAR.test(ch) && hash(frame.tick, x, y) < SPIN_SHARE
}

function spin_row(frame: NixieDraw, y: number, reach: number): void {
	const row = frame.grid[y] ?? []

	for (const [x, [ch]] of row.entries()) {
		if (x < reach && is_spun(frame, ch, x, y)) {
			row[x] = [digit(hash(x, y, frame.tick)), fg(COLOR.spun)]
		}
	}
}

// A ROW or NOTICE spins every digit on the board; a PROGRESS only the lanes' clocks, left of the
// issue numbers.
function spin_reach(frame: NixieDraw): SpinReach {
	const { state, api, grid } = frame

	if (state.row.is_typing || state.notice.is_typing) {
		return { rows: [...grid.keys()], reach: Infinity }
	}

	return { rows: api.layout.lane_rows, reach: api.layout.issue_x - 1 }
}

// Digits spin while an event types: the lanes' clocks on a PROGRESS, every digit on the board otherwise.
function spinning_digits(frame: NixieDraw): void {
	if (!frame.state.busy) return
	const { rows, reach } = spin_reach(frame)

	for (const y of rows) spin_row(frame, y, reach)
}

function spark_row(frame: NixieDraw, line: Line): void {
	const { row, y } = line

	for (const [x, [ch]] of row.entries()) {
		if (ch !== ' ' && hash(frame.tick, x, y + SPARK.salt) < SPARK.share) {
			row[x] = [digit(hash(y, x, frame.tick)), `${fg(COLOR.spark)}${BOLD}`]
		}
	}
}

// A lane rolling in: sparks of digits jump about the whole board.
function sparks(frame: NixieDraw): void {
	if (!frame.state.row.is_typing) return

	for (const [y, row] of frame.grid.entries()) spark_row(frame, { row, y })
}

const run_board_theme_nixie_typing = { rolling_letters, sparks, spinning_digits }

export { run_board_theme_nixie_typing }
