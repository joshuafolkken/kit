import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_render_section } from './run-board-render-section'

// joshuafolkken/kit#4171: a rule whose column labels stand over their cells.

const { columns_rule } = run_board_render_section

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

		expect(rule.startsWith('── lanes ─ CPU ──')).toBe(true)
	})

	it('ends on a short rule where the labels run past the usual width', () => {
		const rule = columns_rule('lanes', [{ label: 'X'.repeat(60), start: 0 }])

		expect(rule.endsWith(` ${'X'.repeat(60)} ──`)).toBe(true)
	})
})
