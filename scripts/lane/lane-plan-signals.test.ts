import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_plan_signals } from './lane-plan-signals'

// joshuafolkken/kit#5568: what `lane:plan` measures beside the plan — the tree's hunks, tests excluded,
// the period's lines ratio, and whether the lane filed a split child.

const ISSUE = 5568
const NOW = Date.parse('2026-10-31T12:00:00.000Z')
const RECENT = '2026-10-31T10:00:00.000Z'
const MERGED = '2026-10-31T11:00:00.000Z'

function file_diff(file: string, starts: ReadonlyArray<number>): Array<string> {
	const hunks = starts.flatMap((start) => [
		`@@ -${String(start)} +${String(start)} @@`,
		'-old',
		'+new',
	])

	return [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, ...hunks]
}

const SOURCE = 'scripts/lane/one.ts'
const DIFF = [...file_diff(SOURCE, [1, 9]), ...file_diff('scripts/lane/one.test.ts', [1])].join(
	'\n',
)

function sized(issue: number, declared_lines: number, actual_lines: number): Array<LedgerEntry> {
	return [
		{
			kind: 'size',
			at: RECENT,
			issue,
			declared: { files: 4, lines: declared_lines },
			actual: { files: 4, lines: actual_lines },
		},
		{ kind: 'merge', at: MERGED, issue },
	]
}

describe('lane_plan_signals.hunk_files', () => {
	it('names the file of each hunk a declaration counts, not of the tests', () => {
		expect(lane_plan_signals.hunk_files(DIFF)).toStrictEqual([SOURCE, SOURCE])
	})

	it('names none on an empty diff', () => {
		expect(lane_plan_signals.hunk_files('')).toStrictEqual([])
	})
})

describe('lane_plan_signals.signals_from', () => {
	it('reads the period lines ratio and no split child off a ledger of merged sizes', () => {
		const entries = [...sized(1, 100, 150), ...sized(2, 100, 250)]

		expect(lane_plan_signals.signals_from(ISSUE, ['a.ts'], entries, NOW)).toStrictEqual({
			hunk_files: ['a.ts'],
			lines_ratio: 2,
			split_filed: false,
		})
	})

	it('answers no ratio on an empty ledger, and a split child the lane filed', () => {
		const filed: LedgerEntry = { kind: 'split-filed', at: RECENT, issue: ISSUE, child: '#9' }

		expect(lane_plan_signals.signals_from(ISSUE, [], [filed], NOW)).toStrictEqual({
			hunk_files: [],
			lines_ratio: undefined,
			split_filed: true,
		})
	})
})
