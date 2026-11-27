import { run_board_theme_deviant_break } from './run-board-theme-deviant-break'
import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_deviant_notice } from './run-board-theme-deviant-notice'
import { run_board_theme_deviant_parts } from './run-board-theme-deviant-parts'
import { run_board_theme_draw, type Pane, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Point } from './run-board-theme-host-types'

// The deviant theme's NOTICE from its peak: the spark; color returning as a ring that grows from
// the wall's middle while the shards drift down and thin out; then the objective stamped in two
// spaced lines beside a blue chip, wiped in from the left, over the data left of the panel — blanked
// while it shows, so the shards fall over an empty pane and the objective's own box sits in front.

const { repeated, restyle } = run_board_theme_host_grid
const { PAIR, clear_pane, data_pane, put_in } = run_board_theme_draw
const { RGB } = run_board_theme_deviant_data
const { OBJECTIVE, RETURN, SHARDS } = run_board_theme_deviant_notice
const { bold, ink } = run_board_theme_deviant_parts
const { center_of, shards, spark } = run_board_theme_deviant_break

// How far a cell is from the wall's middle, in rows.
function reach_of(center: Point, x: number, y: number): number {
	return Math.hypot((x - center.x) / RETURN.wide, y - center.y)
}

// Color returns inside a ring growing from the wall's middle; outside it the board is still grey,
// and the ring's edge is white. The notice's own row keeps its color.
function color_return(draw: ThemeDraw, since: number): void {
	const { layout } = draw.api

	if (since >= RETURN.ticks) return
	const center = center_of(layout)
	const radius = (since / RETURN.ticks) * Math.hypot(layout.w / RETURN.wide, layout.h)
	const [grey, edge] = [ink(RGB.grey), bold(RGB.white)]

	restyle(
		draw.grid,
		(_, x, y) => y !== layout.notice.y && reach_of(center, x, y) > radius - RETURN.edge,
		(x, y) => (reach_of(center, x, y) > radius ? grey : edge),
	)
}

// The objective's two lines and their rule, `shown` letters wiped in.
function objective_lines(pane: Pane, shown: number): void {
	const { text_x: x, row: y } = OBJECTIVE
	const late = Math.max(0, shown - OBJECTIVE.bold_after)

	put_in(pane, { x, y }, OBJECTIVE.thin.slice(0, shown), ink(RGB.soft))
	put_in(pane, { x, y: y + 1 }, OBJECTIVE.bold.slice(0, late), bold(RGB.white))
	put_in(pane, { x, y: y + PAIR }, repeated('─', Math.min(OBJECTIVE.rule_w, late)), ink(RGB.plate))
}

// The cells the objective's text takes in `pane`: from the chip's column (one cell of margin left of
// it when there is room) to one cell past the longest of its two lines and the rule, over those
// three rows; cut at the pane's edges as `put_in` cuts.
function objective_pane(pane: Pane): Pane {
	const { box } = pane
	const left = Math.max(0, OBJECTIVE.chip_x - 1)
	const longest = Math.max(OBJECTIVE.thin.length, OBJECTIVE.bold.length, OBJECTIVE.rule_w)
	const right = OBJECTIVE.text_x + longest + 1
	const width = Math.max(0, Math.min(right, box.w) - left)
	const height = Math.max(0, Math.min(OBJECTIVE.row + PAIR + 1, box.h) - OBJECTIVE.row)

	return {
		grid: pane.grid,
		box: { x: box.x + left, y: box.y + OBJECTIVE.row, w: width, h: height },
	}
}

// Whether the objective shows `since` ticks after the peak.
function is_objective_shown(since: number): boolean {
	return since > OBJECTIVE.from && since < OBJECTIVE.until
}

// The data left of the panel blanked while the objective shows, so that the shards fall over an
// empty pane, not over THROUGHPUT and USAGE.
function objective_ground(draw: ThemeDraw, since: number): void {
	if (is_objective_shown(since)) clear_pane(data_pane(draw))
}

// The objective over the data left of the panel: a thin line, a bold line, a blue chip beside them.
function objective(draw: ThemeDraw, since: number): void {
	const shown = (since - OBJECTIVE.from) * OBJECTIVE.pace
	const { chip_x: x, row: y } = OBJECTIVE

	if (!is_objective_shown(since)) return
	const pane = data_pane(draw)

	clear_pane(objective_pane(pane))
	put_in(pane, { x, y }, '▌', bold(RGB.blue))
	put_in(pane, { x, y: y + 1 }, '▌', bold(RGB.blue))
	objective_lines(pane, shown)
}

// NOTICE `since` ticks after its peak.
function after(draw: ThemeDraw, since: number): void {
	if (since < SHARDS.spark) {
		spark(draw)

		return
	}

	color_return(draw, since)
	objective_ground(draw, since)
	if (since < SHARDS.ticks) shards(draw, since)
	objective(draw, since)
}

const run_board_theme_deviant_after = { after }

export { run_board_theme_deviant_after }
