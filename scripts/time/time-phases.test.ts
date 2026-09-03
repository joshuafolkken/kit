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

// A span that closes at a typed prompt — the interval nobody was at the keyboard for. It carries no
// tool name and no marker, exactly as `time-spans.ts` writes one, so a test cannot accidentally rest
// on a combination a transcript never produces.
function waited(start_minute: number, minutes: number): Span {
	return span(start_minute, minutes, { category: time_spans.HUMAN_CATEGORY })
}

function minutes_of(phases: ReadonlyArray<PhaseTotal>, phase: PhaseName): number {
	return (phases.find((total) => total.phase === phase)?.duration_ms ?? 0) / MINUTE_MS
}

function detected(phases: ReadonlyArray<PhaseTotal>, phase: PhaseName): boolean {
	return phases.find((total) => total.phase === phase)?.is_detected === true
}

// What every reconstruction test compares against: the phases must still add up to the elapsed time,
// whichever window a span was moved out of.
function total_ms(phases: ReadonlyArray<PhaseTotal>): number {
	return phases.reduce((sum, entry) => sum + entry.duration_ms, 0)
}

// One whole run, in the order a `fullrun` walks it: the edit, the gate, the fix the gate demanded,
// the review, the fix the review demanded, then the pull request and the merge.
const RUN: ReadonlyArray<Span> = [
	span(0, 2),
	span(2, 1, { marker: time_markers.PLAN_MARKER, label: 'Bash: gh' }),
	span(3, 4, { marker: time_markers.EDIT_MARKER, label: 'Edit' }),
	span(7, 3, { label: 'Read' }),
	span(10, 5, { josh_command: 'josh gate', label: PNPM_LABEL }),
	span(15, 2, { marker: time_markers.EDIT_MARKER, label: 'Edit' }),
	span(17, 6, { marker: time_markers.REVIEW_MARKER, label: 'Skill' }),
	span(23, 1, { marker: time_markers.EDIT_MARKER, label: 'Edit' }),
	span(24, 2, { josh_command: 'josh git', label: PNPM_LABEL }),
	span(26, 7, { josh_command: 'josh followup', label: PNPM_LABEL }),
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

// The window joshuafolkken/kit#1281 added: a run does not stop editing at its first gate, and with
// `implement` ending there every later fix fell into `other`.
describe('time_phases.build_phases — the rework window', () => {
	it('runs rework from the first gate to the pull request', () => {
		const phases = time_phases.build_phases({ spans: RUN, ...NO_CI })

		expect(minutes_of(phases, time_phases.REWORK_PHASE)).toBe(3)
	})

	// Closing rework at the review instead would send the fix the review itself demanded back into
	// `other` — the same defect one stage further along.
	it('keeps a fix made after the review in rework rather than in other', () => {
		const spans = [
			span(0, 1, { marker: time_markers.EDIT_MARKER }),
			span(1, 2, { josh_command: 'josh gate' }),
			span(3, 4, { marker: time_markers.REVIEW_MARKER }),
			span(7, 5, { marker: time_markers.EDIT_MARKER }),
			span(12, 1, { josh_command: 'josh git' }),
		]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect([
			minutes_of(phases, time_phases.REWORK_PHASE),
			minutes_of(phases, time_phases.OTHER_PHASE),
		]).toEqual([5, 0])
	})

	// A `halfrun` stops before the commit, so no pull request is ever opened. Everything it fixed
	// after its gate is still rework, and closing the window at nothing would have lost it again.
	it('runs rework to the end of what was measured when no pull request was opened', () => {
		const spans = [
			span(0, 1, { marker: time_markers.EDIT_MARKER }),
			span(1, 2, { josh_command: 'josh gate' }),
			span(3, 4),
		]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect(minutes_of(phases, time_phases.REWORK_PHASE)).toBe(4)
	})
})

// joshuafolkken/kit#1290: a window collects intervals, and waiting for a person is an interval — so
// every window phase used to report how long somebody waited alongside how long its stage took.
describe('time_phases.build_phases — the wait phase', () => {
	it('keeps a wait inside the implementation window out of implement', () => {
		const spans = [span(0, 3, { marker: time_markers.EDIT_MARKER }), waited(3, 8)]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect([
			minutes_of(phases, time_phases.IMPLEMENT_PHASE),
			minutes_of(phases, time_phases.WAIT_PHASE),
		]).toEqual([3, 8])
	})

	// The `halfrun` case the issue was filed for: no pull request is opened, so the rework window runs
	// to the end of what was measured — and what a `halfrun` does at that end is wait for a person.
	it('keeps the trailing wait of a run that opened no pull request out of rework', () => {
		const spans = [
			span(0, 1, { marker: time_markers.EDIT_MARKER }),
			span(1, 2, { josh_command: 'josh gate' }),
			span(3, 2),
			waited(5, 20),
		]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect([
			minutes_of(phases, time_phases.REWORK_PHASE),
			minutes_of(phases, time_phases.WAIT_PHASE),
		]).toEqual([2, 20])
	})

	it('keeps a wait before the plan comment out of plan', () => {
		const spans = [
			waited(0, 9),
			span(9, 1, { marker: time_markers.PLAN_MARKER }),
			span(10, 2, { marker: time_markers.EDIT_MARKER }),
		]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect([
			minutes_of(phases, time_phases.PLAN_PHASE),
			minutes_of(phases, time_phases.WAIT_PHASE),
		]).toEqual([1, 9])
	})
})

describe('time_phases.build_phases — the wait phase outside the windows', () => {
	// A wait belonging to no window used to land in the remainder, where it is hidden behind whatever
	// else fell there. A run that stalls on a person is a fact about the run.
	it('names a wait that belongs to no window rather than leaving it in other', () => {
		const spans = [waited(0, 6), span(6, 2)]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect([
			minutes_of(phases, time_phases.WAIT_PHASE),
			minutes_of(phases, time_phases.OTHER_PHASE),
		]).toEqual([6, 2])
	})

	// Every delegated child of an `epicrun` is this run: nobody was at the keyboard, so the honest
	// answer is a measured zero rather than the `not detected` a missing boundary marker earns.
	it('reports a run nobody waited on as zero rather than as not detected', () => {
		const phases = time_phases.build_phases({ spans: RUN, ...NO_CI })

		expect([
			minutes_of(phases, time_phases.WAIT_PHASE),
			detected(phases, time_phases.WAIT_PHASE),
		]).toEqual([0, true])
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

		expect(total_ms(phases)).toBe(12 * MINUTE_MS)
	})

	it('holds a span that matches no marker in other rather than dropping it', () => {
		const phases = time_phases.build_phases({ spans: [span(0, 9)], ...NO_CI })

		expect(minutes_of(phases, time_phases.OTHER_PHASE)).toBe(9)
	})

	// Splitting a window in two must not create or lose a minute: every span still lands in exactly
	// one phase, which is what keeps two runs comparable.
	it('still reconstructs a whole run exactly once rework has taken its share', () => {
		const phases = time_phases.build_phases({ spans: RUN, ...NO_CI })
		const measured = RUN.reduce((sum, entry) => sum + entry.duration_ms, 0)

		expect(total_ms(phases)).toBe(measured)
	})
})

describe('time_phases.build_phases — the total survives the wait phase', () => {
	// Moving the waiting out of the windows must not lose it: whatever leaves a window lands in `wait`,
	// which is the condition joshuafolkken/kit#1290 was filed under.
	it('still reconstructs a run whose waiting was taken out of the windows', () => {
		const spans = [
			span(0, 3, { marker: time_markers.EDIT_MARKER }),
			waited(3, 4),
			span(7, 2, { josh_command: 'josh gate' }),
			waited(9, 5),
		]
		const phases = time_phases.build_phases({ spans, ci_ms: 2 * MINUTE_MS, has_ci_data: true })

		expect(total_ms(phases)).toBe(16 * MINUTE_MS)
	})

	// The invariant the phase table is cross-checked against: every human span goes to `wait` and
	// nothing else does, so the row equals the human-wait category the same report prints above it.
	it('gives the wait phase exactly the human category total', () => {
		const spans = [
			waited(0, 3),
			span(3, 1, { marker: time_markers.EDIT_MARKER }),
			span(4, 2, { josh_command: 'josh gate' }),
			waited(6, 6),
		]
		const phases = time_phases.build_phases({ spans, ...NO_CI })
		const human_minutes = spans
			.filter((entry) => entry.category === time_spans.HUMAN_CATEGORY)
			.reduce((sum, entry) => sum + entry.duration_ms / MINUTE_MS, 0)

		expect(minutes_of(phases, time_phases.WAIT_PHASE)).toBe(human_minutes)
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
			detected(phases, time_phases.REWORK_PHASE),
			detected(phases, time_phases.REVIEW_PHASE),
		]).toEqual([true, true, true, true, true])
	})

	// A run that never gated never reached rework, which is a different answer from having reworked
	// for no time at all — the distinction `not detected` exists to keep.
	it('reports rework as not detected when no gate ran', () => {
		const spans = [span(0, 2), span(2, 6, { marker: time_markers.EDIT_MARKER })]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect(detected(phases, time_phases.REWORK_PHASE)).toBe(false)
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
