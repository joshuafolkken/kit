import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_skynet_data, type SkynetDraw } from './run-board-theme-skynet-data'
import { run_board_theme_skynet_hud } from './run-board-theme-skynet-hud'
import { run_board_theme_skynet_listing } from './run-board-theme-skynet-listing'

// The TERMINATOR theme's NOTICE screens (joshuafolkken/kit#8917), ported from the confirmed theme
// demo: the threat assessment in the area, its overflow into the header, the response list after.

const { block, cells_bar, centered, put } = run_board_theme_host_grid
const { BLINK, CURSOR_PATH, INKS, LISTING, RESPONSES, area_rows_at } = run_board_theme_skynet_data
const { data_reading, match_gauge, match_of, mode_of, sight } = run_board_theme_skynet_hud
const { listing_column, race_columns, ticker_text } = run_board_theme_skynet_listing

// The threat assessment's places, its meter and its salts.
const THREAT = {
	left: 2,
	// Rows as offsets from the area's top (joshuafolkken/kit#8917; the demo's area_top was 4).
	mode_y: 1,
	gauge_y: 2,
	target_y: 3,
	sight_y: 5,
	meter_x: 16,
	meter: 12,
	salt: 3,
	salt_step: 5,
}
// The response list: its width, when the cursor starts walking, its pace and each line's beat.
const RESPONSE = { w: 44, title_y: 1, first_y: 2, wait: 12, pace: 4, reveal: 2, settle_at: 1 }
// What overflows into the header: the left listing, its data, and the ticker's pace.
const OVERFLOW = { listing_x: 2, data_x: 30, lead: 4, salt: 29, ticker_every: 20, ticker_pace: 2 }
const HALF = 2

// The steps the cursor has walked a while after the notice (negative before it starts).
function cursor_step(age: number): number {
	return Math.floor((age - RESPONSE.wait) / RESPONSE.pace)
}

// The cursor's line: none, then walking the list, then settled on the second.
function cursor_of(age: number): number {
	const step = cursor_step(age)

	if (step < 0) return -1

	return CURSOR_PATH[step] ?? RESPONSE.settle_at
}

function response_box({ api, grid }: SkynetDraw, x: number): void {
	for (let y = api.layout.area_top; y <= api.layout.area_end; y++) {
		put(grid, { y, x }, ' '.repeat(RESPONSE.w), INKS.BOX)
	}

	put(
		grid,
		{ y: api.layout.area_top + RESPONSE.title_y, x },
		'   POSSIBLE RESPONSE:'.padEnd(RESPONSE.w),
		INKS.BOX_TITLE,
	)
}

// The cursor's line is lit while it walks, and blinks once settled.
function response_style(age: number, tick: number, is_cursor: boolean): string {
	if (!is_cursor) return INKS.BOX
	const is_lit = cursor_step(age) < CURSOR_PATH.length || tick % BLINK.every < BLINK.lit

	return is_lit ? INKS.INVERSE : INKS.BOX
}

// A response line: typed in two ticks after the one above, the cursor marking its own.
function response_line({ s, tick }: SkynetDraw, index: number): { text: string; style: string } {
	const age = s.notice.cooled
	const is_cursor = index === cursor_of(age)
	const line = `     ${is_cursor ? '▶' : ' '} ${RESPONSES[index] ?? ''}`
	const text = age >= RESPONSE.reveal * (index + 1) ? line : ''

	return { text: text.padEnd(RESPONSE.w), style: response_style(age, tick, is_cursor) }
}

// After a notice: the response list types in, the cursor walks it and settles on one.
function response_list(draw: SkynetDraw): void {
	const x = Math.floor((draw.api.layout.edge - RESPONSE.w) / HALF)
	const first = draw.api.layout.area_top + RESPONSE.first_y

	response_box(draw, x)

	for (const index of RESPONSES.keys()) {
		const { text, style } = response_line(draw, index)

		put(draw.grid, { y: first + index, x }, text, style)
	}
}

