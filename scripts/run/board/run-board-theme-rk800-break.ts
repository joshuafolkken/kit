import { run_board_theme_draw, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import type { Point, ThemeLayout } from './run-board-theme-host-types'
import { run_board_theme_rk800_data } from './run-board-theme-rk800-data'
import { run_board_theme_rk800_notice } from './run-board-theme-rk800-notice'
import { run_board_theme_rk800_parts } from './run-board-theme-rk800-parts'

// The rk800 theme's wall breaking: cracks radiate from its middle over the last hits of the build;
// at the peak the whole screen sparks, and the wall leaves as orange shards thinning out over the
// board. A shard never lands on the notice's or the progress line's row, nor on a free seat row.

const { pick, restyle, set_cell } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { PAIR } = run_board_theme_draw
const { RGB, WALL } = run_board_theme_rk800_data
const { CRACKS, SHARDS } = run_board_theme_rk800_notice
const { bold, mix, on } = run_board_theme_rk800_parts

const TURN = Math.PI * PAIR

// The wall's middle: where the cracks start and the key prompts stand.
function center_of(layout: ThemeLayout): Point {
	return { x: Math.floor(layout.edge * WALL.center), y: layout.area_top + WALL.center_row }
}

function ray_glyph(angle: number): string {
	const [sin, cos] = [Math.sin(angle), Math.cos(angle)]

	if (Math.abs(sin) < CRACKS.flat) return '─'
	if (Math.abs(cos) < CRACKS.flat) return '│'

	return sin * cos > 0 ? '╲' : '╱'
}

function is_in_area(layout: ThemeLayout, at: Point): boolean {
	return at.y >= layout.area_top && at.y <= layout.area_end && at.x >= 0 && at.x < layout.edge
}

// One crack out from the middle, as long as `reach` and its own share of it let it be.
function ray(draw: ThemeDraw, index: number, reach: number): void {
	const { layout } = draw.api
	const center = center_of(layout)
	const angle = (index / CRACKS.rays) * TURN + hash(index, CRACKS.angle_salt, CRACKS.angle_salt)
	const length = reach * (CRACKS.short + hash(index, CRACKS.length_salt, CRACKS.length_salt))
	const glyph = ray_glyph(angle)

	for (let step = 1; step <= length; step++) {
		const x = center.x + Math.round(Math.cos(angle) * step * CRACKS.wide)
		const at = { x, y: center.y + Math.round(Math.sin(angle) * step) }
		const style = bold(mix(RGB.red, RGB.order, hash(index, step, CRACKS.ink_salt)))

		if (is_in_area(layout, at)) set_cell(draw.grid, at, [glyph, style])
	}
}

// The cracks, radiating further with every tick from the hit that starts them.
function cracks(draw: ThemeDraw, age: number): void {
	if (age < CRACKS.from) return
	const reach = (age - CRACKS.from) * CRACKS.pace

	for (let index = 0; index < CRACKS.rays; index++) ray(draw, index, reach)
}

// A free seat row: under the LANES rule, above the blank row that ends the section, and no lane's.
function is_seat(layout: ThemeLayout, y: number): boolean {
	const rule = layout.lanes_rule

	if (rule === undefined || y <= rule || layout.lane_rows.includes(y)) return false

	return y < (layout.gap_rows.find((gap) => gap > rule) ?? layout.h)
}

// A row no shard lands on: the notice's, the progress line's, a free seat's.
function is_kept_row(layout: ThemeLayout, y: number): boolean {
	return y === layout.notice.y || y === layout.progress.y || is_seat(layout, y)
}

// Where the shard that broke off `source` has drifted `since` ticks after the peak, each at a pace
// of its own; none where no shard broke off, or once it has thinned out.
function shard_at(source: Point, since: number): Point | undefined {
	const { x, y } = source
	const is_shard = hash(Math.floor(x / PAIR), y, SHARDS.seed_salt) < SHARDS.odds
	const is_gone = hash(x, y, SHARDS.life_salt) < since / SHARDS.ticks

	if (!is_shard || is_gone) return undefined
	const pace = SHARDS.fall_min + SHARDS.fall_gain * hash(x, y, SHARDS.fall_salt)

	return { x, y: y + Math.floor(since * pace) }
}

function shard(draw: ThemeDraw, source: Point, since: number): void {
	const { layout } = draw.api
	const at = shard_at(source, since)

	if (at === undefined || at.y >= layout.h || is_kept_row(layout, at.y)) return
	const style = bold(mix(RGB.order, RGB.red, hash(source.x, source.y, SHARDS.ink_salt)))
	const glyph = pick(SHARDS.glyphs, hash(source.x, source.y, SHARDS.glyph_salt))

	set_cell(draw.grid, at, [glyph, style])
}

// The wall leaves as orange squares drifting down the board, thinning out as they go.
function shards(draw: ThemeDraw, since: number): void {
	for (const [y, row] of draw.grid.entries()) {
		for (const x of row.keys()) shard(draw, { x, y }, since)
	}
}

// The peak's spark: the whole screen, dark on a pale orange.
function spark(draw: ThemeDraw): void {
	const style = on(RGB.night, mix(RGB.order, RGB.white, SHARDS.spark_ink))

	restyle(
		draw.grid,
		() => true,
		() => style,
	)
}

const run_board_theme_rk800_break = {
	center_of,
	cracks,
	is_kept_row,
	is_seat,
	ray_glyph,
	shard_at,
	shards,
	spark,
}

export { run_board_theme_rk800_break }
