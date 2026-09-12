import { describe, expect, it } from 'vitest'
import { time_markers } from './time-markers'
import { time_overlap } from './time-overlap'
import { time_phase_fixture } from './time-phase-fixture'
import { time_phases } from './time-phases'

// The review phase after joshuafolkken/kit#1855 moved the review into a forked subagent
// (joshuafolkken/kit#1846). The launch is a main-line `Agent` call and the review's real wall clock is
// the fork's own spans, which carry no marker of their own — so the phase is only non-zero if the
// `Agent` launch is marked and its unit's spans inherit that marker through `time-overlap.ts`. These
// exercise the whole chain: `tool_marker` on the launch, the inheritance, and the phase totals.

const { span, minutes_of, detected, NO_CI, PR_COMMAND, MERGE_COMMAND } = time_phase_fixture

// A launch prompt as the main line writes one: the invocation the subagent is told to run, and the
// attestation line the passed-through brief carries.
const REVIEW_PROMPT = 'Invoke /code-review with this brief; then run pnpm josh review:attest abc'
const PNPM_LABEL = 'Bash: pnpm'

describe('time_phases — a forked review carries a real duration', () => {
	// The regression: with the launch unmarked its unit's `Read`s inherit nothing, fall into rework,
	// and the review reads ~0. Marking the launch is what charges the fork's real minutes to review.
	it('charges a forked review to the review phase through marker inheritance', () => {
		const marker = time_markers.tool_marker('Agent', { prompt: REVIEW_PROMPT })
		const parent = [span(0, 10, { marker, label: 'Agent' })]
		const delegated = [span(0, 8, { label: 'Read' }), span(8, 2, { label: 'Read' })]
		const resolved = time_overlap.resolve_delegated(parent, delegated)
		const phases = time_phases.build_phases({ spans: resolved, ...NO_CI })

		expect([
			minutes_of(phases, time_phases.REVIEW_PHASE),
			detected(phases, time_phases.REVIEW_PHASE),
		]).toEqual([10, true])
	})

	// The two-round acceptance criterion: a review before the pull request and one after it show up as
	// two review regions straddling the `pr` row, and their minutes add up across both.
	it('shows two review regions straddling the pull request in a two-round run', () => {
		const spans = [
			span(0, 1, { marker: time_markers.EDIT_MARKER, label: 'Edit' }),
			span(1, 5, { marker: time_markers.REVIEW_MARKER, label: 'Read' }),
			span(6, 2, { josh_command: PR_COMMAND, label: PNPM_LABEL }),
			span(8, 4, { marker: time_markers.REVIEW_MARKER, label: 'Read' }),
			span(12, 3, { josh_command: MERGE_COMMAND, label: PNPM_LABEL }),
		]
		const phases = time_phases.build_phases({ spans, ...NO_CI })

		expect(time_phases.classify(spans)).toEqual([
			time_phases.IMPLEMENT_PHASE,
			time_phases.REVIEW_PHASE,
			time_phases.PR_PHASE,
			time_phases.REVIEW_PHASE,
			time_phases.MERGE_PHASE,
		])
		expect(minutes_of(phases, time_phases.REVIEW_PHASE)).toBe(9)
	})
})
