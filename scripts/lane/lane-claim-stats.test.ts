import { describe, expect, it } from 'vitest'
import { lane_claim_stats } from './lane-claim-stats'
import type { GateCheckRecord, LedgerEntry } from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#5138: one ledger period reduces to a row per gate check — the median cores it
// claimed against the cores it kept busy (median, 90th percentile, maximum) and the seconds it waited —
// counting only a run that was not reused and recorded its `cpu_ms`.

const NOW = Date.parse('2026-10-10T12:00:00.000Z')
const AT = new Date(NOW).toISOString()
const WINDOW = lane_stats.window_of(1, NOW)
const LINT = 'lint'
const UNIT = 'test:unit'
const ELAPSED_MS = 10_000
const { NOT_MEASURED } = lane_stage_stats
const LEGACY_GATE = { kind: 'gate', at: AT, elapsed_ms: 1, is_passed: true } satisfies LedgerEntry

interface Run {
	cpu_ms?: number
	requested?: number
	waited_ms?: number
	is_reused?: boolean
	elapsed_ms?: number
}

function gate(checks: ReadonlyArray<GateCheckRecord>): LedgerEntry {
	return { ...LEGACY_GATE, checks: [...checks] }
}

function check(label: string, run: Run): GateCheckRecord {
	const { cpu_ms, requested, waited_ms = 0, is_reused = false, elapsed_ms = ELAPSED_MS } = run
	const claim = requested === undefined ? undefined : { requested, granted: requested, waited_ms }

	return { label, elapsed_ms, is_passed: true, is_reused, cpu_ms, claim }
}

function rows_of(entries: ReadonlyArray<LedgerEntry>): Array<Array<string>> {
	const lines = lane_claim_stats.table(entries, WINDOW).split('\n')

	return lines.map((line) => line.slice(2, -2).split(' | '))
}

describe('lane_claim_stats.table', () => {
	it('reduces two gate rows to the claim, the cores median, p90 and maximum and the total wait', () => {
		const entries = [
			gate([
				check(LINT, { cpu_ms: 12_000, requested: 2, waited_ms: 1500 }),
				check(UNIT, { cpu_ms: 10_000, requested: 5, waited_ms: 4000 }),
			]),
			gate([
				check(LINT, { cpu_ms: 18_000, requested: 2, waited_ms: 500 }),
				check(UNIT, { cpu_ms: 50_000, requested: 3 }),
			]),
		]

		expect(rows_of(entries)).toStrictEqual([
			['check', 'claim', 'runs', 'cores median', 'cores p90', 'cores max', 'wait (s)'],
			['---', '---', '---', '---', '---', '---', '---'],
			[LINT, '2.0', '2', '1.5', '1.8', '1.8', '2.0'],
			[UNIT, '4.0', '2', '3.0', '5.0', '5.0', '4.0'],
		])
	})
})

describe('lane_claim_stats.table on the runs it leaves out', () => {
	it('leaves a reused check and a check with no cpu_ms out of every column', () => {
		const entries = [
			gate([
				check(LINT, { cpu_ms: 12_000, requested: 2, waited_ms: 1000 }),
				check(LINT, { cpu_ms: 40_000, requested: 8, waited_ms: 9000, is_reused: true }),
				check(LINT, { requested: 8, waited_ms: 9000 }),
				check(UNIT, { requested: 5, waited_ms: 9000 }),
			]),
		]

		expect(rows_of(entries).slice(2)).toStrictEqual([
			[LINT, '2.0', '1', '1.2', '1.2', '1.2', '1.0'],
		])
	})

	it('leaves a zero-second check out, since it has no cores to divide into', () => {
		const entries = [gate([check(LINT, { cpu_ms: 0, requested: 2, elapsed_ms: 0 })])]

		expect(rows_of(entries).slice(2)).toStrictEqual([])
	})

	it('prints a not-measured claim for a measured check that carried no claim', () => {
		const entries = [gate([check(LINT, { cpu_ms: 10_000 })])]

		expect(rows_of(entries).slice(2)).toStrictEqual([
			[LINT, NOT_MEASURED, '1', '1.0', '1.0', '1.0', NOT_MEASURED],
		])
	})
})

describe('lane_claim_stats.table over ten runs', () => {
	it('takes the nearest-rank 90th percentile, below the maximum', () => {
		const cores = [1, 1, 1, 1, 1, 2, 2, 2, 3, 4]
		const runs = cores.map((core) => check(UNIT, { cpu_ms: core * ELAPSED_MS, requested: 5 }))

		expect(rows_of([gate(runs)]).slice(2)).toStrictEqual([
			[UNIT, '5.0', '10', '1.5', '3.0', '4.0', '0.0'],
		])
	})
})
