import { run_board_theme_draw, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid, Point, ThemeLayout, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_rk800_break } from './run-board-theme-rk800-break'
import { run_board_theme_rk800_data } from './run-board-theme-rk800-data'
import { run_board_theme_rk800_notice } from './run-board-theme-rk800-notice'
import { run_board_theme_rk800_parts } from './run-board-theme-rk800-parts'

// The rk800 theme's NOTICE: the red wall of orders. The board freezes grey; over the four seconds
// of the build the wall grows from the left across THROUGHPUT and USAGE — red squares, a red grid,
// the glitching order text over hazard stripes, blue key prompts — and, once those are used, over
// the header's left columns, its pinned column and its first row's gauges. Five hits flash the whole
// screen and cracks radiate; at the peak the wall shatters (`run-board-theme-rk800-break.ts`).

const { bg, code_points, fg, pick, put, repeated, restyle } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { NOTICE_END, PEAK_TICKS, active } = run_board_theme_host_state
const { BLANK, PAIR, clamped, share_of } = run_board_theme_draw
const { RGB, WALL } = run_board_theme_rk800_data
const { ORDER, ORDERS } = run_board_theme_rk800_notice
const { bold, ink, mix, on } = run_board_theme_rk800_parts
const { center_of, cracks } = run_board_theme_rk800_break

// A stretch of the board the wall grows over: its rows and columns, how far the wall has grown on
// it, and the hit that flashes its cells — the area's alone — if one lands now.
interface Slab {
	top: number
	bottom: number
	left: number
	right: number
	share: number
	edge: number
	hit_age?: number | undefined
}

// The ticks since the NOTICE started, through its build and its play-out; -1 while none plays.
function wall_age(state: ThemeState, tick: number): number {
	return active(state.notice, NOTICE_END) ? tick - state.notice.start : -1
}

// Whether a hit lands `age` ticks into the wall's build.
function is_hit(age: number): boolean {
	return WALL.hits.some((hit) => age >= hit && age < hit + WALL.hit_ticks)
}

// The hits the wall has taken `age` ticks into its build.
function hits_passed(age: number): number {
	return WALL.hits.filter((hit) => age >= hit).length
}

// The board freezes grey — its faint parts darker — and flashes whole on a hit; the notice's own row
// keeps its color.
function freeze(draw: ThemeDraw, age: number): void {
	const dark = ink(mix(RGB.grey, RGB.night, 1 / PAIR))
	const lit = is_hit(age) ? bold(mix(RGB.order, RGB.white, WALL.flash_ink)) : ink(RGB.grey)

	restyle(
		draw.grid,
		(_, __, y) => y !== draw.api.layout.notice.y,
		(_, __, [, style]) => (style.includes('dim') || style.includes('rule') ? dark : lit),
	)
}

function hit_cell(at: Point, age: number): Cell {
	const sway = hash(Math.floor(at.x / PAIR), at.y, WALL.hit_salt)
	const ground = mix(RGB.red, RGB.night, WALL.hit_dark + WALL.hit_sway * sway)

	return [pick(WALL.hit_glyphs, hash(at.x, at.y, age)), `${fg(RGB.order)}${bg(ground)}`]
}

// The wall thickens from the left: each push leaves more red squares behind.
function is_block(slab: Slab, at: Point): boolean {
	const thinned = 1 - (WALL.thin * at.x) / slab.edge

	return hash(Math.floor(at.x / PAIR), at.y, WALL.block_salt) < slab.share * WALL.fill * thinned
}

function block_style(at: Point): string {
	const ground = hash(Math.floor(at.x / PAIR), at.y, WALL.ground_salt)

	return `${fg(RGB.grey)}${bg(mix(RGB.wall_dark, RGB.wall_bright, ground))}`
}

// The red grid's line through a cell, `row` rows under the slab's top; none between its lines.
function grid_glyph(x: number, row: number): string | undefined {
	const is_line = row % WALL.grid_y === WALL.grid_line

	if (x % WALL.grid_x === 0) return is_line ? '┼' : '│'

	return is_line ? '─' : undefined
}

function wall_cell(slab: Slab, at: Point, cell: Cell): Cell {
	if (slab.hit_age !== undefined) return hit_cell(at, slab.hit_age)
	if (is_block(slab, at)) return [cell[0], block_style(at)]
	const glyph = cell[0] === ' ' ? grid_glyph(at.x, at.y - slab.top) : undefined

	return glyph === undefined ? cell : [glyph, ink(mix(RGB.red, RGB.night, WALL.grid_dark))]
}

function slab_row(row: Array<Cell>, y: number, slab: Slab): void {
	const end = Math.min(slab.right, row.length)

	for (let x = Math.max(0, slab.left); x < end; x++) {
		row[x] = wall_cell(slab, { x, y }, row[x] ?? BLANK)
	}
}

function lay_slab(grid: Grid, slab: Slab): void {
	if (slab.share <= 0) return

	for (let y = slab.top; y <= slab.bottom; y++) slab_row(grid[y] ?? [], y, slab)
}

