import { issue_cite } from '#scripts/issue/issue-cite'
import type { Codec, Paint } from './run-board-theme-codec-context'
import { run_board_theme_codec_data } from './run-board-theme-codec-data'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import type { Box, Cell, Grid, Point } from './run-board-theme-host-types'

// The codec theme's radar (joshuafolkken/kit#8917), ported from the confirmed theme demo: guards
// patrolling round the player's mark, a jam of static, a new contact pinging inside a widening
// ring, and idle, a sweep and a ring spreading from the player.

const { BOLD, cell_at, fg, pick, put, repeated, set_cell } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { GREEN, STYLE } = run_board_theme_codec_data

// How the radar looks: how much static jams it, whether a new contact shows, its frame's color.
interface RadarLook {
	jam: number
	is_contact: boolean
	frame: string
}

// The radar's inside: its box and its inner width and height, for one tick.
interface RadarView {
	grid: Grid
	box: Box
	tick: number
	iw: number
	ih: number
}

interface Guard {
	iy: number
	a: number
	b: number
	speed: number
	phase: number
}

const HALF = 2
const JAM = { salt: 5, column: 7, glyphs: '░▒▓█ ' }
const JAM_GREYS: ReadonlyArray<string> = ['90;90;90', '160;160;160', '60;60;60']
const BIG_W = 40
const TRAIL = { big: 7, small: 3 }
const CONTACT = { share: 0.74, ring_max: 14, ring_cells: 7, blink: 4, lit: 2, tag_x: 4 }
const RING_EDGE = 0.5
const IDLE = { sweep_tail: 8, ping_every: 60, ping_ticks: 14 }
const FRAME_TRIM = { top: 10, sides: 2 }

function is_center(view: RadarView, ix: number, iy: number): boolean {
	return ix === Math.floor(view.iw / HALF) && iy === Math.floor(view.ih / HALF)
}

function radar_cell(view: RadarView, jam: number, ix: number, iy: number): Cell {
	const { tick } = view

	if (hash(tick, ix * JAM.column + iy, JAM.salt) < jam) {
		return [pick(JAM.glyphs, hash(tick, ix, iy)), fg(pick(JAM_GREYS, hash(iy, tick, ix)))]
	}

	if (is_center(view, ix, iy)) return ['▲', STYLE.white]

	return [(ix + iy) % HALF === 0 ? '·' : ' ', fg('40;110;65')]
}

function guards_of(ih: number, is_big: boolean): ReadonlyArray<Guard> {
	const guards = [
		{ iy: 0, a: 0.08, b: 0.34, speed: 0.08, phase: 0 },
		{ iy: ih - 1, a: 0.56, b: 0.34, speed: 0.06, phase: 1 },
	]
	const more = [
		{ iy: 1, a: 0.62, b: 0.3, speed: 0.05, phase: 2.2 },
		{ iy: ih - HALF, a: 0.1, b: 0.3, speed: 0.07, phase: 4 },
	]

	return is_big ? [...guards, ...more] : guards
}

// One cell of a guard's sight, inside the radar.
function sight_cell(view: RadarView, y: number, sx: number): void {
	if (sx < 0 || sx >= view.iw) return
	put(view.grid, { y, x: view.box.x + 1 + sx }, '░', fg('255;210;60'))
}

// A guard walks back and forth along its row, a trail of its sight ahead of it.
function radar_guard(view: RadarView, guard: Guard, trail: number): void {
	const { grid, box, tick, iw } = view
	const angle = tick * guard.speed + guard.phase
	const ix = Math.round(iw * (guard.a + (guard.b * (Math.sin(angle) + 1)) / HALF))
	const direction = Math.cos(angle) > 0 ? 1 : -1
	const y = box.y + 1 + guard.iy

	for (let step = 1; step <= trail; step++) sight_cell(view, y, ix + direction * step)
	put(grid, { y, x: box.x + 1 + ix }, '●', `${fg('255;60;50')}${BOLD}`)
}

function radar_guards(view: RadarView): void {
	const is_big = view.iw > BIG_W

	for (const guard of guards_of(view.ih, is_big)) {
		radar_guard(view, guard, is_big ? TRAIL.big : TRAIL.small)
	}
}

interface Ring {
	cx: number
	cy: number
	radius: number
}

function is_on_ring(ring: Ring, ix: number, iy: number): boolean {
	return Math.abs(Math.hypot((ix - ring.cx) / HALF, iy - ring.cy) - ring.radius) < RING_EDGE
}

function ring_row(view: RadarView, ring: Ring, iy: number, style: string): void {
	for (let ix = 0; ix < view.iw; ix++) {
		if (is_on_ring(ring, ix, iy)) {
			put(view.grid, { y: view.box.y + 1 + iy, x: view.box.x + 1 + ix }, 'o', style)
		}
	}
}

// On a radar as wide as the area, the contact is tagged with the new lane.
function contact_tag(view: RadarView, at: Point, new_lane: string): void {
	put(view.grid, at, ` ? ${issue_cite.plain_for('terminal', new_lane)} `, STYLE.query)
}

