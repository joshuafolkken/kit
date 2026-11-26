import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import type { Grid, Point, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_wopr_data } from './run-board-theme-wopr-data'
import { run_board_theme_wopr_font_data } from './run-board-theme-wopr-font-data'
import { run_board_theme_wopr_phase } from './run-board-theme-wopr-phase'

// The WARGAMES theme's LAUNCH code (joshuafolkken/kit#8917), ported from the confirmed theme demo: the
// tall LED characters and how WOPR works each of the ten positions.

const { bg, code_points, fg, set_cell } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { LED, ORDER, THE_CODE } = run_board_theme_wopr_data
const { JOINS, K_STEPS, ROW_SPANS, SEGMENTS, SEGMENT_AT } = run_board_theme_wopr_font_data
const { notice_age } = run_board_theme_wopr_phase

// A position as it shows: its character, its lit segments' color ('r;g;b', none for the whole
// character dark), and whether it holds the code's character.
interface Look {
	ch: string
	ink: string | undefined
	locked: boolean
}

type LookAt = (position: number) => Look
type Bitmap = Array<Array<boolean>>

const GRID_SIZE = 5
const LED_W = GRID_SIZE
const HALF = 2
const DIGIT_POOL = '0123456789'
const LETTER_POOL = [...SEGMENTS.keys()].filter((ch) => /[A-Z]/u.test(ch)).join('')
// A spinning position changes every other tick; the lock is white-hot for three ticks.
const SPIN = { every: 2, salt: 51 }
const HOT_TICKS = 3
// ROW: positions lock in WOPR's order as the row types — one every ninth of the typing, up to eight.
const ROW_REACH = 8
const ROW_PACE = ROW_REACH + 1
// NOTICE: a position locks every 5 ticks; three ticks after the tenth lock the whole display blinks,
// three ticks dark in six, until the peak.
const LOCK_TICKS = 5
const MATCHED_AT = THE_CODE.length * LOCK_TICKS
const BLINK_TICKS = 3

function set_pixel(lit: Bitmap, pixel: string): void {
	const row = lit[Number(pixel.charAt(0))]

	if (row) row[Number(pixel.charAt(1))] = true
}

// The lit pixels of a character as a 5 by 5 grid of booleans.
function pixels_of(ch: string): Bitmap {
	const lit = Array.from({ length: GRID_SIZE }, () =>
		Array.from({ length: GRID_SIZE }, () => false),
	)
	const on = SEGMENTS.get(ch) ?? ''
	const segments = code_points(on).flatMap((segment) => (SEGMENT_AT[segment] ?? '').split(' '))
	const joins = JOINS.map((join) => join.split(' '))
		.filter(([, meeting = '']) => code_points(meeting).some((segment) => on.includes(segment)))
		.map(([pixel = '']) => pixel)

	for (const pixel of [...segments, ...joins]) set_pixel(lit, pixel)

	return lit
}

// The 5 by 5 grid's row for each of the twelve half-rows.
const ROW_OF = code_points(ROW_SPANS).flatMap((span, row) =>
	Array.from({ length: Number(span) }, () => row),
)
const LED_ROWS = ROW_OF.length / HALF

function stretched(lit: Bitmap): Bitmap {
	return ROW_OF.map((row) => [...(lit[row] ?? [])])
}

function hand_k(): Bitmap {
	return code_points(K_STEPS).map((step) =>
		Array.from({ length: LED_W }, (_, column) => column === 0 || column === Number(step)),
	)
}

// Each character as 12 half-rows by 5 columns: the 5 by 5 grid stretched down, but K by hand.
const BITMAPS = new Map(
	[...SEGMENTS.keys()].map((ch) => [ch, ch === 'K' ? hand_k() : stretched(pixels_of(ch))]),
)

function pixel_ink(lit: Bitmap, half_row: number, column: number, ink?: string): string {
	const is_lit = lit[half_row]?.at(column) === true

	return ink && is_lit ? ink : LED.ghost
}

// One LED character at `at`, six rows by five columns: a lit pixel in `ink` (none: the whole
// character dark), an unlit one in the ghost.
function led(grid: Grid, at: Point, ch: string, ink: string | undefined): void {
	const lit = BITMAPS.get(ch) ?? []

	for (let row = 0; row < LED_ROWS; row++) {
		for (let column = 0; column < LED_W; column++) {
			const top = pixel_ink(lit, HALF * row, column, ink)
			const bottom = pixel_ink(lit, HALF * row + 1, column, ink)

			set_cell(grid, { y: at.y + row, x: at.x + column }, ['▀', `${fg(top)}${bg(bottom)}`])
		}
	}
}

// Where a position comes in WOPR's fixed, non-sequential order.
function rank_of(position: number): number {
	return ORDER.indexOf(String(position))
}

// A spinning position shows a random letter or digit, as its slot holds, changing every other tick.
function spin(position: number, tick: number): string {
	const pool = /\d/u.test(THE_CODE.charAt(position)) ? DIGIT_POOL : LETTER_POOL
	const step = Math.floor(tick / SPIN.every)

	return pool.charAt(Math.floor(hash(position, step, SPIN.salt) * pool.length))
}

function spun(position: number, tick: number): Look {
	return { ch: spin(position, tick), ink: LED.spin, locked: false }
}

function lock_ink(since: number): string {
	return since < HOT_TICKS ? LED.hot : LED.locked
}

// ROW: WOPR works the code as the row types, and never gets it — two positions still spinning.
function row_look(state: ThemeState, tick: number): LookAt {
	const { row } = state
	const age = tick - row.start
	const total = Math.max(1, row.total)
	const reached = Math.min(ROW_REACH, Math.floor((row.length * ROW_PACE) / total))

	return (position) => {
		const rank = rank_of(position)

		if (rank >= reached) return spun(position, tick)
		const lock_age = age - (Math.ceil(((rank + 1) * total) / ROW_PACE) - 1)

		return { ch: THE_CODE.charAt(position), ink: lock_ink(lock_age), locked: true }
	}
}

// NOTICE's build: each position spins until its lock, flashes three ticks, then holds; then the
// matched code blinks to the peak.
function notice_look(state: ThemeState, tick: number): LookAt {
	const age = notice_age(state, tick)
	const blink = age - MATCHED_AT - BLINK_TICKS
	const is_dark = blink >= 0 && Math.floor(blink / BLINK_TICKS) % HALF === 0

	return (position) => {
		const since = age - (rank_of(position) + 1) * LOCK_TICKS

		if (since < 0) return spun(position, tick)

		return {
			ch: THE_CODE.charAt(position),
			ink: is_dark ? undefined : lock_ink(since),
			locked: true,
		}
	}
}

// How many positions hold the code's character.
function matched(look: LookAt): number {
	return code_points(THE_CODE).filter((_, position) => look(position).locked).length
}

const run_board_theme_wopr_led = {
	LETTER_POOL,
	LED_ROWS,
	led,
	matched,
	notice_look,
	pixels_of,
	rank_of,
	row_look,
	spin,
}

export { run_board_theme_wopr_led }
export type { Look, LookAt }
