import { run_board_theme_draw, type Pane, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { ThemeState } from './run-board-theme-host-types'
import { run_board_theme_isac_data } from './run-board-theme-isac-data'
import { run_board_theme_isac_field } from './run-board-theme-isac-field'

// The isac theme's ROW: a pulse ring sweeps outward across the area from the panel, the hex field
// lighting cell by cell behind it; the new lane's row is marked and brightens as each ring crosses.

const { put, restyle } = run_board_theme_host_grid
const { LINGER, active } = run_board_theme_host_state
const { PAIR, area_pane, clear_pane, put_in } = run_board_theme_draw
const { INKS, PULSE, TX } = run_board_theme_isac_data
const { hex_field } = run_board_theme_isac_field

function is_activating(state: ThemeState): boolean {
	return active(state.row, PULSE.tail + LINGER)
}

// The label on a strip cleared out of the field, blinking while the lane types.
function activation_label(draw: ThemeDraw, pane: Pane): void {
	const { api, s, tick } = draw
	const is_dark = s.row.is_typing && tick % TX.blink >= TX.blink_lit
	const at = { x: PULSE.label_x, y: PULSE.label_row }

	put_in(pane, at, ' '.repeat(PULSE.label_w), 'body')
	put_in(
		pane,
		{ x: at.x + 1, y: at.y },
		`◆ AGENT ACTIVATED #${api.layout.new_lane}`,
		is_dark ? INKS.ORANGE : INKS.WHITE,
	)
}

// ROW: the field takes the area, lit out from the panel's middle as far as the first ring has run;
// a new ring follows every two seconds.
function activation(draw: ThemeDraw): void {
	const { api, s, tick } = draw
	const pane = area_pane(draw)
	const age = tick - s.row.start
	const center = { x: api.layout.px + api.layout.pw / PAIR, y: (pane.box.h - 1) / PAIR }

	clear_pane(pane)
	hex_field(pane, {
		center,
		reach: (age % PULSE.period) * PULSE.ring_pace,
		lit: age * PULSE.ring_pace,
	})
	activation_label(draw, pane)
}

// The lane's own mark, in the blank before its text; the row's typed letters go white as a ring
// crosses it.
function lane_mark(draw: ThemeDraw): void {
	const { grid, s, tick } = draw
	const { y, x } = s.row.span

	if (!is_activating(s)) return
	const phase = (tick - s.row.start) % PULSE.period
	const is_crossed = phase >= PULSE.cross_from && phase < PULSE.cross_from + PULSE.cross_ticks

	put(grid, { y, x: x - PAIR }, '◆', is_crossed ? INKS.WHITE : INKS.ORANGE)
	if (!is_crossed) return
	restyle(
		grid,
		(_, xx, yy) => yy === y && xx >= x && xx < x + s.row.length,
		() => INKS.WHITE,
	)
}

const run_board_theme_isac_pulse = { activation, is_activating, lane_mark }

export { run_board_theme_isac_pulse }
