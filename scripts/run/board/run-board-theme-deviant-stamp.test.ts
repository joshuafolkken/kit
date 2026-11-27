import { describe, expect, it } from 'vitest'
import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_deviant_stamp } from './run-board-theme-deviant-stamp'
import type { ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid } from './run-board-theme-host-types'

// joshuafolkken/kit#9096: the deviant theme's ROW — the reconstruction view, its fact stamped in two
// weights, the panel's RECONSTRUCT plate and the new lane's blue chip.

const { HOST } = run_board_theme_host_fixture
const { state_of } = run_board_theme_host_state
const { is_stamping, stamp } = run_board_theme_deviant_stamp
const { STAMP } = run_board_theme_deviant_data
// The demo's events start typing on tick 10.
const EVENT_START = 10
// Long enough after the start to have wiped in the whole fact.
const FACT_TICKS = Math.ceil((STAMP.thin_after + STAMP.thin.length) / STAMP.pace)
const LONG_AFTER = 400

function stamped_at(tick: number): Grid {
	const grid = HOST.board.map((row) => row.map((cell): Cell => [cell[0], cell[1]]))
	const draw: ThemeDraw = {
		api: HOST.api,
		grid,
		s: state_of(HOST.layout, HOST.events.r, tick),
		tick,
	}

	stamp(draw)

	return grid
}

function screen_text(grid: Grid): string {
	return grid.map((row) => row.map(([ch]) => ch).join('')).join('\n')
}

function stamping_at(key: 'i' | 'r', tick: number): boolean {
	return is_stamping(state_of(HOST.layout, HOST.events[key], tick))
}

describe('run_board_theme_deviant_stamp.is_stamping', () => {
	it('stamps from the ROW start until its tail has passed', () => {
		const at = stamping_at

		expect([
			at('r', EVENT_START - 1),
			at('r', EVENT_START),
			at('r', LONG_AFTER),
			at('i', EVENT_START),
		]).toStrictEqual([false, true, false, false])
	})
})

describe('run_board_theme_deviant_stamp.stamp', () => {
	it('lays the RECONSTRUCT plate on the panel', () => {
		expect(screen_text(stamped_at(EVENT_START))).toContain('⌜ RECONSTRUCT ⌟')
	})

	it('wipes the fact in, both weights, beside its chip', () => {
		const text = screen_text(stamped_at(EVENT_START + FACT_TICKS))

		expect(text).toContain(STAMP.lead)
		expect(text).toContain(`▌ ${STAMP.bold}`)
		expect(text).toContain(STAMP.thin)
	})

	it('marks the new lane with a blue chip before its line', () => {
		const { y, x } = HOST.layout.row
		const grid = stamped_at(EVENT_START)

		expect(grid[y]?.[x - STAMP.chip_back]?.[0]).toBe('▌')
	})

	it('reads the reconstruction open while the lane types', () => {
		expect(screen_text(stamped_at(EVENT_START))).toContain(STAMP.open)
	})
})
