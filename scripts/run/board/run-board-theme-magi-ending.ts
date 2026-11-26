import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_parts } from './run-board-theme-host-parts'
import type { Grid, ThemePart } from './run-board-theme-host-types'
import { run_board_theme_magi_alert } from './run-board-theme-magi-alert'
import {
	run_board_theme_magi_data,
	type MagiKit,
	type PanelLook,
} from './run-board-theme-magi-data'
import { run_board_theme_magi_draw } from './run-board-theme-magi-draw'
import { run_board_theme_magi_gauges } from './run-board-theme-magi-gauges'

// The MAGI theme's ending (joshuafolkken/kit#8917), ported from the confirmed theme demo: shutdown.
// External power is cut — two red flashes, the board drops to a dim orange, INTERNAL blinks and the
// active limit runs down; WARNING bands march in every gap; CASPER, BALTHASAR and MELCHIOR shut
// down one by one; at zero the bands collapse on the middle row, the last band draws in to the
// centre, and a second of empty screen.

const { dimmed, fg, level_x, put, put_level, repeated, restyle } = run_board_theme_host_grid
const { eased } = run_board_theme_host_parts
const { band_direction } = run_board_theme_magi_alert
const { AMBER, BLINK, MAGI_END, ORANGE, ORANGE_ON, RED_BOLD, RED_ON } = run_board_theme_magi_data
const { SIDE_W } = run_board_theme_magi_data
const { band_row, clock_text, edge_band, is_lit, magi_box } = run_board_theme_magi_draw
const { SECOND } = run_board_theme_magi_gauges

// A panel shows SHUTDOWN this many ticks before it goes offline.
const SHUTDOWN_TICKS = 8
const DIM = '110;55;0'
// The level's dim dashes start this far in from the edge and run to POWER CUT, flush with the rule's end.
const DASHES_FROM_EDGE = 17
const POWER_CUT = ' POWER CUT'
const HALF = 2

function shutdown_look(age: number, tick: number): PanelLook {
	if (age < 0) return { text: 'INTERNAL', frame: '230;120;0', fill: fg(AMBER) }

	if (age < SHUTDOWN_TICKS) {
		return {
			text: 'SHUTDOWN',
			frame: '255;60;40',
			fill: is_lit(tick, BLINK.fast) ? RED_ON : RED_BOLD,
		}
	}

	return { text: 'OFFLINE', frame: '50;20;0', fill: fg('70;30;0') }
}

// The active limit runs down to zero on internal power.
function power_clock(kit: MagiKit, grid: Grid, tick: number): void {
	const { px } = kit.api.layout
	const left = Math.max(0, (MAGI_END.collapse - tick) * SECOND)
	const clock_style = left < 1 && is_lit(tick, BLINK.fast) ? RED_ON : RED_BOLD

	put(grid, { y: kit.rows.limit, x: px }, 'ACTIVE LIMIT'.padEnd(SIDE_W), ORANGE)
	put(grid, { y: kit.rows.clock, x: px }, clock_text(left).padEnd(SIDE_W), clock_style)
	put(
		grid,
		{ y: kit.rows.power, x: px },
		' INTERNAL ',
		is_lit(tick, BLINK.fast) ? RED_ON : ORANGE_ON,
	)
}

// CASPER, BALTHASAR and MELCHIOR shut down one by one, the last panel first.
function panels_off(kit: MagiKit, grid: Grid, tick: number): void {
	const last = kit.panels.length - 1

	for (const [index, panel] of kit.panels.entries()) {
		const age = tick - MAGI_END.off - MAGI_END.each * (last - index)

		magi_box(grid, panel, shutdown_look(age, tick))
	}
}

function magi_power(kit: MagiKit, grid: Grid, tick: number): void {
	const { edge, gap_rows, level_spot, w } = kit.api.layout

	const dashes_x = edge - DASHES_FROM_EDGE
	const cut_x = level_x(level_spot, POWER_CUT.length)

	power_clock(kit, grid, tick)
	put(grid, { y: level_spot.y, x: dashes_x }, repeated('-', cut_x - dashes_x), fg(DIM))
	put_level(grid, level_spot, POWER_CUT, is_lit(tick, BLINK.slow) ? RED_ON : RED_BOLD)
	panels_off(kit, grid, tick)

	for (const [row, y] of gap_rows.entries()) {
		band_row(grid, w, { y, dir: band_direction(row), tick, x0: 0, x1: edge })
	}
}

// One row as the bands close: beyond `half` rows of the middle it goes dark, on `half` a band.
function collapse_row(
	kit: MagiKit,
	grid: Grid,
	y: number,
	at: { half: number; tick: number },
): void {
	const off = Math.abs(y - kit.api.layout.screen_cy)

	if (off > at.half) {
		kit.api.blank_row(grid, y)

		return
	}

	if (off === at.half) edge_band(grid, kit.api.layout, y, at.tick)
}

// The bands close on the middle row: rows beyond `half` go dark, a band on each edge.
function collapse(kit: MagiKit, grid: Grid, half: number, tick: number): void {
	for (let y = 0; y < kit.api.layout.h; y++) collapse_row(kit, grid, y, { half, tick })
}

// The last band draws in to the centre on a dark screen.
function last_line(kit: MagiKit, grid: Grid, tick: number): void {
	const { screen_cx, screen_cy, w } = kit.api.layout
	const share = (tick - MAGI_END.line + 1) / (MAGI_END.gone - MAGI_END.line)
	const reach = Math.floor((1 - share) * (w - screen_cx))

	kit.api.blank_screen(grid)
	band_row(grid, w, {
		y: screen_cy,
		dir: 1,
		tick,
		x0: screen_cx - reach,
		x1: screen_cx + reach + 1,
	})
}

// Power cut: two red flashes, the board dims, the panels go offline, then the bands close in.
function shutdown(kit: MagiKit, grid: Grid, tick: number): void {
	if (tick >= MAGI_END.dim) dimmed(grid, fg(DIM))
	magi_power(kit, grid, tick)

	if (tick >= MAGI_END.collapse) {
		const share = (tick - MAGI_END.collapse + 1) / (MAGI_END.line - MAGI_END.collapse)

		collapse(kit, grid, Math.floor((1 - eased(share)) * (kit.api.layout.h / HALF)), tick)
	}

	if (tick < MAGI_END.dim && tick % HALF === 0) {
		restyle(
			grid,
			() => true,
			() => RED_ON,
		)
	}
}

function ending_draw(kit: MagiKit, grid: Grid, tick: number): void {
	if (tick >= MAGI_END.gone) {
		kit.api.blank_screen(grid)

		return
	}

	if (tick >= MAGI_END.line) {
		last_line(kit, grid, tick)

		return
	}

	shutdown(kit, grid, tick)
}

function magi_ending(kit: MagiKit): ThemePart {
	return {
		ticks: MAGI_END.ticks,
		note: 'shutdown: external power cut, INTERNAL, the three go offline one by one · the WARNING bands collapse to a line and go out',
		draw: (grid, tick) => {
			ending_draw(kit, grid, tick)
		},
	}
}

const run_board_theme_magi_ending = { magi_ending, shutdown_look }

export { run_board_theme_magi_ending }
