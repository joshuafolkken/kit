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

// joshuafolkken/kit#6503: an address matching several numeric cells is told apart from one matching none.
describe('lane_value_cell.is_several', () => {
	it('answers true for an address two tables of one title both hold', () => {
		expect(
			lane_value_cell.is_several(TABLES, { table: 'check', row: 'lint', column: 'runs' }),
		).toBe(true)
	})

	it('answers false for an address matching no cell', () => {
		expect(
			lane_value_cell.is_several(TABLES, { table: SCOPE, row: 'touched', column: 'runs' }),
		).toBe(false)
	})
})

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

// joshuafolkken/kit#5947: the cost epic's follow-up measurements — a row whose first cell repeats, a
// table whose first cell is a count, and one count out of a `label N, label N` list cell.
const ROUND_TWO = [
	'| round 2 | code | decisions |',
	DIVIDER,
	'| required | live | 12 |',
	'| required | stale | 4 |',
	'| skipped | live | 2 |',
].join('\n')
const STOP = [
	'| stop | runs | causes |',
	DIVIDER,
	'| preflight | 120 | unpinned 83, pre-detach 37 |',
	'| review | 0 | - |',
	'| merge | 5 | timed out |',
].join('\n')
const LANES = 'measured lanes'
const SIZE = [
	`| ${LANES} | files actual / declared median | lines |`,
	DIVIDER,
	'| 210 | 1.10 | 0.90 |',
].join('\n')
const MEASURED = [ROUND_TWO, STOP, SIZE]
const LIVE = { column: 'code', text: 'live' }
const CAUSES = { table: 'stop', column: 'causes' }
const REQUIRED = { table: 'round 2', row: 'required', column: 'decisions' }

describe('lane_value_cell.value — where and item', () => {
	it.each([
		['a row --where narrows', { ...REQUIRED, where: LIVE }, 12],
		['the first column with no row named', { table: LANES, column: LANES }, 210],
		['an item of a list cell', { ...CAUSES, row: 'preflight', item: 'pre-detach' }, 37],
		['an item a list omits as 0', { ...CAUSES, row: 'preflight', item: 'stale' }, 0],
		['an item of an empty list as 0', { ...CAUSES, row: 'review', item: 'unpinned' }, 0],
		[
			'a row --zero finds missing as 0',
			{ ...REQUIRED, where: { ...LIVE, text: 'gone' }, zero: true },
			0,
		],
		['a row --zero finds as its cell', { ...REQUIRED, where: LIVE, zero: true }, 12],
	])('reads %s', (_case, address, expected) => {
		expect(lane_value_cell.value(MEASURED, address)).toBe(expected)
	})

	it.each([
		['a row that still repeats', REQUIRED],
		['a --where column no table has', { ...REQUIRED, where: { column: 'gate', text: 'live' } }],
		['an item of a cell that is no list', { ...CAUSES, row: 'merge', item: 'timed out' }],
		['--zero on a table no title names', { ...REQUIRED, table: 'round 3', zero: true }],
		['--zero on a row of a non-number', { ...CAUSES, row: 'merge', zero: true }],
		[
			'--zero on a --where column no table has',
			{ ...REQUIRED, where: { ...LIVE, column: 'cod' }, zero: true },
		],
	])('answers undefined for an address of %s', (_case, address) => {
		expect(lane_value_cell.value(MEASURED, address)).toBeUndefined()
	})
})
