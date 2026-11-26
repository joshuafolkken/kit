import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { ThemeApi } from './run-board-theme-host-types'
import {
	run_board_theme_trace_data,
	type ClockField,
	type TraceView,
} from './run-board-theme-trace-data'
import { run_board_theme_trace_flash } from './run-board-theme-trace-flash'

// MATRIX's running clocks (joshuafolkken/kit#8917), from the confirmed theme demo. The board
// redraws each second, and every cell whose character changed flashes (run-board-change-flash.ts).
// The frame is a still, so its elapsed-time fields — those ending in `″` in the header's third
// column and on the lane rows — count up here: each shows the frame's value plus one second every
// second, right-aligned in its place, carrying into `′` and `°`.

const { cell_at, code_points, put } = run_board_theme_host_grid
const { HEADER_ROWS } = run_board_theme_trace_data
const { flash_cell } = run_board_theme_trace_flash

const SECOND_TICKS = 20
const SECONDS = { hour: 3600, minute: 60 }
// A clock's seconds end on `″`; before them, each after its digits, its minutes on `′` and its hours
// on `°` — either may be missing.
const SECONDS_MARK = '″'
const UNITS = [
	{ mark: '′', seconds: SECONDS.minute },
	{ mark: '°', seconds: SECONDS.hour },
]
// A header field stops at its own nine cells, short of the signs column where the spinner turns.
const HEADER_FIELD = 9
// A changed cell flashes from the second's first tick for nineteen ticks.
const FLASH_LAST = 18
const TWO_DIGITS = 2

// A clock found on a row: where it starts, the column past its `″` and its value in seconds.
interface ClockMatch {
	index: number
	right: number
	seconds: number
}

// A part of a clock: where its digits start and their value.
interface ClockPart {
	start: number
	value: number
}

function is_digit(ch: string | undefined): boolean {
	return ch !== undefined && ch >= '0' && ch <= '9'
}

// The digits running up to `end` of `text`; none where `end` follows no digit.
function digits_to(text: string, end: number): ClockPart | undefined {
	let start = end

	while (start > 0 && is_digit(text[start - 1])) start -= 1

	return start === end ? undefined : { start, value: Number(text.slice(start, end)) }
}

// The part ending on `mark` just before `end`, its digits before the mark.
function part_before(text: string, end: number, mark: string): ClockPart | undefined {
	return text[end - 1] === mark ? digits_to(text, end - 1) : undefined
}

// The clock whose `″` is at `mark_at`: its seconds' digits, then the minutes and hours before them
// where marked — the board's `3°52′56″`, `15′39″` and `12″` — read back from the mark, so no pattern
// of nested optional parts runs over the row.
function clock_at(text: string, mark_at: number): ClockMatch | undefined {
	const seconds = digits_to(text, mark_at)

	if (seconds === undefined) return undefined
	const clock = { index: seconds.start, right: mark_at + 1, seconds: seconds.value }

	for (const unit of UNITS) {
		const part = part_before(text, clock.index, unit.mark)

		if (!part) {
			continue
		}

		clock.index = part.start
		clock.seconds += part.value * unit.seconds
	}

	return clock
}

// Every clock on `text`, left to right, at each `″` (one code unit, as are the digits and marks).
function clocks_in(text: string): Array<ClockMatch> {
	const clocks: Array<ClockMatch> = []

	for (let at = text.indexOf(SECONDS_MARK); at !== -1; at = text.indexOf(SECONDS_MARK, at + 1)) {
		const clock = clock_at(text, at)

		if (clock) clocks.push(clock)
	}

	return clocks
}

// The field's first cell: blanks before the clock belong to it while two of them run together.
function field_left(text: string, start: number, least: number): number {
	let left = start

	while (left > least && text[left - 1] === ' ' && text[left - TWO_DIGITS] === ' ') left -= 1

	return left
}

function field_of(
	api: ThemeApi,
	y: number,
	text: string,
	match: ClockMatch,
): ClockField | undefined {
	const { right } = match
	const { head_left } = api.layout
	const is_header = y < HEADER_ROWS

	if (is_header && right > head_left.x + head_left.w) return undefined
	const least = is_header ? right - HEADER_FIELD : 0

	return { y, left: field_left(text, match.index, least), right, base: match.seconds }
}

// Every running clock of the header's three rows and the lane rows.
function clock_fields(api: ThemeApi): Array<ClockField> {
	const header = Array.from({ length: HEADER_ROWS }, (_, y) => y)
	const rows = [...header, ...api.layout.lane_rows]

	return rows.flatMap((y) => {
		const text = api.plain(y)

		return clocks_in(text).flatMap((match) => field_of(api, y, text, match) ?? [])
	})
}

function two(value: number): string {
	return String(value).padStart(TWO_DIGITS, '0')
}

function clock_text(total: number): string {
	const hours = Math.floor(total / SECONDS.hour)
	const minutes = Math.floor(total / SECONDS.minute) % SECONDS.minute
	const seconds = total % SECONDS.minute

	if (hours > 0) return `${String(hours)}°${two(minutes)}′${two(seconds)}″`

	return minutes > 0 ? `${String(minutes)}′${two(seconds)}″` : `${String(seconds)}″`
}

// The field's cells at second `second`, right-aligned over its room.
function field_at(field: ClockField, second: number): string {
	const room = field.right - field.left

	return clock_text(field.base + Math.max(0, second))
		.padStart(room)
		.slice(-room)
}

function is_clock_row(view: TraceView, y: number): boolean {
	return !(y === view.layout.row.y && view.s.row.is_typing)
}

function lay_clocks(view: TraceView): void {
	const second = Math.floor(view.tick / SECOND_TICKS)

	for (const field of view.clock_fields) {
		if (is_clock_row(view, field.y)) {
			put(view.grid, { y: field.y, x: field.left }, field_at(field, second))
		}
	}
}

function flash_field(view: TraceView, field: ClockField, second: number): void {
	// A clock's characters are each one code unit, so its cells are its code points.
	const now = code_points(field_at(field, second))
	const before = code_points(field_at(field, second - 1))
	const beat = { age: view.tick - second * SECOND_TICKS, tick: view.tick }

	for (const [index, ch] of now.entries()) {
		const at = { y: field.y, x: field.left + index }

		if (ch !== ' ' && ch !== before[index]) {
			flash_cell(view, at, [ch, cell_at(view.api.board, at.y, at.x)[1]], beat)
		}
	}
}

// The cells whose character changed on this second flash from its first tick.
function clock_flash(view: TraceView): void {
	const second = Math.floor(view.tick / SECOND_TICKS)
	const age = view.tick - second * SECOND_TICKS

	if (second < 1 || age > FLASH_LAST) return

	for (const field of view.clock_fields) {
		if (is_clock_row(view, field.y)) flash_field(view, field, second)
	}
}

const run_board_theme_trace_clock = {
	clock_fields,
	clocks_in,
	clock_flash,
	clock_text,
	field_at,
	lay_clocks,
}

export { run_board_theme_trace_clock }
