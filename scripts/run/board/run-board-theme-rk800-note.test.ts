import { describe, expect, it } from 'vitest'
import type { ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import type { DemoKey } from './run-board-theme-host-sample'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid, ThemeLayout } from './run-board-theme-host-types'
import { run_board_theme_rk800_data } from './run-board-theme-rk800-data'
import { run_board_theme_rk800_note } from './run-board-theme-rk800-note'
import { run_board_theme_rk800_tables } from './run-board-theme-rk800-tables'

// joshuafolkken/kit#9096: the rk800 theme's small corner notices on the THROUGHPUT rule — read off
// the state of the tick, so a NOTICE's wall raises one and a ROW that has typed unlocks a path.

const { HOST } = run_board_theme_host_fixture
const { state_of } = run_board_theme_host_state
const { note } = run_board_theme_rk800_note
const { WALL } = run_board_theme_rk800_data
const { NOTE } = run_board_theme_rk800_tables
// The demo's events start typing on tick 10.
const EVENT_START = 10
// A few ticks into a notice: past its fade in, inside its hold.
const SETTLED = NOTE.fade + 1
// Far enough to have typed any of the demo's lines.
const LONG_AFTER = 400

function board_copy(): Grid {
	return HOST.board.map((row) => row.map((cell): Cell => [cell[0], cell[1]]))
}

function drawn_at(key: Exclude<DemoKey, 'o' | 'x'>, tick: number, layout?: ThemeLayout): Grid {
	const grid = board_copy()
	const api = layout === undefined ? HOST.api : { ...HOST.api, layout }
	const draw: ThemeDraw = { api, grid, s: state_of(HOST.layout, HOST.events[key], tick), tick }

	note(draw)

	return grid
}

function rule_text(grid: Grid): string {
	return (grid[HOST.layout.level_spot.y] ?? []).map(([ch]) => ch).join('')
}

// The first tick the demo's ROW has finished typing on.
function row_typed_tick(): number {
	const ticks = Array.from({ length: LONG_AFTER }, (_, tick) => tick)

	return (
		ticks.find((tick) => {
			const { row } = state_of(HOST.layout, HOST.events.r, tick)

			return row.index >= 0 && !row.is_typing
		}) ?? -1
	)
}

describe('run_board_theme_rk800_note.note', () => {
	it('shows nothing on an idle board', () => {
		expect(drawn_at('i', SETTLED)).toStrictEqual(HOST.board)
	})

	it('raises SOFTWARE INSTABILITY on the rule as the wall starts', () => {
		const text = rule_text(drawn_at('n', EVENT_START + WALL.from + SETTLED))

		expect(text).toContain(` ${NOTE.up} ${NOTE.words} `)
	})

	it('stands the notice a cell clear of the level', () => {
		const { x } = HOST.layout.level_spot
		const text = rule_text(drawn_at('n', EVENT_START + WALL.from + SETTLED))

		expect(text.slice(0, x - NOTE.gap).endsWith(`${NOTE.words} `)).toBe(true)
	})

	it('unlocks a path once a ROW has typed', () => {
		const tick = row_typed_tick() + SETTLED

		expect(rule_text(drawn_at('r', tick))).toContain(`${NOTE.path_sign} ${NOTE.path}`)
	})

	it('gives the notice up where the rule is too short for it', () => {
		const layout = { ...HOST.layout, level_spot: { ...HOST.layout.level_spot, x: NOTE.min_x } }

		expect(drawn_at('n', EVENT_START + WALL.from + SETTLED, layout)).toStrictEqual(HOST.board)
	})
})
