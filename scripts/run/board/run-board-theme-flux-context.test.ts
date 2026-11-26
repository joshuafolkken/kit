import { describe, expect, it } from 'vitest'
import { run_board_theme_flux_context } from './run-board-theme-flux-context'
import { run_board_theme_flux_fixture } from './run-board-theme-flux-fixture'

// joshuafolkken/kit#8917: the BTTF theme works out its board's places once, as the demo's theme did.

const { is_kept, later } = run_board_theme_flux_context
const { CONTEXT, HOST } = run_board_theme_flux_fixture
const { layout } = HOST

describe('run_board_theme_flux_context', () => {
	it('rolls a clock on by minutes, past midnight', () => {
		expect(later('11-24 23:50', 37)).toBe('11-24 00:27')
		expect(later('11-24 09:05', 37)).toBe('11-24 09:42')
	})

	it('puts the figure at the panel’s right end, under the area’s top rule', () => {
		expect(CONTEXT.figure).toStrictEqual({ row: layout.area_top + 1, column: layout.edge - 25 })
		expect(CONTEXT.area_right).toBe(layout.px - 1)
	})

	it('finds the header’s three clocks and the next estimate', () => {
		expect(CONTEXT.clocks).toHaveLength(3)
		expect(
			CONTEXT.clocks.every(({ x, text }) => x >= 0 && /^\d\d-\d\d \d\d:\d\d$/u.test(text)),
		).toBe(true)
		expect(CONTEXT.circuits.next).toBe(later(CONTEXT.clocks[0]?.text ?? '', 37))
	})

	it('finds the section rules and the rows', () => {
		expect(CONTEXT.rule_rows.length).toBeGreaterThan(1)
		expect(CONTEXT.all_rows).toHaveLength(layout.h)
		expect(CONTEXT.area_rows[0]).toBe(layout.area_top)
		expect(CONTEXT.lines.row.end).toBe(layout.w)
		expect(CONTEXT.lines.notice.throws).toBe(true)
	})

	it('keeps the notice and the progress words', () => {
		expect(is_kept(layout, layout.notice.x, layout.notice.y)).toBe(true)
		expect(is_kept(layout, layout.progress.x - 3, layout.progress.y)).toBe(true)
		expect(is_kept(layout, layout.progress.end, layout.progress.y)).toBe(false)
		expect(is_kept(layout, 0, layout.area_top)).toBe(false)
	})
})

// joshuafolkken/kit#8928: a start or finish a day or more from now reads its date alone.
describe('run_board_theme_flux_context date-only clocks', () => {
	it('finds a header clock that reads a date alone', () => {
		const api = { ...HOST.api, plain: (y: number) => (y < 3 ? '  🚀 11-25  ' : HOST.api.plain(y)) }
		const { clocks } = run_board_theme_flux_context.context_of(api)

		expect(clocks.map(({ text }) => text)).toStrictEqual(['11-25', '11-25', '11-25'])
		expect(clocks.every(({ x }) => x >= 0)).toBe(true)
	})
})
