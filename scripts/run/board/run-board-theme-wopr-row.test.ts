import { describe, expect, it } from 'vitest'
import { run_board_theme_wopr_fixture } from './run-board-theme-wopr-fixture'
import { run_board_theme_wopr_row } from './run-board-theme-wopr-row'

const { HOST, WOPR, board_grid, row_text, state_at } = run_board_theme_wopr_fixture
const { flicker, row_event, scan } = run_board_theme_wopr_row

describe('run_board_theme_wopr_row', () => {
	it('plays only while a lane types', () => {
		expect(row_event(WOPR, board_grid(), state_at('i', 20), 20)).toBe(false)
	})

	it('shows the LAUNCH panel searching during ROW', () => {
		const grid = board_grid()

		expect(row_event(WOPR, grid, state_at('r', 20), 20)).toBe(true)
		expect(row_text(grid, HOST.layout.area_end)).toContain('SEARCHING · ')
	})

	it('scans a white column across the drawn cells', () => {
		const grid = board_grid()

		scan(WOPR, grid, state_at('r', 22), 22)

		expect(grid.flat().some(([ch, style]) => ch !== ' ' && style.includes('200;255;250'))).toBe(
			true,
		)
	})

	it('turns stray characters below a row into code', () => {
		const grid = board_grid()
		const before = grid.flat().filter(([, style]) => style === 'ink').length

		flicker(WOPR, grid, 5, { strays: 20, from_y: HOST.layout.area_end + 1, ink: 'ink' })

		expect(grid.flat().filter(([, style]) => style === 'ink').length).toBeGreaterThan(before)
	})
})
