import { issue_cite } from '#scripts/issue/issue-cite'
import { describe, expect, it } from 'vitest'
import type { ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_ghost_cloak } from './run-board-theme-ghost-cloak'
import { run_board_theme_ghost_data } from './run-board-theme-ghost-data'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import type { Cell, Grid, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_magi_fixture } from './run-board-theme-magi-fixture'

// joshuafolkken/kit#9096: the ghost theme's ROW, the decloaking lane and the net graph.

const { decloak, is_linking, linking } = run_board_theme_ghost_cloak
const { HOST } = run_board_theme_host_fixture
const { fresh_grid, state_at } = run_board_theme_magi_fixture
const { CLOAK, INKS } = run_board_theme_ghost_data
const ROW_START = 10
const TYPING = 20
const LANE_NUMBER = '9096'

function draw_of(grid: Grid, state: ThemeState): ThemeDraw {
	const api = { ...HOST.api, layout: { ...HOST.layout, new_lane: LANE_NUMBER } }

	return { api, grid, s: state, tick: state.tick }
}

// The data pane's rows as text, left of the panel.
function data_text(grid: Grid): string {
	const { area_top, area_end, px } = HOST.layout

	return grid
		.slice(area_top + 1, area_end)
		.map((row) =>
			row
				.slice(0, px - 1)
				.map(([ch]) => ch)
				.join(''),
		)
		.join('\n')
}

function linked_text(state: ThemeState): string {
	const grid = fresh_grid()

	linking(draw_of(grid, state))

	return data_text(grid)
}

function cells_of(grid: Grid, y: number, [from, to]: [number, number]): Array<Cell> {
	return (grid[y] ?? []).slice(from, to)
}

function typed_through(): ThemeState {
	const { total } = state_at('r', ROW_START).row

	return state_at('r', ROW_START + total)
}

describe('run_board_theme_ghost_cloak.is_linking', () => {
	it('plays while the lane types and through the graph’s tail', () => {
		expect(is_linking(state_at('i', TYPING))).toBe(false)
		expect(is_linking(state_at('r', 0))).toBe(false)
		expect(is_linking(state_at('r', TYPING))).toBe(true)
		expect(is_linking(state_at('r', ROW_START + CLOAK.tail + 1000))).toBe(false)
	})
})

describe('run_board_theme_ghost_cloak.decloak', () => {
	it('turns the untyped rest of the lane’s row into dim noise, leaving the typed part', () => {
		const state = state_at('r', TYPING)
		const grid = fresh_grid()
		const { y, x } = state.row.span
		const typed_end = x + state.row.length

		decloak(draw_of(grid, state))
		const drawn_noise = cells_of(grid, y, [typed_end + 1, x + state.row.total]).filter(
			([, style]) => style === INKS.DIM,
		)

		expect(drawn_noise.length).toBeGreaterThan(0)

		for (const [ch] of drawn_noise) expect(CLOAK.glyphs).toContain(ch)

		expect(cells_of(grid, y, [x, typed_end])).toStrictEqual(
			cells_of(fresh_grid(), y, [x, typed_end]),
		)
	})

	it('changes nothing once the lane has typed through', () => {
		const grid = fresh_grid()

		decloak(draw_of(grid, typed_through()))

		expect(grid).toStrictEqual(fresh_grid())
	})
})

describe('run_board_theme_ghost_cloak.linking', () => {
	it('swaps the data for the net graph, its four nodes and a new one drawing out', () => {
		const text = linked_text(state_at('r', TYPING))

		expect(text).toContain('DECLOAKING')
		// The new link draws its first dot over the node it leaves from.
		expect(text.split('●').length - 1).toBe(Object.keys(CLOAK.nodes).length - 1)
		expect(text).toContain('○')
		expect(text).toContain('·')
	})

	it('lights the new node with the lane’s number once the lane has typed', () => {
		const text = linked_text(typed_through())

		expect(text).toContain('NODE LINKED')
		expect(text).toContain('◉')
		expect(text).toContain(issue_cite.plain_for('terminal', LANE_NUMBER))
	})
})
