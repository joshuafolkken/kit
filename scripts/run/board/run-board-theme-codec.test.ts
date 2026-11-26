import { describe, expect, it } from 'vitest'
import { run_board_theme_codec } from './run-board-theme-codec'
import { run_board_theme_demo_allowance_fixture } from './run-board-theme-demo-allowance-fixture'
import { run_board_theme_host_snap_fixture } from './run-board-theme-host-snap-fixture'

// joshuafolkken/kit#8917: the METAL GEAR theme draws the confirmed theme demo's frames (theme 4).

const { check_problems, demo_snaps, expect_demo_snaps, theme_of } =
	run_board_theme_host_snap_fixture
const { ALLOWANCES, LEVELS, expect_level_at_edge } = run_board_theme_demo_allowance_fixture
const THEME_KEY = 4

describe('run_board_theme_codec.theme', () => {
	it('matches the demo', () => {
		expect(demo_snaps(THEME_KEY)).not.toHaveLength(0)
		expect_demo_snaps(run_board_theme_codec.theme, THEME_KEY, ALLOWANCES.codec)
	})

	it('ends its level display at the rule’s right end', () => {
		expect(() => {
			expect_level_at_edge(run_board_theme_codec.theme, THEME_KEY, LEVELS.codec)
		}).not.toThrow()
	})

	it('builds every frame', () => {
		expect(check_problems(run_board_theme_codec.theme)).toStrictEqual([])
	}, 60_000)

	it('names the board and keeps the text as written', () => {
		const theme = theme_of(run_board_theme_codec.theme)

		expect(theme.name).toBe('METAL GEAR')
		expect(theme.board).toBe('josh-codec')
		expect(theme.capitals).toBe(false)
		expect(theme.spinner).toBe('▁▂▃▅▇█▇▅▃▂')
	})
})
