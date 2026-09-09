import { describe, expect, it } from 'vitest'
import { time_markers } from './time-markers'
import { time_phase_fixture } from './time-phase-fixture'
import { time_phases } from './time-phases'
import type { Span } from './time-spans'

// What a phase counts once a command has been taken into the background (joshuafolkken/kit#1662).
//
// The gate is *started* beside the review rather than run in front of it, so its own span closes at
// the launch call two or three seconds later and the minutes it then ran fell to whichever window
// they opened in — `rework`, which the first gate itself opens. The window
// `time_background.positioned` stamps is what puts them back.
//
// It sits beside `time-phases.test.ts` rather than inside it because that file reached its length
// limit — the seam `time-phases-regions.test.ts` was already cut along, and the timeline builder is
// `time-phase-fixture.ts`'s in both.

const { NO_CI, GATE_COMMAND, span, minutes_of } = time_phase_fixture

const BACKGROUND_ID = 'b3sods4bd'

// The shape the issue is about: one minute of launch, six minutes of something beside it, one minute
// reading the output back.
function window_of(inside: Partial<Span>): ReadonlyArray<Span> {
	return [
		span(0, 1, { josh_command: GATE_COMMAND, background_command: GATE_COMMAND }),
		span(1, 6, { ...inside, background_command: GATE_COMMAND }),
		span(7, 1, { background_command: GATE_COMMAND }),
	]
}

describe('time_phases.build_phases — a backgrounded command window', () => {
	it('charges the wait inside the window to that command', () => {
		const phases = time_phases.build_phases({ spans: window_of({}), ...NO_CI })

		expect([
			minutes_of(phases, time_phases.GATE_PHASE),
			minutes_of(phases, time_phases.REWORK_PHASE),
		]).toEqual([8, 0])
	})

	// The precedence is the one that already keeps the gate out of the review: a span that says what it
	// is keeps its own answer, so what the window collects is the time nothing else was measured in —
	// which is what makes an overlapped gate and a gate joined at once read differently.
	it('leaves a review running beside the gate in the review', () => {
		const spans = window_of({ marker: time_markers.REVIEW_MARKER })
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect([
			minutes_of(phases, time_phases.GATE_PHASE),
			minutes_of(phases, time_phases.REVIEW_PHASE),
		]).toEqual([2, 6])
	})
})

describe('time_phases.build_phases — a backgrounded command nobody read back', () => {
	// The transcript then says only how long the launch call took, which is not how long the command
	// ran — so the row says so rather than presenting the seconds as the measurement.
	it('says the phase carries a background runtime that was not measured', () => {
		const spans = [
			span(0, 1, { josh_command: GATE_COMMAND, background_id: BACKGROUND_ID }),
			span(1, 5),
		]
		const phases = time_phases.build_phases({ spans, ...NO_CI })
		const gate = phases.find((total) => total.phase === time_phases.GATE_PHASE)

		expect(gate?.has_unread_background).toBe(true)
	})

	it('says nothing of the kind for a run that backgrounded nothing', () => {
		const phases = time_phases.build_phases({ spans: window_of({}), ...NO_CI })

		expect(phases.some((total) => total.has_unread_background)).toBe(false)
	})
})
