import { describe, expect, it } from 'vitest'
import { run_board_theme_demo_allowance_fixture } from './run-board-theme-demo-allowance-fixture'
import { run_board_theme_flux } from './run-board-theme-flux'
import { run_board_theme_host_snap_fixture } from './run-board-theme-host-snap-fixture'

// joshuafolkken/kit#8917: BTTF, the board's own time-circuits theme, draws the confirmed demo's frames.

const { expect_demo_check, expect_demo_snaps, theme_of } = run_board_theme_host_snap_fixture
const { ALLOWANCES } = run_board_theme_demo_allowance_fixture
const BTTF_KEY = 3

describe('run_board_theme_flux.theme', () => {
	it('matches the demo', () => {
		expect(() => {
			expect_demo_snaps(run_board_theme_flux.theme, BTTF_KEY, ALLOWANCES.flux)
		}).not.toThrow()
	})

	it('builds every frame', () => {
		expect(() => {
			expect_demo_check(run_board_theme_flux.theme)
		}).not.toThrow()
	}, 60_000)

	it('names itself BTTF and blinks the header clocks’ colons', () => {
		const theme = theme_of(run_board_theme_flux.theme)

		expect(theme.name).toBe('BTTF')
		expect(theme.colons).toBe(true)
		expect(theme.colors.red).toBe('255;70;50')
		expect(theme.opening?.ticks).toBe(125)
		expect(theme.ending?.ticks).toBe(124)
	})
})
