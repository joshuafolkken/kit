import { run_board_theme_draw, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_parts } from './run-board-theme-host-parts'
import type { Cell, Point, ThemeApi, ThemePart } from './run-board-theme-host-types'
import { run_board_theme_isac_data } from './run-board-theme-isac-data'

// The isac theme's ending: a signal flare — a bright column rises from the bottom centre; a ring
// closes on the middle of the screen, the board dimming inside it and gone outside it; then the
// empty screen holds.

const { fg, mixed, restyle } = run_board_theme_host_grid
const { eased } = run_board_theme_host_parts
const { blank_unless, is_drawn, put_in, ring_reach, screen_pane, share_of } = run_board_theme_draw
const { FLARE, INKS, RGB } = run_board_theme_isac_data

// The closing ring at a tick: its centre, its radii, and how far it has closed.
interface Ring {
	center: Point
	radius: Point
	closed: number
}

function ring_at(draw: ThemeDraw): Ring {
	const { w, h, screen_cx, screen_cy } = draw.api.layout
	const closed = eased(share_of(draw.tick, FLARE.close_from, FLARE.close_ticks))
	const open = (1 - closed) * FLARE.reach

	return {
		center: { x: screen_cx, y: screen_cy },
		radius: { x: Math.max(FLARE.least, w * open), y: Math.max(FLARE.least, h * open) },
		closed,
	}
}

// The flare: a column from the screen's bottom row up to its head, which climbs to the middle.
function flare(draw: ThemeDraw, ring: Ring): void {
	const pane = screen_pane(draw)
	const last = pane.box.h - 1
	const risen = share_of(draw.tick + 1, 0, FLARE.rise_ticks)
	const head = last - Math.round(risen * (last - ring.center.y))

	for (let y = head + 1; y <= last; y++) put_in(pane, { x: ring.center.x, y }, '│', INKS.BRIGHT)

	put_in(pane, { x: ring.center.x, y: head }, '▲', INKS.WHITE)
}

function edge_row(row: Array<Cell>, y: number, ring: Ring): void {
	for (const x of row.keys()) {
		const reach = ring_reach(ring.center, ring.radius, { x, y })

		if (reach <= 1 && reach > 1 - FLARE.ring_w) row[x] = ['∙', INKS.BRIGHT]
	}
}

// The ring closing: the board gone outside it, dimming inside it, the ring itself on its edge.
function closing(draw: ThemeDraw, ring: Ring): void {
	const { grid, tick } = draw
	const ink = fg(mixed(RGB.orange, RGB.dim, ring.closed))

	blank_unless(grid, (_, x, y) => ring_reach(ring.center, ring.radius, { x, y }) <= 1)
	if (tick < FLARE.close_from) return
	restyle(
		grid,
		(cell) => is_drawn(cell),
		() => ink,
	)

	for (const [y, row] of grid.entries()) edge_row(row, y, ring)
}

function ending_draw(draw: ThemeDraw): void {
	const ring = ring_at(draw)

	if (draw.tick >= FLARE.gone) {
		draw.api.blank_screen(draw.grid)

		return
	}

	flare(draw, ring)
	closing(draw, ring)
}

function ending_of(api: ThemeApi): ThemePart {
	return {
		ticks: FLARE.ticks,
		note: 'a flare rises from the bottom centre · the ring closes · the board dims out from the edges',
		draw: (grid, tick, state) => {
			ending_draw({ api, grid, s: state, tick })
		},
	}
}

const run_board_theme_isac_ending = { ending_of, ring_at }

export { run_board_theme_isac_ending }
