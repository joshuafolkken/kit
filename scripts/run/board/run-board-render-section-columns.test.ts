import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_render_section } from './run-board-render-section'

// joshuafolkken/kit#4171: a rule whose column labels stand over their cells.

const { columns_rule, tight_columns_rule } = run_board_render_section
// A label one rule character and a blank past the section's label.
const ONE_RULE_BEFORE = '── lanes ─ CPU ──'

describe('run_board_render_section.columns_rule', () => {
	it('puts each label at its column’s start and fills the rest of the rule', () => {
		const rule = columns_rule('lanes', [
			{ label: 'CPU', start: 14 },
			{ label: 'MEM', start: 22 },
		])

		expect(rule.indexOf('CPU')).toBe(14)
		expect(rule.indexOf('MEM')).toBe(22)
		expect(rule.startsWith('── lanes ──── CPU ')).toBe(true)
		expect(run_board_fit.width_of(rule)).toBe(50)
	})

	it('keeps one rule character before a label whose start the rule has already passed', () => {
		const rule = columns_rule('lanes', [{ label: 'CPU', start: 2 }])

		expect(rule.startsWith(ONE_RULE_BEFORE)).toBe(true)
	})

	it('ends on a short rule where the labels run past the usual width', () => {
		const rule = columns_rule('lanes', [{ label: 'X'.repeat(60), start: 0 }])

		expect(rule.endsWith(` ${'X'.repeat(60)} ──`)).toBe(true)
	})
})

// joshuafolkken/kit#8280: no rule is forced between labels, so `/H ACTIVE` keeps each at its column.
describe('run_board_render_section.tight_columns_rule', () => {
	it('runs a label on after one blank where its start the rule has already reached or passed', () => {
		const reached = tight_columns_rule('lanes', [{ label: 'CPU', start: 9 }])
		const passed = tight_columns_rule('lanes', [{ label: 'CPU', start: 2 }])

		expect(reached).toBe(passed)
		expect(reached.startsWith('── lanes CPU ──')).toBe(true)
	})

	it('puts a label one blank further where the room before it holds no rule and blank', () => {
		const rule = tight_columns_rule('lanes', [{ label: 'CPU', start: 10 }])

		expect(rule.indexOf('CPU')).toBe(10)
		expect(rule.startsWith('── lanes  CPU ──')).toBe(true)
	})

	it('puts a rule and a blank before a label two columns past the rule', () => {
		expect(
			tight_columns_rule('lanes', [{ label: 'CPU', start: 11 }]).startsWith(ONE_RULE_BEFORE),
		).toBe(true)
	})
})
