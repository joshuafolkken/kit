import { describe, expect, it } from 'vitest'
import { time_markers } from './time-markers'
import { time_phases, type PhaseName, type PhaseTotal } from './time-phases'
import { time_spans, type Span } from './time-spans'

const MINUTE_MS = 60_000
const NO_CI = { ci_ms: 0, has_ci_data: false }
const PNPM_LABEL = 'Bash: pnpm'

// Positioned by start minute so a test reads as a timeline rather than as a list of durations: the
// windows are decided from when a span sits, and a helper that only carried lengths could not say.
function span(start_minute: number, minutes: number, extra: Partial<Span> = {}): Span {
	return {
		category: time_spans.TOOL_CATEGORY,
		label: '',
		josh_command: '',
		marker: time_markers.NO_MARKER,
		branch: 'main',
		ended_ms: (start_minute + minutes) * MINUTE_MS,
		duration_ms: minutes * MINUTE_MS,
		...extra,
	}
}

function minutes_of(phases: ReadonlyArray<PhaseTotal>, phase: PhaseName): number {
	return (phases.find((total) => total.phase === phase)?.duration_ms ?? 0) / MINUTE_MS
}

function detected(phases: ReadonlyArray<PhaseTotal>, phase: PhaseName): boolean {
	return phases.find((total) => total.phase === phase)?.is_detected === true
}

// One whole run, in the order a `fullrun` walks it.
const RUN: ReadonlyArray<Span> = [
	span(0, 2),
	span(2, 1, { marker: time_markers.PLAN_MARKER, label: 'Bash: gh' }),
	span(3, 4, { marker: time_markers.EDIT_MARKER, label: 'Edit' }),
	span(7, 3, { label: 'Read' }),
	span(10, 5, { josh_command: 'josh gate', label: PNPM_LABEL }),
	span(15, 6, { marker: time_markers.REVIEW_MARKER, label: 'Skill' }),
	span(21, 2, { josh_command: 'josh git', label: PNPM_LABEL }),
	span(23, 7, { josh_command: 'josh followup', label: PNPM_LABEL }),
]

describe('time_phases.build_phases — classification', () => {
	it('reports every phase in run order', () => {
		const phases = time_phases.build_phases({ spans: RUN, ...NO_CI })

		expect(phases.map((total) => total.phase)).toEqual([...time_phases.PHASE_ORDER])
	})

	it('closes planning at the plan comment', () => {
		const phases = time_phases.build_phases({ spans: RUN, ...NO_CI })

		expect(minutes_of(phases, time_phases.PLAN_PHASE)).toBe(3)
	})

	it('runs implementation from the first edit to the first gate', () => {
		const phases = time_phases.build_phases({ spans: RUN, ...NO_CI })

		expect(minutes_of(phases, time_phases.IMPLEMENT_PHASE)).toBe(7)
	})

	it('collects the gate, review, pr and merge commands into their own phases', () => {
		const phases = time_phases.build_phases({ spans: RUN, ...NO_CI })

		expect([
			minutes_of(phases, time_phases.GATE_PHASE),
			minutes_of(phases, time_phases.REVIEW_PHASE),
			minutes_of(phases, time_phases.PR_PHASE),
			minutes_of(phases, time_phases.MERGE_PHASE),
		]).toEqual([5, 6, 2, 7])
	})

	// The gate is started beside the review rather than in front of it, so its spans land inside the
	// review's stretch of the timeline. Charging them to the review would hide the whole point.
	it('charges a gate run that overlaps the review to the gate', () => {
		const spans = [
			span(0, 4, { marker: time_markers.REVIEW_MARKER }),
			span(1, 2, { josh_command: 'josh gate' }),
		]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect(minutes_of(phases, time_phases.GATE_PHASE)).toBe(2)
	})
})

