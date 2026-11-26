import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Cell, Grid, ThemeLayout, ThemePart } from './run-board-theme-host-types'

// The theme host's openings and endings (joshuafolkken/kit#8917), ported from the confirmed theme
// demo: the picture tube switching on and off, and the plain pair a theme without its own gets.

const { BOLD, ESC, bg, blank_row, fg, put, restyle } = run_board_theme_host_grid

interface Half {
	w: number
	h: number
}

// A picture tube switching on: a dot at the centre of a black screen, a line running out from it
// to both edges, then the picture opening upward and downward from that line. Switching off is the
// same, backward: the picture closes to a line, the line draws in to a dot, the dot fades.
const TUBE = { dot: 8, line: 12, open: 16, settle: 6, fade: 10, hold: 20 }
const TUBE_BLACK = bg('0;0;0')
const WHITE = fg('255;255;255')
const TUBE_GLOW = `${WHITE}${bg('255;235;230')}`
const TUBE_SPARK = `${WHITE}${bg('255;150;140')}`
const TUBE_BLOOM = `${WHITE}${BOLD}`
// The dot grows on its third tick, and sparks red two ticks in four; the opened picture blooms two.
const DOT = { grow: 2, every: 4, spark: 2, bloom: 2 }
// The dying dot's red: its full level and its green and blue shares.
const EMBER = { full: 255, green: 0.35, blue: 0.3 }
const SMOOTH = { rise: 3, fall: 2 }
const HALF = 2
const BLACK_CELL: Cell = [' ', TUBE_BLACK]

// The plain opening types the name, holds a second and brings the board in two rows a tick behind
// a bright leading row; the plain ending takes it away two rows a tick from the bottom.
const PLAIN_HOLD = 20
const PLAIN = { pace: 2, tail: 10, title_third: 3, title_x: 4 }
const PLAIN_LEAD = `${WHITE}${BOLD}`

function eased(share: number): number {
	const clamped = Math.min(1, Math.max(0, share))

	return clamped * clamped * (SMOOTH.rise - SMOOTH.fall * clamped)
}

interface TubeSight {
	board: Grid
	layout: ThemeLayout
	half: Half
	glow: string
}

function tube_cell(
	sight: TubeSight,
	from: Array<Cell> | undefined,
	x: number,
	is_edge: boolean,
): Cell {
	const center_x = Math.floor(sight.layout.w / HALF)

	if (Math.abs(x - center_x) > sight.half.w) return BLACK_CELL
	if (!from || is_edge) return [' ', sight.glow]

	return from[x] ?? BLACK_CELL
}

// Row `y` as the tube shows it: black outside the picture; inside, the board row squeezed toward
// the centre row lands here, its top and bottom edges glowing while the picture is not full height.
function tube_row(sight: TubeSight, y: number): Array<Cell> {
	const { h: rows, w: columns } = sight.layout
	const center_y = Math.floor(rows / HALF)
	const off = y - center_y

	if (Math.abs(off) > sight.half.h) return Array.from({ length: columns }, () => BLACK_CELL)
	const source = Math.min(
		rows - 1,
		Math.max(0, Math.round(center_y + (off * (rows / HALF)) / sight.half.h)),
	)
	const from = sight.half.h > 0 ? sight.board[source] : undefined
	const is_edge = sight.half.h < Math.ceil(rows / HALF) && Math.abs(off) === sight.half.h

	return Array.from({ length: columns }, (_, x) => tube_cell(sight, from, x, is_edge))
}

// The grid as the tube shows it with the picture `half.w` cells either side of the centre and
// `half.h` rows above and below it.
function tube_picture(grid: Grid, layout: ThemeLayout, half: Half, glow = TUBE_GLOW): void {
	const sight = { board: [...grid], layout, half, glow }

	for (let y = 0; y < layout.h; y++) grid[y] = tube_row(sight, y)
}

// The line running out and the picture opening, by the tick.
function opening_half(layout: ThemeLayout, tick: number): Half {
	if (tick < TUBE.dot + TUBE.line) {
		return { w: Math.ceil(eased((tick - TUBE.dot + 1) / TUBE.line) * (layout.w / HALF)), h: 0 }
	}

	const opened = tick - TUBE.dot - TUBE.line

	return {
		w: layout.w,
		h: Math.max(1, Math.ceil(eased((opened + 1) / TUBE.open) * (layout.h / HALF))),
	}
}

// The dot alone on the black screen, sparking.
function tube_dot(grid: Grid, layout: ThemeLayout, tick: number): void {
	const glow = tick % DOT.every < DOT.spark ? TUBE_GLOW : TUBE_SPARK

	tube_picture(grid, layout, { w: tick < DOT.grow ? 0 : 1, h: 0 }, glow)
}

function tube_on_draw(grid: Grid, layout: ThemeLayout, tick: number): void {
	if (tick < TUBE.dot) {
		tube_dot(grid, layout, tick)

		return
	}

	const opened = tick - TUBE.dot - TUBE.line

	if (opened < TUBE.open) {
		tube_picture(grid, layout, opening_half(layout, tick))

		return
	}

	// The picture has opened: it blooms pale for two ticks, then settles.
	if (opened >= TUBE.open + DOT.bloom) return
	restyle(
		grid,
		([, style]) => !style.startsWith(ESC),
		() => TUBE_BLOOM,
	)
}

