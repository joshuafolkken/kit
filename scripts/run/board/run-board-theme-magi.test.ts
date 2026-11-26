import { describe, expect, it } from 'vitest'
import { run_board_theme_demo_allowance_fixture } from './run-board-theme-demo-allowance-fixture'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_snap_fixture } from './run-board-theme-host-snap-fixture'
import { run_board_theme_magi } from './run-board-theme-magi'

// joshuafolkken/kit#8917: the MAGI theme draws the confirmed theme demo's frames (theme 7).

const { check_problems, demo_snaps, expect_demo_snaps } = run_board_theme_host_snap_fixture
const { ALLOWANCES, LEVELS, expect_level_at_edge } = run_board_theme_demo_allowance_fixture
const { HOST } = run_board_theme_host_fixture
const MAGI_KEY = 7

describe('run_board_theme_magi.theme', () => {
	it('matches the demo', () => {
		expect(demo_snaps(MAGI_KEY)).toHaveLength(72)
		expect_demo_snaps(run_board_theme_magi.theme, MAGI_KEY, ALLOWANCES.magi)
	})

	it('ends its level display at the rule’s right end', () => {
		expect(() => {
			expect_level_at_edge(run_board_theme_magi.theme, MAGI_KEY, LEVELS.magi)
		}).not.toThrow()
	})

	// The demo's DEMO_CHECK, as `expect_demo_check` runs it.
	it('builds every frame', () => {
		expect(check_problems(run_board_theme_magi.theme)).toStrictEqual([])
	}, 60_000)

	it('names its board, capitals and spinner as the demo does', () => {
		const theme = run_board_theme_magi.theme(HOST.api)

		expect(theme.name).toBe('MAGI')
		expect(theme.board).toBe('josh-magi')
		expect(theme.capitals).toBe(true)
		expect(theme.spinner).toBe('┤┘┴└├┌┬┐')
		expect(theme.opening?.ticks).toBe(126)
		expect(theme.ending?.ticks).toBe(100)
	})
})

describe('run_board_theme_magi.kit_of', () => {
	it('places the three panels in their triangle inside the panel', () => {
		const { px, edge } = HOST.layout
		const kit = run_board_theme_magi.kit_of(HOST.api)

		const low_w = Math.floor((HOST.layout.pw - 2) / 2)

		expect(kit.panels.map(({ x, w }) => [x, x + w])).toStrictEqual([
			[edge - low_w, edge],
			[px + 15, edge - 15],
			[px, px + low_w],
		])
		expect(kit.panels.map(({ y }) => y)).toStrictEqual([9, 5, 9])
		expect(kit.sync_end).toBe(px - 1)
		expect(kit.sync_w).toBe(px - 4)
	})
})
