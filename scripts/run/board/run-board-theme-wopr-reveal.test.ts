import { describe, expect, it } from 'vitest'
import type { Grid } from './run-board-theme-host-types'
import { run_board_theme_wopr_reveal } from './run-board-theme-wopr-reveal'

const { block_ends, revealed_to } = run_board_theme_wopr_reveal

function grid_of(text: string): Grid {
	return [Array.from(text, (ch): [string, string] => [ch, 'body'])]
}

describe('run_board_theme_wopr_reveal.block_ends', () => {
	it('keeps words one blank apart in one block and cuts at two blanks', () => {
		expect(block_ends('ab cd  ef', false)).toStrictEqual([5, 9])
	})

	it('gives a rule row’s dashes, its title and the rest of its dashes their own blocks', () => {
		expect(block_ends('-- USAGE ------', true)).toStrictEqual([2, 15])
		expect(block_ends('-- USAGE  ------', true)).toStrictEqual([2, 8, 16])
	})

	it('ends a block at a gauge', () => {
		expect(block_ends('■■ ab', false)).toStrictEqual([2, 5])
	})

	it('has no block on an empty line', () => {
		expect(block_ends(' '.repeat(3), false)).toStrictEqual([])
	})
})

describe('run_board_theme_wopr_reveal.revealed_to', () => {
	const screen = { w: 20, line_ms: 75 }

	it('shows nothing of a row before its beat, then a block at a time', () => {
		const grid = grid_of('ab  cd')

		expect(revealed_to(grid, 0, -1, screen)).toBe(0)
		expect(revealed_to(grid, 0, 0, screen)).toBe(2)
		expect(revealed_to(grid, 0, 40, screen)).toBe(20)
	})
})
