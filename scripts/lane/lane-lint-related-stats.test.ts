import { describe, expect, it } from 'vitest'
import type { LedgerEntry, LintRelatedRecord } from './lane-ledger'
import { lane_lint_related_stats } from './lane-lint-related-stats'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats } from './lane-stats'
import { lane_value_cell } from './lane-value-cell'

// joshuafolkken/kit#7827: one ledger period reduces to a row per `josh lint:related` stage — how many
// runs timed it and their median — read back one cell at a time by `josh lane:value cell`.

const NOW = Date.parse('2026-11-18T12:00:00.000Z')
const AT = new Date(NOW).toISOString()
const OUTSIDE = '2026-11-15T12:00:00.000Z'
const WINDOW = lane_stats.window_of(1, NOW)
const TABLE = 'lint:related stage'
const MEDIAN = 'median (s)'
const UNUSED_MEMBERS = 'unused members'

const GREEN: LintRelatedRecord = {
	fix_ms: 1000,
	structural_ms: 3000,
	lint_ms: 2000,
	documents_ms: 100,
	unused_members_ms: 4000,
	elapsed_ms: 10_000,
	exit_code: 0,
}

const RED: LintRelatedRecord = { fix_ms: 3000, lint_ms: 4000, elapsed_ms: 8000, exit_code: 1 }

function run(record: LintRelatedRecord, at = AT): LedgerEntry {
	return { kind: 'lint-related', at, ...record }
}

function cell(
	entries: ReadonlyArray<LedgerEntry>,
	row: string,
	column = MEDIAN,
): number | undefined {
	const table = lane_lint_related_stats.table(entries, WINDOW)

	return lane_value_cell.value([table], { table: TABLE, row, column })
}

describe('lane_lint_related_stats.table — one row per lint:related stage', () => {
	it('reads the median of each stage over the runs that timed it', () => {
		const entries = [run(GREEN), run(RED)]

		expect(cell(entries, 'lint')).toBe(3)
		expect(cell(entries, 'fix')).toBe(2)
		expect(cell(entries, UNUSED_MEMBERS)).toBe(4)
		expect(cell(entries, UNUSED_MEMBERS, 'runs')).toBe(1)
		expect(cell(entries, 'whole run')).toBe(9)
	})

	it('marks a stage no run in the period timed as not measured', () => {
		const table = lane_lint_related_stats.table([run(GREEN), run(RED, OUTSIDE)], WINDOW)

		expect(table).toContain(lane_stats.to_row(['rebuild', '0', lane_stage_stats.NOT_MEASURED]))
		expect(cell([run(GREEN), run(RED, OUTSIDE)], 'whole run', 'runs')).toBe(1)
	})
})
