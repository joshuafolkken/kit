import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { lane_breakdown, type Breakdown } from './lane-breakdown'
import type { LedgerEntry } from './lane-ledger'
import { lane_net_time } from './lane-net-time'
import { lane_yield } from './lane-yield'

// joshuafolkken/kit#4995: #4970 ran 79.5 minutes of net time, 51 of them its implementation, and the
// overrun investigation saw only the total. Its stages add up to the net time, waits taken out.

const ISSUE = 4970
const OTHER = 4971
const MINUTE_MS = 60_000
const START = Date.parse('2026-10-26T05:43:00.000Z')
const LANE = `#${String(ISSUE)}`
const MERGE_MINUTE = 79.5
const IMPLEMENT = 'implement'
const REVIEW_START = 'review start'
const START_TO_PLAN = 'start to plan'

// #4970's stages, longest first.
const STAGES_4970: ReadonlyArray<readonly [string, number]> = [
	[IMPLEMENT, 51],
	[START_TO_PLAN, 10],
	['ship review', 8],
	['ship commit', 3.5],
	['ship followup', 3.5],
	['ship round-2', 1.5],
	['ship preflight', 1],
	['between ship stages', 1],
]

function at(minute: number): string {
	return new Date(START + minute * MINUTE_MS).toISOString()
}

function event(minute: number, kind: string, text: string): RunEvent {
	return { pos: minute, at: at(minute), kind, text }
}

function ship(minute: number, words: string, cite = LANE): RunEvent {
	return event(minute, 'ship-stage', `${cite} ${words}`)
}

function lane(merge_minute = MERGE_MINUTE): ReadonlyArray<LedgerEntry> {
	return [
		{ kind: 'dispatch', at: at(0), issue: ISSUE },
		{ kind: 'merge', at: at(merge_minute), issue: ISSUE },
	]
}

// #4970's run: start to plan 10, implement 51, then its ship stages up to the merge.
function events_4970(): Array<RunEvent> {
	return [
		event(10, 'plan', `${LANE} plan`),
		event(10, 'lane-phase', `${LANE} implement`),
		ship(61, 'preflight start'),
		ship(62, 'preflight done'),
		ship(63, REVIEW_START),
		ship(71, 'review done'),
		ship(71, 'commit start'),
		ship(74.5, 'commit done'),
		ship(74.5, 'round-2 start'),
		ship(76, 'round-2 done'),
		ship(76, 'followup start'),
	]
}

function minutes_of(breakdown: Breakdown | undefined): Array<readonly [string, number]> {
	return (breakdown?.stages ?? []).map((stage) => [stage.name, stage.ms / MINUTE_MS] as const)
}

function stage_minutes(breakdown: Breakdown | undefined, name: string): number | undefined {
	return minutes_of(breakdown).find(([stage]) => stage === name)?.[1]
}

function total_ms(breakdown: Breakdown | undefined): number {
	return (breakdown?.stages ?? []).reduce((sum, stage) => sum + stage.ms, 0)
}

describe('lane_breakdown.of — #4970', () => {
	const breakdown = lane_breakdown.of(lane(), events_4970(), ISSUE)

	it('splits the net time into its stages, longest first', () => {
		expect(minutes_of(breakdown)).toStrictEqual(STAGES_4970)
	})

	it('adds up to the net time', () => {
		expect(total_ms(breakdown)).toBe(lane_net_time.net_ms(lane(), events_4970(), ISSUE))
		expect(breakdown?.excluded_ms).toBe(0)
	})

	it('names the longest stage in whole minutes', () => {
		expect(breakdown && lane_breakdown.longest_of(breakdown)).toStrictEqual({
			name: IMPLEMENT,
			minutes: 51,
		})
	})

	it('reads no other lane’s events', () => {
		const events = [...events_4970(), ship(30, REVIEW_START, `#${String(OTHER)}`)]
		const breakdown_of_lane = lane_breakdown.of(lane(), events, ISSUE)

		expect(minutes_of(breakdown_of_lane)).toStrictEqual(STAGES_4970)
	})
})