function tube_on(layout: ThemeLayout): ThemePart {
	return {
		ticks: TUBE.dot + TUBE.line + TUBE.open + TUBE.settle,
		note: 'the tube switches on: a dot, a line out to both edges, the picture opening up and down',
		draw: (grid, tick) => {
			tube_on_draw(grid, layout, tick)
		},
	}
}

// The picture closing and the line drawing in, then the dot; undefined once the dot fades.
function closing_half(layout: ThemeLayout, tick: number): Half | undefined {
	if (tick < TUBE.open) {
		return { w: layout.w, h: Math.floor((1 - eased((tick + 1) / TUBE.open)) * (layout.h / HALF)) }
	}

	const drawn = tick - TUBE.open

	if (drawn < TUBE.line) {
		return {
			w: Math.max(1, Math.floor((1 - eased((drawn + 1) / TUBE.line)) * (layout.w / HALF))),
			h: 0,
		}
	}

	return drawn - TUBE.line < TUBE.dot ? { w: 1, h: 0 } : undefined
}

// The dot dims through red and is gone; the screen stays black.
function ember_glow(faded: number): string {
	const ember = Math.round(EMBER.full * Math.max(0, 1 - (faded - TUBE.dot + 1) / TUBE.fade))

	const levels = [ember, Math.round(ember * EMBER.green), Math.round(ember * EMBER.blue)]

	return bg(levels.map(String).join(';'))
}

function tube_off_draw(grid: Grid, layout: ThemeLayout, tick: number): void {
	const half = closing_half(layout, tick)

	if (half) {
		tube_picture(grid, layout, half)

		return
	}

	const faded = tick - TUBE.open - TUBE.line

	tube_picture(grid, layout, { w: faded < TUBE.dot + TUBE.fade ? 0 : -1, h: 0 }, ember_glow(faded))
}

function tube_off(layout: ThemeLayout): ThemePart {
	return {
		ticks: TUBE.open + TUBE.line + TUBE.dot + TUBE.fade + TUBE.hold,
		note: 'the tube switches off: the picture closes to a line, the line draws in to a dot, the dot fades',
		draw: (grid, tick) => {
			tube_off_draw(grid, layout, tick)
		},
	}
}

function blank_screen(grid: Grid, layout: ThemeLayout): void {
	for (let y = 0; y < layout.h; y++) blank_row(grid, y, layout.w)
}

// The two rows the board has just reached, bright.
function plain_lead(grid: Grid, shown: number): void {
	restyle(
		grid,
		(_, __, y) => y === shown - 1 || y === shown - PLAIN.pace,
		() => PLAIN_LEAD,
	)
}

interface PlainTitle {
	title: string
	reveal_from: number
}

// The name typing, its cursor after it until it is whole.
function plain_title(grid: Grid, layout: ThemeLayout, title: string, tick: number): void {
	const cursor = tick < title.length ? '█' : ''

	put(
		grid,
		{ y: Math.floor(layout.h / PLAIN.title_third), x: PLAIN.title_x },
		`${title.slice(0, tick + 1)}${cursor}`,
		'type',
	)
}

function plain_opening_draw(
	grid: Grid,
	layout: ThemeLayout,
	plain: PlainTitle,
	tick: number,
): void {
	const { title, reveal_from } = plain
	const shown = Math.max(0, (tick - reveal_from) * PLAIN.pace)

	for (let y = shown; y < layout.h; y++) blank_row(grid, y, layout.w)
	if (shown > 0 && shown <= layout.h) plain_lead(grid, shown)
	if (tick < reveal_from) plain_title(grid, layout, title, tick)
}

// A theme with no opening of its own: its name types on an empty screen, holds a second, and the
// board comes in two rows a tick behind a bright leading row.
function plain_opening(name: string, layout: ThemeLayout): ThemePart {
	const title = `> ${name}`
	const reveal_from = title.length + PLAIN_HOLD

	return {
		ticks: reveal_from + Math.ceil(layout.h / HALF) + PLAIN.tail,
		note: 'no opening of its own yet: the name types, then the board comes in from the top',
		draw: (grid, tick) => {
			plain_opening_draw(grid, layout, { title, reveal_from }, tick)
		},
	}
}

// A theme with no ending of its own: the board leaves two rows a tick from the bottom, and the
// screen stays empty for a second.
function plain_ending(name: string, layout: ThemeLayout): ThemePart {
	return {
		ticks: Math.ceil(layout.h / HALF) + PLAIN_HOLD,
		note: `no ending of its own yet: ${name.toLowerCase()} leaves from the bottom, a second of empty screen`,
		draw: (grid, tick) => {
			for (let y = Math.max(0, layout.h - tick * PLAIN.pace); y < layout.h; y++) {
				blank_row(grid, y, layout.w)
			}
		},
	}
}

const run_board_theme_host_parts = {
	TUBE_GLOW,
	blank_screen,
	eased,
	plain_ending,
	plain_opening,
	tube_off,
	tube_on,
	tube_picture,
}

export { run_board_theme_host_parts }
