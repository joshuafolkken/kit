import { describe, expect, it } from 'vitest'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_settle } from './run-board-theme-host-settle'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Channel, Grid, ThemeColors, ThemeState } from './run-board-theme-host-types'

// joshuafolkken/kit#8917 (the confirmed specification §2): once its last letter lands, the progress
// line settles over three seconds from the typing color back to the board's own colors.

const { SETTLE_TICKS, look_of, settle_progress, since_of } = run_board_theme_host_settle
const { HOST } = run_board_theme_host_fixture
const { cell_at, fg, mixed, set_cell } = run_board_theme_host_grid
const { state_of: host_state } = run_board_theme_host_state
const COLORS: ThemeColors = {
	body: '10;10;10',
	rule: '20;20;20',
	ok: '30;30;30',
	red: '40;40;40',
	warn: '50;50;50',
	hi: '60;60;60',
	type: '250;250;250',
	notice: '70;70;70',
}
const SPAN = { y: 2, x: 10, end: 14 }
const AT = { y: SPAN.y, x: SPAN.x }
const ICON_LEAD = 3
const HALF = 0.5

function channel_of(cooled: number, is_typing = false): Channel {
	return {
		name: 'progress',
		index: 0,
		is_typing,
		length: 4,
		total: 4,
		cooled,
		start: 0,
		span: SPAN,
		text: 'done',
		icon: undefined,
	}
}

function state_of(cooled: number): ThemeState {
	return { ...host_state(HOST.layout, HOST.events.p, 0), progress: channel_of(cooled) }
}

function board_copy(): Grid {
	return HOST.api.board.map((row) => row.map(([ch, style]): Cell => [ch, style]))
}

// The progress line's cell at its first letter after a settle `cooled` ticks in, the line typed
// in the typing role.
function settled_at(cooled: number): Cell {
	const grid = board_copy()

	for (let x = SPAN.x - ICON_LEAD; x < SPAN.end; x++) {
		set_cell(grid, { y: SPAN.y, x }, ['x', 'type'])
	}

	settle_progress({ grid, api: HOST.api, state: state_of(cooled) }, COLORS)

	return cell_at(grid, AT.y, AT.x)
}

function base_rgb(): string {
	return look_of(cell_at(HOST.api.board, AT.y, AT.x)[1], COLORS).rgb
}

describe('run_board_theme_host_settle.since_of', () => {
	it('counts nothing while the line types or before it starts', () => {
		expect(since_of(channel_of(5, true))).toBeUndefined()
		expect(since_of({ ...channel_of(5), index: -1 })).toBeUndefined()
		expect(since_of(channel_of(5))).toBe(5)
	})
})

describe('run_board_theme_host_settle.look_of', () => {
	it('reads a true color as is, a role through the theme’s colors', () => {
		expect(look_of(fg('1;2;3'), COLORS)).toStrictEqual({ rgb: '1;2;3', ink: '' })
		expect(look_of('hi', COLORS).rgb).toBe(COLORS.hi)
		expect(look_of('nothing', COLORS).rgb).toBe(COLORS.body)
	})
})

describe('run_board_theme_host_settle.settle_progress', () => {
	it('starts from the typing color and blends halfway by a second and a half', () => {
		expect(settled_at(0)[1]).toContain(mixed(COLORS.type, base_rgb(), 0))
		expect(settled_at(SETTLE_TICKS * HALF)[1]).toContain(mixed(COLORS.type, base_rgb(), HALF))
	})

	it('gives the base style back at three seconds, the characters kept', () => {
		const [, base] = cell_at(HOST.api.board, AT.y, AT.x)

		expect(SETTLE_TICKS).toBe(60)
		expect(settled_at(SETTLE_TICKS)).toStrictEqual(['x', base])
	})

	it('leaves a theme’s own drawing over the line', () => {
		const grid = board_copy()

		set_cell(grid, AT, ['T', 'red'])
		settle_progress({ grid, api: HOST.api, state: state_of(SETTLE_TICKS) }, COLORS)

		expect(cell_at(grid, AT.y, AT.x)).toStrictEqual(['T', 'red'])
	})
})