// joshuafolkken/kit#5216: #5171 yielded before its plan, so its start to plan ran from its first
// dispatch through the wait for its redispatch.
describe('lane_breakdown.of — a yield', () => {
	it('takes the yield wait out of start to plan and counts it apart', () => {
		const entries: ReadonlyArray<LedgerEntry> = [
			{ kind: 'dispatch', at: at(-50), issue: ISSUE },
			{ kind: 'dispatch', at: at(0), issue: ISSUE },
			{ kind: 'merge', at: at(MERGE_MINUTE), issue: ISSUE },
		]
		const text = `${LANE} withdrawn by ${lane_yield.YIELD_TEXT.name}: overlaps`
		const events = [event(-43, 'withdraw', text), ...events_4970()]
		const breakdown = lane_breakdown.of(entries, events, ISSUE)

		expect(stage_minutes(breakdown, START_TO_PLAN)).toBe(17)
		expect(breakdown?.yield_ms).toBe(43 * MINUTE_MS)
		expect(breakdown?.excluded_ms).toBe(43 * MINUTE_MS)
		expect(total_ms(breakdown)).toBe(lane_net_time.net_ms(entries, events, ISSUE))
	})
})

describe('lane_breakdown.of — waits and resumes', () => {
	it('moves a park inside the implementation to the excluded time, the sum still the net time', () => {
		const entries: ReadonlyArray<LedgerEntry> = [
			{ kind: 'dispatch', at: at(0), issue: ISSUE },
			{ kind: 'dispatch', at: at(40), issue: ISSUE },
			{ kind: 'merge', at: at(MERGE_MINUTE), issue: ISSUE },
		]
		const events = [...events_4970(), event(30, 'park', `${LANE} parked`)]
		const breakdown = lane_breakdown.of(entries, events, ISSUE)

		expect(stage_minutes(breakdown, IMPLEMENT)).toBe(41)
		expect(breakdown?.excluded_ms).toBe(10 * MINUTE_MS)
		expect(total_ms(breakdown)).toBe(lane_net_time.net_ms(entries, events, ISSUE))
	})

	it('moves a host sleep inside the implementation to the excluded time and counts it apart', () => {
		const sleep = { ...event(40, 'sleep', 'host slept 10.0 min'), elapsed_ms: 10 * MINUTE_MS }
		const events = [...events_4970(), sleep]
		const breakdown = lane_breakdown.of(lane(), events, ISSUE)

		expect(stage_minutes(breakdown, IMPLEMENT)).toBe(41)
		expect(breakdown?.slept_ms).toBe(10 * MINUTE_MS)
		expect(breakdown?.excluded_ms).toBe(10 * MINUTE_MS)
		expect(total_ms(breakdown)).toBe(lane_net_time.net_ms(lane(), events, ISSUE))
	})

	it('keeps the implementation one stage across a cut and its resume', () => {
		const cut = [event(30, 'cut', `${LANE} cut`), event(31, 'resume', `${LANE} resume`)]
		const breakdown = lane_breakdown.of(lane(), [...events_4970(), ...cut], ISSUE)

		expect(stage_minutes(breakdown, IMPLEMENT)).toBe(51)
		expect(breakdown?.implement).toHaveLength(1)
	})

	it('answers nothing for a lane the ledger holds no merge of', () => {
		expect(lane_breakdown.of(lane().slice(0, 1), events_4970(), ISSUE)).toBeUndefined()
	})
})

// joshuafolkken/kit#5078: the window the pre-detach's test:pinned rows are read in.
describe('lane_breakdown.of — ship pre-detach', () => {
	it('keeps the ship pre-detach span', () => {
		const pre_detach = [ship(62, 'pre-detach start'), ship(62.5, 'pre-detach done')]
		const breakdown = lane_breakdown.of(lane(), [...events_4970(), ...pre_detach], ISSUE)
		const spans = breakdown?.pre_detach.map(({ from_ms, to_ms }) => [from_ms, to_ms])

		expect(spans).toStrictEqual([[Date.parse(at(62)), Date.parse(at(62.5))]])
	})
})

describe('lane_breakdown.minutes_text', () => {
	it('writes minutes to one decimal', () => {
		expect(lane_breakdown.minutes_text(3.5 * MINUTE_MS)).toBe('3.5 min')
	})
})
