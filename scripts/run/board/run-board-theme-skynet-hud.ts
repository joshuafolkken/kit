import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Channel, Grid, Point, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_skynet_data, type SkynetDraw } from './run-board-theme-skynet-data'
import { run_board_theme_skynet_listing } from './run-board-theme-skynet-listing'

// The TERMINATOR theme's HUD (joshuafolkken/kit#8917), ported from the confirmed theme demo: the
// panel's analysis, match gauge, listing and data column, the reticles and the sight.

const { BOLD, bg, pick, put, repeated, restyle } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { LINGER } = run_board_theme_host_state
const { BEAM_TRAIL, BLINK, DATA_LABELS, INKS, LINE, LISTING, MODES, SIGHT_CORES } =
	run_board_theme_skynet_data
const { area_rows_at } = run_board_theme_skynet_data
const { listing_column } = run_board_theme_skynet_listing

// The panel's rows and columns, the gauge's cells and the HUD's beats.
const HUD = {
	// Rows as offsets from the area's top (joshuafolkken/kit#8917; the demo's area_top was 4).
	mode_row: 1,
	gauge_row: 2,
	id_x: 28,
	gauge_x: 6,
	value_x: 23,
	gauge_cells: 16,
	gauge_step: 6.25,
	bounce: 26,
	bounce_half: 13,
	bounce_pace: 2,
	marker: 3,
	linger: 16,
	scan_every: 60,
	scan_for: 22,
	id_every: 24,
	id_ok: 12,
	mode_pace: 8,
	match_pace: 1.4,
	match_noise: 6,
	match_top: 99.9,
	full: 100,
	value_w: 5,
}
// The reticle round a typed row, its beam's pace, and the idle reticle's hop between lanes.
const RETICLE = { header_rows: 3, gap: 2, beam_pace: 3, hop: 24, issue_w: 4 }
const SIGHT_LINES = ['┌──  ┃  ──┐', '└──  ┃  ──┘']

function blink_ink(tick: number): string {
	return tick % BLINK.every < BLINK.lit ? INKS.INK : INKS.DIM_RED
}

// A data reading: its label and a four-digit number `seed` and `salt` fix.
function data_reading(seed: number, index: number, salt: number): string {
	const value = String(Math.floor(hash(seed, index, salt) * LISTING.data_scale))

	return `${DATA_LABELS[index] ?? ''} ${value.padStart(LISTING.data_digits, '0')}`
}

// Beside the listing, the panel's data column: readings that hold a second idle and race while busy.
function panel_data({ api, grid, s, tick }: SkynetDraw): void {
	const { px, edge } = api.layout
	const data_x = edge - LISTING.data_w
	const seed = s.busy ? tick : Math.floor(tick / LISTING.data_hold)
	const style = s.busy ? INKS.WHITE : INKS.PINK

	for (const [index, y] of area_rows_at(LISTING.rows, api.layout.area_top).entries()) {
		const text = data_reading(seed, index, LISTING.data_seed).padEnd(LISTING.data_w)

		put(
			grid,
			{ y, x: px + LISTING.panel_w },
			' '.repeat(Math.max(0, data_x - px - LISTING.panel_w)),
		)
		put(grid, { y, x: data_x }, text, style)
	}
}

// The panel's listing scrolls a line a tick while anything types, and a line every eight ticks idle.
function panel_listing(draw: SkynetDraw): void {
	const { api, grid, s, tick } = draw
	const from = s.busy_ticks + Math.floor(tick / LISTING.idle_pace)

	listing_column(grid, {
		x: api.layout.px,
		width: LISTING.panel_w,
		rows: area_rows_at(LISTING.rows, api.layout.area_top),
		from,
		salt: LINE.salt,
		is_racing: s.busy,
	})
	panel_data(draw)
}

function match_gauge(grid: Grid, at: Point, match: number, tick: number): void {
	const filled = Math.round(match / HUD.gauge_step)
	const lit = tick % BLINK.gauge_every < BLINK.gauge_lit ? INKS.WHITE : INKS.GAUGE_RED

	put(grid, at, 'MATCH ', INKS.SOFT)
	put(
		grid,
		{ y: at.y, x: at.x + HUD.gauge_x },
		`${repeated('█', filled)}${repeated('░', HUD.gauge_cells - filled)}`,
		lit,
	)
	put(
		grid,
		{ y: at.y, x: at.x + HUD.value_x },
		`${match.toFixed(1).padStart(HUD.value_w)}%`,
		INKS.INK,
	)
}

function mode_of(state: ThemeState, tick: number): string {
	if (!state.busy) return 'LOCKED'

	return pick(MODES, (Math.floor(tick / HUD.mode_pace) % MODES.length) / MODES.length)
}

function match_of(state: ThemeState, tick: number): number {
	if (!state.busy) return HUD.full

	return Math.min(
		HUD.match_top,
		(tick - state.last_start) * HUD.match_pace + hash(tick) * HUD.match_noise,
	)
}

function engaged_hud({ api, grid, s, tick }: SkynetDraw): void {
	const { px, pw, area_top } = api.layout
	const gauge = { y: area_top + HUD.gauge_row, x: px }

	put(
		grid,
		{ y: area_top + HUD.mode_row, x: px },
		`ANALYSIS: ${mode_of(s, tick)}`.padEnd(pw),
		INKS.INK,
	)
	put(grid, gauge, repeated(' ', pw))
	match_gauge(grid, gauge, match_of(s, tick), tick)
}

