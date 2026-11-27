import { run_board_theme_draw, type Pane, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_ghost_data } from './run-board-theme-ghost-data'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Point, ThemeState } from './run-board-theme-host-types'

// The ghost theme's ROW: the new lane decloaks — where its text has not typed yet the row shimmers
// as dim noise, which the typing resolves left to right into the lane's own text; over the data
// left of the panel a net graph gains a node, a link drawing out to it.

const { cell_at, pick, set_cell } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { LINGER, active } = run_board_theme_host_state
const { clear_pane, data_pane, is_drawn, line_points, put_in, typed_share } = run_board_theme_draw
const { CLOAK, INKS } = run_board_theme_ghost_data

function is_linking(state: ThemeState): boolean {
	return active(state.row, CLOAK.tail + LINGER)
}

function blink_ink(tick: number): string {
	return tick % CLOAK.blink < CLOAK.blink_lit ? INKS.PALE : INKS.DIM
}

// A cell of the lane's row still cloaked: noise where the lane's own text has a letter.
function noise_cell(draw: ThemeDraw, at: Point): void {
	const { api, grid, tick } = draw

	if (!is_drawn(cell_at(api.board, at.y, at.x))) return
	const held = Math.floor(tick / CLOAK.hold)

	set_cell(grid, at, [pick(CLOAK.glyphs, hash(at.x, held, CLOAK.salt)), INKS.DIM])
}

// The lane's row past its typing: noise as far as its text runs, resolved as the typing reaches it.
function decloak(draw: ThemeDraw): void {
	const { row } = draw.s
	const { y, x } = row.span

	if (!row.is_typing) return

	for (let at = x + row.length + 1; at < x + row.total; at++) noise_cell(draw, { x: at, y })
}

// A node's cell in the pane, from its shares of the pane's width and height.
function node_at(pane: Pane, share: Point): Point {
	return {
		x: Math.round(share.x * (pane.box.w - 1)),
		y: Math.round(share.y * (pane.box.h - 1)),
	}
}

// A link's dots, a brighter one travelling along it.
function link(pane: Pane, ends: { from: Point; to: Point }, tick: number): void {
	const points = line_points(node_at(pane, ends.from), node_at(pane, ends.to))
	const lit = points[Math.floor(tick / CLOAK.pulse_pace) % points.length]

	for (const at of points) put_in(pane, at, '·', INKS.DIM)

	if (lit) put_in(pane, lit, '∙', INKS.PALE)
}

function net(pane: Pane, tick: number): void {
	for (const ends of CLOAK.links) link(pane, ends, tick)

	for (const node of Object.values(CLOAK.nodes)) put_in(pane, node_at(pane, node), '●', INKS.CYAN)
}

// The new link draws out as the lane types; its node lights with the lane's number once it has.
function new_link(draw: ThemeDraw, pane: Pane): void {
	const { api, s, tick } = draw
	const to = node_at(pane, CLOAK.new_link.to)
	const points = line_points(node_at(pane, CLOAK.new_link.from), to)
	const shown = points.slice(0, Math.ceil(typed_share(s.row) * points.length))
	const lit = s.row.is_typing ? blink_ink(tick) : INKS.WHITE

	for (const at of shown) put_in(pane, at, '·', INKS.PALE)

	put_in(pane, to, s.row.is_typing ? '○' : '◉', lit)
	put_in(pane, { x: to.x + CLOAK.gap, y: to.y }, `#${api.layout.new_lane}`, lit)
}

// ROW: the data left of the panel gives way to the net graph; the panel keeps its ring.
function linking(draw: ThemeDraw): void {
	const { s, tick } = draw
	const pane = data_pane(draw)
	const label = s.row.is_typing ? 'DECLOAKING' : 'NODE LINKED'

	clear_pane(pane)
	net(pane, tick)
	new_link(draw, pane)
	put_in(pane, { x: CLOAK.label_x, y: 0 }, label, s.row.is_typing ? blink_ink(tick) : INKS.WHITE)
}

const run_board_theme_ghost_cloak = { decloak, is_linking, linking, node_at }

export { run_board_theme_ghost_cloak }
