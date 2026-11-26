import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Grid } from './run-board-theme-host-types'
import { run_board_theme_wopr_data } from './run-board-theme-wopr-data'
import { run_board_theme_wopr_led, type LookAt } from './run-board-theme-wopr-led'
import { run_board_theme_wopr_place, type Wopr } from './run-board-theme-wopr-place'

// The WARGAMES theme's LAUNCH panel (joshuafolkken/kit#8917), ported from the confirmed theme demo:
// the film's panel over the THROUGHPUT and USAGE area, and the tic-tac-toe screen beside it.

const { put, repeated, restyle, rows_to } = run_board_theme_host_grid
const { GAMES, INK, MARKS, TALLY } = run_board_theme_wopr_data
const { led } = run_board_theme_wopr_led
const { BOARD_W, CELLS_ACROSS, CELL_W } = run_board_theme_wopr_place

type Phase = 'flash' | 'gone' | 'play'

// The game playing: which game, its moves (cell numbers 0-8), how many marks are down, and whether
// the board is up, flashing or gone.
interface Play {
	game: number
	moves: string
	marks: number
	phase: Phase
}

// The panel's status on its lower edge, each position as `look` gives it, and the game beside it.
interface PanelView {
	status: string
	status_ink: string
	look: LookAt
	play: Play
}

// The top edge's labels' columns, and the status's room from the window's right side.
const FRAME_AT = { open: 3, launch: 4, join: 12, adn: 15, close: 20 }
const STATUS = { open: 5, close: 4 }
const SIDES = 2
// After the ninth mark: two ticks of the whole board flashing white, two of an empty screen.
const MOVES = 9
const FLASH_TICKS = 2
const GONE_TICKS = 2
// Rounding room for a pace under one tick, which puts several marks down in the same tick.
const EPSILON = 1e-9
// The tally from the area's third row: games played, WINNER: NONE.
const TALLY_ROW = 2
const PLAYED_WIDTH = 3
// Three rows of cells two rows tall, the lines on the rows between.
const ROW_STEP = 3
const LINE_ROW = 2
const PAIR = 2

function frame_top(wopr: Wopr, grid: Grid): void {
	const y = wopr.api.layout.area_top

	put(grid, { y, x: 0 }, `╔${repeated('═', wopr.window_w - SIDES)}╗`, INK.frame)
	put(grid, { y, x: FRAME_AT.open }, '╡', INK.frame)
	put(grid, { y, x: FRAME_AT.launch }, ' LAUNCH ', INK.label)
	put(grid, { y, x: FRAME_AT.join }, '╞═╡', INK.frame)
	put(grid, { y, x: FRAME_AT.adn }, ' ADN ', INK.label)
	put(grid, { y, x: FRAME_AT.close }, '╞', INK.frame)
}

function frame_glass(wopr: Wopr, grid: Grid): void {
	const { window_w, led_y } = wopr

	for (let y = led_y; y < wopr.bottom; y++) {
		put(grid, { y, x: 0 }, '║', INK.frame)
		put(grid, { y, x: 1 }, repeated(' ', window_w - SIDES), INK.glass)
		put(grid, { y, x: window_w - 1 }, '║', INK.frame)
	}
}

function frame_bottom(wopr: Wopr, grid: Grid, view: PanelView): void {
	const { window_w, bottom: y } = wopr
	const text = ` ${view.status} `

	put(grid, { y, x: 0 }, `╚${repeated('═', window_w - SIDES)}╝`, INK.frame)
	put(grid, { y, x: window_w - STATUS.open - text.length }, '╡', INK.frame)
	put(grid, { y, x: window_w - STATUS.close - text.length }, text, view.status_ink)
	put(grid, { y, x: window_w - STATUS.close }, '╞', INK.frame)
}

// The THROUGHPUT rule as the top edge carrying LAUNCH and ADN, a double-framed dark window, and the
// lower edge with the status on the area's last row.
function frame(wopr: Wopr, grid: Grid, view: PanelView): void {
	wopr.api.clear_area(grid)
	frame_top(wopr, grid)
	frame_glass(wopr, grid)
	frame_bottom(wopr, grid, view)
}

function game_length(pace: number): number {
	return Math.ceil(MOVES * pace) + FLASH_TICKS + GONE_TICKS
}

function phase_of(into: number, filled: number): Phase {
	if (into < filled) return 'play'

	return into < filled + FLASH_TICKS ? 'flash' : 'gone'
}

function play_of(game: number, into: number, pace: number): Play {
	const marks = Math.min(MOVES, Math.floor(into / pace + EPSILON) + 1)
	const phase = phase_of(into, Math.ceil(MOVES * pace))

	return { game, moves: GAMES[game % GAMES.length] ?? '', marks, phase }
}

