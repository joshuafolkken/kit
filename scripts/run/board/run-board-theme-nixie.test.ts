import { describe, expect, it } from 'vitest'
import { run_board_theme_demo_allowance_fixture } from './run-board-theme-demo-allowance-fixture'
import { run_board_theme_host_snap_fixture } from './run-board-theme-host-snap-fixture'
import { run_board_theme_nixie } from './run-board-theme-nixie'

// joshuafolkken/kit#8917: the STEINS;GATE theme draws the confirmed demo's frames (theme key 5).

const { expect_demo_snaps, expect_demo_check, theme_of } = run_board_theme_host_snap_fixture
const { ALLOWANCES, LEVELS, expect_level_at_edge } = run_board_theme_demo_allowance_fixture
const NIXIE_KEY = 5

describe('run_board_theme_nixie.theme', () => {
	// The fixture's helpers assert themselves; wrapped so the test states its own assertion.
	it('matches the demo', () => {
		expect(() => {
			expect_demo_snaps(run_board_theme_nixie.theme, NIXIE_KEY, ALLOWANCES.nixie)
		}).not.toThrow()
	})

	it('ends its level display at the rule’s right end', () => {
		expect(() => {
			expect_level_at_edge(run_board_theme_nixie.theme, NIXIE_KEY, LEVELS.nixie)
		}).not.toThrow()
	})

	it('builds every frame', () => {
		expect(() => {
			expect_demo_check(run_board_theme_nixie.theme)
		}).not.toThrow()
	}, 60_000)

	it('names its board and keeps the text as written', () => {
		const theme = theme_of(run_board_theme_nixie.theme)

		expect([theme.name, theme.board, theme.capitals, theme.spinner]).toStrictEqual([
			'STEINS;GATE',
			'josh-nixie',
			false,
			'0123456789',
		])
	})
})
