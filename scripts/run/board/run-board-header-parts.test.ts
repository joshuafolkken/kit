import { describe, expect, it } from 'vitest'
import { run_board_header_parts } from './run-board-header-parts'
import { run_board_row_key } from './run-board-row-key'

// joshuafolkken/kit#8457: the header's progress line keyed where the board types rows.

const { keyed_progress, plan_key } = run_board_header_parts
const PROGRESS = 'OK 0/35  HD 34'

describe('run_board_header_parts', () => {
	it('leads the progress line with its key where the board types rows', () => {
		const split = run_board_row_key.split_key(keyed_progress({ is_keyed: true }, PROGRESS))

		expect(split).toStrictEqual({ key: plan_key({ is_keyed: true }), text: PROGRESS, prefix: '' })
	})

	it('keys nothing where the board types no rows', () => {
		expect(keyed_progress({ is_keyed: undefined }, PROGRESS)).toBe(PROGRESS)
		expect(plan_key({ is_keyed: false })).toBeUndefined()
	})
})
