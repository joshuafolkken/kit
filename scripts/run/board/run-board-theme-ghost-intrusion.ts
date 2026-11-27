import { run_board_theme_draw, type Pane, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_ghost_data } from './run-board-theme-ghost-data'
import { run_board_theme_ghost_panel } from './run-board-theme-ghost-panel'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_parts } from './run-board-theme-host-parts'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Point, ThemeState } from './run-board-theme-host-types'

// The ghost theme's NOTICE: an intrusion. Over the build the ring of text grows out of the panel to
// take the area and blocks of the area scramble into glyph noise; at the peak the ring flashes white;
// over the play-out the barrier restores the blocks one by one and the ring draws back. A cyan bar
// sweeps the header while the notice plays.

const { pick, restyle } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { eased } = run_board_theme_host_parts
const { active } = run_board_theme_host_state
const { PAIR, area_pane, put_in, share_of, typed_share } = run_board_theme_draw
const { INKS, INTRUSION, RING, STATUS } = run_board_theme_ghost_data
const { spin_of, status_block, text_ring } = run_board_theme_ghost_panel

const NOISE_INKS: ReadonlyArray<string> = [INKS.DIM, INKS.DIM, INKS.CYAN]

// A NOTICE plays: its build and its play-out, the last second left to the settled board.
function is_intruded(state: ThemeState): boolean {
	return active(state.notice, INTRUSION.play)
}

// The share of the area's blocks scrambled: rising through the build, restored over the play-out.
function scrambled_share(state: ThemeState): number {
	const { notice } = state
	const restored = share_of(notice.cooled, INTRUSION.restore_from, INTRUSION.restore_ticks)

	return (notice.is_typing ? typed_share(notice) : 1 - restored) * INTRUSION.most
}

// How far the ring has grown out of the panel: eased out through the build, back in at the end.
function grown(state: ThemeState): number {
	const { notice } = state

	if (notice.is_typing) return eased(typed_share(notice))

	return 1 - eased(share_of(notice.cooled, INTRUSION.shrink_from, INTRUSION.shrink_ticks))
}

function noise_cell(pane: Pane, at: Point, tick: number): void {
	const held = Math.floor(tick / INTRUSION.hold)
	const is_gap = hash(at.x, at.y, INTRUSION.gap_salt) < INTRUSION.gaps
	const glyph = pick(INTRUSION.glyphs, hash(at.x, at.y, INTRUSION.glyph_salt + held))

	put_in(pane, at, is_gap ? ' ' : glyph, pick(NOISE_INKS, hash(at.y, at.x, INTRUSION.gap_salt)))
}

function scramble_block(pane: Pane, block: Point, tick: number): void {
	const from = { x: block.x * INTRUSION.block_w, y: block.y * INTRUSION.block_h }

	for (let row = 0; row < INTRUSION.block_h; row++) {
		for (let column = 0; column < INTRUSION.block_w; column++) {
			noise_cell(pane, { x: from.x + column, y: from.y + row }, tick)
		}
	}
}

// Every block of the area the intrusion has reached, its cells glyph noise.
function scramble(draw: ThemeDraw, pane: Pane): void {
	const share = scrambled_share(draw.s)
	const blocks = {
		x: Math.ceil(pane.box.w / INTRUSION.block_w),
		y: Math.ceil(pane.box.h / INTRUSION.block_h),
	}

	for (let index = 0; index < blocks.x * blocks.y; index++) {
		const block = { x: index % blocks.x, y: Math.floor(index / blocks.x) }

		if (hash(block.x, block.y, INTRUSION.salt) < share) scramble_block(pane, block, draw.tick)
	}
}

function between(from: Point, to: Point, share: number): Point {
	return { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share }
}

// The ring of text, from its place in the panel out to the whole area; white for the peak's moment.
function big_ring(draw: ThemeDraw, pane: Pane): void {
	const { api, s, tick } = draw
	const share = grown(s)
	const middle = { x: (pane.box.w - 1) / PAIR, y: (pane.box.h - 1) / PAIR }
	const wide = { x: pane.box.w * INTRUSION.reach, y: middle.y }
	const is_flash = !s.notice.is_typing && s.notice.cooled < INTRUSION.flash

	text_ring(pane, {
		center: between({ x: api.layout.px + RING.x, y: RING.y }, middle, share),
		radius: between(RING.radius, wide, share),
		spin: spin_of(s, tick),
		ink: is_flash ? INKS.WHITE : undefined,
	})
}

// The label's words and ink: the intrusion to just past the peak, then the barrier restoring.
function label_of(state: ThemeState, tick: number): readonly [string, string] {
	const { notice } = state
	const is_lit = tick % INTRUSION.blink < INTRUSION.blink_lit

	if (notice.is_typing || notice.cooled < INTRUSION.restore_from) {
		return [INTRUSION.label, is_lit ? INKS.ORANGE : INKS.PALE]
	}

	return notice.cooled < INTRUSION.restore_from + INTRUSION.restore_ticks
		? [INTRUSION.restoring, INKS.ORANGE]
		: [INTRUSION.restored, INKS.WHITE]
}

function label(draw: ThemeDraw, pane: Pane): void {
	const [text, ink] = label_of(draw.s, draw.tick)
	const x = Math.max(0, Math.floor((pane.box.w - text.length) / PAIR))

	put_in(pane, { x, y: Math.floor((pane.box.h - 1) / PAIR) }, text, ink)
}

// A cyan bar sweeping the header's three rows, left to right, again and again.
function header_bar(draw: ThemeDraw): void {
	const { api, grid, s, tick } = draw
	const run = api.layout.edge + INTRUSION.bar_w
	const from = (((tick - s.notice.start) * INTRUSION.bar_pace) % run) - INTRUSION.bar_w

	restyle(
		grid,
		(_, x, y) => y < INTRUSION.header_rows && x >= from && x < from + INTRUSION.bar_w,
		() => INKS.BAR,
	)
}

// NOTICE: the status block's barrier falling, the scramble, the ring over it, the label, the bar.
function intrusion(draw: ThemeDraw): void {
	const pane = area_pane(draw)
	const held = 1 - scrambled_share(draw.s) / INTRUSION.most

	status_block(draw, Math.round(STATUS.barrier_lit * held))
	scramble(draw, pane)
	big_ring(draw, pane)
	label(draw, pane)
	header_bar(draw)
}

const run_board_theme_ghost_intrusion = { intrusion, is_intruded, scrambled_share }

export { run_board_theme_ghost_intrusion }
