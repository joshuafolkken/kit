import { describe, expect, it } from 'vitest'
import { run_board_theme_demo_allowance_fixture } from './run-board-theme-demo-allowance-fixture'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_snap_fixture } from './run-board-theme-host-snap-fixture'
import { run_board_theme_trace } from './run-board-theme-trace'

// joshuafolkken/kit#8917: MATRIX, the board's own code-rain theme, draws the confirmed demo's frames.

const { expect_demo_snaps, expect_demo_check } = run_board_theme_host_snap_fixture
const { ALLOWANCES, LEVELS, expect_level_at_edge } = run_board_theme_demo_allowance_fixture
const { HOST } = run_board_theme_host_fixture
const MATRIX_KEY = 2

describe('run_board_theme_trace', () => {
	it('matches the demo', () => {
		expect(() => {
			expect_demo_snaps(run_board_theme_trace.theme, MATRIX_KEY, ALLOWANCES.trace)
		}).not.toThrow()
	})

	it('ends its TRACE gauge at the rule’s right end', () => {
		expect(() => {
			expect_level_at_edge(run_board_theme_trace.theme, MATRIX_KEY, LEVELS.trace)
		}).not.toThrow()
	})

	it('builds every frame', () => {
		expect(() => {
			expect_demo_check(run_board_theme_trace.theme)
		}).not.toThrow()
	}, 60_000)

	it('names itself MATRIX and blinks the header clocks’ colons', () => {
		const theme = run_board_theme_trace.theme(HOST.api)

		expect(theme.name).toBe('MATRIX')
		expect(theme.colons).toBe(true)
		expect(theme.colors.notice).toBe('0;255;65')
	})
})
