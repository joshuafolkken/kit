import { describe, expect, it } from 'vitest'
import { run_board_theme_demo_allowance_fixture } from './run-board-theme-demo-allowance-fixture'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_snap_fixture } from './run-board-theme-host-snap-fixture'
import { run_board_theme_wopr } from './run-board-theme-wopr'

const { HOST } = run_board_theme_host_fixture
const { expect_demo_check, expect_demo_snaps } = run_board_theme_host_snap_fixture
// joshuafolkken/kit#8917: WARGAMES is the confirmed demo's theme 1.
const WARGAMES_KEY = 1
const { ALLOWANCES } = run_board_theme_demo_allowance_fixture

describe('run_board_theme_wopr', () => {
	it('matches the demo but for the code running on every tick', () => {
		expect(() => {
			expect_demo_snaps(run_board_theme_wopr.theme, WARGAMES_KEY, ALLOWANCES.wopr)
		}).not.toThrow()
	})

	it('builds every frame', () => {
		expect(() => {
			expect_demo_check(run_board_theme_wopr.theme)
		}).not.toThrow()
	}, 60_000)

	// The confirmed specification §2: `lasts.n` is the NOTICE's whole length, wopr's counted from its
	// screen effect — 79 ticks to the peak and 238 after it.
	it('is the WOPR board in capitals with blinking colons and a 317-tick NOTICE', () => {
		const theme = run_board_theme_wopr.theme(HOST.api)

		expect(run_board_theme_wopr.NOTICE_LASTS).toBe(317)
		expect(theme).toMatchObject({
			name: 'WARGAMES',
			board: 'josh-wopr',
			capitals: true,
			colons: true,
			lasts: { n: run_board_theme_wopr.NOTICE_LASTS },
		})
	})
})
