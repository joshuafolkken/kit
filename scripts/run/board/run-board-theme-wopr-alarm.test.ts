import { describe, expect, it } from 'vitest'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Cell, Grid } from './run-board-theme-host-types'
import { run_board_theme_wopr_alarm } from './run-board-theme-wopr-alarm'
import { run_board_theme_wopr_data } from './run-board-theme-wopr-data'
import { run_board_theme_wopr_fixture } from './run-board-theme-wopr-fixture'

// joshuafolkken/kit#9137: the WARGAMES alarm — the red beacon turning along the header's first row, and
// its pink light crossing the screen on its first turns.

const { HOST, WOPR, board_grid, cell_of, state_at } = run_board_theme_wopr_fixture
const { ALARM, beacon_bar, beacon_light, turn_share } = run_board_theme_wopr_alarm
const { BEACON, BEACON_PINK, GROUND } = run_board_theme_wopr_data
const { bg, fg } = run_board_theme_host_grid
const { head_top, w: WIDTH } = HOST.layout
// The tick the demo's NOTICE starts on, and the pink band's width.
const NOTICE_START = state_at('n', ALARM.from).notice.start
const BAND = 6
const BEACON_ROW = 0
const HALF_TURN = ALARM.turn / 2
const OWN_GROUND = `${fg('200;220;255')}${bg('6;12;38')}`
const UNWASHED = fg('65;234;255')

// The tick `alarm_age` ticks into the alarm of the demo's NOTICE.
function tick_of(alarm_age: number): number {
	return NOTICE_START + ALARM.from + alarm_age
}

// The beacon row's styles across the header's top `alarm_age` ticks into the alarm.
function bar_at(alarm_age: number): Array<string> {
	const grid = board_grid()
	const tick = tick_of(alarm_age)

	beacon_bar(WOPR, grid, state_at('n', tick), tick)

	return (grid[BEACON_ROW] ?? [])
		.slice(head_top.x, head_top.x + head_top.w)
		.map(([, style]) => style)
}

// One row of letters the screen wide, `cells` set on it, lit `alarm_age` ticks in.
function lit_row(
	alarm_age: number,
	cells: ReadonlyArray<[x: number, cell: Cell]> = [],
): Array<Cell> {
	const grid: Grid = [Array.from({ length: WIDTH }, (): Cell => ['x', UNWASHED])]
	const tick = tick_of(alarm_age)

	for (const [x, cell] of cells) run_board_theme_host_grid.set_cell(grid, { y: 0, x }, cell)
	beacon_light(WOPR, grid, state_at('n', tick), tick)

	return grid[0] ?? []
}

// The columns the pink light paints `alarm_age` ticks in.
function pink_at(alarm_age: number): Array<number> {
	const row = lit_row(alarm_age)

	return [...row.keys()].filter((x) => row[x]?.[1] === BEACON_PINK)
}

describe('run_board_theme_wopr_alarm.ALARM', () => {
	it('sounds from the wars’ start to the ending, turning each second, crossing thrice', () => {
		expect(ALARM).toStrictEqual({ from: 83, ticks: 143, turn: 20, on: 12, crossings: 3 })
	})
})

describe('run_board_theme_wopr_alarm.turn_share', () => {
	it('runs from 0 to 1 over a turn and comes round again', () => {
		expect(
			[0, 5, HALF_TURN, 15, ALARM.turn, ALARM.turn + 5].map((age) => turn_share(age)),
		).toStrictEqual([0, 0.25, 0.5, 0.75, 0, 0.25])
	})

	it('counts back through the turn before the alarm starts', () => {
		expect(turn_share(-5)).toBe(0.75)
	})
})

describe('run_board_theme_wopr_alarm.beacon_bar', () => {
	it('draws a lamp a cell across the header’s top on the first row', () => {
		const grid = board_grid()
		const base = board_grid()
		const tick = tick_of(0)

		beacon_bar(WOPR, grid, state_at('n', tick), tick)
		const row = grid[BEACON_ROW] ?? []
		const lamps = row.slice(head_top.x, head_top.x + head_top.w).map(([ch]) => ch)
		const after = head_top.x + head_top.w

		expect(lamps).toStrictEqual(Array.from({ length: head_top.w }, () => '▄'))
		expect(cell_of(grid, { y: BEACON_ROW, x: head_top.x - 1 })).toStrictEqual(
			base[0]?.[head_top.x - 1],
		)
		expect(cell_of(grid, { y: BEACON_ROW, x: after })).toStrictEqual(base[0]?.[after])
	})

	it('shades the lobe from its centre at the alarm’s start, out past six cells', () => {
		const [core, glow, edge, out] = BEACON

		expect(bar_at(0).slice(0, 8)).toStrictEqual([core, core, glow, glow, edge, edge, edge, out])
	})

	it('wraps the lobe round the bar’s ends', () => {
		expect(bar_at(0).at(-1)).toBe(BEACON[0])
		expect(bar_at(0).at(-2)).toBe(BEACON[1])
	})

	it('moves the lobe halfway along in half a turn and back to the start in a turn', () => {
		const centre = Math.round(head_top.w / 2)

		expect(bar_at(HALF_TURN)[centre]).toBe(BEACON[0])
		expect(bar_at(HALF_TURN)[0]).toBe(BEACON.at(-1))
		expect(bar_at(ALARM.turn)).toStrictEqual(bar_at(0))
	})
})

describe('run_board_theme_wopr_alarm.beacon_light', () => {
	it('paints a band six cells wide in pink, halfway across in half a turn', () => {
		const head = Math.floor((WIDTH + BAND) / 2)

		expect(pink_at(HALF_TURN)).toStrictEqual(
			Array.from({ length: BAND }, (_, index) => head - BAND + 1 + index),
		)
	})

	it('crosses once a turn on the first three turns only', () => {
		const ticks = ALARM.crossings * ALARM.turn

		expect(pink_at(-1)).toStrictEqual([])
		expect(pink_at(0)).toStrictEqual([0])
		expect(pink_at(ticks - 1)).toHaveLength(BAND)
		expect(pink_at(ticks)).toStrictEqual([])
		expect(pink_at(5 + ALARM.turn)).toStrictEqual(pink_at(5))
		expect(pink_at(5 + 2 * ALARM.turn)).toStrictEqual(pink_at(5))
	})

	it('leaves blanks and cells with their own ground, and paints one on the screen’s', () => {
		const head = Math.floor((WIDTH + BAND) / 2)
		const row = lit_row(HALF_TURN, [
			[head, ['o', OWN_GROUND]],
			[head - 1, [' ', UNWASHED]],
			[head - 2, ['g', UNWASHED]],
		])

		expect(row[head]).toStrictEqual(['o', OWN_GROUND])
		expect(row[head - 1]).toStrictEqual([' ', UNWASHED])
		expect(row[head - 2]).toStrictEqual(['g', BEACON_PINK])
		expect(UNWASHED).not.toContain(GROUND)
	})
})
