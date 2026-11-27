import { run_board_theme_draw, type Pane, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_parts } from './run-board-theme-host-parts'
import type { Point, ThemeApi, ThemeLayout, ThemePart } from './run-board-theme-host-types'
import { run_board_theme_isac_data } from './run-board-theme-isac-data'

// The isac theme's opening: on an empty screen the title types from the first tick while a ring
// draws clockwise in the middle; brackets run out from it to the screen's corners, the board showing
// dim inside them; then the board fades in orange and is the board as it is.

const { fg, mixed, restyle } = run_board_theme_host_grid
const { eased } = run_board_theme_host_parts
const { PAIR, blank_unless, is_drawn, put_in, ring_point, screen_pane, share_of } =
	run_board_theme_draw
const { INKS, OPEN, RGB } = run_board_theme_isac_data

function center_of(layout: ThemeLayout): Point {
	return { x: layout.screen_cx, y: layout.screen_cy }
}

// Whether `at` is no further from `center` than `half` either way.
function is_inside(at: Point, center: Point, half: Point): boolean {
	return Math.abs(at.x - center.x) <= half.x && Math.abs(at.y - center.y) <= half.y
}

// The ring's own window, which the board stays out of.
function ring_half(): Point {
	return { x: OPEN.radius.x + OPEN.pad.x, y: OPEN.radius.y + OPEN.pad.y }
}

// Half the brackets' rectangle: the ring's window at first, the whole screen once they have run out.
function rect_half(layout: ThemeLayout, tick: number): Point {
	const grown = eased(share_of(tick, OPEN.expand_from, OPEN.expand_ticks))
	const from = ring_half()

	return {
		x: Math.round(from.x + (layout.w - from.x) * grown),
		y: Math.round(from.y + (layout.h - from.y) * grown),
	}
}

// The board's cells in one orange, `share` of the way from dim to full.
function faded(draw: ThemeDraw, share: number): void {
	const ink = fg(mixed(RGB.dim, RGB.orange, share))

	restyle(
		draw.grid,
		(cell) => is_drawn(cell),
		() => ink,
	)
}

// The ring as far as it has drawn, clockwise from the top, and the title typing under its middle.
function ring_and_title(pane: Pane, center: Point, tick: number): void {
	const shown = Math.ceil(share_of(tick + 1, 0, OPEN.ring_ticks) * OPEN.points)
	const title_x = center.x - Math.floor(OPEN.title.length / PAIR)

	for (let index = 0; index < shown; index++) {
		put_in(pane, ring_point(center, OPEN.radius, index / OPEN.points), '∙', INKS.BRIGHT)
	}

	put_in(pane, { x: title_x, y: center.y }, OPEN.title.slice(0, tick + 1), INKS.WHITE)
}

// The four brackets at the rectangle's corners, kept on the screen.
function brackets(pane: Pane, center: Point, half: Point): void {
	const left = Math.max(0, center.x - half.x)
	const right = Math.min(pane.box.w, center.x + half.x + 1) - OPEN.arm.length - 1
	const top = Math.max(0, center.y - half.y)
	const bottom = Math.min(pane.box.h - 1, center.y + half.y)

	put_in(pane, { x: left, y: top }, `┌${OPEN.arm}`, INKS.BRIGHT)
	put_in(pane, { x: right, y: top }, `${OPEN.arm}┐`, INKS.BRIGHT)
	put_in(pane, { x: left, y: bottom }, `└${OPEN.arm}`, INKS.BRIGHT)
	put_in(pane, { x: right, y: bottom }, `${OPEN.arm}┘`, INKS.BRIGHT)
}

// Until the brackets reach the corners: the board dim inside their rectangle, the ring over it.
function running_out(draw: ThemeDraw): void {
	const { api, grid, tick } = draw
	const pane = screen_pane(draw)
	const center = center_of(api.layout)
	const half = rect_half(api.layout, tick)
	const is_open = tick >= OPEN.expand_from

	blank_unless(
		grid,
		(_, x, y) =>
			is_open && is_inside({ x, y }, center, half) && !is_inside({ x, y }, center, ring_half()),
	)
	faded(draw, 0)
	ring_and_title(pane, center, tick)
	if (is_open) brackets(pane, center, half)
}

function opening_draw(draw: ThemeDraw): void {
	const { tick } = draw

	if (tick >= OPEN.fade_from + OPEN.fade_ticks) return
	if (tick < OPEN.fade_from) running_out(draw)
	else faded(draw, share_of(tick, OPEN.fade_from, OPEN.fade_ticks))
}

function opening_of(api: ThemeApi): ThemePart {
	return {
		ticks: OPEN.ticks,
		note: 'the title types while a ring draws clockwise · brackets run out to the corners · the board fades in orange',
		draw: (grid, tick, state) => {
			opening_draw({ api, grid, s: state, tick })
		},
	}
}

const run_board_theme_isac_opening = { opening_of, rect_half }

export { run_board_theme_isac_opening }