describe('time_phases.build_phases — the total is preserved', () => {
	it('keeps an interval belonging to no phase as other', () => {
		const phases = time_phases.build_phases({ spans: RUN, ...NO_CI })

		expect(minutes_of(phases, time_phases.OTHER_PHASE)).toBe(0)
	})

	it('sums to the elapsed time the spans and the CI share account for', () => {
		const spans = [span(0, 5), span(5, 4, { marker: time_markers.EDIT_MARKER })]
		const phases = time_phases.build_phases({ spans, ci_ms: 3 * MINUTE_MS, has_ci_data: true })
		const total = phases.reduce((sum, entry) => sum + entry.duration_ms, 0)

		expect(total).toBe(12 * MINUTE_MS)
	})

	it('holds a span that matches no marker in other rather than dropping it', () => {
		const spans = [span(0, 9)]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect(minutes_of(phases, time_phases.OTHER_PHASE)).toBe(9)
	})
})

describe('time_phases.build_phases — detection', () => {
	it('reports a phase whose marker never appeared as not detected', () => {
		const phases = time_phases.build_phases({ spans: [span(0, 5)], ...NO_CI })

		expect(detected(phases, time_phases.PLAN_PHASE)).toBe(false)
	})

	it('reports the phases whose markers did appear as detected', () => {
		const phases = time_phases.build_phases({ spans: RUN, ...NO_CI })

		expect([
			detected(phases, time_phases.PLAN_PHASE),
			detected(phases, time_phases.IMPLEMENT_PHASE),
			detected(phases, time_phases.GATE_PHASE),
			detected(phases, time_phases.REVIEW_PHASE),
		]).toEqual([true, true, true, true])
	})

	it('detects the CI phase only where the GitHub half was read', () => {
		const with_ci = time_phases.build_phases({ spans: RUN, ci_ms: MINUTE_MS, has_ci_data: true })
		const without = time_phases.build_phases({ spans: RUN, ...NO_CI })

		expect([
			detected(with_ci, time_phases.CI_PHASE),
			detected(without, time_phases.CI_PHASE),
		]).toEqual([true, false])
	})

	it('always reports other, because it is a remainder rather than a marker', () => {
		const phases = time_phases.build_phases({ spans: [], ...NO_CI })

		expect(detected(phases, time_phases.OTHER_PHASE)).toBe(true)
	})
})

describe('time_phases.build_phases — the window boundaries', () => {
	// A run that stopped before its gate still implemented something; saying so is the honest answer,
	// and the missing gate is already visible in its own row.
	it('runs implementation to the end of what was measured when no gate ran', () => {
		const spans = [span(0, 2), span(2, 6, { marker: time_markers.EDIT_MARKER })]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect(minutes_of(phases, time_phases.IMPLEMENT_PHASE)).toBe(6)
	})

	// A resumed session gates the previous issue before this one's first edit. Closing the window at
	// that gate would invert it, and every implementation span would fall out of a phase still
	// reported as detected — a confident zero where the flag exists to prevent one.
	it('ignores a gate that ran before the first edit when closing the window', () => {
		const spans = [
			span(0, 2, { josh_command: 'josh gate' }),
			span(2, 5, { marker: time_markers.EDIT_MARKER }),
			span(7, 3, { josh_command: 'josh gate' }),
		]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect(minutes_of(phases, time_phases.IMPLEMENT_PHASE)).toBe(5)
	})

	// The completion comment and an auto-decision log take the plan comment's exact shape, so a run
	// that posted no plan would otherwise have everything before its last comment called planning.
	it('refuses an issue comment posted after implementation opened as the plan boundary', () => {
		const spans = [
			span(0, 3, { marker: time_markers.EDIT_MARKER }),
			span(3, 4, { marker: time_markers.PLAN_MARKER }),
		]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect(detected(phases, time_phases.PLAN_PHASE)).toBe(false)
	})

	// A run whose file changes went through Bash records no edit marker, so the first edit cannot be
	// the bound. Without the second one, that run's completion comment closed a planning phase
	// covering nearly the whole of it.
	it('bounds planning by the first command phase when no edit was recorded', () => {
		const spans = [
			span(0, 4, { josh_command: 'josh gate' }),
			span(4, 3, { marker: time_markers.PLAN_MARKER }),
		]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect(detected(phases, time_phases.PLAN_PHASE)).toBe(false)
	})
})
