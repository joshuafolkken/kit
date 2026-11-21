import { describe, expect, it } from 'vitest'
import { run_board_colon } from './run-board-colon'
import { run_board_labels } from './run-board-labels'
import { run_board_spin } from './run-board-spin'
import { run_board_spot } from './run-board-spot'
import { run_board_type_rows } from './run-board-type-rows'

// joshuafolkken/kit#8476: the header clocks' colons blink every half second between redraws — dark as
// their 24-bit color at 30% of its brightness, or dim where there is no such color — and the spinner,
// the redraw's second and the letters keep their own pace.

const { COLON_MS, colon_boundary, colon_bytes, dark_style, is_lit } = run_board_colon
const { REDRAW_MS, colons_in, spin_bytes, spin_to_second, spun } = run_board_spin
const { SPINNER_INTERVAL_MS, spinner_of } = run_board_labels
const ESCAPE = '\u{1B}'
const DIM = `${ESCAPE}[2m`
const RESET = `${ESCAPE}[0m`
const CYAN_RGB = `${ESCAPE}[38;2;62;236;225m`
const START = Date.parse('2026-10-08T09:00:00.000Z')
const COLONS = [{ row: 2, column: 6, style: CYAN_RGB }]
const SPOTS = [{ row: 1, column: 1, style: '' }]

function sync_free(text: string): string {
	return text.replaceAll(`${ESCAPE}[?2026h`, '').replaceAll(`${ESCAPE}[?2026l`, '')
}

// A clock each sleep moves forward and the non-empty writes it saw.
function colon_ports(now_ms: number): {
	ports: Parameters<typeof spin_to_second>[1]
	writes: Array<{ at_ms: number; text: string }>
} {
	const clock = { now_ms }
	const writes: Array<{ at_ms: number; text: string }> = []
	const ports = {
		now: () => clock.now_ms,
		write: (raw: string) => {
			const text = sync_free(raw)

			if (text !== '') writes.push({ at_ms: clock.now_ms, text })
		},
		sleep: async (ms: number) => {
			clock.now_ms += ms
		},
	}

	return { ports, writes }
}

describe('run_board_colon.is_lit', () => {
	it('lights the colons for the first half of every second and darkens them for the second', () => {
		expect([0, 499, 500, 999, 1000].map((ms) => is_lit(START + ms))).toStrictEqual([
			true,
			true,
			false,
			false,
			true,
		])
	})
})

describe('run_board_colon.dark_style', () => {
	it('scales a 24-bit color to 30% of its brightness, a theme’s color included', () => {
		expect(dark_style(CYAN_RGB)).toBe(`${CYAN_RGB}${ESCAPE}[38;2;19;71;68m`)
	})

	it('dims a named color, the terminal’s default color and a color reset before the colon', () => {
		expect(dark_style(`${ESCAPE}[36m`)).toBe(`${ESCAPE}[36m${DIM}`)
		expect(dark_style('')).toBe(DIM)
		expect(dark_style(`${CYAN_RGB}x${ESCAPE}[39m`)).toBe(`${CYAN_RGB}x${ESCAPE}[39m${DIM}`)
	})
})

describe('run_board_colon.colon_bytes and colon_boundary', () => {
	it('writes each colon lit in its style or dark, with no red, green or yellow of its own', () => {
		const plain = [{ row: 2, column: 6, style: '' }]

		expect(colon_bytes(plain, START)).toBe(`${ESCAPE}[2;6H:${RESET}`)
		expect(colon_bytes(plain, START + COLON_MS)).toBe(`${ESCAPE}[2;6H${DIM}:${RESET}`)
	})

	it('turns on the next half second, never with no colon', () => {
		expect(colon_boundary(COLONS, START + 120) - START).toBe(COLON_MS)
		expect(colon_boundary(COLONS, START + COLON_MS) - START).toBe(2 * COLON_MS)
		expect(colon_boundary([], START)).toBe(Infinity)
	})
})

describe('run_board_spin.colons_in and spun', () => {
	const lines = ['title', `${CYAN_RGB}🕒 12${run_board_spot.COLON}00`]

	it('records a clock colon’s spot by display width with the style before it', () => {
		expect(colons_in(lines, { rows: 24, columns: 80 })).toStrictEqual(COLONS)
	})

	it('records no colon on a row the terminal cuts off', () => {
		expect(colons_in(lines, { rows: 1, columns: 80 })).toStrictEqual([])
	})

	it('draws the colon lit', () => {
		expect(spun(lines, '⠋', { rows: 24, columns: 80 }).lines[1]).toBe(`${CYAN_RGB}🕒 12:00`)
	})
})

describe('run_board_spin.spin_to_second colons', () => {
	it('darkens the colons on the half second and leaves the lighting to the redraw', async () => {
		const { ports, writes } = colon_ports(START)
		const typing = run_board_type_rows.NO_TYPING

		await spin_to_second({ spots: [], typing, colons: COLONS }, ports)

		expect(writes).toStrictEqual([
			{ at_ms: START + COLON_MS, text: colon_bytes(COLONS, START + COLON_MS) },
		])
		expect(ports.now()).toBe(START + REDRAW_MS)
	})

	it('turns the spinner every 80 ms to the second as it did with no colon', async () => {
		const { ports, writes } = colon_ports(START)

		await spin_to_second(
			{ spots: SPOTS, typing: run_board_type_rows.NO_TYPING, colons: COLONS },
			ports,
		)

		const turns = Math.ceil(REDRAW_MS / SPINNER_INTERVAL_MS) - 1
		const spins = writes.filter(({ at_ms, text }) =>
			text.startsWith(spin_bytes(SPOTS, spinner_of(at_ms))),
		)

		expect(SPINNER_INTERVAL_MS).toBe(80)
		expect(spins.map(({ at_ms }) => at_ms - START)).toStrictEqual(
			Array.from({ length: turns }, (_, index) => (index + 1) * SPINNER_INTERVAL_MS),
		)
		expect(writes.filter(({ text }) => text.includes(':'))).toHaveLength(1)
	})
})
