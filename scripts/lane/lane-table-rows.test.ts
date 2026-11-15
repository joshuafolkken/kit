import { describe, expect, it } from 'vitest'
import { lane_table_rows } from './lane-table-rows'

// joshuafolkken/kit#7578: a per-lane table keeps its first rows by default and names how many it left
// out, so `josh lane:stats` stays inside a session's output cap.

const CAP = 2
const ROWS = ['| a |', '| b |', '| c |', '| d |']

describe('lane_table_rows.capped', () => {
	it('keeps the first rows in order and counts the rest past the cap', () => {
		expect(lane_table_rows.capped(ROWS, CAP, { is_all: false })).toStrictEqual([
			'| a |',
			'| b |',
			'',
			'… 2 more rows omitted — `--all` prints every row',
		])
	})

	it('keeps every row with no note at or under the cap', () => {
		expect(lane_table_rows.capped(ROWS.slice(0, CAP), CAP, { is_all: false })).toStrictEqual([
			'| a |',
			'| b |',
		])
	})

	it('keeps every row with --all', () => {
		expect(lane_table_rows.capped(ROWS, CAP, lane_table_rows.ALL_ROWS)).toStrictEqual(ROWS)
	})
})
