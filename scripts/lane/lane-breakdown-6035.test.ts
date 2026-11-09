import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { lane_breakdown, type Breakdown } from './lane-breakdown'
import { lane_breakdown_laps } from './lane-breakdown-laps'
import type { LedgerEntry } from './lane-ledger'
import { lane_sinks } from './lane-sinks'

// joshuafolkken/kit#6140: #6035's first ship stopped at its preflight (`unplanned`, `unpinned`) a minute
// into its pre-detach, with no stage event after its `pre-detach start`; its `lane:plan` then waited
// three asks on #6036 before the re-ship. The stop now closes the pre-detach, and the waits are their
// own row. The fixture is #6035's sequence, in seconds from its dispatch.

const ISSUE = 6035
const LANE = `#${String(ISSUE)}`
const HOLDER = `#${String(ISSUE + 1)}`
const START = Date.parse('2026-11-03T09:40:00.000Z')
const MS_PER_SECOND = 1000
const MINUTE_MS = 60_000
const WAIT_ROW = `lane:plan wait (${HOLDER})`
const ASK_SECONDS = 540
const ASKS = [1100, 1660, 2220]
const STOP_SECOND = 1066

function at(second: number): string {
	return new Date(START + second * MS_PER_SECOND).toISOString()
}

const SYNC_STAGE = 'ship sync'
const OVERLAP_STEP = 'overlap wait'

// `<second> <kind> <text>`, one event a line, the waits' asks added below.
const LANE_EVENTS = `
60 plan planned
1000 ship-stage preflight start preflight
1007 ship-stage pre-detach start
2802 ship-stage preflight start preflight
2867 ship-stage pre-detach start
2894 ship-stage pre-detach done
2895 ship-stage sync start
2960 ship-stage sync done
2961 ship-stage followup start
3400 ship-stage followup done
`

function lines_of(): Array<readonly [number, string, string]> {
	const lines = LANE_EVENTS.trim()
		.split('\n')
		.map((line) => {
			const [second = '', kind = '', ...words] = line.split(' ')

			return [Number(second), kind, words.join(' ')] as const
		})
	const asks = ASKS.flatMap((second) => [
		[second, 'plan-wait', `start ${HOLDER}`] as const,
		[second + ASK_SECONDS, 'plan-wait', `end ${HOLDER}`] as const,
	])

	return [...lines, ...asks].toSorted(([left], [right]) => left - right)
}

function events_6035(): Array<RunEvent> {
	return lines_of().map(([second, kind, text], pos) => ({
		pos,
		at: at(second),
		kind,
		text: `${LANE} ${text}`,
	}))
}

function entries_6035(stop_second = STOP_SECOND): Array<LedgerEntry> {
	return [
		{ kind: 'dispatch', at: at(0), issue: ISSUE },
		{ kind: 'stop', at: at(stop_second), issue: ISSUE, reason: 'preflight', cause: 'check' },
		{
			kind: 'ship-lap',
			at: at(2950),
			issue: ISSUE,
			stage: 'sync',
			step: OVERLAP_STEP,
			elapsed_ms: 40 * MS_PER_SECOND,
		},
		{ kind: 'merge', at: at(3410), issue: ISSUE },
	]
}

function breakdown_of(entries: ReadonlyArray<LedgerEntry>): Breakdown {
	const breakdown = lane_breakdown.of(entries, events_6035(), ISSUE)

	if (breakdown === undefined) throw new Error('no breakdown')

	return breakdown
}

function minutes_of(breakdown: Breakdown, name: string): number {
	return (breakdown.stages.find((stage) => stage.name === name)?.ms ?? 0) / MINUTE_MS
}

describe('lane_breakdown.of — #6035', () => {
	const breakdown = breakdown_of(entries_6035())

	it('closes the pre-detach at the preflight stop, leaving it about a minute', () => {
		expect(minutes_of(breakdown, lane_breakdown.PRE_DETACH_STAGE)).toBeCloseTo((59 + 27) / 60)
	})

	it('counts the three asks on the holder as one row of their own', () => {
		expect(minutes_of(breakdown, WAIT_ROW)).toBe((ASKS.length * ASK_SECONDS) / 60)
	})

	// The driver's followup is outside the net time, so it joins the stages to make up the lane (#6541).
	it('still adds the stages and the driver followup up to the lane', () => {
		const parts = [...breakdown.stages, ...(breakdown.driver ?? [])]
		const total_ms = parts.reduce((sum, stage) => sum + stage.ms, 0)

		expect(total_ms).toBe(3410 * MS_PER_SECOND)
	})

	it('keeps the sync stage’s overlap wait under its ship stage', () => {
		const laps = lane_breakdown_laps.of(entries_6035(), ISSUE, breakdown, [])

		expect(laps.get(SYNC_STAGE)).toStrictEqual([{ name: OVERLAP_STEP, ms: 40 * MS_PER_SECOND }])
	})
})

describe('lane_breakdown.of — a stop outside a ship stage', () => {
	it('opens nothing in the implementation', () => {
		const breakdown = breakdown_of(entries_6035(500))

		expect(breakdown.implement).toStrictEqual([
			{ stage: 'implement', from_ms: Date.parse(at(60)), to_ms: Date.parse(at(1000)) },
		])
	})
})

describe('lane_sinks.sinks_of — #6035', () => {
	it('lists the lane:plan wait as a sink of its own', () => {
		const sinks = lane_sinks.sinks_of({ entries: entries_6035(), events: events_6035() }, [ISSUE])
		const wait = sinks.find((sink) => sink.name === 'lane:plan wait')

		expect(wait?.per_lane_ms).toStrictEqual([ASKS.length * ASK_SECONDS * MS_PER_SECOND])
	})
})