// The threat meter fills as the notice types.
function threat_meter({ api, grid, s, tick }: SkynetDraw): void {
	const { notice } = s
	const level = Math.round((notice.length / notice.total) * THREAT.meter)
	const meter = cells_bar(level, THREAT.meter)
	const lit = tick % BLINK.gauge_every < BLINK.gauge_lit ? INKS.INK : INKS.PINK
	const y = api.layout.area_top + THREAT.sight_y

	put(grid, { y, x: THREAT.meter_x }, 'THREAT', INKS.SOFT)
	put(grid, { y: y + 1, x: THREAT.meter_x }, meter, lit)
}

// While the notice types: the analysis HUD, the match gauge and a sight at the area's left edge,
// three listings racing beside them.
function threat_typing(draw: SkynetDraw): void {
	const { grid, s, tick } = draw
	const top = draw.api.layout.area_top
	const x = THREAT.left

	put(grid, { y: top + THREAT.mode_y, x }, `ANALYSIS: ${mode_of(s, tick)}`, INKS.INK)
	match_gauge(grid, { y: top + THREAT.gauge_y, x }, match_of(s, tick), tick)
	put(grid, { y: top + THREAT.target_y, x }, 'TARGET: NOTICE', INKS.SOFT)
	sight(draw, { y: top + THREAT.sight_y, x })
	threat_meter(draw)
	race_columns(grid, {
		columns: LISTING.race_columns,
		width: LISTING.race_w,
		rows: area_rows_at(LISTING.threat_rows, top),
		step: s.busy_ticks,
		offset: Math.floor(tick / LISTING.idle_pace),
		salt: THREAT.salt,
		salt_step: THREAT.salt_step,
		is_racing: true,
	})
}

// Once typed: the listings slow either side of the response list.
function threat_after(draw: SkynetDraw): void {
	race_columns(draw.grid, {
		columns: LISTING.side_columns,
		width: LISTING.side_w,
		rows: area_rows_at(LISTING.threat_rows, draw.api.layout.area_top),
		step: Math.floor(draw.tick / LISTING.notice_pace),
		offset: 0,
		salt: THREAT.salt,
		salt_step: THREAT.salt_step,
		is_racing: false,
	})
	response_list(draw)
}

// NOTICE takes the area first: the analysis HUD, the match gauge and a sight at its left edge, three
// listings racing beside them; then the listings slow either side of the response list.
function threat_screen(draw: SkynetDraw): void {
	const { api, grid, s, tick } = draw
	const title = centered('PRIORITY OVERRIDE · THREAT ASSESSMENT', api.layout.edge)
	const style = tick % BLINK.every < BLINK.alarm ? INKS.ALARM : INKS.INVERSE

	api.clear_area(grid)
	put(grid, { y: api.layout.area_top, x: 0 }, title, style)

	if (s.notice.is_typing) {
		threat_typing(draw)

		return
	}

	threat_after(draw)
}

// A ticker of the listing along the header's gauge row.
function header_ticker({ api, grid, s }: SkynetDraw): void {
	const { head_top } = api.layout
	const text = ticker_text(Math.floor(s.busy_ticks / OVERFLOW.ticker_every))
	const from = (s.busy_ticks * OVERFLOW.ticker_pace) % text.length

	put(grid, { y: 0, x: head_top.x }, `${text}${text}`.slice(from, from + head_top.w), INKS.PINK)
}

// The area is full, so the NOTICE's listings overflow into the header: one more racing in the left
// columns, a sight on the right, and a ticker along the gauge row.
function threat_header(draw: SkynetDraw): void {
	const { api, grid, s, tick } = draw
	const { head_left, head_right } = api.layout

	block(grid, head_left, INKS.INK)
	listing_column(grid, {
		x: OVERFLOW.listing_x,
		width: LISTING.side_w,
		rows: LISTING.head_rows,
		from: s.busy_ticks * OVERFLOW.lead + Math.floor(tick / LISTING.idle_pace),
		salt: OVERFLOW.salt,
		is_racing: s.busy,
	})

	for (const y of LISTING.head_rows) {
		put(grid, { y, x: OVERFLOW.data_x }, data_reading(tick, y, LISTING.data_head_seed), INKS.INK)
	}

	block(grid, head_right, INKS.INK)
	sight(draw, { y: 0, x: head_right.x + 1 })
	header_ticker(draw)
}

const run_board_theme_skynet_threat = { cursor_of, response_list, threat_header, threat_screen }

export { run_board_theme_skynet_threat }
