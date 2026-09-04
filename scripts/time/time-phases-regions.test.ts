import { describe, expect, it } from 'vitest'
import { time_markers } from './time-markers'
import { time_phase_fixture } from './time-phase-fixture'
import { time_phases } from './time-phases'

// joshuafolkken/kit#1299: `other` printed with `is_detected: true`, so it ranked as a measured block
// nobody could propose a cut against — 19–63% of each of the four runs the issue was filed from, and
// larger in every one of them than the biggest named phase. It is four regions and a remainder.

const { MINUTE_MS, NO_CI, GATE_COMMAND, PR_COMMAND, MERGE_COMMAND } = time_phase_fixture
const { span, waited, minutes_of, detected, total_ms } = time_phase_fixture

describe('time_phases.build_phases — setup and wrapup', () => {
	// A `fullrun` reads the issue, normalizes its title, pulls the default branch and settles the
	// approach before it touches a file. All of it used to be reported as belonging to no stage.
	it('names the stretch before the first edit setup rather than other', () => {
		const spans = [span(0, 6), span(6, 2, { marker: time_markers.EDIT_MARKER })]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect([
			minutes_of(phases, time_phases.SETUP_PHASE),
			minutes_of(phases, time_phases.OTHER_PHASE),
		]).toEqual([6, 0])
	})

	// The second review round, the follow-up filing and the completion summary all run beside the CI
	// the commit started, so they sit after the pull request and inside no window.
	it('names the work done after the pull request opened wrapup rather than other', () => {
		const spans = [
			span(0, 1, { marker: time_markers.EDIT_MARKER }),
			span(1, 1, { josh_command: GATE_COMMAND }),
			span(2, 1, { josh_command: PR_COMMAND }),
			span(3, 4),
		]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect([
			minutes_of(phases, time_phases.WRAPUP_PHASE),
			minutes_of(phases, time_phases.OTHER_PHASE),
		]).toEqual([4, 0])
	})
})

describe('time_phases.build_phases — outside the run', () => {
	// The conversation that produced the Issue is attributed to it by the same fill-forward walk that
	// attributes the run, so without this boundary it is measured as the run's own preparation.
	it('names what happened before the workflow opened pre-run rather than setup', () => {
		const spans = [
			span(0, 5),
			span(5, 1, { marker: time_markers.WORKFLOW_MARKER }),
			span(6, 2),
			span(8, 3, { marker: time_markers.EDIT_MARKER }),
		]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect([
			minutes_of(phases, time_phases.PRE_RUN_PHASE),
			minutes_of(phases, time_phases.SETUP_PHASE),
		]).toEqual([5, 3])
	})

	// The tail after the merge is the next piece of work, filled backward onto this issue. One
	// measured run charged 9.9 minutes of a following conversation to itself.
	it('names what happened after the merge post-run rather than wrapup', () => {
		const spans = [
			span(0, 1, { marker: time_markers.EDIT_MARKER }),
			span(1, 1, { josh_command: GATE_COMMAND }),
			span(2, 1, { josh_command: PR_COMMAND }),
			span(3, 2),
			span(5, 1, { josh_command: MERGE_COMMAND }),
			span(6, 7),
		]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect([
			minutes_of(phases, time_phases.WRAPUP_PHASE),
			minutes_of(phases, time_phases.POST_RUN_PHASE),
		]).toEqual([2, 7])
	})
})

describe('time_phases.build_phases — where the run ends', () => {
	// `followup` exits non-zero on an AI-review blocker and is re-run, so the first merge command is
	// not the end of the run — everything between the two attempts is still the run's own work.
	it('closes the run at the last merge command rather than the first', () => {
		const spans = [
			span(0, 1, { marker: time_markers.EDIT_MARKER }),
			span(1, 1, { josh_command: GATE_COMMAND }),
			span(2, 1, { josh_command: PR_COMMAND }),
			span(3, 1, { josh_command: MERGE_COMMAND }),
			span(4, 4),
			span(8, 1, { josh_command: MERGE_COMMAND }),
		]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect([
			minutes_of(phases, time_phases.WRAPUP_PHASE),
			minutes_of(phases, time_phases.POST_RUN_PHASE),
		]).toEqual([4, 0])
	})

	// The remainder is still kept: a span between the work starting and the pull request that no
	// window covers belongs to no region either, and inventing one for it would be the defect again.
	it('leaves a span that fits no region in other', () => {
		const spans = [
			span(0, 1, { josh_command: GATE_COMMAND }),
			span(1, 3),
			span(4, 1, { marker: time_markers.EDIT_MARKER }),
			span(5, 1, { josh_command: PR_COMMAND }),
		]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect([
			minutes_of(phases, time_phases.OTHER_PHASE),
			minutes_of(phases, time_phases.SETUP_PHASE),
		]).toEqual([3, 0])
	})
})

