import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { lane_breakdown, type Breakdown } from './lane-breakdown'
import { lane_breakdown_laps } from './lane-breakdown-laps'
import { lane_breakdown_pause } from './lane-breakdown-pause'
import type { LedgerEntry } from './lane-ledger'
import type { ToolCall } from './lane-transcript-calls'

// joshuafolkken/kit#5646: the time between ship stages a park fell in is named after the park — the
// blocker a pause waited on — rather than left to the Bash kinds.

const MINUTE_MS = 60_000
const ISSUE = 5544
const BETWEEN = 'between ship stages'
const SPAN = { from_ms: 0, to_ms: 100 * MINUTE_MS }
const WAITING_ON_5582 = '#5544 waiting on #5582'
const PAUSE_FOR_5582 = 'pause for #5582'

function event(minute: number, text: string, kind = 'park'): RunEvent {
	return { pos: minute, at: new Date(minute * MINUTE_MS).toISOString(), kind, text }
}

function between(from: number, to: number): Breakdown['ship'][number] {
	return { stage: BETWEEN, from_ms: from * MINUTE_MS, to_ms: to * MINUTE_MS }
}

function bash(minute: number, minutes: number): ToolCall {
	return {
		session_id: 's',
		lane: String(ISSUE),
		started_ms: minute * MINUTE_MS,
		duration_ms: minutes * MINUTE_MS,
		tool: 'Bash',
		background: false,
		command: 'pnpm josh gate',
		subagent: undefined,
		output: '',
	}
}

// Two pauses, the first stretch's wait taken out, and one stretch with no park.
const BREAKDOWN: Breakdown = {
	stages: [],
	excluded_ms: 5 * MINUTE_MS,
	slept_ms: 0,
	yield_ms: 0,
	waits: [{ from_ms: 12 * MINUTE_MS, to_ms: 17 * MINUTE_MS }],
	implement: [],
	pre_detach: [],
	ship: [
		between(10, 25),
		{ stage: 'ship gate', from_ms: 25 * MINUTE_MS, to_ms: 30 * MINUTE_MS },
		between(30, 37),
		{ stage: 'ship commit', from_ms: 37 * MINUTE_MS, to_ms: 40 * MINUTE_MS },
		between(40, 43),
	],
	pauses: lane_breakdown_pause.of(
		[event(12, WAITING_ON_5582), event(31, `#${String(ISSUE)} waiting on #5600`)],
		ISSUE,
		SPAN,
	),
}

describe('lane_breakdown_pause.of', () => {
	it("names the lane's waits on blockers and its parks, in order", () => {
		const events = [
			event(5, '#5544 waiting on #5582, #5583'),
			event(6, '#5544 parked (run:stalled: session-unfinished)'),
			event(7, '#5544 parked'),
		]

		expect(lane_breakdown_pause.of(events, ISSUE, SPAN).map((mark) => mark.name)).toStrictEqual([
			'pause for #5582, #5583',
			'park (run:stalled: session-unfinished)',
			'park',
		])
	})

	it("leaves out another lane's park, another kind of event and a park outside the lane", () => {
		const events = [
			event(5, '#55440 waiting on #5582'),
			event(6, WAITING_ON_5582, 'resume'),
			event(101, WAITING_ON_5582),
		]

		expect(lane_breakdown_pause.of(events, ISSUE, SPAN)).toStrictEqual([])
	})
})

// joshuafolkken/kit#5649: what the lane redid after each pause, read up to the next one.
const PREFLIGHT_START = 'preflight start'
const GATE_START = 'gate start'
const GATE_FAILED = 'gate failed'

function stage(minute: number, words: string): RunEvent {
	return event(minute, `#${String(ISSUE)} ${words}`, 'ship-stage')
}

function names_of(events: ReadonlyArray<RunEvent>): ReadonlyArray<string> {
	return lane_breakdown_pause.of(events, ISSUE, SPAN).map((mark) => mark.name)
}

