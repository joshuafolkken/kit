import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_stalled } from '#scripts/run/park/run-stalled'
import { describe, expect, it, vi } from 'vitest'

const ship_cause_mock = vi.hoisted(() => vi.fn())

vi.mock('./run-merge-ship', () => ({ run_merge_ship: { cause: ship_cause_mock } }))

const { run_merge_cap } = await import('./run-merge-cap')

// joshuafolkken/kit#4765: a child re-dispatched up to the per-child cap was parked as its ship's stop,
// with neither the cap, the re-dispatch count nor why its relaunch started nothing.

const CHILD = '4703'
const LIMIT = 3

function event(pos: number, kind: string, text: string): RunEvent {
	return { pos, at: '2026-10-24T00:00:00.000Z', kind, text }
}

const { OUTAGE: OUTAGE_KIND, RELAUNCH_FAILED } = run_event_stream.EVENT_KIND

const OUTAGE = event(1, OUTAGE_KIND, `#${CHILD} outage (re-dispatchable)`)
const OTHER_OUTAGE = event(2, OUTAGE_KIND, '#9 outage (re-dispatchable)')
const OLD_FAILURE = event(3, RELAUNCH_FAILED, `#${CHILD} could not be relaunched: no claude`)
const FAILURE = event(4, RELAUNCH_FAILED, `#${CHILD} could not be relaunched: broker refused`)

describe('run_merge_cap.note_of', () => {
	it('names the cap, the child’s re-dispatches and its newest failed relaunch', () => {
		const events = [OUTAGE, OTHER_OUTAGE, OUTAGE, OLD_FAILURE, OUTAGE, FAILURE]

		expect(run_merge_cap.note_of(events, CHILD, LIMIT)).toBe(
			`it reached the re-dispatch cap (3) after 3 re-dispatches; the last failed relaunch: ${FAILURE.text}.`,
		)
	})

	it('says no failed relaunch was recorded where none was', () => {
		expect(run_merge_cap.note_of([OUTAGE], CHILD, LIMIT)).toContain(
			'the last failed relaunch: none was recorded.',
		)
	})
})

describe('run_merge_cap.park_cause', () => {
	const SHIP_CAUSE = {
		short: 'followup failed',
		why: 'its detached ship stopped and was not fixed.',
	}

	it('leads the ship’s cause with the cap line', () => {
		ship_cause_mock.mockReturnValue(SHIP_CAUSE)

		expect(run_merge_cap.park_cause(CHILD, undefined, 'capped.')).toStrictEqual({
			short: SHIP_CAUSE.short,
			why: `capped. ${SHIP_CAUSE.why}`,
		})
	})

	it('keeps the caller’s cause, and the ended session where nothing else judged', () => {
		ship_cause_mock.mockReturnValue(undefined)

		expect(run_merge_cap.park_cause(CHILD, run_stalled.CUT_NOT_RELAUNCHED, 'capped.')).toBe(
			run_stalled.CUT_NOT_RELAUNCHED,
		)
		expect(run_merge_cap.park_cause(CHILD, undefined, undefined)).toBe(
			run_stalled.SESSION_UNFINISHED,
		)
	})
})
