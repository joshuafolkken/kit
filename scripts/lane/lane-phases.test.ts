import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_phases, type PhaseSample } from './lane-phases'

// joshuafolkken/kit#8287: `josh lane:phases` reads each lane's phases off its ledger rows and its
// implementation marker, and prints each phase's median and sample count.

const ISSUE = 8266
const OTHER = 8257
const { PHASE } = lane_phases

function at(minute: number): string {
	return new Date(minute * MS_PER_MINUTE).toISOString()
}

function dispatch(minute: number, issue = ISSUE): LedgerEntry {
	return { kind: 'dispatch', at: at(minute), issue }
}

function merge(minute: number, issue = ISSUE): LedgerEntry {
	return { kind: 'merge', at: at(minute), issue }
}

function ci_wait(minute: number, minutes: number): LedgerEntry {
	return {
		kind: 'stage',
		at: at(minute),
		stage: 'ci-wait',
		elapsed_ms: minutes * MS_PER_MINUTE,
		issue: ISSUE,
	}
}

// A run:chain whose stages run back to back from `from`, each `[name, minutes]`.
function chain(from: number, stages: ReadonlyArray<[string, number]>, join = false): LedgerEntry {
	let minute = from
	const timed = stages.map(([name, minutes]) => {
		const stage = { name, at: at(minute), elapsed_ms: minutes * MS_PER_MINUTE }

		minute += minutes

		return stage
	})

	return {
		kind: 'chain',
		at: at(minute),
		issue: ISSUE,
		elapsed_ms: (minute - from) * MS_PER_MINUTE,
		join,
		stages: timed,
	}
}

function plan_event(minute: number, issue = ISSUE): RunEvent {
	return { pos: minute, at: at(minute), kind: 'plan', text: `#${String(issue)} plan` }
}

// A dispatch, an implement marker, a pre-review run of checks and the review brief, the reviewer's
// wait, the join's attest, then the ship, its CI wait and the merge — minutes from the dispatch.
const LANE: ReadonlyArray<LedgerEntry> = [
	dispatch(0),
	chain(10, [
		['check:related', 4],
		['run:review', 1],
	]),
	chain(20, [['review:attest', 1]], true),
	chain(21, [['ship', 10]], true),
	ci_wait(38, 4),
	merge(40),
]

function minutes_of(samples: ReadonlyArray<PhaseSample>): Record<string, number> {
	return Object.fromEntries(samples.map((sample) => [sample.phase, sample.ms / MS_PER_MINUTE]))
}

describe('lane_phases.phases_of', () => {
	it('bounds each phase by the dispatch, the marker, the chain runs, the ship and the merge', () => {
		const samples = lane_phases.phases_of(LANE, [plan_event(3)], ISSUE)

		expect(minutes_of(samples)).toEqual({
			[PHASE.PREP]: 3,
			[PHASE.IMPLEMENT]: 7,
			[PHASE.CHECK]: 4,
			[PHASE.REVIEW]: 7,
			[PHASE.SHIP]: 19,
			[PHASE.CI_WAIT]: 4,
		})
	})

	it('times the lane from the last dispatch before its first chain run', () => {
		const samples = lane_phases.phases_of(
			[dispatch(-30), dispatch(1), ...LANE],
			[plan_event(3)],
			ISSUE,
		)

		expect(minutes_of(samples)[PHASE.PREP]).toBe(2)
	})

	it('leaves prep and implement out where no marker of the lane falls before its first run', () => {
		const events = [plan_event(3, OTHER), plan_event(12)]
		const phases = lane_phases.phases_of(LANE, events, ISSUE).map((sample) => sample.phase)

		expect(phases).toEqual([PHASE.CHECK, PHASE.REVIEW, PHASE.SHIP, PHASE.CI_WAIT])
	})
})

describe('lane_phases.phases_of — missing records', () => {
	it('leaves ship and CI out of an unmerged lane, and CI alone where no wait was recorded', () => {
		const unmerged = LANE.filter((entry) => entry.kind !== 'merge')
		const no_wait = minutes_of(
			lane_phases.phases_of(
				LANE.filter((entry) => entry.kind !== 'stage'),
				[],
				ISSUE,
			),
		)

		expect(minutes_of(lane_phases.phases_of(unmerged, [], ISSUE))).not.toHaveProperty(PHASE.SHIP)
		expect(no_wait).toMatchObject({ [PHASE.SHIP]: 19 })
		expect(no_wait).not.toHaveProperty(PHASE.CI_WAIT)
	})

	it('reads no review without a --join run, and nothing for another lane', () => {
		const pre_review = LANE.filter((entry) => entry.kind !== 'chain' || !entry.join)

		expect(minutes_of(lane_phases.phases_of(pre_review, [], ISSUE))).not.toHaveProperty(
			PHASE.REVIEW,
		)
		expect(lane_phases.phases_of(LANE, [plan_event(3)], OTHER)).toEqual([])
	})

	it('reads no phase of a lane whose dispatch before its first run fell outside the read', () => {
		const cut_off = LANE.filter((entry) => entry.kind !== 'dispatch')

		expect(lane_phases.phases_of(cut_off, [plan_event(3)], ISSUE)).toEqual([])
	})
})

describe('lane_phases.rows_of', () => {
	it('prints each phase median and its own sample count, in phase order', () => {
		const samples: ReadonlyArray<PhaseSample> = [
			{ phase: PHASE.SHIP, ms: 3 * MS_PER_MINUTE },
			{ phase: PHASE.PREP, ms: MS_PER_MINUTE },
			{ phase: PHASE.SHIP, ms: 5 * MS_PER_MINUTE },
			{ phase: PHASE.CI_WAIT, ms: 2 * MS_PER_MINUTE },
		]
		const rows = lane_phases.rows_of(samples)

		expect(lane_phases.text(rows, 2)).toBe(
			[
				'Lane phases over 2 lanes (median, samples):',
				'- prep & investigation: 1.0 min median / 1 lanes',
				'- push → merge: 4.0 min median / 2 lanes',
				'-   of which CI wait: 2.0 min median / 1 lanes',
			].join('\n'),
		)
	})
})

describe('lane_phases.merged_in', () => {
	it('takes the lanes whose last merge falls in the span, oldest first', () => {
		const entries = [merge(50, OTHER), merge(5), merge(200, 1), merge(20, OTHER)]
		const span = { from_ms: 0, to_ms: 100 * MS_PER_MINUTE }

		expect(lane_phases.merged_in(entries, span)).toEqual([ISSUE, OTHER])
	})
})
