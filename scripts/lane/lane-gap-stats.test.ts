import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { lane_gap_stats } from './lane-gap-stats'
import type { LedgerEntry } from './lane-ledger'
import { lane_stats } from './lane-stats'
import { lane_yield } from './lane-yield'

// joshuafolkken/kit#4395. Each gap is timed from the moment a slot's next step could run until the step
// that ran it, from the ledger and the run-event stream.

const NOW = Date.parse('2026-10-21T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const MS_PER_SECOND = 1000
const ISSUE = 4300
const OTHER = 4356
const RELAUNCH = 'cut → resume'
const OUTAGE = 'outage → relaunch'
const PARK = 'park → offer'
const YIELD = 'yield → redispatch'
const MERGE = 'followup → merge'
const FIRST_LANE = 'start → first lane'
const SETUP_KIND = 'setup'
const STARTING_TEXT = 'starting session'
const CUT_TEXT = `#${String(ISSUE)} cut (implementation)`
const OUTAGE_TEXT = `#${String(ISSUE)} outage (re-dispatchable)`
const OUTAGE_KIND = 'outage'
const LAUNCH_KIND = 'child-launch'
const UNMEASURED = 'not measured | not measured'
const HEADER = '| gap | count | median (s) | max (s) | not ended |'

function seconds_before_now(seconds: number): string {
	return new Date(NOW - seconds * MS_PER_SECOND).toISOString()
}

function event(kind: string, text: string, seconds_before: number): RunEvent {
	return { pos: 0, at: seconds_before_now(seconds_before), kind, text }
}

function held(seconds_before: number): LedgerEntry {
	return { kind: 'held', at: seconds_before_now(seconds_before), reason: 'offer:watch:blocked' }
}

function followup(issue: number, seconds_before: number): LedgerEntry {
	return {
		kind: 'stage',
		at: seconds_before_now(seconds_before),
		stage: 'followup',
		elapsed_ms: 1,
		issue,
	}
}

function merge(issue: number, seconds_before: number): LedgerEntry {
	return { kind: 'merge', at: seconds_before_now(seconds_before), issue }
}

function withdraw(issue: number, by: string, seconds_before: number): RunEvent {
	return event('withdraw', `#${String(issue)} withdrawn by ${by}: overlaps`, seconds_before)
}

function yield_note(issue: number, seconds_before: number): RunEvent {
	return event('note', `#${String(issue)} yielded its lane: overlaps · at: summary`, seconds_before)
}

function dispatch(issue: number, seconds_before: number): LedgerEntry {
	return { kind: 'dispatch', at: seconds_before_now(seconds_before), issue }
}

function row_of(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	gap: string,
): string | undefined {
	return lane_gap_stats
		.table(entries, WINDOW, events)
		.split('\n')
		.find((line) => line.startsWith(`| ${gap} |`))
}

describe('lane_gap_stats.table -- cut → resume', () => {
	it('times each cut until its own issue resumed', () => {
		const events = [
			event('cut', CUT_TEXT, 100),
			event('resume', `#${String(OTHER)} resumed`, 95),
			event('resume', `#${String(ISSUE)} resumed`, 84),
		]

		expect(row_of([], events, RELAUNCH)).toBe(`| ${RELAUNCH} | 1 | 16 | 16 | 0 |`)
	})

	it('counts a cut no resume followed as not ended', () => {
		const events = [event('cut', CUT_TEXT, 100)]

		expect(row_of([], events, RELAUNCH)).toBe(`| ${RELAUNCH} | 1 | ${UNMEASURED} | 1 |`)
	})

	// The first cut was never resumed; the resume after the issue's later cut is that cut's alone.
	it('ends a cut no later than the same issue next cut', () => {
		const events = [
			event('cut', CUT_TEXT, 300),
			event('cut', CUT_TEXT, 100),
			event('resume', `#${String(ISSUE)} resumed`, 90),
		]

		expect(row_of([], events, RELAUNCH)).toBe(`| ${RELAUNCH} | 2 | 10 | 10 | 1 |`)
	})

	// A pre-gate resume appends no `resume` event, so its cut has no end to time.
	it('leaves out a pre-gate cut', () => {
		const events = [event('cut', `#${String(ISSUE)} cut (pre-gate)`, 100)]

		expect(row_of([], events, RELAUNCH)).toBe(`| ${RELAUNCH} | 0 | ${UNMEASURED} | 0 |`)
	})
})

describe('lane_gap_stats.table -- outage → relaunch', () => {
	// A child that ended with no result is collected as an outage and dispatched again (joshuafolkken/kit#4410).
	it('times each outage until its own issue launched again', () => {
		const events = [
			event(OUTAGE_KIND, OUTAGE_TEXT, 100),
			event(LAUNCH_KIND, `#${String(OTHER)} dispatched`, 95),
			event(LAUNCH_KIND, `#${String(ISSUE)} dispatched`, 77),
		]

		expect(row_of([], events, OUTAGE)).toBe(`| ${OUTAGE} | 1 | 23 | 23 | 0 |`)
	})

	it('ends an outage no later than the same issue next outage', () => {
		const events = [
			event(OUTAGE_KIND, OUTAGE_TEXT, 300),
			event(OUTAGE_KIND, OUTAGE_TEXT, 100),
			event(LAUNCH_KIND, `#${String(ISSUE)} dispatched`, 80),
		]

		expect(row_of([], events, OUTAGE)).toBe(`| ${OUTAGE} | 2 | 20 | 20 | 1 |`)
	})
})

describe('lane_gap_stats.table -- park → offer', () => {
	// The #4377 park of 2026-10-21: the driver's pass after it found the pool full.
	it('ends a park at the full pool released entry', () => {
		const events = [event('park', `#${String(ISSUE)} waiting on start date`, 60)]
		const entries: Array<LedgerEntry> = [{ kind: 'released', at: seconds_before_now(45) }]

		expect(row_of(entries, events, PARK)).toBe(`| ${PARK} | 1 | 15 | 15 | 0 |`)
	})

	// The #4300 park of 2026-10-21: the cap's park, then the driver's collection, each answered.
	it('times each park until the next offer answer after it', () => {
		const events = [
			event('park', `#${String(ISSUE)} parked (run:stalled: ship-stop cap)`, 500),
			event('park', `#${String(ISSUE)} parked`, 468),
		]
		const entries = [held(521), held(479), held(445)]

		expect(row_of(entries, events, PARK)).toBe(`| ${PARK} | 2 | 22 | 23 | 0 |`)
	})

	it('ends a park at the next dispatch', () => {
		const events = [event('park', `#${String(ISSUE)} parked`, 60)]
		const entries: Array<LedgerEntry> = [
			{ kind: 'dispatch', at: seconds_before_now(30), issue: OTHER },
		]

		expect(row_of(entries, events, PARK)).toBe(`| ${PARK} | 1 | 30 | 30 | 0 |`)
	})
})

describe('lane_gap_stats.table -- yield → redispatch', () => {
	// joshuafolkken/kit#5216: the #5171 yield waited for its holder's lane, no seat held.
	it('times each yield until its own issue next dispatch', () => {
		const events = [yield_note(ISSUE, 100)]
		const entries = [dispatch(OTHER, 90), dispatch(ISSUE, 40)]

		expect(row_of(entries, events, YIELD)).toBe(`| ${YIELD} | 1 | 60 | 60 | 0 |`)
	})

	// joshuafolkken/kit#5755: the wait starts at the yield note; the withdrawal closing it is no second yield.
	it('times a yield closed by its withdrawal once, from its note', () => {
		const events = [yield_note(ISSUE, 100), withdraw(ISSUE, lane_yield.YIELD_TEXT.name, 70)]

		expect(row_of([dispatch(ISSUE, 40)], events, YIELD)).toBe(`| ${YIELD} | 1 | 60 | 60 | 0 |`)
	})

	it('leaves out a withdrawal that is not a yield', () => {
		const events = [withdraw(ISSUE, 'a person', 100)]

		expect(row_of([dispatch(ISSUE, 40)], events, YIELD)).toBe(
			`| ${YIELD} | 0 | ${UNMEASURED} | 0 |`,
		)
	})
})

describe('lane_gap_stats.table -- followup → merge', () => {
	it('times the last followup stage before the merge line of the same issue', () => {
		const entries = [
			followup(ISSUE, 300),
			followup(ISSUE, 90),
			followup(OTHER, 60),
			merge(ISSUE, 48),
		]

		expect(row_of(entries, [], MERGE)).toBe(`| ${MERGE} | 1 | 42 | 42 | 0 |`)
	})

	it('leaves out a merge with no followup stage', () => {
		expect(row_of([merge(ISSUE, 10)], [], MERGE)).toBe(`| ${MERGE} | 0 | ${UNMEASURED} | 0 |`)
	})
})

describe('lane_gap_stats.table -- start → first lane', () => {
	it('times each session start until its first lane opening', () => {
		const events = [
			event(SETUP_KIND, STARTING_TEXT, 300),
			event(SETUP_KIND, `opening lane #${String(ISSUE)}`, 258),
			event(SETUP_KIND, `opening lane #${String(OTHER)}`, 200),
			event(SETUP_KIND, STARTING_TEXT, 100),
		]

		expect(row_of([], events, FIRST_LANE)).toBe(`| ${FIRST_LANE} | 2 | 42 | 42 | 1 |`)
	})
})

describe('lane_gap_stats.table -- the period', () => {
	it('prints every gap with zero counts for an empty period', () => {
		const lines = lane_gap_stats.table([], WINDOW).split('\n')

		expect(lines[0]).toBe(HEADER)
		expect(lines).toHaveLength(8)
	})

	it('leaves out a gap that started before the period', () => {
		const day_and_more = 90_000
		const events = [
			event('cut', CUT_TEXT, day_and_more),
			event('resume', `#${String(ISSUE)} resumed`, day_and_more - 10),
		]

		expect(row_of([], events, RELAUNCH)).toBe(`| ${RELAUNCH} | 0 | ${UNMEASURED} | 0 |`)
	})
})
