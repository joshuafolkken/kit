import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid, Point, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_wopr_data } from './run-board-theme-wopr-data'
import { run_board_theme_wopr_phase } from './run-board-theme-wopr-phase'
import type { Wopr } from './run-board-theme-wopr-place'
import { run_board_theme_wopr_scenario_data } from './run-board-theme-wopr-scenario-data'
import { run_board_theme_wopr_wars, type Track, type War } from './run-board-theme-wopr-wars'

// The WARGAMES theme's war (joshuafolkken/kit#8917), ported from the confirmed theme demo: the film's
// big screens — the NORAD map with its tracks and white blobs left, the WINNER table right.

const { put, repeated, rows_to, set_cell } = run_board_theme_host_grid
const { TICK_MS } = run_board_theme_host_state
const { CODE, INK } = run_board_theme_wopr_data
const { mixed } = run_board_theme_wopr_phase
const { SCENARIOS } = run_board_theme_wopr_scenario_data
const { in_area, on_screen, war_at } = run_board_theme_wopr_wars

// A blob of `radius` rows (twice that in columns): solid in the middle, shaded at its rim.
interface Blot extends Point {
	radius: number
}

interface Paint {
	ink: string
	may: (y: number, x: number) => boolean
}

// A row is about two columns; a track runs flat under a quarter of a row a column.
const ASPECT = 2
const FLAT = 4
const SHADE = { solid: 0.55, mid: 0.8, least: 0.01 }
// A blob on the map grows to three and a half rows, 0.8 a tick; one over the screen to two and a
// half, a third of a row a tick.
const MAP_BLOB = { most: 3.5, growth: 0.8 }
const SCREEN_BLOB = { most: 2.5, ticks: 3 }
// The rule's code changes every other tick; its lead `--` stays.
const CODE_MS = 100
const RULE_LEAD = 3
const LABEL_X = 2
const NUMBER_WIDTH = 3
// The table's `WINNER:` and `NONE` end at its right side.
const WINNER_W = 7
const NONE_W = 4

function draw_map(wopr: Wopr, grid: Grid): void {
	const { sky, bottom, half } = wopr

	for (let y = sky; y <= bottom; y++) put(grid, { y, x: 0 }, repeated(' ', half), INK.sea)

	for (const { y, x } of wopr.coast_cells) {
		if (x < half) set_cell(grid, { y, x }, ['·', INK.coast])
	}
}

// `─` where a line runs flat, `╱` / `╲` where it climbs or falls, `│` where it runs steeply.
function slope_glyph(dx: number, dy: number): string {
	if (Math.abs(dy) * FLAT < Math.abs(dx)) return '─'
	if (Math.abs(dx) < Math.abs(dy)) return '│'

	return dy < 0 === dx > 0 ? '╱' : '╲'
}

function has_cell(grid: Grid, y: number, x: number): boolean {
	const row = grid[y]

	return y >= 0 && row !== undefined && x >= 0 && x < row.length
}

// A thin straight line from the track's site toward its target, drawn up to its share `share`.
function draw_line(wopr: Wopr, grid: Grid, track: Track, share: number): void {
	const dx = track.x1 - track.x0
	const dy = track.y1 - track.y0
	const steps = Math.max(Math.abs(dx), Math.abs(dy) * ASPECT, 1)
	const glyph = slope_glyph(dx, dy)

	for (let k = 0; k <= Math.floor(share * steps); k++) {
		const x = Math.round(track.x0 + (dx * k) / steps)
		const y = Math.round(track.y0 + (dy * k) / steps)

		if (has_cell(grid, y, x) && x < wopr.half) set_cell(grid, { y, x }, [glyph, track.ink])
	}
}

function shade(distance: number): string {
	if (distance < SHADE.solid) return '█'

	return distance < SHADE.mid ? '▓' : '▒'
}

function blob_row(grid: Grid, blot: Blot, dy: number, paint: Paint): void {
	const reach = Math.ceil(blot.radius)

	for (let dx = -ASPECT * reach; dx <= ASPECT * reach; dx++) {
		const distance = Math.hypot(dy, dx / ASPECT) / Math.max(blot.radius, SHADE.least)
		const at = { y: blot.y + dy, x: blot.x + dx }

		if (distance <= 1 && paint.may(at.y, at.x)) set_cell(grid, at, [shade(distance), paint.ink])
	}
}

// A white blob: solid in the middle, shaded at its rim, where `paint.may` lets it draw.
function draw_blob(grid: Grid, blot: Blot, paint: Paint): void {
	const reach = Math.ceil(blot.radius)

	for (let dy = -reach; dy <= reach; dy++) blob_row(grid, blot, dy, paint)
}

function war_track(wopr: Wopr, grid: Grid, track: Track, age: number): void {
	if (age < track.from) return

	if (age < track.to) {
		draw_line(wopr, grid, track, (age - track.from + 1) / (track.to - track.from))

		return
	}

	const radius = Math.min(MAP_BLOB.most, (age - track.to + 1) * MAP_BLOB.growth)
	const paint = { ink: INK.blob, may: (y: number, x: number): boolean => in_area(wopr, y, x) }

	draw_blob(grid, { y: track.y1, x: track.x1, radius }, paint)
}