// A lane added: a new contact blinks on the radar inside a ring that widens.
function radar_contact(view: RadarView, start: number, new_lane: string): void {
	const { grid, box, tick, iw, ih } = view
	const cx = Math.round(iw * CONTACT.share)
	const cy = Math.floor(ih / HALF)
	const span = Math.min(CONTACT.ring_max, Math.floor(iw / CONTACT.ring_cells))
	const ring = { cx, cy, radius: (((tick - start) / HALF) % span) + RING_EDGE }

	for (let iy = 0; iy < ih; iy++) ring_row(view, ring, iy, `${fg('255;230;90')}${BOLD}`)
	const at = { y: box.y + 1 + cy, x: box.x + 1 + cx }

	put(grid, at, '◆', tick % CONTACT.blink < CONTACT.lit ? STYLE.white : STYLE.yellow)
	if (iw > BIG_W) contact_tag(view, { y: at.y, x: box.x + CONTACT.tag_x + cx }, new_lane)
}

function radar_frame(grid: Grid, box: Box, style: string): void {
	put(grid, { y: box.y, x: box.x }, `┌─ RADAR ${repeated('─', box.w - FRAME_TRIM.top)}┐`, style)
	put(
		grid,
		{ y: box.y + box.h - 1, x: box.x },
		`└${repeated('─', box.w - FRAME_TRIM.sides)}┘`,
		style,
	)

	for (let iy = 1; iy < box.h - 1; iy++) {
		put(grid, { y: box.y + iy, x: box.x }, '│', style)
		put(grid, { y: box.y + iy, x: box.x + box.w - 1 }, '│', style)
	}
}

function view_of(grid: Grid, box: Box, tick: number): RadarView {
	return { grid, box, tick, iw: box.w - FRAME_TRIM.sides, ih: box.h - FRAME_TRIM.sides }
}

function radar_field(view: RadarView, jam: number): void {
	for (let iy = 0; iy < view.ih; iy++) {
		for (let ix = 0; ix < view.iw; ix++) {
			const at = { y: view.box.y + 1 + iy, x: view.box.x + 1 + ix }

			set_cell(view.grid, at, radar_cell(view, jam, ix, iy))
		}
	}
}

const JAM_GUARDS = 0.9

function radar(codec: Codec, paint: Paint, box: Box, look: RadarLook): void {
	const view = view_of(paint.grid, box, paint.tick)

	radar_field(view, look.jam)
	if (look.jam < JAM_GUARDS) radar_guards(view)
	if (look.is_contact) radar_contact(view, paint.s.row.start, codec.layout.new_lane)
	radar_frame(paint.grid, box, `${fg(look.frame)}${BOLD}`)
}

// Idle, one cell of the radar: the ring from the player's mark over all but the mark, the sweep
// over the empty cells.
function is_pinged(view: RadarView, ix: number, iy: number): boolean {
	const ping = view.tick % IDLE.ping_every

	if (ping >= IDLE.ping_ticks) return false
	const ring = {
		cx: Math.floor(view.iw / HALF),
		cy: Math.floor(view.ih / HALF),
		radius: ping / HALF,
	}

	return is_on_ring(ring, ix, iy)
}

function swept_cell(ch: string, sweep: number, ix: number): Cell | undefined {
	if (ch !== '·' && ch !== ' ') return undefined
	if (ix === sweep) return ['│', fg('130;255;160')]

	return ix === sweep - 1 ? ['·', fg('90;200;120')] : undefined
}

function idle_cell(view: RadarView, sweep: number, ix: number, iy: number): Cell | undefined {
	const [ch] = cell_at(view.grid, view.box.y + 1 + iy, view.box.x + 1 + ix)

	if (ch !== '▲' && is_pinged(view, ix, iy)) return ['o', fg(GREEN.ok)]

	return swept_cell(ch, sweep, ix)
}

function idle_row(view: RadarView, sweep: number, iy: number): void {
	for (let ix = 0; ix < view.iw; ix++) {
		const cell = idle_cell(view, sweep, ix, iy)

		if (cell) set_cell(view.grid, { y: view.box.y + 1 + iy, x: view.box.x + 1 + ix }, cell)
	}
}

// Idle, the radar is alive: a bright line sweeps across it, and every three seconds a ring spreads
// out from the player's own mark.
function radar_idle(grid: Grid, box: Box, tick: number): void {
	const view = view_of(grid, box, tick)
	const sweep = Math.floor(tick / HALF) % (view.iw + IDLE.sweep_tail)

	for (let iy = 0; iy < view.ih; iy++) idle_row(view, sweep, iy)
}

const run_board_theme_codec_radar = {
	guards_of,
	is_on_ring,
	radar,
	radar_cell,
	radar_idle,
	view_of,
}

export { run_board_theme_codec_radar }
export type { RadarLook, RadarView }
