import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import type { Grid, Point, ThemeLayout, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_skynet_data, type SkynetDraw } from './run-board-theme-skynet-data'

// The TERMINATOR theme's vision (joshuafolkken/kit#8917), ported from the confirmed theme demo: the
// NOTICE's crosshair across the whole screen, the lanes scrambling to hex, and the red vignette.

const { pick, restyle, set_cell } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { HEX_DIGITS, INKS } = run_board_theme_skynet_data

// The crosshair's bar climbs faster than the notice types; the lanes scramble for half a second.
const CROSSHAIR = { climb: 1.4, scramble_ticks: 10, scramble_salt: 700, share: 0.5 }
// The vignette: its darkening toward the edges, its pulse, flicker, scan lines and rolling band.
const VIGNETTE = {
	edge: 0.6,
	pulse: 0.35,
	pulse_pace: 0.9,
	flicker: 14,
	flicker_salt: 9,
	band_gap: 14,
	band_pace: 2,
	band_head: 55,
	band_tail: 28,
	red: 125,
	green: 6,
	blue: 10,
	scan_line: 0.88,
	band_share: 4,
	top: 255,
}
const HALF = 2

function is_scrambled(ch: string, at: Point, tick: number): boolean {
	return ch !== ' ' && hash(tick, at.x, at.y + CROSSHAIR.scramble_salt) < CROSSHAIR.share
}

function scramble_row(grid: Grid, y: number, tick: number): void {
	const row = grid[y] ?? []

	for (const [x, [ch, style]] of row.entries()) {
		if (is_scrambled(ch, { y, x }, tick)) {
			set_cell(grid, { y, x }, [pick(HEX_DIGITS, hash(x, y, tick)), style])
		}
	}
}

// NOTICE's first half second: the lanes' characters scramble to hex, about half of them a tick.
function scramble({ api, grid, tick }: SkynetDraw): void {
	for (const y of api.layout.lane_rows) scramble_row(grid, y, tick)
}

// The crosshair's centre: its upright follows the typing, its bar climbs to the notice's row.
function crosshair_center(layout: ThemeLayout, share: number): Point {
	const { notice, h } = layout
	const x = notice.x + Math.round(share * (notice.end - notice.x - 1))
	const y = Math.round(h - 1 - (h - 1 - notice.y) * Math.min(1, share * CROSSHAIR.climb))

	return { y, x }
}

// NOTICE: a crosshair spans the whole screen — its upright follows the typing, its bar climbs to the
// notice's row — and the lanes scramble to hex for the first half second.
function crosshair(draw: SkynetDraw): void {
	const { api, grid, s, tick } = draw
	const { notice } = s

	if (!notice.is_typing) return
	const { notice: span, edge } = api.layout
	const center = crosshair_center(api.layout, notice.length / notice.total)

	restyle(
		grid,
		(_, x, y) => y !== span.y && (x === center.x || (y === center.y && x < edge)),
		() => INKS.CROSS,
	)
	if (tick - notice.start < CROSSHAIR.scramble_ticks) scramble(draw)
}

// How bright the vision is at `at`: darker toward the edges, the whole of it pulsing while a notice
// types.
function vision_level(layout: ThemeLayout, at: Point, tick: number, state: ThemeState): number {
	const dx = Math.abs(at.x - layout.w / HALF) / (layout.w / HALF)
	const dy = Math.abs(at.y - layout.h / HALF) / (layout.h / HALF)
	const swing = VIGNETTE.pulse * Math.sin(tick * VIGNETTE.pulse_pace)
	const pulse = state.notice.is_typing ? 1 + swing : 1

	return (1 - VIGNETTE.edge * Math.max(dx * dx, dy * dy)) * pulse
}

// The bright band rolling down: its head row and the row behind it.
function band_sweep(layout: ThemeLayout, y: number, tick: number): number {
	const cycle = layout.h + VIGNETTE.band_gap
	const band = ((Math.floor(tick / VIGNETTE.band_pace) % cycle) - y + cycle) % cycle

	if (band === 0) return VIGNETTE.band_head

	return band === 1 ? VIGNETTE.band_tail : 0
}

// The red vision: darker toward the edges, scan lines, a flicker, a bright band rolling down — and
// the whole of it pulsing while a notice types.
function vignette(layout: ThemeLayout, at: Point, tick: number, state: ThemeState): string {
	const level = vision_level(layout, at, tick, state)
	const flicker = hash(Math.floor(tick / HALF), at.y, VIGNETTE.flicker_salt) * VIGNETTE.flicker
	const sweep = band_sweep(layout, at.y, tick)
	const scan = at.y % HALF ? VIGNETTE.scan_line : 1
	const red = Math.round((VIGNETTE.red * level + flicker) * scan + sweep)
	const green = Math.round(VIGNETTE.green * level + sweep / VIGNETTE.band_share)
	const blue = Math.round(VIGNETTE.blue * level + sweep / VIGNETTE.band_share)

	return `${String(Math.min(VIGNETTE.top, red))};${String(green)};${String(blue)}`
}

const run_board_theme_skynet_vision = { band_sweep, crosshair, crosshair_center, vignette }

export { run_board_theme_skynet_vision }
