import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_lamps } from './run-board-lamps'
import { run_board_spot } from './run-board-spot'

// joshuafolkken/kit#8236: the WOPR lamp panel's pure parts — whether a lamp is lit at a moment, how many
// fit, and the panel run on to the rule's end.

const { LAMP_TICK_MS, count_of, expanded, is_colored, is_lit, lamp_text, place_of, start_of } =
	run_board_lamps
const { LAMP, LAMP_START } = run_board_spot
const START = Date.parse('2026-11-20T09:00:00.000Z')
const STEPS = 20_000
const GROUPS = 12
const LEAST_RATE = 0.35
const MOST_RATE = 0.45
const LEAST_PERIOD_STEPS = 3
const MOST_PERIOD_STEPS = 18
const ESCAPE = '\u{1B}'
const BLINK = `${ESCAPE}[5m`

afterEach(() => {
	vi.unstubAllEnvs()
})

// A group's four lamps at `step` steps past the start, as one string.
function group_at(group: number, step: number, is_burst: boolean): string {
	return [0, 1, 2, 3]
		.map((lamp) => is_lit(START + step * LAMP_TICK_MS, group, lamp, is_burst))
		.join(',')
}

// The steps a group's lamps changed on, over `steps` steps.
function changes_of(group: number, steps: number, is_burst = false): Array<number> {
	return Array.from({ length: steps }, (_, step) => step).filter(
		(step) => step > 0 && group_at(group, step, is_burst) !== group_at(group, step - 1, is_burst),
	)
}

function divisor_of(left: number, right: number): number {
	return right === 0 ? left : divisor_of(right, left % right)
}

// The period a group's changes keep: the greatest common divisor of the steps between them.
function period_of(changes: ReadonlyArray<number>): number {
	const gaps = changes.slice(1).map((step, index) => step - (changes[index] ?? 0))

	let period = 0

	for (const gap of gaps) period = divisor_of(period, gap)

	return period
}

describe('run_board_lamps.is_lit', () => {
	it('answers the same for the same moment, group and lamp', () => {
		const moments = [START, START + 1234, START + 98_765]

		for (const now_ms of moments) {
			expect(is_lit(now_ms, 3, 2, false)).toBe(is_lit(now_ms, 3, 2, false))
		}
	})

	it('lights about four lamps in ten over a long time', () => {
		const lit = Array.from({ length: STEPS }, (_, step) =>
			is_lit(START + step * LAMP_TICK_MS, step % GROUPS, step % 4, false),
		).filter(Boolean).length

		expect(lit / STEPS).toBeGreaterThanOrEqual(LEAST_RATE)
		expect(lit / STEPS).toBeLessThanOrEqual(MOST_RATE)
	})

	it('holds a group between its own changes, which come every 3 to 18 steps', () => {
		const periods = Array.from({ length: GROUPS }, (_, group) => period_of(changes_of(group, 400)))

		expect(Math.min(...periods)).toBeGreaterThanOrEqual(LEAST_PERIOD_STEPS)
		expect(Math.max(...periods)).toBeLessThanOrEqual(MOST_PERIOD_STEPS)
	})

	it('gives the groups their own periods and phases', () => {
		const firsts = Array.from({ length: GROUPS }, (_, group) => changes_of(group, 100).join(','))

		expect(new Set(firsts).size).toBeGreaterThan(GROUPS / 2)
	})

	it('changes a group on nearly every step in a burst', () => {
		expect(changes_of(1, 100, true).length).toBeGreaterThan(changes_of(1, 100).length * 2)
	})
})

describe('run_board_lamps.count_of', () => {
	it.each([
		[15, 8],
		[16, 8],
		[17, 9],
		[14, 0],
		[0, 0],
	])('fits a lamp every other column of %i columns: %i', (width, count) => {
		expect(count_of(width)).toBe(count)
	})
})

describe('run_board_lamps.place_of', () => {
	it('puts four lamps to a group, each row its own groups', () => {
		expect(place_of(0, 5)).toStrictEqual({ group: 1, lamp: 1 })
		expect(place_of(1, 0).group).not.toBe(place_of(0, 0).group)
	})
})

describe('run_board_lamps.expanded', () => {
	it('runs the panel on to the rule’s end, a lamp every other column', () => {
		const line = `ab  ${LAMP_START}`

		expect(expanded(line, 4 + 17)).toBe(`ab  ${Array.from({ length: 9 }, () => LAMP).join(' ')}`)
	})

	it('drops the panel and the blanks before it where eight lamps do not fit', () => {
		expect(expanded(`ab  ${LAMP_START}`, 4 + 14)).toBe('ab')
	})

	it('leaves a line with no panel as it was', () => {
		expect(expanded('ab', 40)).toBe('ab')
	})
})

describe('run_board_lamps colors', () => {
	it('lights the 24h row yellow and the 7d row red, out the same color dim, never blinking', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const cells = [lamp_text(0, true), lamp_text(1, true), lamp_text(0, false), start_of(1)]

		expect(cells[0]).toContain('38;2;255;214;10')
		expect(cells[1]).toContain('38;2;255;69;58')
		expect(cells[2]).toContain(`${ESCAPE}[2m`)
		expect(stripVTControlCharacters(cells[3] ?? '')).toBe(LAMP_START)
		expect(cells.join('')).not.toContain(BLINK)
	})

	it('draws lamps only where stdout draws color', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(is_colored()).toBe(true)
		vi.stubEnv('FORCE_COLOR', '0')

		expect(is_colored()).toBe(false)
	})
})
