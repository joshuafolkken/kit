import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { lane_breakdown } from './lane-breakdown'
import type { LedgerEntry } from './lane-ledger'
import { lane_net_time } from './lane-net-time'
import { lane_timeline, type Timeline, type TimelineRow } from './lane-timeline'

// joshuafolkken/kit#7186: one lane in time order, so a measure's effect reads off when each stage ran
// and where the lane waited — the stage lines adding up to the net time.

const ISSUE = 4970
const LANE = `#${String(ISSUE)}`
const MINUTE_MS = 60_000
const START = Date.parse('2026-10-26T05:43:00.000Z')
const MERGE_MINUTE = 79.5
const PARK_MINUTE = 20
const RESUME_MINUTE = 30
const LAP_MINUTE = 64
const LAP_MINUTES = 2
const NOTICE_MINUTE = 40

function at(minute: number): string {
	return new Date(START + minute * MINUTE_MS).toISOString()
}

function event(minute: number, kind: string, text: string): RunEvent {
	return { pos: minute, at: at(minute), kind, text }
}

function ship(minute: number, words: string): RunEvent {
	return event(minute, 'ship-stage', `${LANE} ${words}`)
}

// A park at minute 20, dispatched again at minute 30.
function events(): Array<RunEvent> {
	return [
		event(10, 'plan', `${LANE} plan`),
		event(PARK_MINUTE, 'park', `${LANE} parked on a decision`),
		ship(RESUME_MINUTE, 'preflight start'),
		ship(31, 'preflight done'),
		event(60, 'ship-launch', `${LANE} ship launched`),
		ship(61, 'sync start'),
		ship(66, 'sync done'),
		ship(66, 'review start'),
		ship(74, 'review done'),
		ship(76, 'followup start'),
	]
}

function entries(): Array<LedgerEntry> {
	return [
		{ kind: 'dispatch', at: at(0), issue: ISSUE },
		// The redispatch that ends the park.
		{ kind: 'dispatch', at: at(RESUME_MINUTE), issue: ISSUE },
		{
			kind: 'split-notice',
			at: at(NOTICE_MINUTE),
			issue: ISSUE,
			files: 9,
			lines: 250,
			reason: 'files',
		},
		{ kind: 'unplanned-notice', at: at(NOTICE_MINUTE + 1), issue: ISSUE, files: ['a.ts'] },
		{
			kind: 'ship-lap',
			at: at(LAP_MINUTE + LAP_MINUTES),
			issue: ISSUE,
			stage: 'sync',
			step: 'merge',
			elapsed_ms: LAP_MINUTES * MINUTE_MS,
		},
		{ kind: 'merge', at: at(MERGE_MINUTE), issue: ISSUE },
	]
}

function timeline_of(extra: ReadonlyArray<RunEvent> = []): Timeline | undefined {
	const records = { entries: entries(), events: [...events(), ...extra] }
	const breakdown = lane_breakdown.of(records.entries, records.events, ISSUE)

	return breakdown === undefined ? undefined : lane_timeline.of(records, ISSUE, breakdown)
}

function row_named(name: string): TimelineRow | undefined {
	return timeline_of()?.rows.find((row) => row.name === name)
}

describe('lane_timeline.of — the stage lines', () => {
	it('adds the stage lines up to the breakdown and to lane:net', () => {
		const records = { entries: entries(), events: events() }
		const breakdown = lane_breakdown.of(records.entries, records.events, ISSUE)
		const timeline = timeline_of()
		const stages_ms = (breakdown?.stages ?? []).reduce((sum, stage) => sum + stage.ms, 0)

		expect(timeline === undefined ? undefined : lane_timeline.net_ms(timeline)).toBe(stages_ms)
		expect(stages_ms).toBe(lane_net_time.net_ms(records.entries, records.events, ISSUE))
	})

	it('lists the rows oldest first, from the dispatch', () => {
		const starts = (timeline_of()?.rows ?? []).map((row) => row.at_ms)

		expect(starts).toStrictEqual(starts.toSorted((left, right) => left - right))
		expect(timeline_of()?.rows[0]).toMatchObject({ at_ms: START, name: 'start to plan' })
	})

	it('answers undefined for a lane the ledger holds no merge of', () => {
		const breakdown = lane_breakdown.of(entries(), events(), ISSUE)
		const records = { entries: entries().filter((entry) => entry.kind !== 'merge'), events: [] }

		expect(breakdown && lane_timeline.of(records, ISSUE, breakdown)).toBeUndefined()
	})
})

describe('lane_timeline.of — the points the stages hide', () => {
	it('names the main merge-in at its start, with its minutes', () => {
		const name = 'main merge-in (ship sync)'

		expect(row_named(name)).toStrictEqual({
			at_ms: START + LAP_MINUTE * MINUTE_MS,
			ms: LAP_MINUTES * MINUTE_MS,
			name,
			kind: lane_timeline.ROW.EVENT,
		})
	})

	it('names the split and unplanned notices at their times', () => {
		expect(row_named('split notice (files)')?.at_ms).toBe(START + NOTICE_MINUTE * MINUTE_MS)
		expect(row_named('unplanned notice (a.ts)')?.at_ms).toBe(
			START + (NOTICE_MINUTE + 1) * MINUTE_MS,
		)
	})

	it('names a ship launch as a point', () => {
		expect(row_named('ship launch')).toMatchObject({ kind: lane_timeline.ROW.EVENT })
	})
})

describe('lane_timeline.of — the waits taken out', () => {
	it('marks the park excluded, by its kind, apart from the stages', () => {
		expect(row_named('park')).toStrictEqual({
			at_ms: START + PARK_MINUTE * MINUTE_MS,
			ms: (RESUME_MINUTE - PARK_MINUTE) * MINUTE_MS,
			name: 'park',
			kind: lane_timeline.ROW.EXCLUDED,
		})
	})

	it('marks the followup as driver time', () => {
		expect(row_named(`${lane_breakdown.DRIVER_FOLLOWUP_STAGE} (CI wait)`)?.kind).toBe(
			lane_timeline.ROW.DRIVER,
		)
	})

	it('tags each line apart from the stages in the text', () => {
		const timeline = timeline_of()
		const text = timeline === undefined ? '' : lane_timeline.text(LANE, timeline)

		expect(text).toContain('2026-10-26 06:03Z      +20.0   10.0 min  [excluded] park')
		expect(text).toContain('[event] split notice (files)')
	})
})

// A host sleep of `minutes` that ended at `minute`.
function slept_until(minute: number, minutes: number): RunEvent {
	return {
		...event(minute, 'sleep', `host slept ${String(minutes)} min`),
		elapsed_ms: minutes * MINUTE_MS,
	}
}

describe('lane_timeline.of — a host sleep', () => {
	it('names a wait nothing else opened by the sleep across it', () => {
		const rows = timeline_of([slept_until(50, 5)])?.rows ?? []

		expect(rows.find((row) => row.at_ms === START + 45 * MINUTE_MS)?.name).toBe('sleep')
	})

	it('adds the sleep to the park it fell inside', () => {
		const rows = timeline_of([slept_until(25, 2)])?.rows ?? []

		expect(rows.find((row) => row.kind === lane_timeline.ROW.EXCLUDED)?.name).toBe('park + sleep')
	})
})
