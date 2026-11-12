import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { assert, describe, expect, it } from 'vitest'
import { lane_breakdown } from './lane-breakdown'
import type { LedgerEntry } from './lane-ledger'
import { lane_net_time } from './lane-net-time'
import { lane_stage_events } from './lane-stage-events'
import { lane_timeline } from './lane-timeline'

const ISSUE = 7354
const START = Date.parse('2026-11-12T05:16:00Z')
const MINUTE = 60_000
const SHIP_KIND = 'ship-stage'
const SHIP_REVIEW = 'ship review'

function at(minute: number): string {
	return new Date(START + minute * MINUTE).toISOString()
}

function stage(name: string, start: number, end: number): LedgerEntry {
	return {
		kind: 'stage',
		issue: ISSUE,
		stage: name,
		at: at(end),
		elapsed_ms: (end - start) * MINUTE,
	}
}

function entries(): Array<LedgerEntry> {
	return [
		{ kind: 'dispatch', issue: ISSUE, at: at(0) },
		stage('preflight', 15, 17),
		stage('gate', 24, 36),
		stage('round-2', 24, 37),
		stage('followup', 50, 58),
		{ kind: 'merge', issue: ISSUE, at: at(59) },
	]
}

function events(): Array<RunEvent> {
	return [
		{ kind: 'plan', pos: 1, at: at(3), text: '#7354 plan' },
		{ kind: SHIP_KIND, pos: 2, at: at(60), text: '#7354 report done' },
	]
}

describe('lane_stage_events — compacted stage history (#7379)', () => {
	it('restores ship and driver followup from the ledger after only report done survives', () => {
		const records = { entries: entries(), events: events() }
		const breakdown = lane_breakdown.of(records.entries, records.events, ISSUE)

		assert(breakdown)
		const timeline = lane_timeline.of(records, ISSUE, breakdown)

		assert(timeline)

		expect(timeline.rows.map((row) => row.name)).toContain('ship preflight')
		expect(timeline.rows.map((row) => row.name)).toContain('driver followup (CI wait)')
		expect(breakdown.implement).toEqual([
			{ stage: 'implement', from_ms: START + 3 * MINUTE, to_ms: START + 15 * MINUTE },
		])
		expect(lane_timeline.net_ms(timeline)).toBe(lane_net_time.net_ms(entries(), events(), ISSUE))
	})
	it('never counts simultaneous gate and round-2 twice or closes the longer stage early', () => {
		const breakdown = lane_breakdown.of(entries(), events(), ISSUE)
		const concurrent =
			breakdown?.segments?.filter((segment) =>
				['ship gate', 'ship round-2'].includes(segment.stage),
			) ?? []

		expect(concurrent.reduce((sum, segment) => sum + segment.net_ms, 0)).toBe(13 * MINUTE)
		expect(concurrent.at(-1)?.to_ms).toBe(START + 37 * MINUTE)
	})
	it('is idempotent when the recovered and surviving event boundaries coexist', () => {
		const restored = lane_stage_events.of(entries(), events(), ISSUE)
		const once = lane_breakdown.of(entries(), events(), ISSUE)
		const twice = lane_breakdown.of(entries(), restored, ISSUE)

		expect(twice?.stages).toEqual(once?.stages)
		expect(twice?.driver).toEqual(once?.driver)
	})
})

describe('lane_stage_events — partial and unrelated records', () => {
	it('keeps measured starts where the ledger has no finished stage', () => {
		const open: RunEvent = { kind: SHIP_KIND, pos: 3, at: at(40), text: '#7354 review start' }
		const breakdown = lane_breakdown.of(entries(), [...events(), open], ISSUE)

		expect(breakdown?.ship.some((segment) => segment.stage === SHIP_REVIEW)).toBe(true)
	})
	it('does not promote a CI lap or another issue into a ship stage', () => {
		const extra = [stage('ci-wait', 51, 57), { ...stage('review', 5, 10), issue: 7333 }]
		const breakdown = lane_breakdown.of([...entries(), ...extra], events(), ISSUE)

		expect(breakdown?.ship.some((segment) => segment.stage === 'ship ci-wait')).toBe(false)
		expect(breakdown?.ship.some((segment) => segment.stage === SHIP_REVIEW)).toBe(false)
	})
})
