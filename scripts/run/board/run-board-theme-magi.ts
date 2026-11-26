import { run_board_theme_host_flash } from './run-board-theme-host-flash'
import type {
	Grid,
	ThemeApi,
	ThemeLayout,
	ThemeModule,
	ThemeState,
} from './run-board-theme-host-types'
import { run_board_theme_magi_alert } from './run-board-theme-magi-alert'
import {
	run_board_theme_magi_data,
	type MagiKit,
	type MagiPanel,
	type MagiRows,
} from './run-board-theme-magi-data'
import { run_board_theme_magi_ending } from './run-board-theme-magi-ending'
import { run_board_theme_magi_gauges } from './run-board-theme-magi-gauges'
import { run_board_theme_magi_opening } from './run-board-theme-magi-opening'
import { run_board_theme_magi_panels } from './run-board-theme-magi-panels'
import { run_board_theme_magi_sync } from './run-board-theme-magi-sync'
import { run_board_theme_magi_wash } from './run-board-theme-magi-wash'

// The MAGI theme (joshuafolkken/kit#8917), ported from the confirmed theme demo
// (`fixed-v21-theme-demo.mjs`, theme 7).
// Idle: the three computers in their triangle in the panel, a pulse passing round them.
// PROGRESS: the three deliberate, then give their verdicts one by one; the result on the rule.
// ROW: the synchronization display takes the area left of the panel — two waves falling into
// step, the borderline bar, the checks, the rate in tall digits — while the clock runs.
// NOTICE: EMERGENCY and PATTERN BLUE borrow the header, WARNING bands march, the panels flash ALERT.

const { notice_trace, peak_flash } = run_board_theme_host_flash
const { emergency_header, emergency_screen, warning_bands } = run_board_theme_magi_alert
const { BOOT_PLACES, BOOT_W, COLORS, NOTES, PALE, PANEL_NAMES, RED_ON, SIDE_W, rows_at } =
	run_board_theme_magi_data
const { activity_limit, consensus, status } = run_board_theme_magi_gauges
const { magi_ending } = run_board_theme_magi_ending
const { magi_opening } = run_board_theme_magi_opening
const { magi_panels } = run_board_theme_magi_panels
const { sync_display } = run_board_theme_magi_sync
const { idle_pulse, red_text, red_wash } = run_board_theme_magi_wash

const SPINNER = '┤┘┴└├┌┬┐'
const SIDES = 2
// The sync display is drawn this much short of its end.
const SYNC_SHORT = 3

// The three panels in their triangle in the panel: MELCHIOR low right, BALTHASAR high in the
// middle, CASPER low left.
function panels_of(layout: ThemeLayout, rows: MagiRows): Array<MagiPanel> {
	const { edge, px, pw } = layout
	const low_w = Math.floor((pw - SIDES) / SIDES)
	const [melchior, balthasar, casper] = PANEL_NAMES

	return [
		{ name: melchior, x: edge - low_w, y: rows.low, w: low_w },
		{ name: balthasar, x: px + SIDE_W + 1, y: rows.limit, w: pw - SIDES * SIDE_W - SIDES },
		{ name: casper, x: px, y: rows.low, w: low_w },
	]
}

// The same three on the opening's dark screen, round its middle.
function boot_panels_of(layout: ThemeLayout): Array<MagiPanel> {
	const { screen_cx, screen_cy } = layout
	const [melchior, balthasar, casper] = PANEL_NAMES
	const low = screen_cy + BOOT_PLACES.low

	return [
		{ name: melchior, x: screen_cx + BOOT_PLACES.right, y: low, w: BOOT_W },
		{
			name: balthasar,
			x: screen_cx + BOOT_PLACES.middle,
			y: screen_cy + BOOT_PLACES.high,
			w: BOOT_W,
		},
		{ name: casper, x: screen_cx + BOOT_PLACES.left, y: low, w: BOOT_W },
	]
}

function kit_of(api: ThemeApi): MagiKit {
	const { layout } = api
	// The sync display's columns: everything left of the panel, drawn a little short of its edge.
	const sync_end = layout.px - 1
	const rows = rows_at(layout.area_top)

	return {
		api,
		rows,
		panels: panels_of(layout, rows),
		boot_panels: boot_panels_of(layout),
		sync_end,
		sync_w: sync_end - SYNC_SHORT,
	}
}

// The effects that take the area and the header: the sync display, the emergency and its bands.
function magi_effects(kit: MagiKit, grid: Grid, state: ThemeState, tick: number): void {
	sync_display(kit, grid, state, tick)
	emergency_screen(kit, grid, state, tick)
	warning_bands(kit, grid, state, tick)
	emergency_header(kit, grid, state, tick)
	peak_flash(grid, state, RED_ON)
}

function magi(kit: MagiKit, grid: Grid, state: ThemeState, tick: number): void {
	red_text(grid, state)
	idle_pulse(grid, kit.api.layout, state, tick)
	notice_trace(grid, state, PALE)
	activity_limit(kit, grid, state, tick)
	status(kit, grid, state, tick)
	magi_panels(kit, grid, state, tick)
	consensus(kit, grid, state, tick)
	magi_effects(kit, grid, state, tick)
}

function theme(api: ThemeApi): ThemeModule {
	const kit = kit_of(api)

	return {
		name: 'MAGI',
		// The command center's displays are capitals throughout.
		board: 'josh-magi',
		capitals: true,
		spinner: SPINNER,
		notes: NOTES,
		colors: COLORS,
		background: (x, y, tick, state) => red_wash(api.layout, { x, y }, tick, state),
		opening: magi_opening(kit),
		ending: magi_ending(kit),
		draw: (grid, state, tick) => {
			magi(kit, grid, state, tick)
		},
	}
}

const run_board_theme_magi = { kit_of, theme }

export { run_board_theme_magi }
