import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_step, type StepInput } from './run-step'

// joshuafolkken/kit#3375: `run:cut --resume` answered `resume-impl` and cleared the cut record, but the
// `cut` event stayed the newest position, so `run:step` kept answering the resume it had just run. The
// resume's own event is what moves the run back to implementation; these read it through the same
// lane-child scope `run:step`'s CLI applies.

const KIND = run_event_stream.EVENT_KIND
const ISSUE = '3370'
const STARTED_AT = '2026-10-07T00:00:00.000Z'
const RESUME_COMMAND = `pnpm josh run:cut --resume ${ISSUE}`

function event(pos: number, kind: string, text: string): RunEvent {
	return { pos, at: `2026-10-07T0${String(pos)}:00:00.000Z`, kind, text }
}

const CUT = event(1, KIND.CUT, `#${ISSUE} cut (implementation)`)
const RESUME = event(2, KIND.RESUME, `#${ISSUE} resumed`)

function next_line(events: ReadonlyArray<RunEvent>): string {
	const last = run_event_scope.last_issue_event(
		events,
		{ kind: 'since', started_at: STARTED_AT },
		ISSUE,
		true,
	)
	const input: StepInput = {
		issue_number: ISSUE,
		state: 'OPEN',
		is_human_review: false,
		latest_scope: 'skip',
		last_event: last?.kind,
		carry_kind: 'carried',
		is_retrospective_done: false,
		is_lane_child: true,
		is_consumer: false,
		is_retrospective_enabled: false,
		has_changes: true,
		has_completion_callback: true,
		is_at_cut_cap: false,
		is_handed_off: false,
		is_merge_owed: false,
	}

	return run_step.next_action(input).line
}

describe('run:step after an implementation resume', () => {
	it('answers the resume command while the cut is still the newest event', () => {
		expect(next_line([CUT])).toBe(RESUME_COMMAND)
	})

	it('answers implement once the resume event follows the cut', () => {
		expect(next_line([CUT, RESUME])).toBe(run_step.IMPLEMENT)
	})

	it('ignores another issue resuming after this one was cut', () => {
		const foreign = event(2, KIND.RESUME, '#9999 resumed')

		expect(next_line([CUT, foreign])).toBe(RESUME_COMMAND)
	})
})