// The game playing `t` ticks in, each game's moves `pace_of(game)` ticks apart.
function game_at(t: number, pace_of: (game: number) => number): Play {
	let start = 0
	let game = 0

	while (t >= start + game_length(pace_of(game))) {
		start += game_length(pace_of(game))
		game += 1
	}

	return play_of(game, t - start, pace_of(game))
}

function cell_rows(wopr: Wopr): Array<number> {
	return Array.from({ length: CELLS_ACROSS }, (_, row) => wopr.api.layout.area_top + ROW_STEP * row)
}

// Two thick lines across, two down, no border.
function ttt_lines(wopr: Wopr, grid: Grid, ink: string): void {
	const line = Array.from({ length: CELLS_ACROSS }, () => '━'.repeat(CELL_W)).join('╋')
	const line_rows = cell_rows(wopr)
		.slice(1)
		.map((row) => row - ROW_STEP + LINE_ROW)
	const tall_rows = cell_rows(wopr).flatMap((row) => [row, row + 1])
	const columns = Array.from(
		{ length: CELLS_ACROSS - 1 },
		(_, k) => wopr.board_x + (k + 1) * (CELL_W + 1) - 1,
	)

	for (const y of line_rows) put(grid, { y, x: wopr.board_x }, line, ink)

	for (const y of tall_rows) {
		for (const x of columns) put(grid, { y, x }, '┃', ink)
	}
}

function ttt_mark(
	wopr: Wopr,
	grid: Grid,
	mark: { index: number; cell: number },
	ink: string,
): void {
	const { index, cell } = mark
	const shape = index % PAIR ? MARKS.O : MARKS.X
	const x = wopr.board_x + (cell % CELLS_ACROSS) * (CELL_W + 1) + 1
	const top = wopr.api.layout.area_top + ROW_STEP * Math.floor(cell / CELLS_ACROSS)

	for (const [row, text] of shape.entries()) put(grid, { y: top + row, x }, text, ink)
}

// The marks down so far, X first.
function ttt_marks(wopr: Wopr, grid: Grid, play: Play, ink: string): void {
	const cells = Array.from(play.moves.slice(0, play.marks), Number)

	for (const [index, cell] of cells.entries()) ttt_mark(wopr, grid, { index, cell }, ink)
}

function ttt_tally(wopr: Wopr, grid: Grid, play: Play): void {
	const played = play.game + (play.phase === 'play' ? 0 : 1)
	const lines = TALLY.with(1, String(played).padStart(PLAYED_WIDTH, '0'))

	for (const [index, text] of lines.entries()) {
		put(grid, { y: wopr.api.layout.area_top + TALLY_ROW + index, x: wopr.tally_x }, text, INK.tally)
	}
}

function ttt_flash(wopr: Wopr, grid: Grid): void {
	const { board_x, sky, bottom } = wopr
	const top = sky - 1

	restyle(
		grid,
		(_, x, y) => y >= top && y <= bottom && x >= board_x && x < board_x + BOARD_W,
		() => INK.ttt_flash,
	)
}

// The film's screen: dark navy, a grid of thick pale lines, rings and crosses in the same ink; the
// flash is the lines and marks alone turning white. Right of it, WOPR's tally.
function tic_tac_toe(wopr: Wopr, grid: Grid, play: Play): void {
	const { x0, x1 } = wopr.screen

	for (let y = wopr.api.layout.area_top; y <= wopr.bottom; y++) {
		put(grid, { y, x: x0 }, repeated(' ', x1 - x0 + 1), INK.sea)
	}

	ttt_tally(wopr, grid, play)
	if (play.phase === 'gone') return
	const ink = play.phase === 'flash' ? INK.ttt_flash : INK.ttt

	ttt_lines(wopr, grid, ink)
	ttt_marks(wopr, grid, play, ink)
	if (play.phase === 'flash') ttt_flash(wopr, grid)
}

// The panel with each position as `look` gives it, and beside it the tic-tac-toe screen.
function panel(wopr: Wopr, grid: Grid, view: PanelView): void {
	const area = rows_to(grid, wopr.bottom)

	frame(wopr, area, view)

	for (const [position, x] of wopr.positions.entries()) {
		const { ch, ink } = view.look(position)

		led(area, { y: wopr.led_y, x }, ch, ink)
	}

	tic_tac_toe(wopr, area, view.play)
}

const run_board_theme_wopr_panel = { game_at, panel }

export { run_board_theme_wopr_panel }
export type { PanelView, Play }
