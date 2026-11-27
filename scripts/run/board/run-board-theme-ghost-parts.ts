import { run_board_theme_draw, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_ghost_data } from './run-board-theme-ghost-data'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import type { Cell, Point, ThemeApi, ThemePart } from './run-board-theme-host-types'

// The ghost theme's opening and ending. Opening: the board assembles from digits — every cell a
// flickering digit until a wave running left to right, top to bottom, resolves it to its own
// character, a horizontal scan line leading the wave. Ending: the board's characters turn to dots
// that drift upward and thin out until the screen is empty, and the empty screen holds.

const { digit, fg, mixed, pick, set_cell } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { BLANK, is_drawn, share_of } = run_board_theme_draw
const { ASSEMBLE, DRIFT, INKS, RGB } = run_board_theme_ghost_data

// The tick the wave reaches a cell: mostly by its row, a little by its column.
function resolve_tick(draw: ThemeDraw, at: Point): number {
	const { w, h } = draw.api.layout
	const share = (1 - ASSEMBLE.slant) * (at.y / h) + ASSEMBLE.slant * (at.x / w)

	return share * ASSEMBLE.wave_ticks
}

// A cell before the wave: a flickering digit where the board has a character, and on a few of its
// blanks; its own cell once the wave has passed.
function assembled(draw: ThemeDraw, at: Point, cell: Cell): Cell {
	const { tick } = draw

	if (tick >= resolve_tick(draw, at)) return cell
	if (!is_drawn(cell) && hash(at.x, at.y, ASSEMBLE.salt) >= ASSEMBLE.sparse) return BLANK

	return [digit(hash(at.x, at.y, Math.floor(tick / ASSEMBLE.flicker))), INKS.DIM]
}

// The scan line on the row the wave has reached at the left edge: bright over the board's cells.
function scan_line(draw: ThemeDraw): void {
	const { api, grid, tick } = draw
	const reached = (tick + 1) / (ASSEMBLE.wave_ticks * (1 - ASSEMBLE.slant))
	const row = grid[Math.floor(reached * api.layout.h)] ?? []

	for (const [x, cell] of row.entries()) {
		row[x] = is_drawn(cell) ? [cell[0], INKS.WHITE] : ['─', INKS.CYAN]
	}
}

function opening_draw(draw: ThemeDraw): void {
	const { grid, tick } = draw

	if (tick >= ASSEMBLE.wave_ticks) return

	for (const [y, row] of grid.entries()) {
		grid[y] = row.map((cell, x) => assembled(draw, { x, y }, cell))
	}

	scan_line(draw)
}

function opening_of(api: ThemeApi): ThemePart {
	return {
		ticks: ASSEMBLE.ticks,
		note: 'the board assembles from flickering digits, a wave resolving it left to right and top to bottom behind a scan line',
		draw: (grid, tick, state) => {
			opening_draw({ api, grid, s: state, tick })
		},
	}
}

// A character `age` ticks after its own moment: a dot, risen and fading, gone once thinned out.
function dot_cell(draw: ThemeDraw, at: Point, age: number): void {
	const ink = fg(mixed(RGB.cyan, RGB.dim, share_of(age, 0, DRIFT.fade)))
	const y = at.y - Math.floor(age * DRIFT.rise)

	if (hash(at.x, at.y, DRIFT.thin_salt) < age / DRIFT.thin) return
	set_cell(draw.grid, { x: at.x, y }, [pick(DRIFT.glyphs, hash(at.x, at.y, DRIFT.glyph_salt)), ink])
}

// A character in its place until its own moment, a drifting dot after; one risen off the top is gone.
function drift_cell(draw: ThemeDraw, at: Point, cell: Cell): void {
	const age = draw.tick - hash(at.x, at.y, DRIFT.delay_salt) * DRIFT.delay

	if (age < 0) set_cell(draw.grid, at, cell)
	else dot_cell(draw, at, age)
}

function drift_row(draw: ThemeDraw, row: ReadonlyArray<Cell>, y: number): void {
	for (const [x, cell] of row.entries()) {
		if (is_drawn(cell)) drift_cell(draw, { x, y }, cell)
	}
}

function ending_draw(draw: ThemeDraw): void {
	const { api, grid, tick } = draw
	const source = grid.map((row) => [...row])

	api.blank_screen(grid)
	if (tick >= DRIFT.gone) return

	for (const [y, row] of source.entries()) drift_row(draw, row, y)
}

function ending_of(api: ThemeApi): ThemePart {
	return {
		ticks: DRIFT.ticks,
		note: 'the board’s characters turn to dots that drift upward and thin out · the empty screen holds',
		draw: (grid, tick, state) => {
			ending_draw({ api, grid, s: state, tick })
		},
	}
}

const run_board_theme_ghost_parts = { ending_of, opening_of, resolve_tick }

export { run_board_theme_ghost_parts }