// One war on the map: the tracks fanning out (each line drawn as far as it has flown), then the
// blobs growing where they landed — to three rows, so they merge — in white.
function war(wopr: Wopr, grid: Grid, now: War, cooled: number): void {
	draw_map(wopr, grid)

	for (const track of now.tracks) war_track(wopr, grid, track, cooled - now.start)
}

// One blob over the screen, `age` ticks after its bloom (none before it).
function screen_blob(grid: Grid, blob: Point, age: number, paint: Paint): void {
	const radius = Math.min(SCREEN_BLOB.most, (age + 1) / SCREEN_BLOB.ticks)

	if (age >= 0) draw_blob(grid, { y: blob.y, x: blob.x, radius }, paint)
}

// The blobs over the rest of the screen, from each war's middle on.
function screen_blobs(wopr: Wopr, grid: Grid, state: ThemeState): void {
	const { cooled, is_typing: is_building } = state.notice
	const now = is_building ? undefined : war_at(wopr.wars, cooled)

	if (!now) return
	const paint = { ink: INK.blob_out, may: (y: number, x: number): boolean => on_screen(wopr, y, x) }

	for (const blob of now.blobs) screen_blob(grid, blob, cooled - now.start - blob.from, paint)
}

// A war rule's character at `x`: the rule's lead as the base has it (the demo's `--`, a live rule's fold
// marker, joshuafolkken/kit#8917), dashes to the code's start, then launch code.
function war_char(lead: ReadonlyArray<Cell>, at: Point, change: number): string {
	const kept = lead[at.x]?.[0]

	if (kept !== undefined) return kept
	if (at.x < RULE_LEAD) return '-'

	return CODE.charAt(mixed([at.y + 1, at.x + 1, change]) % CODE.length)
}

// The board's rule — DEFCON's, the THROUGHPUT rule — carrying `label` and launch code over the rest of
// its run up to DEFCON.
function war_rule(wopr: Wopr, grid: Grid, tick: number, label: string): void {
	const { level_spot } = wopr.api.layout
	const { y } = level_spot
	const change = Math.floor((tick * TICK_MS) / CODE_MS)
	const base = wopr.api.board[y] ?? []
	const lead = base.slice(
		0,
		Math.max(
			0,
			base.findIndex(([ch]) => ch === ' '),
		),
	)

	for (let x = 0; x < level_spot.x - 1; x++) {
		set_cell(grid, { y, x }, [war_char(lead, { y, x }, change), 'rule'])
	}

	put(grid, { y, x: LABEL_X }, ` ${label} `, INK.orange_on)
}

function arrived_at(wopr: Wopr, cooled: number): number {
	return wopr.table_at.filter((at) => cooled >= at).length
}

function table_row(
	wopr: Wopr,
	grid: Grid,
	index: number,
	page: { from: number; newest: number },
): void {
	const { table: place, sky } = wopr
	const y = sky + 1 + index - page.from
	const ink = index === page.newest ? INK.table_new : INK.table

	put(grid, { y, x: place.x }, SCENARIOS[index % SCENARIOS.length] ?? '', ink)
	put(grid, { y, x: place.x + place.w - NONE_W }, 'NONE', ink)
}

// The WINNER table in the area's right half, paging: rows appear one under another from the second
// row to the last; once the page is full, the next row clears it and starts again.
function table(wopr: Wopr, grid: Grid, state: ThemeState): void {
	const { sky, bottom, half, table: place } = wopr
	const arrived = arrived_at(wopr, state.notice.cooled)

	for (let y = sky; y <= bottom; y++) {
		put(grid, { y, x: half }, repeated(' ', wopr.api.layout.edge - half), INK.sea)
	}

	put(grid, { y: sky, x: place.x }, 'STRATEGY:', INK.table)
	put(grid, { y: sky, x: place.x + place.w - WINNER_W }, 'WINNER:', INK.table)
	if (arrived === 0) return
	const from = Math.floor((arrived - 1) / place.rows) * place.rows

	for (let index = from; index < arrived; index++) {
		table_row(wopr, grid, index, { from, newest: arrived - 1 })
	}
}

function padded(value: number): string {
	return String(value).padStart(NUMBER_WIDTH, '0')
}

// The area from the spark to the ending: the war left, the table right, under one rule.
function split(wopr: Wopr, grid: Grid, state: ThemeState, tick: number): void {
	const { cooled } = state.notice
	const now = war_at(wopr.wars, cooled)
	const scenario = (now ? wopr.wars.indexOf(now) : -1) + 1
	const strategies = arrived_at(wopr, cooled)
	const at = { y: wopr.api.layout.area_top, x: wopr.half + 1 }

	wopr.api.clear_area(grid)
	war_rule(wopr, grid, tick, `NORAD · WAR SIMULATION · SCENARIO ${padded(scenario)}`)
	put(grid, at, ` WOPR · STRATEGY TABLE · ${padded(strategies)} RUN `, INK.orange_on)
	if (now) war(wopr, rows_to(grid, wopr.bottom), now, cooled)
	table(wopr, grid, state)
}

const run_board_theme_wopr_map = {
	arrived_at,
	draw_blob,
	draw_line,
	screen_blobs,
	slope_glyph,
	split,
}

export { run_board_theme_wopr_map }
