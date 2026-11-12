import { describe, expect, it } from 'vitest'
import { lane_breakdown, type Breakdown } from './lane-breakdown'
import { lane_breakdown_laps } from './lane-breakdown-laps'
import type { LedgerEntry } from './lane-ledger'

// joshuafolkken/kit#5831: the laps `run:entry` writes for its children split the start to plan; its
// waits stay the ship's, so a lane without entry laps prints its start to plan as before.

const MINUTE_MS = 60_000
const ISSUE = 5831
const PREP_STEP = 'run:entry › run:prep'
const HOLD_STEP = 'run:entry › run:hold'

const BREAKDOWN: Breakdown = {
	stages: [],
	excluded_ms: 0,
	slept_ms: 0,
	yield_ms: 0,
	waits: [],
	plan: [{ from_ms: 0, to_ms: 5 * MINUTE_MS }],
	implement: [],
	pre_detach: [],
	ship: [{ stage: 'ship gate', from_ms: 10 * MINUTE_MS, to_ms: 16 * MINUTE_MS }],
}

function at(minute: number): string {
	return new Date(minute * MINUTE_MS).toISOString()
}

function lap(step: string, minutes: number, ended: number): LedgerEntry {
	return {
		kind: 'ship-lap',
		at: at(ended),
		issue: ISSUE,
		stage: 'run:entry',
		step,
		elapsed_ms: minutes * MINUTE_MS,
	}
}

function core_wait(minutes: number, ended: number): LedgerEntry {
	return {
		kind: 'core-wait',
		at: at(ended),
		command: 'gate',
		waited_ms: minutes * MINUTE_MS,
		issue: ISSUE,
	}
}

function minutes_of(
	entries: ReadonlyArray<LedgerEntry>,
	breakdown = BREAKDOWN,
): Array<[string, Array<readonly [string, number]>]> {
	return [...lane_breakdown_laps.of(entries, ISSUE, breakdown, [])].map(([stage, parts]) => [
		stage,
		parts.map((part) => [part.name, part.ms / MINUTE_MS] as const),
	])
}

describe('lane_breakdown_laps.of — the start to plan', () => {
	it.each([7, 12])('keeps a background sweep ending at minute %s under entry', (ended) => {
		const sweep = `${HOLD_STEP} › sweep`

		expect(minutes_of([lap(sweep, 1, ended)])).toEqual([[lane_breakdown.PLAN_STAGE, [[sweep, 1]]]])
	})
	it('shows the hold stages as separate entry rows (ac-3f4fdc3c)', () => {
		const stages = ['preflight', 'take_tree', 'sweep']
		const entries = stages.map((stage) => lap(`${HOLD_STEP} › ${stage}`, 1, 4))

		expect(minutes_of(entries)).toEqual([
			[lane_breakdown.PLAN_STAGE, stages.map((stage) => [`${HOLD_STEP} › ${stage}`, 1])],
		])
	})
	it("groups run:entry's laps under the start to plan, longest first", () => {
		expect(minutes_of([lap(HOLD_STEP, 1, 2), lap(PREP_STEP, 2, 4)])).toStrictEqual([
			[
				lane_breakdown.PLAN_STAGE,
				[
					[PREP_STEP, 2],
					[HOLD_STEP, 1],
				],
			],
		])
	})

	it('leaves a core-budget wait in the start to plan unplaced', () => {
		expect(minutes_of([core_wait(1, 3)])).toStrictEqual([])
	})

	it('places nothing under the start to plan of a breakdown with no plan spans', () => {
		expect(minutes_of([lap(PREP_STEP, 2, 4)], { ...BREAKDOWN, plan: [] })).toStrictEqual([])
	})
})
