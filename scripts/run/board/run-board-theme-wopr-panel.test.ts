import { describe, expect, it } from 'vitest'
import { run_board_theme_wopr_fixture } from './run-board-theme-wopr-fixture'
import { run_board_theme_wopr_panel } from './run-board-theme-wopr-panel'

const { HOST, WOPR, board_grid, row_text } = run_board_theme_wopr_fixture
const { game_at, panel } = run_board_theme_wopr_panel

describe('run_board_theme_wopr_panel.game_at', () => {
	it('puts a mark down every pace from the first tick', () => {
		expect(game_at(0, () => 4)).toMatchObject({ game: 0, marks: 1, phase: 'play' })
		expect(game_at(35, () => 4)).toMatchObject({ game: 0, marks: 9, phase: 'play' })
	})

	it('flashes two ticks after the ninth mark, then is gone two', () => {
		expect(game_at(36, () => 4).phase).toBe('flash')
		expect(game_at(38, () => 4).phase).toBe('gone')
		expect(game_at(40, () => 4)).toMatchObject({ game: 1, marks: 1, phase: 'play' })
	})

	it('puts several marks down a tick at a pace under one', () => {
		expect(game_at(1, () => 1 / 3).marks).toBe(4)
	})
})

describe('run_board_theme_wopr_panel.panel', () => {
	it('frames LAUNCH and ADN over the area with the status on its last row', () => {
		const grid = board_grid()
		const play = game_at(0, () => 4)

		panel(WOPR, grid, {
			status: 'SEARCHING · 00/10',
			status_ink: '',
			look: () => ({ ch: 'A', ink: undefined, locked: false }),
			play,
		})

		expect(row_text(grid, HOST.layout.area_top)).toContain('╡ LAUNCH ╞═╡ ADN ╞')
		expect(row_text(grid, HOST.layout.area_end)).toContain('╡ SEARCHING · 00/10 ╞')
		expect(row_text(grid, HOST.layout.area_top + 2)).toContain('GAMES')
	})
})
