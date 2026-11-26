import { describe, expect, it } from 'vitest'
import type { Breakdown } from './lane-breakdown'
import { lane_implement_split } from './lane-implement-split'
import { lane_ledger, type LedgerEntry } from './lane-ledger'

const { KIND } = lane_ledger
const { SEGMENT } = lane_implement_split
const ISSUE = 8998
const OTHER_ISSUE = 8969
const MINUTE_MS = 60_000
const START_MS = Date.parse('2026-11-26T09:00:00.000Z')
const IMPLEMENT_END = 60
const WAIT_FROM = 50
const WAIT_TO = 55

function at(minute: number): string {
	return new Date(START_MS + minute * MINUTE_MS).toISOString()
}

function span(from: number, to: number): { from_ms: number; to_ms: number } {
	return { from_ms: START_MS + from * MINUTE_MS, to_ms: START_MS + to * MINUTE_MS }
}

function breakdown_of(): Breakdown {
	return {
		stages: [],
		excluded_ms: 0,
		slept_ms: 0,
		yield_ms: 0,
		waits: [span(WAIT_FROM, WAIT_TO)],
		implement: [span(0, IMPLEMENT_END)],
		pre_detach: [],
		ship: [],
	}
}

function stage(name: string, from: number, to: number, issue = ISSUE): LedgerEntry {
	const elapsed_ms = (to - from) * MINUTE_MS

	return { kind: KIND.CHAIN_STAGE, issue, result: 'passed', name, at: at(to), elapsed_ms }
}

function core_wait(from: number, to: number, issue = ISSUE): LedgerEntry {
	const waited_ms = (to - from) * MINUTE_MS

	return { kind: KIND.CORE_WAIT, at: at(to), command: 'test:related', waited_ms, issue }
}

function pinned(from: number, to: number, discarded = false): LedgerEntry {
	const elapsed_ms = (to - from) * MINUTE_MS

	return {
		kind: KIND.TEST_PINNED,
		at: at(to),
		issue: ISSUE,
		held: 0,
		probes: [],
		elapsed_ms,
		discarded,
	}
}

const ENTRIES: ReadonlyArray<LedgerEntry> = [
	pinned(8, 20),
	pinned(0, 30, true),
	stage('recheck', 10, 20),
	stage('check:related', 20, 24),
	core_wait(21, 23),
	core_wait(0, 40, OTHER_ISSUE),
	stage('run:review', 30, 33),
	stage('a-new-stage', 40, 41),
	stage('ship', 56, 59),
]

function minutes_of(entries: ReadonlyArray<LedgerEntry>): Array<[string, number]> | undefined {
	const split = lane_implement_split.of(ISSUE, breakdown_of(), entries)

	return split?.map((part) => [part.name, part.ms / MINUTE_MS])
}

describe('lane_implement_split.of', () => {
	it('splits the net implementation by segment, each overlapped minute counted once', () => {
		expect(minutes_of(ENTRIES)).toStrictEqual([
			[SEGMENT.EDIT, 35],
			[SEGMENT.CORE, 2],
			[SEGMENT.PINNED, 12],
			[SEGMENT.REVIEW, 3],
			[SEGMENT.GATE, 2],
			[SEGMENT.OTHER, 1],
		])
	})

	it('sums to the implementation net of its waits', () => {
		const total = (minutes_of(ENTRIES) ?? []).reduce((sum, [, minutes]) => sum + minutes, 0)

		expect(total).toBe(IMPLEMENT_END - (WAIT_TO - WAIT_FROM))
	})

	it('maps the review stages to the review wait and an unknown stage to the other stages', () => {
		const split = minutes_of([stage('review:attest', 1, 2), stage('unlisted', 3, 5)])

		expect(split?.slice(1)).toStrictEqual([
			[SEGMENT.CORE, 0],
			[SEGMENT.PINNED, 0],
			[SEGMENT.REVIEW, 1],
			[SEGMENT.GATE, 0],
			[SEGMENT.OTHER, 2],
		])
	})

	it('is unknown when the ledger holds no row of the issue', () => {
		expect(minutes_of([core_wait(1, 2, OTHER_ISSUE)])).toBeUndefined()
	})

	it('prints the order lane:breakdown names them in', () => {
		expect(lane_implement_split.PRINTED[0]).toBe(SEGMENT.EDIT)
	})
})

describe('lane_implement_split.lines_of', () => {
	it('prints one line a segment in minutes', () => {
		const lines = lane_implement_split.lines_of(ISSUE, breakdown_of(), ENTRIES)

		expect(lines[0]).toBe(`split › ${SEGMENT.EDIT} 35.0 min`)
		expect(lines).toHaveLength(lane_implement_split.PRINTED.length)
	})

	it('prints nothing for an unknown split', () => {
		expect(lane_implement_split.lines_of(ISSUE, breakdown_of(), [])).toStrictEqual([])
	})
})

describe('lane_implement_split.has_rows', () => {
	it('holds only where the ledger has a split row of the issue', () => {
		expect(lane_implement_split.has_rows(ISSUE, ENTRIES)).toBe(true)
		expect(lane_implement_split.has_rows(ISSUE, [core_wait(1, 2, OTHER_ISSUE)])).toBe(false)
	})
})
