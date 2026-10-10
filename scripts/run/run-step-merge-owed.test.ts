import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_step, type StepInput } from './run-step'

// joshuafolkken/kit#3442: a parent asked `run:step` about a child that had closed, was answered
// `already-done`, and never ran `run:merge` — the merge event's one writer — so `run:board` showed the
// child running forever. These read the owed merge through the same scope `run:step`'s CLI applies.

const KIND = run_event_stream.EVENT_KIND
const ISSUE = '3441'
const STARTED_AT = '2026-10-08T00:00:00.000Z'
const MERGE_COMMAND = `pnpm josh run:merge ${ISSUE}`

function event(pos: number, kind: string, text: string): RunEvent {
	return { pos, at: `2026-10-08T0${String(pos)}:00:00.000Z`, kind, text }
}

const LAUNCH = event(1, KIND.CHILD_LAUNCH, `#${ISSUE} launched`)
const MERGE = event(2, KIND.MERGE, `#${ISSUE} merged`)

function step_input(events: ReadonlyArray<RunEvent>, is_lane_child: boolean): StepInput {
	const is_merge_owed = run_event_scope.is_merge_owed(
		events,
		{ kind: 'since', started_at: STARTED_AT },
		ISSUE,
	)

	return {
		issue_number: ISSUE,
		state: 'CLOSED',
		is_human_review: false,
		latest_scope: 'skip',
		last_event: events.at(-1)?.kind,
		carry_kind: 'carried',
		is_retrospective_done: false,
		is_lane_child,
		is_consumer: false,
		is_retrospective_enabled: false,
		has_changes: false,
		has_completion_callback: true,
		is_at_cut_cap: false,
		is_handed_off: false,
		is_merge_owed,
	}
}

describe('run:step on a closed child whose merge is still owed', () => {
	it('points the parent at run:merge when the stream holds only the launch', () => {
		const action = run_step.next_action(step_input([LAUNCH], false))

		expect(action).toStrictEqual({ kind: 'command', line: MERGE_COMMAND })
	})

	it('answers already-done once the merge is recorded', () => {
		expect(run_step.next_action(step_input([LAUNCH, MERGE], false)).line).toBe(
			run_step.ALREADY_DONE,
		)
	})

	it('never hands a lane child run:merge for its closed issue', () => {
		expect(run_step.next_action(step_input([LAUNCH], true)).line).toBe(run_step.ALREADY_DONE)
	})
})
