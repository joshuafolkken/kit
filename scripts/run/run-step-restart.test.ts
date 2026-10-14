import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_step, type StepInput } from './run-step'

// joshuafolkken/kit#3772: `lane:restart` re-dispatches a child in a fresh session and records a
// `restart` after the dispatch's own `child-launch`. The fresh child starts from its pre-implementation
// position whatever the stopped one had reached, and the parent reads the restart as a launch.

const KIND = run_event_stream.EVENT_KIND
const ISSUE = '3769'
const STARTED_AT = '2026-10-14T00:00:00.000Z'

function event(pos: number, kind: string, text: string): RunEvent {
	return { pos, at: `2026-10-14T0${String(pos)}:00:00.000Z`, kind, text }
}

const FIRST_LAUNCH = event(1, KIND.CHILD_LAUNCH, `#${ISSUE} dispatched`)
const CUT = event(2, KIND.CUT, `#${ISSUE} cut (implementation)`)
const RELAUNCH = event(3, KIND.CHILD_LAUNCH, `#${ISSUE} dispatched`)
const RESTART = event(4, KIND.RESTART, `#${ISSUE} restarted in a fresh session by a person`)
const EVENTS = [FIRST_LAUNCH, CUT, RELAUNCH, RESTART]

function next_line(is_lane_child: boolean): string {
	const last = run_event_scope.last_issue_event(
		EVENTS,
		{ kind: 'since', started_at: STARTED_AT },
		ISSUE,
		is_lane_child,
	)
	const input: StepInput = {
		issue_number: ISSUE,
		state: 'OPEN',
		is_human_review: false,
		latest_scope: 'skip',
		last_event: last?.kind,
		carry_kind: 'carried',
		is_retrospective_done: false,
		is_lane_child,
		is_consumer: false,
		is_retrospective_enabled: false,
		has_changes: false,
		has_completion_callback: true,
		is_at_cut_cap: false,
		is_handed_off: false,
		is_merge_owed: false,
	}

	return run_step.next_action(input).line
}

describe('run:step after a person restarted a lane child', () => {
	it('starts the fresh child at implementation, not at the stopped child’s cut', () => {
		expect(next_line(true)).toBe(run_step.IMPLEMENT)
	})

	it('has the parent wait on the restarted child as on a launch', () => {
		expect(next_line(false)).toBe(run_step.WAIT)
	})
})
