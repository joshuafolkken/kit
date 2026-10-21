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
const UNMOVED_MS = 900
const { NOT_MEASURED } = lane_stage_stats
const { WHOLE_GATE_LABEL } = lane_check_stats
const UNIT = 'test:unit'
const NO_MAP = 'no-map'
const WHOLE_SUITE = 'whole-suite-file'
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

		expect(row_of(entries, LINT)).toStrictEqual(['40.0', '90.0', '3', '0', '0', '0'])
	})

	it('counts a reused check without letting its zero reach the timings', () => {
		const timed = check(LINT, CHECK_MS)
		const reused = check(LINT, 0, true)

		expect(row_of([gate([timed]), gate([reused])], LINT)).toStrictEqual([
			'30.0',
			'30.0',
			'2',
			'1',
			'0',
			'0',
		])
	})

	it('prints `not measured` for a check that was only ever reused', () => {
		const reused = check(CHECK, 0, true)
		const expected = [NOT_MEASURED, NOT_MEASURED, '1', '1', '0', '0']

		expect(row_of([gate([reused])], CHECK)).toStrictEqual(expected)
	})

	it('reads no row from a gate recorded before the checks were', () => {
		const rows = rows_of([LEGACY_GATE, gate([check(CHECK, CHECK_MS)])])

		const check_rows = rows.slice(
			2,
			rows.findIndex((row) => row.length === 1),
		)

		expect(check_rows.map(([label]) => label)).toStrictEqual([WHOLE_GATE_LABEL, CHECK])
	})
})

// joshuafolkken/kit#4397: a whole-gate reuse and the unit leg's full-suite fallback are both read back.
describe('lane_check_stats.table — the whole gate and the fallbacks', () => {
	it('counts a reused whole gate as a run and a reuse, timing only the gates that ran', () => {
		const ran = { ...LEGACY_GATE, elapsed_ms: CHECK_MS }
		const reused = { ...LEGACY_GATE, is_reused: true }

		expect(row_of([ran, reused], WHOLE_GATE_LABEL)).toStrictEqual([
			'30.0',
			'30.0',
			'2',
			'1',
			'0',
			'0',
		])
	})

	it('counts the unit leg runs that fell back to the whole suite', () => {
		const fell_back = { ...check(UNIT, CHECK_MS), fallback: NO_MAP }
		const narrowed = check(UNIT, CHECK_MS)

		expect(row_of([gate([fell_back]), gate([narrowed])], UNIT)?.at(-1)).toBe('1')
	})

	it('breaks the fallbacks down by reason kind', () => {
		const entries = [NO_MAP, NO_MAP, WHOLE_SUITE].map((fallback) =>
			gate([{ ...check(UNIT, CHECK_MS), fallback }]),
		)

		expect(row_of(entries, NO_MAP)).toStrictEqual(['2'])
		expect(row_of(entries, WHOLE_SUITE)).toStrictEqual(['1'])
	})
})

// joshuafolkken/kit#4457: the unit leg's since-green no-op ran no test, so it is counted, never timed.
describe('lane_check_stats.table — the unit leg no-ops', () => {
	it('counts the no-ops without letting their seconds reach the timings', () => {
		const ran = check(UNIT, CHECK_MS)
		const unmoved: GateCheckRecord = { ...check(UNIT, UNMOVED_MS), is_unmoved: true }
		const entries = [gate([ran]), gate([unmoved]), gate([unmoved])]

		expect(row_of(entries, UNIT)).toStrictEqual(['30.0', '30.0', '3', '0', '2', '0'])
	})
})
