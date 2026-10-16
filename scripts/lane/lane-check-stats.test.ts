import { describe, expect, it } from 'vitest'
import { lane_check_stats } from './lane-check-stats'
import type { GateCheckRecord, LedgerEntry } from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#3903: one ledger period reduces to a row per gate check — median, maximum, run
// count and reused count — where a reused check is counted but never timed.

const NOW = Date.parse('2026-10-10T12:00:00.000Z')
const AT = new Date(NOW).toISOString()
const WINDOW = lane_stats.window_of(1, NOW)
const LINT = 'lint'
const CHECK = 'exports'
const LINT_MS = [20_000, 40_000, 90_000]
const CHECK_MS = 30_000
const { NOT_MEASURED } = lane_stage_stats
const LEGACY_GATE = { kind: 'gate', at: AT, elapsed_ms: 1, is_passed: true } satisfies LedgerEntry

function gate(checks: ReadonlyArray<GateCheckRecord>): LedgerEntry {
	return { ...LEGACY_GATE, checks: [...checks] }
}

function check(label: string, elapsed_ms: number, is_reused = false): GateCheckRecord {
	return { label, elapsed_ms, is_passed: true, is_reused }
}

function rows_of(entries: ReadonlyArray<LedgerEntry>): Array<Array<string>> {
	const lines = lane_check_stats.table(entries, WINDOW).split('\n')

	return lines.map((line) => line.slice(2, -2).split(' | '))
}

// The cells of one check's row, without the check name.
function row_of(entries: ReadonlyArray<LedgerEntry>, label: string): Array<string> | undefined {
	return rows_of(entries)
		.find(([first]) => first === label)
		?.slice(1)
}

describe('lane_check_stats.table — the recorded checks', () => {
	it('reduces a check to its median, its maximum, its runs and its reuses, in seconds', () => {
		const entries = LINT_MS.map((elapsed_ms) => gate([check(LINT, elapsed_ms)]))

		expect(row_of(entries, LINT)).toStrictEqual(['40.0', '90.0', '3', '0'])
	})

	it('counts a reused check without letting its zero reach the timings', () => {
		const timed = check(LINT, CHECK_MS)
		const reused = check(LINT, 0, true)

		expect(row_of([gate([timed]), gate([reused])], LINT)).toStrictEqual(['30.0', '30.0', '2', '1'])
	})

	it('prints `not measured` for a check that was only ever reused', () => {
		const reused = check(CHECK, 0, true)
		const expected = [NOT_MEASURED, NOT_MEASURED, '1', '1']

		expect(row_of([gate([reused])], CHECK)).toStrictEqual(expected)
	})

	it('reads no row from a gate recorded before the checks were', () => {
		const rows = rows_of([LEGACY_GATE, gate([check(CHECK, CHECK_MS)])])

		expect(rows.slice(2).map(([label]) => label)).toStrictEqual([CHECK])
	})
})
