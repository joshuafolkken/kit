import { run_board_theme_host_fonts } from './run-board-theme-host-fonts'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Grid } from './run-board-theme-host-types'
import { run_board_theme_skynet_data, type SkynetDraw } from './run-board-theme-skynet-data'
import { run_board_theme_skynet_hud } from './run-board-theme-skynet-hud'
import { run_board_theme_skynet_listing } from './run-board-theme-skynet-listing'

// The TERMINATOR theme's ROW screen (joshuafolkken/kit#8917), ported from the confirmed theme demo:
// target acquisition takes the area — brackets close on the lane's number, the match climbs.

const { big_number, big_width } = run_board_theme_host_fonts
const { BOLD, pick, put } = run_board_theme_host_grid
const { BLINK, DOTS, INKS, LISTING, area_rows_at } = run_board_theme_skynet_data
const { blink_ink, match_gauge } = run_board_theme_skynet_hud
const { race_columns } = run_board_theme_skynet_listing

// Target acquisition's places: the title, the lane number's brackets, the gauge and the salts.
const ACQUIRE = {
	left: 2,
	dots_x: 22,
	dots_pace: 2,
	number_x: 12,
	// Rows as offsets from the area's top (joshuafolkken/kit#8917; the demo's area_top was 4).
	number_y: 2,
	hash_gap: 4,
	top: 1,
	bottom: 5,
	gauge_y: 6,
	slack: 8,
	close_pace: 4,
	salt: 11,
	salt_step: 7,
	full: 100,
}

// The four brackets' corners at `left` and `right`, on their rows under the area's top.
function brackets(
	grid: Grid,
	area_top: number,
	at: { left: number; right: number },
	lit: string,
): void {
	const top = area_top + ACQUIRE.top
	const bottom = area_top + ACQUIRE.bottom

	put(grid, { y: top, x: at.left }, '┌──', lit)
	put(grid, { y: bottom, x: at.left }, '└──', lit)
	put(grid, { y: top, x: at.right }, '──┐', lit)
	put(grid, { y: bottom, x: at.right }, '──┘', lit)
}

// Brackets close on the lane's number while it types, then hold.
function acquisition_brackets({ api, grid, s, tick }: SkynetDraw): void {
	const { row } = s
	const x = ACQUIRE.number_x
	const closing = ACQUIRE.slack - Math.floor((tick - row.start) / ACQUIRE.close_pace)
	const slack = row.is_typing ? Math.max(1, closing) : 1
	const lit = row.is_typing ? blink_ink(tick) : INKS.INK
	const right = x + big_width(api.layout.new_lane) + slack - ACQUIRE.left

	brackets(grid, api.layout.area_top, { left: x - 1 - slack, right }, lit)
}

function acquisition_title({ api, grid, s, tick }: SkynetDraw): void {
	const { area_top } = api.layout
	const dots = pick(DOTS, (Math.floor(tick / ACQUIRE.dots_pace) % DOTS.length) / DOTS.length)

	put(grid, { y: area_top, x: ACQUIRE.left }, 'TARGET ACQUISITION', INKS.INK)
	put(grid, { y: area_top, x: ACQUIRE.dots_x }, s.row.is_typing ? dots : 'COMPLETE', INKS.PINK)
}

function acquisition_number({ api, grid, s }: SkynetDraw): void {
	const style = s.row.is_typing ? `${INKS.SOFT}${BOLD}` : INKS.INK
	const at = { y: api.layout.area_top + ACQUIRE.number_y, x: ACQUIRE.number_x }

	big_number(grid, at, api.layout.new_lane, { style })
	put(grid, { y: at.y + 1, x: at.x - ACQUIRE.hash_gap }, '#', INKS.INK)
}

function acquisition_match({ api, grid, s, tick }: SkynetDraw): void {
	const { row } = s
	const match = row.total ? (row.length / row.total) * ACQUIRE.full : 0
	const confirmed = tick % BLINK.every < BLINK.lit ? INKS.INVERSE : INKS.INK
	const at = { y: api.layout.area_end, x: ACQUIRE.left }

	const gauge = { y: api.layout.area_top + ACQUIRE.gauge_y, x: ACQUIRE.left }

	match_gauge(grid, gauge, Math.min(ACQUIRE.full, match), tick)
	if (!row.is_typing) put(grid, at, ' ID CONFIRMED ', confirmed)
}

// ROW: target acquisition takes the area — brackets close on the lane's number, the match climbs,
// and three listings race beside it.
function acquisition(draw: SkynetDraw): void {
	const { api, grid, s, tick } = draw

	api.clear_area(grid)
	acquisition_title(draw)
	acquisition_brackets(draw)
	acquisition_number(draw)
	acquisition_match(draw)
	race_columns(grid, {
		columns: LISTING.race_columns,
		width: LISTING.race_w,
		rows: area_rows_at(LISTING.area_rows, draw.api.layout.area_top),
		step: s.busy_ticks,
		offset: Math.floor(tick / LISTING.idle_pace),
		salt: ACQUIRE.salt,
		salt_step: ACQUIRE.salt_step,
		is_racing: s.row.is_typing,
	})
}

const run_board_theme_skynet_acquire = { acquisition }

export { run_board_theme_skynet_acquire }
