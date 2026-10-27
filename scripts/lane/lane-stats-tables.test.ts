import { describe, expect, it } from 'vitest'
import { lane_stats } from './lane-stats'
import { lane_stats_tables } from './lane-stats-tables'

// joshuafolkken/kit#5144: the tables `lane:stats` prints are listed once, in print order, so
// `lane:value cell` addresses the same tables by their first header cell.

const NOW = Date.parse('2026-10-28T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const FIRST_HEADER_CELLS = [
	'stage',
	'implement sub-stage',
	'stop',
	'gap',
	'round 1',
	'round 2',
	'noticed lanes',
	'held by',
	'lane',
	'process',
	'check',
	'check',
	'test:related scope',
	'test:related whole-suite trigger',
	'transcript metric',
]

function first_header_cell(table: string): string {
	return table.split('|', 2)[1]?.trim() ?? ''
}

describe('lane_stats_tables.tables_of', () => {
	it('lists every lane:stats table in print order', () => {
		const tables = lane_stats_tables.tables_of({ entries: [], events: [], calls: [] }, WINDOW)

		expect(tables.map((table) => first_header_cell(table))).toStrictEqual(FIRST_HEADER_CELLS)
	})
})
