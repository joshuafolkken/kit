import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid, ThemePart } from './run-board-theme-host-types'
import { run_board_theme_wopr_data } from './run-board-theme-wopr-data'
import { run_board_theme_wopr_idle } from './run-board-theme-wopr-idle'
import type { Wopr } from './run-board-theme-wopr-place'
import { run_board_theme_wopr_reveal } from './run-board-theme-wopr-reveal'

// The WARGAMES theme's opening and ending (joshuafolkken/kit#8917), ported from the confirmed theme
// demo: kit's opening (run-board-intro.ts, run-board-reveal-blocks.ts), and the film's last exchange.

const { put, repeated, rows_to, set_cell } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { TICK_MS } = run_board_theme_host_state
const { INK, INTRO, LAST_WORDS, SHADES } = run_board_theme_wopr_data
const { paint_lamps, sweep_at } = run_board_theme_wopr_idle
const { revealed_to } = run_board_theme_wopr_reveal

// `SHALL WE PLAY A GAME?` types a letter a tick and holds forty ticks; then the first frame is
// written a line every one and a half ticks, two ticks of slack after the last.
const HOLD_TICKS = 40
const REVEAL_FROM = INTRO.length + HOLD_TICKS
const LINE_MS = 75
const SLACK_TICKS = 2
// The ending: the lamps go out over its first twenty ticks (each group by four before the end), the
// board's rows leave over the next twenty, six of dark screen, then WOPR's last line types, holds
// thirty ticks with the block blinking five in ten, and the screen is empty for ten.
const LAMPS_OUT = 20
const LAMP_GROUP = 4
const LAMP_SALT = 81
const ROWS_FROM = LAMPS_OUT
const ROWS_TICKS = 20
const DARK_TICKS = 6
const WORDS_FROM = ROWS_FROM + ROWS_TICKS + DARK_TICKS
const WORDS_HOLD = 30
const EMPTY_TICKS = 10
const CURSOR_BLINK = 5
const PAIR = 2

function intro(wopr: Wopr, grid: Grid, tick: number): void {
	const letters = Math.min(INTRO.length, tick + 1)
	const cursor = letters < INTRO.length ? '█' : ''

	for (let y = 0; y < wopr.api.layout.h; y++) wopr.api.blank_row(grid, y)
	put(grid, { y: 0, x: 0 }, `${INTRO.slice(0, letters)}${cursor}`, 'body')
}

// The board written so far; no spinner, sweep or blink runs until the frame is out: the lamps are
// drawn out.
function reveal(wopr: Wopr, grid: Grid, tick: number): void {
	const { h, w } = wopr.api.layout
	const { sweep } = wopr
	const ms = (tick - REVEAL_FROM) * TICK_MS

	paint_lamps(wopr, grid, () => INK.out)
	put(grid, { y: sweep.y, x: sweep.left }, repeated(' ', sweep.cells), 'body')

	for (let y = 0; y < h; y++) {
		const to = revealed_to(grid, y, ms, { w, line_ms: LINE_MS })

		put(grid, { y, x: to }, ' '.repeat(Math.max(0, w - to)), 'body')
	}
}

function opening_of(wopr: Wopr): ThemePart {
	return {
		ticks: REVEAL_FROM + Math.ceil((wopr.api.layout.h * LINE_MS) / TICK_MS) + SLACK_TICKS,
		note: 'SHALL WE PLAY A GAME? types (50 ms a letter) and holds 2 s; the board is written in a line every 75 ms, block by block',
		draw: (grid, tick) => {
			if (tick < REVEAL_FROM) intro(wopr, grid, tick)
			else reveal(wopr, grid, tick)
		},
	}
}

function lamp_out(
	wopr: Wopr,
	grid: Grid,
	lamp: { row: number; index: number },
	tick: number,
): void {
	const { x, top } = wopr.lamps
	const { row, index } = lamp
	const out_at = Math.floor(
		hash(row, Math.floor(index / LAMP_GROUP), LAMP_SALT) * (LAMPS_OUT - LAMP_GROUP),
	)

	if (tick >= out_at) set_cell(grid, { y: top + row, x: x + PAIR * index }, ['■', INK.out])
}

// The lamps go out group by group and the sweep stops.
function lamps_out(wopr: Wopr, grid: Grid, tick: number): void {
	const area = rows_to(grid, wopr.bottom)

	for (const row of SHADES.keys()) {
		for (let index = 0; index < wopr.lamps.count; index++) {
			lamp_out(wopr, area, { row, index }, tick)
		}
	}

	// The sweep stops at its first cell while the lamps go out.
	sweep_at(wopr, grid, tick < LAMPS_OUT ? 0 : undefined)
}

// The board's rows leave from the bottom up, all of them over a second; the rows past the last
// with text are gone from the start.
function rows_leave(wopr: Wopr, grid: Grid, tick: number): void {
	const { last_row } = wopr
	const gone = Math.floor(((tick - ROWS_FROM + 1) * (last_row + 1)) / ROWS_TICKS)
	const from = tick >= ROWS_FROM ? Math.max(0, last_row + 1 - gone) : last_row + 1

	for (let y = from; y < wopr.api.layout.h; y++) wopr.api.blank_row(grid, y)
}

// WOPR's last line at the top left, where the opening typed, its block blinking while it holds.
function last_words(wopr: Wopr, grid: Grid, tick: number): void {
	const typed = tick - WORDS_FROM + 1

	for (let y = 0; y < wopr.api.layout.h; y++) wopr.api.blank_row(grid, y)
	if (typed > LAST_WORDS.length + WORDS_HOLD) return
	const held = typed - LAST_WORDS.length
	const has_cursor = held <= 0 || Math.floor(held / CURSOR_BLINK) % PAIR === 0

	put(grid, { y: 0, x: 0 }, `${LAST_WORDS.slice(0, typed)}${has_cursor ? '█' : ''}`, 'body')
}

// The last line's letters as the ending's sound hears them: the trill while they type, the typed end
// once through, as the opening's line (joshuafolkken/kit#8917).
const WORDS_TYPED = {
	from_ms: WORDS_FROM * TICK_MS,
	to_ms: (WORDS_FROM + LAST_WORDS.length) * TICK_MS,
}

function ending_of(wopr: Wopr): ThemePart {
	return {
		ticks: WORDS_FROM + LAST_WORDS.length + WORDS_HOLD + EMPTY_TICKS,
		typing: { spans: [WORDS_TYPED], typed_ms: WORDS_TYPED.to_ms },
		note: 'the lamps go out, the board leaves from the bottom up, and WOPR types HOW ABOUT A NICE GAME OF CHESS?',
		draw: (grid, tick) => {
			if (tick >= WORDS_FROM) {
				last_words(wopr, grid, tick)

				return
			}

			lamps_out(wopr, grid, tick)
			rows_leave(wopr, grid, tick)
		},
	}
}

const run_board_theme_wopr_parts = { ending_of, opening_of }

export { run_board_theme_wopr_parts }
