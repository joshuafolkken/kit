import { describe, expect, it } from 'vitest'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import { run_board_theme_nixie_opening } from './run-board-theme-nixie-opening'

// joshuafolkken/kit#8917: STEINS;GATE's opening — a tube spins, flashes white as it locks, then
// glows; the board settles from the top, the area last.

const { HOST } = run_board_theme_host_fixture
const { layout } = HOST
const { SG_OPEN, nixie_opening, settle_at, warm_glow } = run_board_theme_nixie_opening
const { state_of } = run_board_theme_host_state

describe('run_board_theme_nixie_opening.warm_glow', () => {
	it('spins hot, flashes white for two ticks, then glows on four ticks in eight', () => {
		const white = '255;255;255'

		expect([39, 40, 41, 42, 46].map((tick) => warm_glow(tick, 40))).toStrictEqual([
			'255;200;120',
			white,
			white,
			'255;170;60',
			'255;150;40',
		])
	})
})

describe('run_board_theme_nixie_opening.settle_at', () => {
	it('settles the rows from the top first and the area last', () => {
		const top = settle_at(layout, 0, 0)
		const area = settle_at(layout, 0, layout.area_top)

		expect(top).toBeGreaterThanOrEqual(SG_OPEN.roll)
		expect(area).toBeGreaterThanOrEqual(SG_OPEN.area)
	})
})

describe('run_board_theme_nixie_opening.nixie_opening', () => {
	it('plays for its ticks and leaves the board as it was once done', () => {
		const opening = nixie_opening(HOST.api)
		const grid = HOST.board.map((row) => [...row])

		opening.draw(grid, SG_OPEN.done, state_of(layout, HOST.events.o, SG_OPEN.done))
		expect(opening.ticks).toBe(130)
		expect(grid).toStrictEqual(HOST.board)
	})
})
