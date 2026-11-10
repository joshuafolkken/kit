import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { lane_breakdown, type Breakdown } from './lane-breakdown'
import type { LedgerEntry } from './lane-ledger'
import { lane_net_time } from './lane-net-time'

// joshuafolkken/kit#4995: the overrun investigation needs stages, not only a total, to locate the cost.
// Its stages add up to the net time, waits taken out.

const ISSUE = 4970
const OTHER = 4971
const MINUTE_MS = 60_000
const START = Date.parse('2026-10-26T05:43:00.000Z')
const LANE = `#${String(ISSUE)}`
const MERGE_MINUTE = 79.5
const IMPLEMENT = 'implement'
const LANE_PHASE = 'lane-phase'
const REVIEW_START = 'review start'
const START_TO_PLAN = 'start to plan'
const SHIP_REVIEW = 'ship review'

// #4970's stages, longest first.
const STAGES_4970: ReadonlyArray<readonly [string, number]> = [
	[IMPLEMENT, 51],
	[START_TO_PLAN, 10],
	[SHIP_REVIEW, 8],
	['ship commit', 3.5],
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
		event(10, LANE_PHASE, `${LANE} implement`),
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

	// joshuafolkken/kit#5294: the windows a ship stage's laps and the fixes between stages are read in;
	// the followup's window stays among them for its laps though its time is the driver's (#6541).
	it('keeps the ship stages and the time between them as its ship segments', () => {
		const names = new Set(breakdown?.ship.map((segment) => segment.stage))
		const expected = [
			...STAGES_4970.map(([name]) => name).filter(
				(name) => name !== IMPLEMENT && name !== START_TO_PLAN,
			),
			lane_breakdown.FOLLOWUP_STAGE,
		]

		expect(names).toStrictEqual(new Set(expected))
	})

	// joshuafolkken/kit#5539: the window the start to plan's longest calls are read in.
	it('keeps the start to plan span', () => {
		const spans = breakdown?.plan?.map(({ from_ms, to_ms }) => [from_ms, to_ms])

		expect(spans).toStrictEqual([[START, START + 10 * MINUTE_MS]])
	})
})

// joshuafolkken/kit#5835: a docs-only lane writes no `plan` event, so its first edit opens the
// implementation; a lane whose `plan` event did keeps the stages it had.
// joshuafolkken/kit#6541: the followup is the driver's wait, outside the lane's net time.
describe('lane_breakdown.of — the driver followup', () => {
	it('counts the followup apart from the stages, which still add up to the net time', () => {
		const breakdown = lane_breakdown.of(lane(), events_4970(), ISSUE)

		expect(breakdown?.driver).toStrictEqual([
			{ name: lane_breakdown.DRIVER_FOLLOWUP_STAGE, ms: 3.5 * MINUTE_MS },
		])
		expect(total_ms(breakdown)).toBe((MERGE_MINUTE - 3.5) * MINUTE_MS)
	})

	it('leaves the driver stage empty for a lane with no followup', () => {
		const events = events_4970().filter((line) => !line.text.includes('followup'))

		expect(lane_breakdown.of(lane(), events, ISSUE)?.driver).toStrictEqual([])
	})
})

describe('lane_breakdown.of — the first edit', () => {
	const unplanned = events_4970().slice(2)

	it('opens the implementation at the first edit where no plan event did', () => {
		const breakdown = lane_breakdown.of(lane(), unplanned, ISSUE, Date.parse(at(10)))

		expect(minutes_of(breakdown)).toStrictEqual(STAGES_4970)
	})

	it('leaves everything before the first ship stage in start to plan without an edit', () => {
		const breakdown = lane_breakdown.of(lane(), unplanned, ISSUE)

		expect(stage_minutes(breakdown, START_TO_PLAN)).toBe(61)
		expect(stage_minutes(breakdown, IMPLEMENT)).toBeUndefined()
	})

	it('keeps a planned lane’s stages, an earlier or a later edit alike', () => {
		for (const edit_minute of [5, 20]) {
			const breakdown = lane_breakdown.of(lane(), events_4970(), ISSUE, Date.parse(at(edit_minute)))

			expect(minutes_of(breakdown)).toStrictEqual(STAGES_4970)
		}
	})

	it('ignores an edit after the first ship stage or outside the lane', () => {
		for (const edit_minute of [65, 90]) {
			const breakdown = lane_breakdown.of(lane(), unplanned, ISSUE, Date.parse(at(edit_minute)))

			expect(stage_minutes(breakdown, IMPLEMENT)).toBeUndefined()
		}
	})
})