describe('time_phases.build_phases — the workflow start floors the windows', () => {
	// The session edited files before the keyword was typed — a leftover task, a doc tweak. Taking
	// that edit as the first one opens `implement` ahead of the run, swallows the whole preceding
	// stretch into it, and leaves `setup` an empty window that was reported as detected.
	it('ignores an edit made before the workflow opened', () => {
		const spans = [
			span(0, 4, { marker: time_markers.EDIT_MARKER }),
			span(4, 1, { marker: time_markers.WORKFLOW_MARKER }),
			span(5, 3),
			span(8, 2, { marker: time_markers.EDIT_MARKER }),
		]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect([
			minutes_of(phases, time_phases.PRE_RUN_PHASE),
			minutes_of(phases, time_phases.SETUP_PHASE),
			minutes_of(phases, time_phases.IMPLEMENT_PHASE),
		]).toEqual([4, 4, 2])
	})

	// The same floor under the gate: a run resumed in a session that gated the previous issue never
	// reworked anything, and `not detected` is a different answer from zero minutes of rework.
	it('ignores a gate that ran before the workflow opened', () => {
		const spans = [
			span(0, 2, { josh_command: GATE_COMMAND }),
			span(2, 1, { marker: time_markers.WORKFLOW_MARKER }),
			span(3, 4),
		]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect(detected(phases, time_phases.REWORK_PHASE)).toBe(false)
	})
})

describe('time_phases.build_phases — the regions preserve the totals', () => {
	// Splitting the remainder four ways must not create or lose a minute, exactly as splitting off
	// `rework` and `wait` before it must not.
	it('still reconstructs a run whose remainder was cut into regions', () => {
		const spans = [
			span(0, 4),
			span(4, 1, { marker: time_markers.WORKFLOW_MARKER }),
			span(5, 2),
			span(7, 3, { marker: time_markers.EDIT_MARKER }),
			span(10, 1, { josh_command: PR_COMMAND }),
			span(11, 2),
			span(13, 1, { josh_command: MERGE_COMMAND }),
			span(14, 5),
		]
		const phases = time_phases.build_phases({ spans, ci_ms: 2 * MINUTE_MS, has_ci_data: true })

		expect(total_ms(phases)).toBe(21 * MINUTE_MS)
	})

	// The invariant the phase table is cross-checked against: every human span goes to `wait`, so a
	// person waiting before the run opened stays there rather than moving into `pre-run`.
	it('keeps a wait before the workflow opened in wait rather than in pre-run', () => {
		const spans = [
			waited(0, 9),
			span(9, 1, { marker: time_markers.WORKFLOW_MARKER }),
			span(10, 2, { marker: time_markers.EDIT_MARKER }),
		]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect([
			minutes_of(phases, time_phases.WAIT_PHASE),
			minutes_of(phases, time_phases.PRE_RUN_PHASE),
		]).toEqual([9, 0])
	})
})

describe('time_phases.build_phases — the regions are detected on their own boundaries', () => {
	it('withholds all four when no boundary of theirs appeared', () => {
		const phases = time_phases.build_phases({ spans: [span(0, 5)], ...NO_CI })

		expect([
			detected(phases, time_phases.SETUP_PHASE),
			detected(phases, time_phases.WRAPUP_PHASE),
			detected(phases, time_phases.PRE_RUN_PHASE),
			detected(phases, time_phases.POST_RUN_PHASE),
		]).toEqual([false, false, false, false])
	})

	// A `halfrun` stops before the commit, so it has a setup to report and no pull request at all —
	// and a `wrapup` of `0.0 min` there would assert the run did nothing after opening one.
	it('reports wrapup as not detected when no pull request was opened', () => {
		const spans = [span(0, 2), span(2, 3, { marker: time_markers.EDIT_MARKER })]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect([
			detected(phases, time_phases.SETUP_PHASE),
			detected(phases, time_phases.WRAPUP_PHASE),
		]).toEqual([true, false])
	})

	// The two outside-the-run rows are detected separately because a run has one of their boundaries
	// far more often than none: a delegated unit whose parent loaded the skill never writes the label,
	// and a `halfrun` never merges. One row on either would call the unchecked half a measured zero.
	it('detects post-run from the merge alone while withholding pre-run', () => {
		const spans = [
			span(0, 1, { marker: time_markers.EDIT_MARKER }),
			span(1, 1, { josh_command: MERGE_COMMAND }),
		]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect([
			detected(phases, time_phases.POST_RUN_PHASE),
			detected(phases, time_phases.PRE_RUN_PHASE),
		]).toEqual([true, false])
	})
})
