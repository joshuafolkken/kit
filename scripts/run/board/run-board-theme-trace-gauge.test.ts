import { describe, expect, it } from 'vitest'
import type { Cell } from './run-board-theme-host-types'
import { run_board_theme_trace_fixture } from './run-board-theme-trace-fixture'
import { run_board_theme_trace_gauge } from './run-board-theme-trace-gauge'
import { run_board_theme_trace_paint } from './run-board-theme-trace-paint'

// joshuafolkken/kit#8917: MATRIX's TRACE gauge climbs with a notice; its rules' dashes go dark.

const { HOST, cell_of, row_text, view_at } = run_board_theme_trace_fixture
const { dark_dashes, trace_gauge, trace_level } = run_board_theme_trace_gauge
const { DARK_ON } = run_board_theme_trace_paint
const { level_spot } = HOST.layout
const GAUGE_WIDTH = 11

function is_rule_dash([ch, style]: Cell): boolean {
	return ch === '-' && style.startsWith('rule')
}

// The gauge, 11 columns, ends on the rule's last column (the confirmed specification §4).
function gauge_text(view: ReturnType<typeof view_at>): string {
	return row_text(view, level_spot.y).slice(HOST.layout.edge - GAUGE_WIDTH, HOST.layout.edge)
}

describe('run_board_theme_trace_gauge', () => {
	it('rests at 5 and climbs to 1 by the peak', () => {
		expect(trace_level(view_at('i', 40).s)).toBe(5)
		expect(trace_level(view_at('n', 10).s)).toBe(5)
		expect(trace_level(view_at('n', 90).s)).toBe(1)
	})

	it('shows TRACE and its filled cells', () => {
		const calm = view_at('i', 40)
		const alarm = view_at('n', 90)

		trace_gauge(calm)
		trace_gauge(alarm)

		expect(gauge_text(calm)).toBe('TRACE ■----')
		expect(gauge_text(alarm)).toBe('TRACE ■■■■■')
	})

	it('darkens the rules’ dashes', () => {
		const view = view_at('i', 0)
		const y = view.grid.findIndex((row) => row.some((cell) => is_rule_dash(cell)))
		const x = view.grid[y]?.findIndex((cell) => is_rule_dash(cell)) ?? -1

		dark_dashes(view.grid)

		expect(x).toBeGreaterThanOrEqual(0)
		expect(cell_of(view, y, x)[1]).toBe(DARK_ON)
	})
})
