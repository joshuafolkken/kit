import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid, Point, ThemeLayout } from './run-board-theme-host-types'
import { run_board_theme_trace_data } from './run-board-theme-trace-data'
import { run_board_theme_trace_paint } from './run-board-theme-trace-paint'

// MATRIX's code rain's one pass (joshuafolkken/kit#8917, run-board-rain.ts), from the confirmed theme
// demo: each column's head starts up to 23 rows above the top and falls at its own speed a rain
// frame, holding that pace for a while and then gaining one more each second. The reveal brings
// the board in behind its tails; the exit wipe takes it away behind them.

const { hash } = run_board_theme_host_hash
const { TICK_MS } = run_board_theme_host_state
const { CELL_KEY, REROLL, SHADE } = run_board_theme_trace_data
const { HEAD_CELLS, HEAD_PAINTS, glyph, mix, paint, settled_glyph } = run_board_theme_trace_paint

const RAIN_MS = 45
const START_ROWS = 24
const FALLEN_FRAMES = 2000
// The pace holds for the first stretch of the pass, then gains one row a frame each second.
const HOLD_MS = 3000
const MS_PER_SECOND = 1000
const HEAD_SALTS = { at: 1, speed: 2, length: 3 }
const CELL_SALTS = { reroll: 204, head: 205, glint: 206 }
// The pass's tail in 24 steps, each step flared for a rerolled glyph's frame.
const PASS_STEPS = 24
const TAIL_EASE = 1.8
const GLINT = { gain: 1.7, top: 255 }
const BLANK: Cell = [' ', 'body']

// A pass's columns: how long their tails are and how fast they fall, as shares, and its salt.
interface PassScene {
	tail: { least: number; spread: number }
	speed: { least: number; spread: number }
	salt: number
}

// One column's head: the row it starts on, its rows a frame, its tail's length.
interface Head {
	at: number
	speed: number
	length: number
}

// What a cell the rain has not reached (`ahead`) or has passed (`behind`) shows: the board as drawn
// (true) or a blank.
interface Shows {
	ahead: boolean
	behind: boolean
}

const PASS_TAIL: ReadonlyArray<string> = Array.from({ length: PASS_STEPS + 1 }, (_, index) =>
	mix(SHADE.ember, SHADE.bright, (1 - index / PASS_STEPS) ** TAIL_EASE),
)
const PASS_PAINTS: ReadonlyArray<string> = PASS_TAIL.map((color) => paint(color))
const PASS_GLINTS: ReadonlyArray<string> = PASS_TAIL.map((color) =>
	paint(
		color
			.split(';')
			.map((part) => Math.min(GLINT.top, Math.round(Number(part) * GLINT.gain)))
			.join(';'),
	),
)

// The rows the rain has fallen at each of its frames, at one row a frame plus its gain.
function fallen_of(): Array<number> {
	const fallen = [0]

	for (let frame = 1; frame < FALLEN_FRAMES; frame++) {
		const gain = Math.max(0, (frame - 1) * RAIN_MS - HOLD_MS) / MS_PER_SECOND

		fallen.push((fallen[frame - 1] ?? 0) + 1 + gain)
	}

	return fallen
}

function heads_of(layout: ThemeLayout, scene: PassScene): Array<Head> {
	return Array.from({ length: layout.w }, (_, x) => ({
		at: -Math.floor(hash(x, scene.salt, HEAD_SALTS.at) * START_ROWS),
		speed: scene.speed.least + hash(x, scene.salt, HEAD_SALTS.speed) * scene.speed.spread,
		length: Math.round(
			layout.h * (scene.tail.least + hash(x, scene.salt, HEAD_SALTS.length) * scene.tail.spread),
		),
	}))
}

// The ticks until every tail has fallen past the last row.
function pass_ticks(sweep: Omit<Sweep, 'shows'>, rows: number): number {
	const frames = sweep.fallen.findIndex((rows_fallen) =>
		sweep.heads.every((head) => head.at + head.speed * rows_fallen - head.length >= rows),
	)

	return Math.ceil((frames * RAIN_MS) / TICK_MS) + 1
}

function tail_cell(head: Head, at: Point, frame: number, distance: number): Cell {
	const seed = at.x * CELL_KEY.x + at.y
	const share = (distance - HEAD_CELLS) / Math.max(1, head.length - HEAD_CELLS)
	const step = Math.min(PASS_STEPS, Math.round(share * PASS_STEPS))

	if (hash(seed, frame, CELL_SALTS.reroll) < REROLL) {
		return [glyph(hash(seed, frame, CELL_SALTS.glint)), PASS_GLINTS[step] ?? '']
	}

	// A tail cell is never within the flickering lead: it keeps its place's settled glyph.
	return [settled_glyph(at.x, at.y), PASS_PAINTS[step] ?? '']
}

// A cell inside a column's rain, `distance` rows above its head.
function rain_cell(head: Head, at: Point, frame: number, distance: number): Cell {
	if (distance >= HEAD_CELLS) return tail_cell(head, at, frame, distance)

	return [
		glyph(hash(at.x * CELL_KEY.x + at.y, frame, CELL_SALTS.head)),
		HEAD_PAINTS[distance] ?? '',
	]
}

// One pass over the board: its heads, the rows fallen by frame, and what the cells it misses show.
interface Sweep {
	heads: ReadonlyArray<Head>
	fallen: ReadonlyArray<number>
	shows: Shows
}

// A frame of a sweep: the frame, the rows its heads have fallen by it, what missed cells show.
interface SweepFrame {
	frame: number
	rows_fallen: number
	shows: Shows
}

// A cell after the pass at a frame: its rain; or, ahead of the rain (not yet reached) or behind it
// (passed), the board's cell where the pass shows it, else a blank.
function pass_cell(moment: SweepFrame, head: Head, at: Point, current: Cell): Cell {
	const distance = Math.floor(head.at + head.speed * moment.rows_fallen) - at.y

	if (distance >= 0 && distance <= head.length) return rain_cell(head, at, moment.frame, distance)
	const is_shown = distance < 0 ? moment.shows.ahead : moment.shows.behind

	return is_shown ? current : BLANK
}

function pass_row(grid: Grid, sweep: Sweep, y: number, frame: number): void {
	const row = grid[y]

	if (!row) return
	const moment = { frame, rows_fallen: sweep.fallen[frame] ?? 0, shows: sweep.shows }

	for (const [x, head] of sweep.heads.entries()) {
		row[x] = pass_cell(moment, head, { x, y }, row[x] ?? BLANK)
	}
}

// One frame of a pass over the board.
function pass(grid: Grid, sweep: Sweep, tick: number, rows: number): void {
	const frame = Math.min(sweep.fallen.length - 1, Math.floor((tick * TICK_MS) / RAIN_MS))

	for (let y = 0; y < rows; y++) pass_row(grid, sweep, y, frame)
}

const run_board_theme_trace_pass = { fallen_of, heads_of, pass, pass_cell, pass_ticks }

export { run_board_theme_trace_pass }
export type { Head, PassScene, Shows, Sweep }