// A `--review` ship's stage starts in the order `josh ship` runs them, gate and round-2 side by side.
const PRE_DETACH = 'pre-detach'
const GATE_SIDE_BY_SIDE = ['gate', 'round-2']
const REVIEW_SHIP = [
	PRE_DETACH,
	'preflight',
	'sync',
	'review',
	...GATE_SIDE_BY_SIDE,
	'commit',
	'followup',
	'report',
]

function starts(minute: number, stages: ReadonlyArray<string>): ReadonlyArray<RunEvent> {
	return stages.map((name, index) => stage(minute + index / stages.length, `${name} start`))
}

describe('lane_breakdown_pause.of — what the lane redid after a pause', () => {
	it('counts one --review ship after the pause as one run', () => {
		const events = [event(12, WAITING_ON_5582), ...starts(20, REVIEW_SHIP)]

		expect(names_of(events)).toStrictEqual(['pause for #5582 (ship ×1 re-run)'])
	})

	it('counts the ship runs after the pause, a resumed run that skips its first stages among them', () => {
		const events = [
			stage(5, PREFLIGHT_START),
			stage(6, GATE_FAILED),
			event(12, WAITING_ON_5582),
			...starts(20, [PRE_DETACH, 'preflight', 'sync', ...GATE_SIDE_BY_SIDE]),
			stage(25, GATE_FAILED),
			stage(30, 'preflight skipped'),
			...starts(31, [PRE_DETACH, 'sync', ...GATE_SIDE_BY_SIDE, 'commit']),
		]

		expect(names_of(events)).toStrictEqual(['pause for #5582 (ship ×2 re-run)'])
	})

	it('names a re-plan, and reads each pause only up to the next one', () => {
		const events = [
			event(12, WAITING_ON_5582),
			event(13, '#5544 plan', 'plan'),
			event(20, '#5544 waiting on #5600'),
			stage(21, GATE_START),
			stage(22, 'round-2 start'),
			stage(23, GATE_START),
			event(23, '#5545 implement', 'lane-phase'),
		]

		expect(names_of(events)).toStrictEqual([
			'pause for #5582 (re-plan)',
			'pause for #5600 (ship ×2 re-run)',
		])
	})
})

describe('lane_breakdown_pause.of — a pause the lane redid nothing after', () => {
	it('leaves a pause the lane did nothing after as it was, and a lane with no pause without one', () => {
		expect(names_of([event(12, WAITING_ON_5582), stage(13, 'gate done')])).toStrictEqual([
			PAUSE_FOR_5582,
		])
		expect(names_of([stage(5, PREFLIGHT_START), stage(6, GATE_START)])).toStrictEqual([])
	})
})

describe('lane_breakdown.of — the parks', () => {
	it("carries the lane's parks between its dispatch and its merge", () => {
		const entries: Array<LedgerEntry> = [
			{ kind: 'dispatch', at: new Date(0).toISOString(), issue: ISSUE },
			{ kind: 'merge', at: new Date(SPAN.to_ms).toISOString(), issue: ISSUE },
		]
		const breakdown = lane_breakdown.of(entries, [event(12, WAITING_ON_5582)], ISSUE)

		expect(breakdown?.pauses?.map((mark) => mark.name)).toStrictEqual([PAUSE_FOR_5582])
	})
})

describe('lane_breakdown_laps.of — between ship stages a lane paused in', () => {
	it('names each pause with its blocker and its minutes, net of the wait, beside the Bash', () => {
		const laps = lane_breakdown_laps.of([], ISSUE, BREAKDOWN, [bash(41, 1), bash(11, 4)])

		expect(
			laps.get(BETWEEN)?.map((part) => [part.name, part.ms / MINUTE_MS] as const),
		).toStrictEqual([
			[PAUSE_FOR_5582, 10],
			['pause for #5600', 7],
			['gate', 1],
		])
	})
})
