import { describe, expect, it } from 'vitest'
import { run_board_theme_wopr_data } from './run-board-theme-wopr-data'
import { run_board_theme_wopr_fixture } from './run-board-theme-wopr-fixture'
import { run_board_theme_wopr_led, type Look, type LookAt } from './run-board-theme-wopr-led'

const { LED, THE_CODE } = run_board_theme_wopr_data
const { board_grid, state_at } = run_board_theme_wopr_fixture
const { LETTER_POOL, LED_ROWS, MATCHED_AT, led, matched, notice_look, pixels_of } =
	run_board_theme_wopr_led
const { rank_of, row_look, spin } = run_board_theme_wopr_led

const POSITIONS = Array.from({ length: THE_CODE.length }, (_, position) => position)

function ticks_of(from: number, to: number): Array<number> {
	return Array.from({ length: to - from }, (_, step) => from + step)
}

function looks_of(look: LookAt): Array<Look> {
	return POSITIONS.map((position) => look(position))
}

// The positions that break the rule from `now` to the next tick: an unlocked one that kept its
// character, or a locked one that lost the code's.
function faults_of(now: ReadonlyArray<Look>, next: LookAt): Array<number> {
	return POSITIONS.filter((position) => {
		const before = now[position]
		const after = next(position)

		if (before?.locked) return after.ch !== THE_CODE.charAt(position)

		return !after.locked && after.ch === before?.ch
	})
}

// The demo's NOTICE and ROW panels' looks at `tick`.
function notice_at(tick: number): LookAt {
	return notice_look(state_at('n', tick), tick)
}

function row_at(tick: number): LookAt {
	return row_look(state_at('r', tick), tick)
}

function faults_over(
	ticks: ReadonlyArray<number>,
	look_at: (tick: number) => LookAt,
): Array<number> {
	return ticks.flatMap((tick) => faults_of(looks_of(look_at(tick)), look_at(tick + 1)))
}

function drawn(lit: Array<Array<boolean>>): Array<string> {
	return lit.map((row) => row.map((is_on) => (is_on ? '#' : '.')).join(''))
}

describe('run_board_theme_wopr_led', () => {
	it('lights a 1 on its right side and joins its corners', () => {
		expect(drawn(pixels_of('1'))).toStrictEqual(['....#', '....#', '....#', '....#', '....#'])
	})

	it('lights an 8 as a full figure with a middle bar', () => {
		expect(drawn(pixels_of('8'))).toStrictEqual(['#####', '#...#', '#####', '#...#', '#####'])
	})

	it('draws a character six rows of half blocks, a dark one all ghost', () => {
		const grid = board_grid()

		led(grid, { y: 0, x: 0 }, 'C', undefined)

		expect(LED_ROWS).toBe(6)
		expect(grid[0]?.[0]).toStrictEqual(['▀', `\u{1B}[38;2;${LED.ghost}m\u{1B}[48;2;${LED.ghost}m`])
	})

	it('spins a digit slot through digits and a letter slot through letters', () => {
		expect('0123456789').toContain(spin(3, 10))
		expect(LETTER_POOL).toContain(spin(0, 10))
	})

	it('ranks the positions in WOPR’s order', () => {
		expect(rank_of(6)).toBe(0)
		expect(rank_of(5)).toBe(9)
	})

	it('locks at most eight positions while a lane types', () => {
		const state = state_at('r', 10 + 200)

		expect(matched(row_look(state, 210))).toBeLessThanOrEqual(8)
	})

	it('matches the whole code by the NOTICE’s fiftieth tick', () => {
		const start = state_at('n', 10)
		const matching = state_at('n', 60)

		expect(matched(notice_look(start, 10))).toBe(0)
		expect(matched(notice_look(matching, 60))).toBe(10)
		expect(MATCHED_AT).toBe(50)
	})
})

// joshuafolkken/kit#9137: every position not yet locked shows another character on every tick, and a
// locked one holds the code's.
describe('run_board_theme_wopr_led — code on every tick', () => {
	it('spins every position to another character from one tick to the next', () => {
		const repeats = ticks_of(0, 200).flatMap((tick) =>
			POSITIONS.filter((position) => spin(position, tick) === spin(position, tick + 1)),
		)

		expect(repeats).toStrictEqual([])
	})

	it('changes the NOTICE build’s unlocked positions and holds its locked ones', () => {
		expect(faults_over(ticks_of(10, 88), notice_at)).toStrictEqual([])
	})

	it('changes the ROW panel’s unlocked positions and holds its locked ones', () => {
		expect(faults_over(ticks_of(10, 200), row_at)).toStrictEqual([])
	})
})
