import { describe, expect, it } from 'vitest'
import { run_board_theme_magi_fixture } from './run-board-theme-magi-fixture'
import { run_board_theme_magi_sync } from './run-board-theme-magi-sync'

// joshuafolkken/kit#8917: the MAGI theme's synchronization display (its ROW effect).

const { sync_display, sync_waves } = run_board_theme_magi_sync
const { HOST, KIT, fresh_grid, row_text, state_at } = run_board_theme_magi_fixture

describe('run_board_theme_magi_sync.sync_display', () => {
	it('leaves the area alone while no lane syncs', () => {
		const grid = fresh_grid()

		sync_display(KIT, grid, state_at('i', 40), 40)

		expect(grid).toStrictEqual(fresh_grid())
	})

	it('titles the display with the new lane and passes every check at full', () => {
		const grid = fresh_grid()
		// The tick after the lane's row finishes typing, while the display still shows.
		const ticks = Array.from({ length: 300 }, (_, tick) => tick)
		const tick = ticks.find((each) => state_at('r', each).row.cooled === 1) ?? 0

		sync_display(KIT, grid, state_at('r', tick), tick)

		expect(row_text(grid, HOST.layout.area_top)).toContain(
			`SYNCHRONIZATION #${HOST.layout.new_lane}`,
		)
		expect(row_text(grid, 9)).toContain('CONNECTED')
		expect(row_text(grid, 11)).toContain('STABLE')
	})
})

describe('run_board_theme_magi_sync.sync_waves', () => {
	it('draws the two waves as one where they meet at full', () => {
		const grid = fresh_grid()

		sync_waves(KIT, grid, 100, 0)
		const rows = [5, 6, 7].map((y) => row_text(grid, y).slice(2, KIT.sync_w)).join('')

		expect(rows).toContain('◉')
		expect(rows).not.toContain('○')
	})
})
