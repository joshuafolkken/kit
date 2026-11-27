import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_deviant_menu } from './run-board-theme-deviant-menu'
import { run_board_theme_deviant_parts } from './run-board-theme-deviant-parts'
import { run_board_theme_draw, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import type { Cell, Grid, Point, ThemeApi, ThemePart } from './run-board-theme-host-types'

// The deviant theme's opening: the date card types on black; the screen turns to the ice-white menu
// of vertical light bars — the triangle, the title, and the menu row entering as bare bars, then
// labels, then the plate on CONTINUE, which pulses twice; the menu slides away and the chapter card
// stands in the middle — a tile, the first lane's plate, the board's name, the date and time; then
// the light bars lift off the board column by column, each cell flashing white as it shows. Its
// last frame is the board.

const { bg, code_points, put } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { PAIR, screen_pane, share_of } = run_board_theme_draw
const { MENU, MODEL, OPEN, REVEAL, RGB, TRIANGLE } = run_board_theme_deviant_data
const { TILE, bar_style, entrance, lane_labels } = run_board_theme_deviant_menu
const { bold, card_of, ink, lay_date, mix, on, ring, ring_glyph } = run_board_theme_deviant_parts

// The chapter card's rows under its tile: the title's and the date's.
const CARD_ROWS = { title: 3, date: 4 }

// The ice-white of column `x`, a light bar a few columns wide, `share` of the way up from the night.
function ice_at(x: number, share: number): string {
	const bar = hash(Math.floor(x / OPEN.bar_w), 0, OPEN.bar_salt)

	return mix(RGB.night, mix(RGB.ice_dim, RGB.ice_bright, bar), share)
}

// The whole screen as the light bars, nothing drawn on them yet.
function ice(grid: Grid, share: number): void {
	const columns = Array.from({ length: grid[0]?.length ?? 0 }, (_, x) => bg(ice_at(x, share)))

	for (const row of grid) {
		for (const [x, ground] of columns.entries()) row[x] = [' ', ground]
	}
}

// `text` over the light bars, each letter on its own column's ice.
function on_ice(grid: Grid, at: Point, text: string, lead: string): void {
	for (const [index, ch] of code_points(text).entries()) {
		const x = at.x + index

		put(grid, { y: at.y, x }, ch, `${lead}${bg(ice_at(x, 1))}`)
	}
}

// A color `shown` of the way in from the ice.
function faded(color: string, shown: number): string {
	return ink(mix(RGB.ice_bright, color, shown))
}

function title(draw: ThemeDraw, top: number, middle: number): void {
	const { grid } = draw

	for (const [row, line] of TRIANGLE.entries()) {
		const lead = ink(row % PAIR === 1 ? RGB.steel : RGB.plate)

		on_ice(grid, { y: top + row, x: middle - MENU.triangle_back }, line, lead)
	}

	on_ice(grid, { y: top + MENU.title_row, x: middle - MENU.title_back }, MENU.title, bold(RGB.ink))
	on_ice(grid, { y: top + MENU.sub_row, x: middle - MENU.sub_back }, MENU.sub, ink(RGB.steel))
}

// The plate on the menu's first label: it fades in last, and pulses twice as the label is confirmed.
function menu_plate(grid: Grid, at: Point, age: number): void {
	const shown = entrance(age - OPEN.ice_ticks, 0, MENU.words.length).cursor
	const is_pulse = age > MENU.pulse_after && age % MENU.pulse_beat < MENU.pulse_lit
	const corner = faded(RGB.steel, shown)
	const ground = mix(RGB.ice_bright, is_pulse ? RGB.blue : RGB.steel, shown)

	if (shown <= 0) return
	on_ice(grid, at, '⌜', corner)
	put(grid, { y: at.y, x: at.x + 1 }, `   ${MENU.words[0] ?? ''}   `, on(RGB.white, ground))
	on_ice(grid, { y: at.y, x: at.x + MENU.plate_end }, '⌟', corner)
}

// A label of the menu row as it enters: a bare bar, its label on it, then the label alone on the ice.
function menu_item(draw: ThemeDraw, at: Point, index: number, age: number): void {
	const label = MENU.words[index] ?? ''
	const enter = entrance(age - OPEN.ice_ticks, index, MENU.words.length)
	const x = at.x + 1 + index * MENU.label_step
	const final = index === 0 ? RGB.ink : RGB.steel
	const bar = `   ${label}`.padEnd(MENU.bar_w)

	if (enter.bar > 0) put(draw.grid, { y: at.y, x }, bar, bar_style(enter, RGB.ice_bright, final))
	else if (enter.label > 0) {
		on_ice(draw.grid, { y: at.y, x: x + MENU.label_x - 1 }, label, ink(final))
	}
}

// The menu's parts round the column `middle`: the triangle and the title, and the menu row entering.
function menu_parts(draw: ThemeDraw, top: number, middle: number, age: number): void {
	const at = { y: top + MENU.row, x: middle - MENU.left }

	title(draw, top, middle)

	for (const index of MENU.words.keys()) menu_item(draw, at, index, age)

	menu_plate(draw.grid, at, age)
}

function menu_screen(draw: ThemeDraw): void {
	const { api, grid, tick } = draw
	const { w, h } = api.layout
	const age = tick - OPEN.menu_from
	const middle = Math.max(MENU.margin + MENU.left, Math.floor(w / PAIR))
	const top = Math.max(1, Math.floor(h * MENU.top))

	ice(grid, age / OPEN.ice_ticks)
	if (age < OPEN.ice_ticks) return
	menu_parts(draw, top, middle, age)
	on_ice(grid, { y: 1, x: w - OPEN.ring_back }, ring_glyph(tick), bold(RGB.steel))
}

// The chapter's plate on the ice, a right-angle line from its end down to the title under it.
function card_plate(grid: Grid, at: Point, label: string, shown: number): void {
	const end = at.x + label.length + PAIR + 1
	const wire = faded(RGB.steel, shown)

	on_ice(grid, at, '⌜', wire)
	put(
		grid,
		{ y: at.y, x: at.x + 1 },
		` ${label} `,
		on(RGB.white, mix(RGB.ice_bright, RGB.plate, shown)),
	)
	on_ice(grid, { y: at.y, x: end }, '⌟─┐', wire)
	on_ice(grid, { y: at.y + 1, x: end + PAIR }, '│', wire)
}

// The board's date and time under the card's title, in the date card's manner.
function card_date(draw: ThemeDraw, at: Point, shown: number): void {
	const card = card_of(draw.api)

	if (!card) return
	const lead = card.date === '' ? '' : `${card.date}  `

	on_ice(draw.grid, at, `${lead}${card.half}`, faded(RGB.steel, shown))
	on_ice(
		draw.grid,
		{ y: at.y, x: at.x + lead.length + card.half.length + 1 },
		card.time,
		faded(RGB.ink, shown),
	)
}

// The chapter card round the column `at.x`: the slanted tile, the plate of the first lane, the
// board's name as a large thin title, the date and time, and two small ornaments.
function chapter_card(draw: ThemeDraw, at: Point, shown: number): void {
	const { api, grid } = draw
	const name = code_points(MODEL.board.toUpperCase()).join(' ')
	const x = at.x - Math.floor(name.length / PAIR)
	const { y } = at

	on_ice(grid, { y, x: x + 1 }, TILE, faded(RGB.plate, shown))
	on_ice(grid, { y, x: x + name.length }, '+', faded(RGB.steel, shown))
	card_plate(grid, { y: y + 1, x }, lane_labels(api)[0] ?? '', shown)
	on_ice(grid, { y: y + CARD_ROWS.title, x }, name, faded(RGB.ink, shown))
	card_date(draw, { y: y + CARD_ROWS.date, x }, shown)
	on_ice(grid, { y: y + CARD_ROWS.date, x: x + name.length + PAIR }, '·', faded(RGB.steel, shown))
}

// Between the menu and the reveal: the menu slides away to the left, then the chapter card fades in.
function chapter_screen(draw: ThemeDraw): void {
	const { api, grid, tick } = draw
	const { w, h } = api.layout
	const since = tick - OPEN.chapter_from
	const middle = Math.max(MENU.margin + MENU.left, Math.floor(w / PAIR))
	const top = Math.max(1, Math.floor(h * MENU.top))
	const slid = middle - since * Math.ceil(w / OPEN.slide)

	ice(grid, 1)

	if (since < OPEN.slide) menu_parts(draw, top, slid, OPEN.chapter_from - OPEN.menu_from)
	else {
		chapter_card(
			draw,
			{ y: top + OPEN.card_row, x: middle },
			share_of(since, OPEN.slide, OPEN.card_fade),
		)
	}

	on_ice(grid, { y: 1, x: w - OPEN.ring_back }, ring_glyph(tick), bold(RGB.steel))
}

// A cell `since` ticks after its light bar lifts: ice before, a white flash as it shows, then itself.
function revealed(cell: Cell, x: number, since: number): Cell {
	if (since < 0) return [' ', bg(ice_at(x, 1))]

	return since < REVEAL.flash ? [cell[0], on(RGB.ink, RGB.ice_bright)] : cell
}

// The light bars lift, each a few columns wide at a moment of its own, the lower rows a little later.
function reveal(grid: Grid, elapsed: number): void {
	for (const [y, row] of grid.entries()) {
		const rise = Math.min(REVEAL.rise_max, y * REVEAL.rise)

		for (const [x, cell] of row.entries()) {
			const bar = hash(Math.floor(x / REVEAL.column), REVEAL.salt, REVEAL.salt)

			row[x] = revealed(cell, x, elapsed - REVEAL.lead - bar * REVEAL.spread - rise)
		}
	}
}

// The date card typing on the empty screen, two letters a tick, the ring waiting top right.
function date_screen(draw: ThemeDraw): void {
	const { api, grid, tick } = draw
	const { w, h } = api.layout
	const pane = screen_pane(draw)
	const card = card_of(api)
	const at = { x: OPEN.card_x, y: Math.max(0, h - OPEN.card_up) }

	api.blank_screen(grid)
	if (card) lay_date(pane, at, card, tick * OPEN.per_tick)
	ring(pane, { x: w - OPEN.ring_back, y: 1 }, tick, RGB.blue)
}

function opening_draw(draw: ThemeDraw): void {
	const { grid, tick } = draw

	if (tick >= OPEN.reveal_from) reveal(grid, tick - OPEN.reveal_from)
	else if (tick >= OPEN.chapter_from) chapter_screen(draw)
	else if (tick >= OPEN.menu_from) menu_screen(draw)
	else date_screen(draw)
}

function opening_of(api: ThemeApi): ThemePart {
	return {
		ticks: OPEN.reveal_from + OPEN.reveal_ticks,
		note: 'the date card types on black · the ice-white menu, its plate on CONTINUE · the light panels lift off the board',
		draw: (grid, tick, state) => {
			opening_draw({ api, grid, s: state, tick })
		},
	}
}

const run_board_theme_deviant_opening = { faded, ice_at, opening_of }

export { run_board_theme_deviant_opening }
