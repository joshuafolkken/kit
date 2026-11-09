import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_merge_dated } from './run-merge-dated'

// joshuafolkken/kit#6677: a merge is dated no later than its ship's report, so the driver's wait to
// collect the child — siblings launching in the same pass — stays out of the lane and before their
// dispatch.

const CHILD = '6537'
const SIBLING = '6657'
const DISPATCHED_AT = '2026-11-07T11:47:00.000Z'
const REPORTED_AT = '2026-11-07T12:45:24.218Z'
const SIBLING_AT = '2026-11-07T12:48:09.417Z'
const CONFIRMED_AT = new Date('2026-11-07T12:48:34.527Z')

function event(pos: number, at: string, kind: string, text: string): RunEvent {
	return { pos, at, kind, text }
}

const LAUNCH_KIND = 'child-launch'
const SHIP_KIND = 'ship-stage'
const DISPATCH = event(1, DISPATCHED_AT, LAUNCH_KIND, `#${CHILD} dispatched`)
const REPORT = event(2, REPORTED_AT, SHIP_KIND, `#${CHILD} report done preflight,report`)
const SIBLING_DISPATCH = event(3, SIBLING_AT, LAUNCH_KIND, `#${SIBLING} dispatched`)

describe('run_merge_dated.dated', () => {
	it('dates the merge to its ship report, ahead of a sibling dispatched before the collection (ac-83bd6591)', () => {
		const at = run_merge_dated.dated([DISPATCH, REPORT, SIBLING_DISPATCH], CHILD, CONFIRMED_AT)

		expect(at.toISOString()).toBe(REPORTED_AT)
		expect(at.getTime()).toBeLessThan(Date.parse(SIBLING_AT))
	})

	it('keeps the confirmation when the child shipped no report since its dispatch (ac-6f869860)', () => {
		const redispatch = event(4, SIBLING_AT, LAUNCH_KIND, `#${CHILD} dispatched`)

		expect(run_merge_dated.dated([DISPATCH], CHILD, CONFIRMED_AT)).toBe(CONFIRMED_AT)
		expect(run_merge_dated.dated([REPORT, redispatch], CHILD, CONFIRMED_AT)).toBe(CONFIRMED_AT)
	})

	it('reads neither another child’s report nor a report that is not done', () => {
		const other = event(2, REPORTED_AT, SHIP_KIND, `#${SIBLING} report done report`)
		const started = event(2, REPORTED_AT, SHIP_KIND, `#${CHILD} report start report`)

		expect(run_merge_dated.dated([DISPATCH, other], CHILD, CONFIRMED_AT)).toBe(CONFIRMED_AT)
		expect(run_merge_dated.dated([DISPATCH, started], CHILD, CONFIRMED_AT)).toBe(CONFIRMED_AT)
	})

	it('never dates the merge after its confirmation', () => {
		const late = event(2, '2026-11-07T12:49:00.000Z', SHIP_KIND, `#${CHILD} report done report`)

		expect(run_merge_dated.dated([DISPATCH, late], CHILD, CONFIRMED_AT)).toBe(CONFIRMED_AT)
	})
})