// The area whole, then the header's borrowed columns and its first row's gauges once the build is
// half through.
function slabs_of(layout: ThemeLayout, age: number): Array<Slab> {
	const { edge, head_left, head_right, head_top } = layout
	const late = share_of(age, WALL.header_from, WALL.header_ticks)
	const head = { top: 0, bottom: WALL.header_rows - 1, share: late, edge }
	const hit_age = is_hit(age) ? age : undefined
	const share = Math.min(1, age / WALL.build)

	return [
		{ top: layout.area_top, bottom: layout.area_end, left: 0, right: edge, share, edge, hit_age },
		{ ...head, left: head_left.x, right: head_left.x + head_left.w },
		{ ...head, left: head_right.x, right: head_right.x + head_right.w },
		{ ...head, bottom: 0, left: head_top.x, right: head_top.x + head_top.w },
	]
}

// A word as it glitches: a letter of it another glyph on most beats.
function glitched(word: string, tick: number, seed: number): string {
	const letters = code_points(word)
	const beat = Math.floor(tick / ORDER.beat)
	const is_glitched = tick % ORDER.beat === 0 || hash(tick, seed, ORDER.when_salt) < ORDER.odds
	const at = Math.floor(hash(beat, seed, ORDER.where_salt) * letters.length)

	if (is_glitched) letters[at] = pick(ORDER.glitch, hash(beat, seed, ORDER.what_salt))

	return letters.join('')
}

// The order text on a cleared patch of the wall, hazard stripes under it.
function order_text(draw: ThemeDraw, at: Point, seed: number): void {
	const { grid, tick } = draw
	const { x, y } = at

	put(grid, { y, x: x - 1 }, repeated(' ', ORDER.clear_w), ink(RGB.grey))
	put(grid, { y: y + 1, x: x - 1 }, repeated(' ', ORDER.clear_w - 1), ink(RGB.grey))
	put(grid, { y, x }, glitched(ORDER.word, tick, seed), bold(RGB.order))
	put(grid, { y, x: x + ORDER.tail_x }, ORDER.tail, ink(mix(RGB.order, RGB.night, ORDER.thin)))
	put(
		grid,
		{ y: y + 1, x },
		repeated('╱', ORDER.stripes),
		ink(mix(RGB.red, RGB.night, ORDER.stripe_dark)),
	)
}

// A key prompt: its sign in a blue box that pulses, an arrow over it and a line under it.
function key_prompt(draw: ThemeDraw, at: Point, sign: string, lag: number): void {
	const { grid } = draw
	const is_lit = (draw.tick + lag) % ORDERS.prompt_beat >= ORDERS.prompt_lit
	const ground = mix(RGB.blue, RGB.white, is_lit ? ORDERS.prompt_glow : 0)

	put(grid, { y: at.y - 1, x: at.x + 1 }, '▾', bold(RGB.white))
	put(grid, at, ` ${sign} `, on(RGB.white, ground))
	put(grid, { y: at.y + 1, x: at.x }, '▔▔▔', ink(RGB.blue))
}

function orders(draw: ThemeDraw, age: number): void {
	const { area_top, edge, px } = draw.api.layout
	const { first, second, third } = ORDERS

	order_text(draw, { y: area_top + first.row, x: first.x }, 1)
	order_text(draw, { y: area_top + second.row, x: Math.floor(edge * second.share) }, PAIR)
	if (age > third.after) order_text(draw, { y: area_top + third.row, x: px + third.x }, PAIR + 1)
}

function prompts(draw: ThemeDraw, age: number): void {
	const center = center_of(draw.api.layout)

	key_prompt(draw, { y: center.y, x: center.x - ORDERS.prompt_back }, '△', 0)
	if (age <= ORDERS.prompt_after) return
	key_prompt(draw, { y: center.y, x: center.x + ORDERS.prompt_on }, '○', ORDERS.prompt_lag)
}

// The wall `age` ticks into its build, over the frozen board.
function build(draw: ThemeDraw, age: number): void {
	freeze(draw, age)

	for (const slab of slabs_of(draw.api.layout, age)) lay_slab(draw.grid, slab)

	cracks(draw, age)
	orders(draw, age)
	prompts(draw, age)
}

// The red left behind the board `since` ticks after the peak: it drains from the left to the right.
function drained_wash(across: number, since: number): string {
	const drained = (since / WALL.drain) * WALL.drain_over
	const kept = clamped((across - drained) * WALL.drain_edge)

	return mix(RGB.night, RGB.wash, (WALL.wash - across) * kept)
}

// The wash behind column `x` through a NOTICE `age` ticks old: the night until the wall starts; the
// red growing from the left through its build, flashing on a hit; the red draining after the peak.
function wall_wash(layout: ThemeLayout, x: number, age: number): string {
	const built = age - WALL.from

	if (built < 0 || age >= PEAK_TICKS + WALL.drain) return RGB.night
	const across = x / Math.max(1, layout.w)

	if (age >= PEAK_TICKS) return drained_wash(across, age - PEAK_TICKS)
	if (is_hit(built)) return mix(RGB.red, RGB.night, WALL.flash)

	return mix(RGB.night, RGB.wash, (built / WALL.build) * WALL.wash - across)
}

const run_board_theme_rk800_wall = {
	build,
	glitched,
	grid_glyph,
	hits_passed,
	is_hit,
	wall_age,
	wall_wash,
}

export { run_board_theme_rk800_wall }
