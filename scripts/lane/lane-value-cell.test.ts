import { describe, expect, it } from 'vitest'
import { lane_value_cell } from './lane-value-cell'

// joshuafolkken/kit#5144: one `lane:stats` table cell read as one number by its table title, row and
// column — `undefined` for an address that names no cell, a non-number or more than one cell.

const SCOPE = 'test:related scope'
const MEDIAN = 'median (s)'
const RELATED = 'related'
const DIVIDER = '| --- | --- | --- |'
const TEST_RELATED = [
	`| ${SCOPE} | runs | ${MEDIAN} |`,
	DIVIDER,
	`| ${RELATED} | 1229 | 38.8 |`,
	'| none | 445 | not measured |',
].join('\n')
const CHECK = [
	`| check | ${MEDIAN} | runs |`,
	DIVIDER,
	'| lint | 13.6 | 430 |',
	'',
	'| fallback reason | runs |',
	'| --- | --- |',
	'| stale | 3 |',
].join('\n')
const CLAIM = ['| check | claim | runs |', DIVIDER, '| lint | 2.0 | 428 |'].join('\n')
const TABLES = [TEST_RELATED, CHECK, CLAIM]

describe('lane_value_cell.value', () => {
	it('reads the addressed cell as a number', () => {
		const address = { table: SCOPE, row: RELATED, column: MEDIAN }

		expect(lane_value_cell.value(TABLES, address)).toBe(38.8)
	})

	it('reads a table printed after another in the same block of text', () => {
		const address = { table: 'fallback reason', row: 'stale', column: 'runs' }

		expect(lane_value_cell.value(TABLES, address)).toBe(3)
	})

	it('tells two tables of one title apart by the column only one has', () => {
		const address = { table: 'check', row: 'lint', column: 'claim' }

		expect(lane_value_cell.value(TABLES, address)).toBe(2)
	})

	it.each([
		['no such table', { table: 'stage', row: RELATED, column: 'runs' }],
		['no such row', { table: SCOPE, row: 'touched', column: 'runs' }],
		['no such column', { table: SCOPE, row: RELATED, column: 'max (s)' }],
		['the row label column', { table: SCOPE, row: RELATED, column: SCOPE }],
		['a non-numeric cell', { table: SCOPE, row: 'none', column: MEDIAN }],
		['a cell two tables share', { table: 'check', row: 'lint', column: 'runs' }],
	])('answers undefined for %s', (_case, address) => {
		expect(lane_value_cell.value(TABLES, address)).toBeUndefined()
	})
})