// Idle, the analysis scans again a moment a minute, and the hopping reticle's lane is checked.
function idle_mode({ api, grid, tick }: SkynetDraw, lane: string): void {
	const { px, pw } = api.layout
	const y = api.layout.area_top + HUD.mode_row
	const is_scanning = tick % HUD.scan_every < HUD.scan_for
	const mode = `ANALYSIS: ${is_scanning ? 'SCANNING…' : 'STANDBY'}`.padEnd(HUD.id_x)
	const id = `ID ${lane} ${tick % HUD.id_every > HUD.id_ok ? 'OK' : '··'}`.padEnd(pw - HUD.id_x)

	put(grid, { y, x: px }, mode, is_scanning ? INKS.INK : `${INKS.PINK}${BOLD}`)
	put(grid, { y, x: px + HUD.id_x }, id, INKS.SOFT)
}

// Idle, the HUD wakes to rescan, and a block bounces along the gauge.
function idle_hud(draw: SkynetDraw, lane: string): void {
	const { api, grid, tick } = draw
	const { px } = api.layout
	const y = api.layout.area_top + HUD.gauge_row
	const at = Math.abs((Math.floor(tick / HUD.bounce_pace) % HUD.bounce) - HUD.bounce_half)
	const bar = `${repeated('░', at)}${'█'.repeat(HUD.marker)}${repeated('░', HUD.bounce_half - at)}`

	idle_mode(draw, lane)
	put(grid, { y, x: px }, 'MATCH ', INKS.SOFT)
	put(grid, { y, x: px + HUD.gauge_x }, bar, INKS.GAUGE_RED)
	put(grid, { y, x: px + HUD.value_x }, ' --.-%', INKS.SOFT)
}

function is_engaged(state: ThemeState): boolean {
	return state.busy || (state.done > 0 && state.since < HUD.linger + LINGER)
}

// The panel's HUD: engaged while anything types and a moment after; idle, it wakes to rescan.
function panel_hud(draw: SkynetDraw, lane: string): void {
	if (is_engaged(draw.s)) {
		engaged_hud(draw)

		return
	}

	idle_hud(draw, lane)
}

// The white beam sweeping along the row being typed, a short trail behind it.
function beam_sweep(grid: Grid, span: Channel['span'], tick: number): void {
	const { y, x, end } = span
	const beam = x + ((tick * RETICLE.beam_pace) % (end - x))

	restyle(
		grid,
		(_, xx, yy) => yy === y && xx <= beam && xx > beam - BEAM_TRAIL.length,
		(xx) => `${INKS.BEAM_INK}${bg(BEAM_TRAIL[beam - xx] ?? '')}`,
	)
}

// A blinking reticle round the row being typed, and a white beam sweeping along it.
function target({ api, grid, tick }: SkynetDraw, typed: Channel): void {
	if (!typed.is_typing) return
	const { y, x, end } = typed.span
	const lit = blink_ink(tick)
	const left = y < RETICLE.header_rows ? api.layout.column_x - 1 : x - RETICLE.gap

	put(grid, { y: y - 1, x: left }, '┌', lit)
	put(grid, { y: y + 1, x: left }, '└', lit)
	put(grid, { y: y - 1, x: end + 1 }, '┐', lit)
	put(grid, { y: y + 1, x: end + 1 }, '┘', lit)
	beam_sweep(grid, typed.span, tick)
}

// The lane the idle reticle is on: it hops from one lane to the next every 24 ticks.
function hop_row(api: SkynetDraw['api'], tick: number): number {
	const { lane_rows } = api.layout

	return lane_rows[Math.floor(tick / RETICLE.hop) % lane_rows.length] ?? -1
}

// That lane's issue number, as the board shows it.
function reticle_lane(api: SkynetDraw['api'], tick: number): string {
	const { issue_x, lane_rows } = api.layout

	if (lane_rows.length === 0) return ''

	return api.plain(hop_row(api, tick)).slice(issue_x, issue_x + RETICLE.issue_w)
}

// Idle: a small reticle hops from one lane's issue number to the next, as if searching; with no lane on
// the board, none (joshuafolkken/kit#8917: it fell back on the header's first row, over the name).
function idle_reticle({ api, grid, s, tick }: SkynetDraw): void {
	if (s.busy || api.layout.lane_rows.length === 0) return
	const { issue_x } = api.layout
	const y = hop_row(api, tick)
	const lit = blink_ink(tick)

	put(grid, { y, x: issue_x - 1 }, '[', lit)
	put(grid, { y, x: issue_x + RETICLE.issue_w }, ']', lit)
}

function sight({ grid, s, tick }: SkynetDraw, at: Point): void {
	const lit = blink_ink(tick)
	const core = s.busy ? pick(SIGHT_CORES, (tick % BLINK.every) / BLINK.every) : '╋'
	const [top = '', bottom = ''] = SIGHT_LINES

	for (const [index, line] of [top, `──   ${core}   ──`, bottom].entries()) {
		put(grid, { y: at.y + index, x: at.x }, line, lit)
	}
}

const run_board_theme_skynet_hud = {
	blink_ink,
	data_reading,
	idle_reticle,
	is_engaged,
	match_gauge,
	match_of,
	mode_of,
	panel_hud,
	panel_listing,
	reticle_lane,
	sight,
	target,
}

export { run_board_theme_skynet_hud }
