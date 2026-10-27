import { describe, expect, it } from 'vitest'
import type { Breakdown } from './lane-breakdown'
import { lane_breakdown_pinned } from './lane-breakdown-pinned'
import type { LedgerEntry, TestPinnedEntry } from './lane-ledger'

const ISSUE = 5078
const OTHER_ISSUE = 5052
const FROM = '2026-10-27T01:00:00.000Z'
const INSIDE = '2026-10-27T01:05:00.000Z'
const AFTER = '2026-10-27T01:20:00.000Z'
const TO = '2026-10-27T01:10:00.000Z'
const RAN_MS = 60_000

const BREAKDOWN: Breakdown = {
	stages: [],
	excluded_ms: 0,
	slept_ms: 0,
	yield_ms: 0,
	waits: [],
	implement: [],
	pre_detach: [{ from_ms: Date.parse(FROM), to_ms: Date.parse(TO) }],
}

function row(at: string, issue: number | undefined = ISSUE): TestPinnedEntry {
	return {
		kind: 'test-pinned',
		at,
		issue,
		held: 2,
		probes: [
			{ file: 'scripts/a.ts', tests: 3, elapsed_ms: 60_000 },
			{ file: 'scripts/b.ts', elapsed_ms: 120_000 },
		],
		elapsed_ms: 180_000,
	}
}

function discarded(at: string, elapsed_ms: number): TestPinnedEntry {
	return { ...row(at), held: 0, probes: [], elapsed_ms, origin: 'run-review', discarded: true }
}

describe('lane_breakdown_pinned.rows_of', () => {
	it("keeps the lane's test-pinned rows written inside its ship pre-detach stage only", () => {
		const inside = row(INSIDE)
		const entries: Array<LedgerEntry> = [
			inside,
			row(AFTER),
			row(INSIDE, OTHER_ISSUE),
			{ ...row(INSIDE), issue: undefined },
			{ kind: 'merge', at: INSIDE, issue: ISSUE },
			discarded(INSIDE, RAN_MS),
		]

		expect(lane_breakdown_pinned.rows_of(entries, ISSUE, BREAKDOWN)).toEqual([inside])
	})
})

// joshuafolkken/kit#5262: the run:review background probes stopped before their answer.
describe('lane_breakdown_pinned.discarded_text', () => {
	it("counts the lane's discarded rows and sums their wall time", () => {
		const entries: Array<LedgerEntry> = [
			row(INSIDE),
			discarded(FROM, RAN_MS),
			discarded(AFTER, RAN_MS * 2),
			{ ...discarded(AFTER, RAN_MS), issue: OTHER_ISSUE },
		]

		expect(lane_breakdown_pinned.discarded_text(entries, ISSUE)).toBe(
			'run:review background test:pinned probes discarded 2, 3.0 min',
		)
	})

	it('is empty when none was discarded', () => {
		expect(lane_breakdown_pinned.discarded_text([row(INSIDE)], ISSUE)).toBe('')
	})
})

describe('lane_breakdown_pinned.detail_text', () => {
	it('counts the cached and probed hunks and names the probes longest first', () => {
		expect(lane_breakdown_pinned.detail_text([row(INSIDE)])).toBe(
			' (test:pinned 4 hunks, 2 cached, 2 probed, scripts/b.ts 2.0 min, scripts/a.ts 3 test files 1.0 min)',
		)
	})

	it('counts the rewired hunks the run did not probe', () => {
		expect(lane_breakdown_pinned.detail_text([{ ...row(INSIDE), rewired: 6 }])).toBe(
			' (test:pinned 10 hunks, 2 cached, 2 probed, 6 rewired, scripts/b.ts 2.0 min, scripts/a.ts 3 test files 1.0 min)',
		)
	})

	it('is empty when no probe ran inside the stage', () => {
		expect(lane_breakdown_pinned.detail_text([])).toBe('')
	})
})
