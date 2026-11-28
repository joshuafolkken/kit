import { describe, expect, it } from 'vitest'
import { lane_stats } from './lane-stats'
import { lane_stats_tables } from './lane-stats-tables'
import { lane_table_rows } from './lane-table-rows'

// joshuafolkken/kit#5144: the tables `lane:stats` prints are listed once, in print order, so
// `lane:value cell` addresses the same tables by their first header cell.

const NOW = Date.parse('2026-10-28T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const FIRST_HEADER_CELLS = [
	'active lanes',
	'filled limit',
	'stage',
	'ship step',
	'followup critical path',
	'implement sub-stage',
	'implement turn split',
	'implement read',
	'implement read by call',
	'stage turns',
	'stop',
	'human wait',
	'failed check',
	'longest stop',
	'stopped at',
	'gap',
	'cuts',
	'round 1',
	'round 2',
	'early push',
	'reason',
	'measured lanes',
	'implement-rate lanes',
	'held by',
	'held by cause (a hold with several causes counts in full under each)',
	'held behind (any cause; a hold naming several issues counts in full under each)',
	'dispatch wait',
	'model',
	'lane',
	'process',
	'check',
	'catch rate',
	'check',
	'test:related scope',
	'test:related whole-suite trigger',
	'lint:related stage',
	'transcript metric',
	'first request model',
	'recording command',
	'concurrent lanes',
]

function first_header_cell(table: string): string {
	return table.split('|', 2)[1]?.trim() ?? ''
}

describe('lane_stats_tables.tables_of', () => {
	it('lists every lane:stats table in print order', () => {
		const tables = lane_stats_tables.tables_of(
			{ entries: [], events: [], calls: [] },
			WINDOW,
			lane_table_rows.ALL_ROWS,
		)

		expect(tables.map((table) => first_header_cell(table))).toStrictEqual(FIRST_HEADER_CELLS)
	})
})
