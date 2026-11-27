import { run_board_theme_deviant_break } from './run-board-theme-deviant-break'
import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_deviant_parts } from './run-board-theme-deviant-parts'
import { run_board_theme_deviant_rules } from './run-board-theme-deviant-rules'
import { run_board_theme_draw, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import type { Grid, Point, ThemeLayout } from './run-board-theme-host-types'

// The deviant theme's idle one-point effect: every three seconds a reticle — a bold yellow and a
// bold blue corner bracket, as the analysis draws them — closes from six cells out on one number of
// the board; while it holds, the number sits on a steel-blue plate in white bold with a thin
// connector and a blue chip beside it; then plate and brackets fade out together. Never while the
// scan band passes, never on the header's rows, a rule, the panel or a free seat row.

const { cell_at, pick, put, set_cell } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { PAIR, share_of } = run_board_theme_draw
const { RGB, SCAN, WATCH } = run_board_theme_deviant_data
const { bold, ink, mix, on } = run_board_theme_deviant_parts
const { is_kept_row } = run_board_theme_deviant_break
const { is_rule_row } = run_board_theme_deviant_rules

const NUMBER = /\d(?:[\d.,:]*[\d%])?/gu
// What may stand right after a number that stands alone: a blank, the row's end, a list's comma.
const AFTER = new Set(['', ' ', ','])
const SPAN = WATCH.close + WATCH.hold + WATCH.open

// A number on the board: its row and its columns, `end` the one past its last.
interface Target {
	y: number
	x: number
	end: number
}

// Whether a number stands alone: a blank or the row's start before it, and no letter after it.
function is_alone(line: string, target: Target): boolean {
	return line.charAt(target.x - 1).trim() === '' && AFTER.has(line.charAt(target.end))
}

// The column the board's data ends before on row `y`: the panel's beside it, else the board's edge.
function row_limit(layout: ThemeLayout, y: number): number {
	return y > layout.area_top && y <= layout.area_end ? layout.px - 1 : layout.edge
}

// The numbers standing alone on row `y`, with room after them for the lock's connector; those under
// the panel left out.
function targets_on(draw: ThemeDraw, y: number): Array<Target> {
	const line = draw.api.plain(y)
	const limit = row_limit(draw.api.layout, y) - WATCH.reach
	const found = Array.from(line.matchAll(NUMBER), (match) => ({
		y,
		x: match.index,
		end: match.index + match[0].length,
	}))

	return found.filter((target) => target.end <= limit && is_alone(line, target))
}

// A row the reticle may close on: a row of data — no rule, no row the theme keeps its hands off.
function is_open_row(draw: ThemeDraw, y: number): boolean {
	return !is_rule_row(draw.grid, y) && !is_kept_row(draw.api.layout, y)
}

// The board's rows of data under the header, down to its last row of text.
function open_rows(draw: ThemeDraw): Array<number> {
	const count = Math.max(0, draw.api.layout.last_text_row + 1 - WATCH.top)
	const rows = Array.from({ length: count }, (_, index) => WATCH.top + index)

	return rows.filter((y) => is_open_row(draw, y))
}

// The number cycle `cycle` closes on; none on a board with no number to close on.
function target_of(draw: ThemeDraw, cycle: number): Target | undefined {
	const all = open_rows(draw).flatMap((y) => targets_on(draw, y))

	return all.length === 0 ? undefined : pick(all, hash(cycle, WATCH.where_salt))
}

// The brackets' distance from the number: closing in from six cells out, then a cell away.
function gap_at(age: number): number {
	return 1 + Math.round((1 - share_of(age, 0, WATCH.close)) * WATCH.gap)
}

// How far the reticle has faded: none until it lets go, then out with its plate.
function faded_at(age: number): number {
	return share_of(age, WATCH.close + WATCH.hold, WATCH.open)
}

// A character on a blank cell only: the lock's connector never covers the board's own text.
function put_blank(grid: Grid, at: Point, ch: string, style: string): void {
	if (cell_at(grid, at.y, at.x)[0] === ' ') put(grid, at, ch, style)
}

// The lock, from the hold on: the number on a steel-blue plate in white bold, a thin connector and a
// blue chip beside it.
function lock(draw: ThemeDraw, target: Target, faded: number): void {
	const { grid } = draw
	const { y, end } = target
	const plate = on(mix(RGB.white, RGB.night, faded), mix(RGB.steel, RGB.night, faded))

	for (let { x } = target; x < end; x++) set_cell(grid, { y, x }, [cell_at(grid, y, x)[0], plate])

	put_blank(grid, { y, x: end + 1 }, '─', ink(mix(RGB.steel, RGB.night, faded)))
	put_blank(grid, { y, x: end + PAIR }, '─', ink(mix(RGB.steel, RGB.night, faded)))
	put_blank(grid, { y, x: end + WATCH.reach - 1 }, '▌', bold(mix(RGB.blue, RGB.night, faded)))
}

function reticle(draw: ThemeDraw, target: Target, age: number): void {
	const { grid } = draw
	const { y, x, end } = target
	const gap = gap_at(age)
	const faded = faded_at(age)

	if (age >= WATCH.close) lock(draw, target, faded)
	put(grid, { y, x: x - gap }, '⌜', bold(mix(RGB.yellow, RGB.night, faded)))
	put(grid, { y, x: end - 1 + gap }, '⌟', bold(mix(RGB.blue, RGB.night, faded)))
}

// The reticle at `tick`: which one it is and how old. One starts every three seconds, counted from
// the scan band's last pass; the one the band would cross waits for the band, so none while it is
// near.
function turn_at(tick: number): { cycle: number; age: number } | undefined {
	const phase = tick % SCAN.every
	const slot = Math.floor(phase / WATCH.every)
	const age = phase - slot * WATCH.every
	const is_crossed = slot * WATCH.every + SPAN >= SCAN.every - SCAN.ticks

	if (is_crossed || age >= SPAN) return undefined

	return { cycle: Math.floor(tick / SCAN.every) * SCAN.every + slot, age }
}

function watch(draw: ThemeDraw): void {
	const turn = turn_at(draw.tick)

	if (turn === undefined) return
	const target = target_of(draw, turn.cycle)

	if (target) reticle(draw, target, turn.age)
}

const run_board_theme_deviant_watch = { gap_at, open_rows, row_limit, target_of, turn_at, watch }

export { run_board_theme_deviant_watch }
