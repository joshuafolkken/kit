import { describe, expect, it } from 'vitest'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import type { Cell, Grid, ThemeLayout } from './run-board-theme-host-types'
import { run_board_theme_rules } from './run-board-theme-rules'

// joshuafolkken/kit#8917: a theme finds the board's section rules by the cells' role, never the words.

const {
	is_rule_line,
	is_rule_row,
	label_x_of,
	lanes_rule_at,
	lanes_rule_of,
	retitled_lead,
	rule_rows_of,
} = run_board_theme_rules
const { HOST } = run_board_theme_host_fixture

function row_of(text: string, style: string): Array<Cell> {
	return [...text].map((ch): Cell => [ch, ch === '-' ? style : 'body'])
}

// A live board: an open THROUGHPUT rule, a body row that reads like one, a folded USAGE rule, a lane.
function live_board(): Grid {
	return [
		row_of('V -- throughput ------', 'rule'),
		row_of('a body row -- with dashes', 'body:dim'),
		row_of('> -- usage -- 3 --', 'rule:dim'),
		row_of('   8899 a lane', 'body'),
	]
}

describe('run_board_theme_rules rows', () => {
	it('takes a dash in the rule role for a rule line, a body dash not', () => {
		expect(is_rule_line(['-', 'rule'])).toBe(true)
		expect(is_rule_line(['─', 'rule:dim'])).toBe(true)
		expect(is_rule_line(['-', 'body:dim'])).toBe(false)
		expect(is_rule_line(['x', 'rule'])).toBe(false)
	})

	it('finds the open and the folded rules, not a row whose words have dashes', () => {
		const board = live_board()

		expect(is_rule_row(board, 1)).toBe(false)
		expect(is_rule_row(board, 9)).toBe(false)
		expect(rule_rows_of(board)).toStrictEqual([0, 2])
	})

	it('starts the label past the lead and the icon', () => {
		const demo = [row_of('-- -- throughput ---', 'rule')]

		expect(label_x_of(live_board(), 0)).toBe(5)
		expect(label_x_of(demo, 0)).toBe(6)
	})

	it('puts the base’s lead back in the rule’s style and returns the label’s column', () => {
		const board = live_board()
		const grid: Grid = board.map((row) => row.map((): Cell => [' ', 'body']))

		expect(retitled_lead(grid, board, { y: 0, style: 'hi' })).toBe(5)
		expect(grid[0]?.slice(0, 5).map(([ch]) => ch)).toStrictEqual([...'V -- '])
		expect(grid[0]?.slice(0, 5).every(([, style]) => style === 'hi')).toBe(true)
		expect(grid[0]?.[5]).toStrictEqual([' ', 'body'])
	})
})

describe('run_board_theme_rules.lanes_rule_of', () => {
	it('takes the plan’s keyed rule where it is a rule', () => {
		expect(lanes_rule_of([4, 13], 13, [14, 15])).toBe(13)
	})

	it('takes the last rule above the first lane where the plan row is not a rule', () => {
		expect(lanes_rule_of([4, 13, 20], 12, [14, 15])).toBe(13)
		expect(lanes_rule_of([4, 13], undefined, [14])).toBe(13)
	})

	it('finds none with neither a plan rule nor a lane', () => {
		expect(lanes_rule_of([4, 13], undefined, [])).toBeUndefined()
	})

	it('takes the layout’s own LANES rule, else finds it from the board', () => {
		const board = live_board()
		const laid: ThemeLayout = { ...HOST.layout, lanes_rule: 0, lane_rows: [3] }

		expect(lanes_rule_at(laid, board)).toBe(0)
		expect(lanes_rule_at({ ...laid, lanes_rule: undefined }, board)).toBe(2)
		expect(lanes_rule_at({ ...laid, lanes_rule: undefined, lane_rows: [] }, board)).toBeUndefined()
	})
})
