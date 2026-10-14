import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_status } from './run-board-status'

// joshuafolkken/kit#3769: when a running child entered the phase it is on, so the board can say how long
// it has stood there.

const KIND = run_event_stream.EVENT_KIND
const T0 = '2026-10-08T09:00:00.000Z'
const T1 = '2026-10-08T09:05:00.000Z'
const T2 = '2026-10-08T09:10:00.000Z'
const T3 = '2026-10-08T09:15:00.000Z'
const NONE: ReadonlySet<number> = new Set()

// One event naming #3409, as when it was written, its kind and its text.
type Step = [string, string, string]

const LAUNCH: Step = [T0, KIND.CHILD_LAUNCH, '#3409 launched']
const IMPLEMENT_TEXT = '#3409 implement'

function phase_ms_after(...steps: ReadonlyArray<Step>): number | undefined {
	const events: Array<RunEvent> = steps.map(([at, kind, text], index) => ({
		pos: index + 1,
		at,
		kind,
		text,
	}))

	return run_board_status.statuses_of(events, [], NONE).get(3409)?.phase_ms
}

describe('run_board_status.statuses_of phase start', () => {
	it('starts a launched child’s phase at its launch', () => {
		expect(phase_ms_after(LAUNCH)).toBe(Date.parse(T0))
	})

	it('moves the phase’s start to the event that moved the child to a new phase', () => {
		const implement: Step = [T1, KIND.LANE_PHASE, IMPLEMENT_TEXT]
		const gate: Step = [T2, KIND.SHIP_STAGE, '#3409 gate start']

		expect(phase_ms_after(LAUNCH, implement)).toBe(Date.parse(T1))
		expect(phase_ms_after(LAUNCH, implement, gate)).toBe(Date.parse(T2))
	})

	it('keeps the phase’s start where a second session’s first edit names the same phase', () => {
		const first: Step = [T1, KIND.LANE_PHASE, IMPLEMENT_TEXT]
		const second: Step = [T2, KIND.LANE_PHASE, IMPLEMENT_TEXT]

		expect(phase_ms_after(LAUNCH, first, second)).toBe(Date.parse(T1))
	})

	it('keeps the phase’s start across a cut and a resume', () => {
		const implement: Step = [T1, KIND.LANE_PHASE, IMPLEMENT_TEXT]
		const cut: Step = [T2, KIND.CUT, '#3409 cut']
		const resume: Step = [T3, KIND.RESUME, '#3409 resumed']

		expect(phase_ms_after(LAUNCH, implement, cut, resume)).toBe(Date.parse(T1))
	})
})
