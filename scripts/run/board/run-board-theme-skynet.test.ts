import { describe, expect, it } from 'vitest'
import { run_board_theme_demo_allowance_fixture } from './run-board-theme-demo-allowance-fixture'
import { run_board_theme_host_snap_fixture } from './run-board-theme-host-snap-fixture'
import { run_board_theme_skynet } from './run-board-theme-skynet'

// joshuafolkken/kit#8917: the TERMINATOR theme draws the confirmed demo's frames (theme key 6).

const { expect_demo_check, expect_demo_snaps, theme_of } = run_board_theme_host_snap_fixture
const { ALLOWANCES, LEVELS, expect_level_at_edge } = run_board_theme_demo_allowance_fixture
const THEME_KEY = 6

describe('run_board_theme_skynet', () => {
	it('matches the demo', () => {
		expect(() => {
			expect_demo_snaps(run_board_theme_skynet.theme, THEME_KEY, ALLOWANCES.skynet)
		}).not.toThrow()
	})

	it('ends its level display at the rule’s right end', () => {
		expect(() => {
			expect_level_at_edge(run_board_theme_skynet.theme, THEME_KEY, LEVELS.skynet)
		}).not.toThrow()
	})

	it('builds every frame', () => {
		expect(() => {
			expect_demo_check(run_board_theme_skynet.theme)
		}).not.toThrow()
	}, 60_000)

	it('names the board, raises capitals and turns the quadrant spinner', () => {
		const theme = theme_of(run_board_theme_skynet.theme)

		expect(theme).toMatchObject({
			name: 'TERMINATOR',
			board: 'josh-skynet',
			capitals: true,
			spinner: '▖▘▝▗',
		})
	})

	it('opens and ends on the picture tube', () => {
		const theme = theme_of(run_board_theme_skynet.theme)

		expect(theme.opening?.note).toContain('the tube switches on')
		expect(theme.ending?.note).toContain('the tube switches off')
	})
})
