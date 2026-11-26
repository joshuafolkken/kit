import { describe, expect, it } from 'vitest'
import { run_board_theme_trace_fixture } from './run-board-theme-trace-fixture'
import { run_board_theme_trace_wash } from './run-board-theme-trace-wash'

// joshuafolkken/kit#8917: MATRIX's notice washes the area away; a drop a second falls when none pours.

const { HOST, row_text, view_at } = run_board_theme_trace_fixture
const { draw_seconds, is_pouring_at, wash_area } = run_board_theme_trace_wash
const { layout } = HOST

function area_text(view: ReturnType<typeof view_at>): string {
	const rows = Array.from({ length: layout.area_end - layout.area_top + 1 }, (_, index) =>
		row_text(view, layout.area_top + index).slice(0, layout.edge),
	)

	return rows.join('\n')
}

describe('run_board_theme_trace_wash', () => {
	it('blanks area cells the notice’s drops have passed', () => {
		const view = view_at('n', 100)
		const before = area_text(view)

		wash_area(view)

		expect(area_text(view)).not.toBe(before)
		expect(area_text(view).replaceAll(/\S/gu, '').length).toBeGreaterThan(
			before.replaceAll(/\S/gu, '').length,
		)
	})

	it('leaves the area alone with no notice', () => {
		const view = view_at('i', 100)
		const before = area_text(view)

		wash_area(view)

		expect(area_text(view)).toBe(before)
	})

	it('knows when the rain pours', () => {
		const { s } = view_at('n', 40)

		expect(is_pouring_at(s, 5)).toBe(false)
		expect(is_pouring_at(s, 20)).toBe(true)
	})

	it('drops nothing while the notice pours', () => {
		const view = view_at('n', 60)
		const before = view.grid.map((row) => row.map(([ch]) => ch).join(''))

		draw_seconds(view)

		expect(view.grid.map((row) => row.map(([ch]) => ch).join(''))).toHaveLength(before.length)
	})
})
