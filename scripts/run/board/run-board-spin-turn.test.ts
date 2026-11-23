import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import { run_board_spin } from './run-board-spin'
import { run_board_spin_turn } from './run-board-spin-turn'
import { run_board_spot } from './run-board-spot'
import { run_board_type_rows, type Typing } from './run-board-type-rows'

// joshuafolkken/kit#8794: what one wake between redraws writes, apart from when the wakes come.

const { coded, lamp_moment, spin_bytes } = run_board_spin_turn
const { SPINNER_INTERVAL_MS } = run_board_labels
const ESCAPE = '\u{1B}'
const GREEN = `${ESCAPE}[32m`
const START = Date.parse('2026-10-08T09:00:00.000Z')
const TYPING: Typing = {
	seen: new Set(),
	lines: [{ key: 'a', index: 0, row: 1, prefix_columns: 0, text: 'x'.repeat(40), start_ms: START }],
}
const PANEL_LAMPS = Array.from({ length: 8 }, () => run_board_spot.LAMP).join(' ')
const RULE_FRAME = [`── THROUGHPUT ${'─'.repeat(40)}`, `  24H  ${PANEL_LAMPS}`]

describe('run_board_spin_turn.spin_bytes', () => {
	it('moves the cursor to each spot and draws the frame in its colors, then resets', () => {
		const spots = [
			{ row: 1, column: 1, style: GREEN },
			{ row: 4, column: 3, style: '' },
		]

		expect(spin_bytes(spots, '⠹')).toBe(
			`${ESCAPE}[1;1H${GREEN}⠹${ESCAPE}[0m${ESCAPE}[4;3H⠹${ESCAPE}[0m`,
		)
	})
})

describe('run_board_spin_turn.lamp_moment', () => {
	it('bursts on a step a row is still typing at, and carries the arrival through', () => {
		const at_ms = START + SPINNER_INTERVAL_MS + 1

		expect(lamp_moment({ spots: [], typing: TYPING, arrive_ms: START }, at_ms)).toStrictEqual({
			ms: at_ms,
			is_burst: true,
			jump: undefined,
			arrive_ms: START,
		})
	})

	it('does not burst with no row typing', () => {
		const typing = run_board_type_rows.NO_TYPING

		expect(lamp_moment({ spots: [], typing }, START).is_burst).toBe(false)
	})
})

describe('run_board_spin_turn.coded', () => {
	const { lamps, rules } = run_board_spin.spun(RULE_FRAME, '⠋')

	it('runs the rules’ code once the lamps blink', () => {
		expect(rules.length).toBeGreaterThan(0)
		expect(coded({ spots: [], typing: TYPING, lamps, rules }).cells).toStrictEqual(rules)
	})

	it('runs no code before the first frame is out', () => {
		const typing = { seen: undefined, lines: [] }

		expect(coded({ spots: [], typing, lamps, rules }).cells).toStrictEqual([])
	})
})
