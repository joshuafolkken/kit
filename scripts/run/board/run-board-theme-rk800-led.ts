import type { ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Cell } from './run-board-theme-host-types'
import { run_board_theme_rk800_data } from './run-board-theme-rk800-data'
import { run_board_theme_rk800_parts } from './run-board-theme-rk800-parts'
import { run_board_theme_rk800_tables } from './run-board-theme-rk800-tables'

// The rk800 theme's lanes as LEDs, the ring on an android's temple: a running lane's spinner — the
// ring turning — is yellow; a lane's leading mark is blue while it is steady (`ok`, quieter for
// `info` and `idle`), yellow on a warning and red in trouble. Only cells the host laid are
// recolored, by their role: a two-letter mark keeps its letters, a row a ROW has not opened yet has
// no spinner to color, and `human` keeps the theme's own accent. Drawn before every effect, so an
// effect that takes or greys those cells still does.

const { cell_at, code_points, set_cell } = run_board_theme_host_grid
const { RGB } = run_board_theme_rk800_data
const { bold, ink, mix } = run_board_theme_rk800_parts
const { LED } = run_board_theme_rk800_tables

// The ring's glyphs, ten frames a turn.
const SPINNER = '◜◜◠◝◝◞◞◡◟◟'
const SPINNER_GLYPHS: ReadonlySet<string> = new Set(code_points(SPINNER))

// Each mark role's LED.
const LED_INKS: ReadonlyMap<string, string> = new Map([
	['ok', bold(RGB.blue)],
	['info', ink(mix(RGB.blue, RGB.night, LED.info))],
	['idle', ink(mix(RGB.blue, RGB.night, LED.idle))],
	['warn', bold(RGB.yellow)],
	['red', bold(RGB.red)],
])

// The LED of a cell the host laid in a mark's role; none for any other cell.
function led_ink([ch, style]: Cell): string | undefined {
	if (ch === ' ') return undefined

	return LED_INKS.get(style.split(':', 1)[0] ?? '')
}

// A lane row's cells before its issue number, each mark in its LED.
function mark_leds(draw: ThemeDraw, y: number): void {
	const { api, grid } = draw
	const { lane_spin_x, issue_x } = api.layout

	for (let x = Math.max(0, lane_spin_x); x < issue_x; x++) {
		const cell = cell_at(grid, y, x)
		const led = led_ink(cell)

		if (led !== undefined) set_cell(grid, { y, x }, [cell[0], led])
	}
}

// A running lane's ring, yellow where the host laid it.
function ring_led(draw: ThemeDraw, y: number): void {
	const at = { y, x: draw.api.layout.lane_spin_x }
	const [ch, style] = cell_at(draw.grid, at.y, at.x)

	if (style === 'body' && SPINNER_GLYPHS.has(ch)) set_cell(draw.grid, at, [ch, bold(RGB.yellow)])
}

function leds(draw: ThemeDraw): void {
	const { lane_rows, lane_spin_rows } = draw.api.layout

	for (const y of lane_rows) mark_leds(draw, y)
	for (const y of lane_spin_rows) ring_led(draw, y)
}

const run_board_theme_rk800_led = { SPINNER, leds }

export { run_board_theme_rk800_led }