// joshuafolkken/kit#5296: the ship review's event line says why it ran or was skipped.
describe('lane_breakdown.of — ship stage reasons', () => {
	const REUSED = 'reused: round 1 attested on this branch, its tree held'

	it('keeps the newest reason of each ship stage, read off its own lane', () => {
		const events = [
			...events_4970(),
			ship(72, `review skipped | ${REUSED}`),
			ship(71.5, 'review done | ran: --review with no reusable round 1 — x'),
			ship(72.5, 'review skipped | other lane', `#${String(OTHER)}`),
		]
		const breakdown = lane_breakdown.of(lane(), events, ISSUE)

		expect(breakdown?.reasons).toStrictEqual(new Map([[SHIP_REVIEW, REUSED]]))
	})

	it('keeps no reason where no line gave one', () => {
		expect(lane_breakdown.of(lane(), events_4970(), ISSUE)?.reasons).toStrictEqual(new Map())
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
		const text = `${LANE} yielded its lane: overlaps · at: summary`
		const events = [event(-43, 'note', text), ...events_4970()]
		const breakdown = lane_breakdown.of(entries, events, ISSUE)

		expect(stage_minutes(breakdown, START_TO_PLAN)).toBe(17)
		expect(breakdown?.yield_ms).toBe(43 * MINUTE_MS)
		expect(breakdown?.excluded_ms).toBe(43 * MINUTE_MS)
		expect(total_ms(breakdown)).toBe(lane_net_time.net_ms(entries, events, ISSUE))
	})

	// joshuafolkken/kit#6006: the holder's remaining time and the redispatch gap, apart.
	it('splits the yield wait at its holder merge', () => {
		const entries: ReadonlyArray<LedgerEntry> = [
			{ kind: 'dispatch', at: at(-50), issue: ISSUE },
			{ kind: 'merge', at: at(-20), issue: OTHER },
			{ kind: 'dispatch', at: at(0), issue: ISSUE },
			{ kind: 'merge', at: at(MERGE_MINUTE), issue: ISSUE },
		]
		const text = `${LANE} yielded its lane: overlaps, which #${String(OTHER)} declares · at: summary`
		const events = [event(-43, 'note', text), ...events_4970()]

		expect(lane_breakdown.of(entries, events, ISSUE)?.yield_split).toStrictEqual({
			holder_ms: 23 * MINUTE_MS,
			gap_ms: 20 * MINUTE_MS,
			unsplit_ms: 0,
		})
	})
})

// joshuafolkken/kit#6678: #6537 split in its first run and was dispatched again a day later; its start
// to plan counted the day between the two runs.
describe('lane_breakdown.of — a split, then a redispatch', () => {
	const entries: ReadonlyArray<LedgerEntry> = [
		{ kind: 'dispatch', at: at(-1900), issue: ISSUE },
		{ kind: 'dispatch', at: at(0), issue: ISSUE },
		{ kind: 'merge', at: at(MERGE_MINUTE), issue: ISSUE },
	]
	const events = [event(-1886, 'split', `${LANE} split`), ...events_4970()]
	const breakdown = lane_breakdown.of(entries, events, ISSUE)

	it('counts start to plan from the last dispatch only', () => {
		expect(stage_minutes(breakdown, START_TO_PLAN)).toBe(10)
		expect(breakdown?.excluded_ms).toBe(1900 * MINUTE_MS)
	})

	it('still adds up to the net time', () => {
		expect(total_ms(breakdown)).toBe(lane_net_time.net_ms(entries, events, ISSUE))
	})
})

describe('lane_breakdown.of — Codex resume events', () => {
	it('uses plan and implement events after a Codex resume without a transcript', () => {
		const events = [
			event(1, 'note', `${LANE} run:cut --resume`),
			event(10, 'plan', `planned ${LANE}`),
			event(10, LANE_PHASE, `${LANE} ${IMPLEMENT}`),
			...events_4970().slice(2),
		]
		const breakdown = lane_breakdown.of(lane(), events, ISSUE)

		expect(stage_minutes(breakdown, START_TO_PLAN)).toBe(10)
		expect(stage_minutes(breakdown, IMPLEMENT)).toBe(51)
		expect(total_ms(breakdown)).toBe(lane_net_time.net_ms(lane(), events, ISSUE))
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

// joshuafolkken/kit#7026: #6983's round-1 review stage ran across a closed lid.
describe('lane_breakdown.of — host sleep in a review stage', () => {
	it('takes a host sleep inside the review stage out of that stage', () => {
		const sleep = { ...event(70, 'sleep', 'host slept 5.0 min'), elapsed_ms: 5 * MINUTE_MS }
		const breakdown = lane_breakdown.of(lane(), [...events_4970(), sleep], ISSUE)

		expect(stage_minutes(breakdown, SHIP_REVIEW)).toBe(3)
		expect(stage_minutes(breakdown, IMPLEMENT)).toBe(51)
		expect(breakdown?.slept_ms).toBe(5 * MINUTE_MS)
	})

	it('leaves every stage as it was on a lane the host never slept through', () => {
		const breakdown = lane_breakdown.of(lane(), events_4970(), ISSUE)

		expect(minutes_of(breakdown)).toStrictEqual(STAGES_4970)
		expect(breakdown?.slept_ms).toBe(0)
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

// joshuafolkken/kit#5936: cost:audit attributes a request's tokens by the stage its instant fell in.
function stage_at_minute(minute: number): string | undefined {
	const breakdown = lane_breakdown.of(lane(), events_4970(), ISSUE)
	const at_ms = Date.parse(at(minute))

	return breakdown === undefined ? 'no breakdown' : lane_breakdown.stage_at(breakdown, at_ms)
}

describe('lane_breakdown.stage_at', () => {
	it.each([
		[5, START_TO_PLAN],
		[30, IMPLEMENT],
		[65, SHIP_REVIEW],
		[75, lane_breakdown.ROUND_TWO_STAGE],
	])('places minute %d in %s', (minute, stage) => {
		expect(stage_at_minute(minute)).toBe(stage)
	})

	it('places an instant past the merge in no stage', () => {
		expect(stage_at_minute(90)).toBeUndefined()
	})
})

describe('lane_breakdown.minutes_text', () => {
	it('writes minutes to one decimal', () => {
		expect(lane_breakdown.minutes_text(3.5 * MINUTE_MS)).toBe('3.5 min')
	})
})
