import { describe, expect, it } from 'vitest'
import { run_board_theme_wopr_fixture } from './run-board-theme-wopr-fixture'
import { run_board_theme_wopr_map } from './run-board-theme-wopr-map'

const { HOST, WOPR, board_grid, cell_of, row_text, state_at } = run_board_theme_wopr_fixture
const { arrived_at, draw_blob, draw_line, screen_blobs, slope_glyph, split } =
	run_board_theme_wopr_map

// The demo's NOTICE peaks at tick 89: c ticks after the peak.
function after_peak(cooled: number): number {
	return 89 + cooled
}

describe('run_board_theme_wopr_map — tracks and blobs', () => {
	it('draws a track flat, slanted or steep', () => {
		expect(slope_glyph(10, 1)).toBe('─')
		expect(slope_glyph(1, 3)).toBe('│')
		expect(slope_glyph(4, -3)).toBe('╱')
		expect(slope_glyph(4, 3)).toBe('╲')
	})

	it('draws a line from its site as far as it has flown', () => {
		const grid = board_grid()
		const track = { y0: WOPR.sky, x0: 1, y1: WOPR.sky, x1: 11, from: 0, to: 1, ink: 'ink' }

		draw_line(WOPR, grid, track, 0.5)

		expect(cell_of(grid, { y: WOPR.sky, x: 6 })).toStrictEqual(['─', 'ink'])
		expect(cell_of(grid, { y: WOPR.sky, x: 7 })[1]).not.toBe('ink')
	})

	it('draws a blob solid in the middle where it may', () => {
		const grid = board_grid()

		draw_blob(grid, { y: 20, x: 20, radius: 2 }, { ink: 'ink', may: (y) => y <= 20 })

		expect(cell_of(grid, { y: 20, x: 20 })).toStrictEqual(['█', 'ink'])
		expect(cell_of(grid, { y: 21, x: 20 })[1]).not.toBe('ink')
	})
})

describe('run_board_theme_wopr_map — the split area', () => {
	it('splits the area into the NORAD map and the STRATEGY table', () => {
		const grid = board_grid()
		const state = state_at('n', after_peak(10))

		split(WOPR, grid, state, state.tick)

		expect(row_text(grid, HOST.layout.area_top)).toContain('NORAD · WAR SIMULATION · SCENARIO 001')
		expect(row_text(grid, WOPR.sky)).toContain('STRATEGY:')
		expect(arrived_at(WOPR, 10)).toBe(1)
	})

	it('blooms no screen blob during the build', () => {
		const grid = board_grid()
		const before = row_text(grid, 0)

		screen_blobs(WOPR, grid, state_at('n', 40))

		expect(row_text(grid, 0)).toBe(before)
	})
})
