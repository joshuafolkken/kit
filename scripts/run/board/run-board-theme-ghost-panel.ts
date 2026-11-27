import { run_board_theme_draw, type Pane, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_ghost_data } from './run-board-theme-ghost-data'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Point, ThemeState } from './run-board-theme-host-types'

// The ghost theme's panel. Idle: the link, the barrier and a drifting sync reading on the left; on
// the right a ring of text traveling round an ellipse with a small net graph inside it, and now and
// then a camouflage ripple. PROGRESS: a dive — rectangles zoom to the ring's centre, hex pairs stream
// sideways under the status, the ring spins faster.

const { cell_at, cells_bar, code_points, pick, set_cell } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { active } = run_board_theme_host_state
const { PAIR, panel_box, panel_pane, put_in, ring_point } = run_board_theme_draw
const { DIVE, GRAPH, HEX_DIGITS, INKS, RING, RIPPLE, STATUS } = run_board_theme_ghost_data

// A ring of text: its centre and radii in its pane, how far it has turned, and one ink for every
// letter where it is not drawn in its own.
interface TextRing {
	center: Point
	radius: Point
	spin: number
	ink?: string | undefined
}

// A PROGRESS plays: while its line types and a moment after.
function is_diving(state: ThemeState): boolean {
	return active(state.progress, DIVE.linger)
}

// The ring's turns so far: slowly always, faster for every tick anything has typed.
function spin_of(state: ThemeState, tick: number): number {
	return tick * RING.idle_pace + state.busy_ticks * (RING.busy_pace - RING.idle_pace)
}

// The ring's words round the ellipse, clockwise, as many letters as its width carries.
function text_ring(pane: Pane, ring: TextRing): void {
	const letters = code_points(RING.text)
	const count = Math.max(1, Math.round(ring.radius.x * RING.density))

	for (let index = 0; index < count; index++) {
		const letter = letters[index % letters.length] ?? ' '
		const own = letter === '·' ? INKS.DIM : INKS.CYAN

		put_in(
			pane,
			ring_point(ring.center, ring.radius, index / count + ring.spin),
			letter,
			ring.ink ?? own,
		)
	}
}

function labeled(pane: Pane, y: number, name: string, value: string): void {
	put_in(pane, { x: 0, y }, name, INKS.DIM)
	put_in(pane, { x: STATUS.value_x, y }, value, INKS.PALE)
}

// The sync reading, a few tenths under its best, held a second and a half.
function sync_text(tick: number): string {
	const held = Math.floor(tick / STATUS.sync_hold)
	const drift = Math.floor(hash(held, STATUS.sync_salt) * STATUS.sync_drift)

	return `${((STATUS.sync - drift) / STATUS.tenth).toFixed(1)}%`
}

// The status block, its barrier gauge `barrier` cells full.
function status_block(draw: ThemeDraw, barrier: number): void {
	const { s, tick } = draw
	const pane = panel_pane(draw)

	labeled(pane, STATUS.link_row, 'LINK', s.busy ? 'DIVING' : 'ACTIVE')
	labeled(pane, STATUS.barrier_row, 'BARRIER', cells_bar(barrier, STATUS.barrier_cells))
	labeled(pane, STATUS.sync_row, 'SYNC', sync_text(tick))
}

// The small net graph inside the ring, one node after another lit.
function graph(pane: Pane, tick: number): void {
	const lit = pick(
		GRAPH.nodes,
		(Math.floor(tick / GRAPH.hop) % GRAPH.nodes.length) / GRAPH.nodes.length,
	)

	for (const [index, row] of GRAPH.rows.entries()) {
		put_in(pane, { x: GRAPH.x, y: GRAPH.y + index }, row, INKS.CYAN)
	}

	put_in(pane, { x: GRAPH.x + lit.x, y: GRAPH.y + lit.y }, '●', INKS.PALE)
}

// One row of the rippling patch: its cells slip a column to the right and dim.
function slip_row(draw: ThemeDraw, at: Point): void {
	for (let x = at.x + RIPPLE.w - 1; x > at.x; x--) {
		const [ch] = cell_at(draw.grid, at.y, x - 1)

		set_cell(draw.grid, { y: at.y, x }, [ch, INKS.DIM])
	}
}

// The camouflage ripple: for a few ticks every few seconds a small patch of the panel slips.
function ripple(draw: ThemeDraw): void {
	const { api, tick } = draw
	const box = panel_box(api.layout)
	const seed = Math.floor(tick / RIPPLE.every)

	if (tick % RIPPLE.every >= RIPPLE.ticks || box.y >= draw.grid.length) return
	const at = {
		x: box.x + Math.floor(hash(seed, 1, RIPPLE.salt) * (box.w - RIPPLE.w)),
		y: box.y + Math.floor(hash(seed, PAIR, RIPPLE.salt) * (box.h - RIPPLE.h)),
	}

	for (let row = 0; row < RIPPLE.h; row++) slip_row(draw, { x: at.x, y: at.y + row })
}

// One of the nested rectangles: born wide and dim, shrinking to the ring's centre and brightening.
function dive_rect(draw: ThemeDraw, index: number): void {
	const { api, grid, tick } = draw
	const box = panel_box(api.layout)
	const phase = (tick * DIVE.pace + index / DIVE.rects) % 1
	const half = { x: (1 - phase) * DIVE.half_x, y: (1 - phase) * (RING.radius.y - 1) }
	const center = { x: box.x + RING.x, y: box.y + RING.y }
	const corners = {
		x0: Math.round(center.x - half.x),
		y0: Math.round(center.y - half.y),
		x1: Math.round(center.x + half.x),
		y1: Math.round(center.y + half.y),
	}

	api.rect_frame(grid, corners, phase < DIVE.near ? INKS.DIM : INKS.CYAN)
}

// A stream's cell: two hex digits and a blank, over and over, fixed by where the pair is.
function stream_cell(position: number, row: number): string {
	const slot = ((position % DIVE.pair) + DIVE.pair) % DIVE.pair

	if (slot === DIVE.pair - 1) return ' '

	return pick(HEX_DIGITS, hash(Math.floor(position / DIVE.pair), slot, DIVE.salt + row))
}

// Hex pairs streaming sideways on two rows, one each way.
function hex_streams(pane: Pane, tick: number): void {
	for (let index = 0; index < DIVE.streams; index++) {
		const drift = index === 0 ? tick : -tick
		const cells = Array.from({ length: DIVE.stream_w }, (_, x) => stream_cell(x + drift, index))

		put_in(pane, { x: 0, y: DIVE.stream_row + index }, cells.join(''), INKS.CYAN)
	}
}

function dive(draw: ThemeDraw, pane: Pane): void {
	for (let index = 0; index < DIVE.rects; index++) dive_rect(draw, index)

	hex_streams(pane, draw.tick)
}

function panel(draw: ThemeDraw): void {
	const { s, tick } = draw
	const pane = panel_pane(draw)

	status_block(draw, STATUS.barrier_lit)
	if (is_diving(s)) dive(draw, pane)
	else graph(pane, tick)
	text_ring(pane, { center: { x: RING.x, y: RING.y }, radius: RING.radius, spin: spin_of(s, tick) })
	if (!s.busy) ripple(draw)
}

const run_board_theme_ghost_panel = { is_diving, panel, spin_of, status_block, text_ring }

export { run_board_theme_ghost_panel }
export type { TextRing }
