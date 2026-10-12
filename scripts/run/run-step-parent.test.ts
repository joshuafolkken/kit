import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_step, type ParentInput } from './run-step'

// joshuafolkken/kit#3665: a `backlogrun` begun on an empty backlog dispatched nothing, so no issue's
// position could name its next action and the parent ended the run instead of handing it to the idle
// watch. The parent's own position answers from the carry record alone.

const KIND = run_event_stream.EVENT_KIND

// A record this session began and still drives, with nothing emitted yet — the empty-backlog start.
function input(overrides: Partial<ParentInput> = {}): ParentInput {
	return {
		carry_kind: 'carried',
		is_driving: true,
		is_handed_off: false,
		is_at_cut_cap: false,
		last_event: undefined,
		is_lane_child: false,
		is_retrospective_done: false,
		is_consumer: false,
		is_retrospective_enabled: false,
		...overrides,
	}
}

describe('run_step.parent_action — the hand-off', () => {
	it('hands a freshly begun run to the supervisor though nothing was dispatched', () => {
		expect(run_step.parent_action(input()).line).toBe(run_step.HAND_OFF_COMMAND)
	})

	it('hands the loop over whatever the batch last did', () => {
		const positions = [KIND.CHILD_LAUNCH, KIND.MERGE, KIND.PARK, KIND.DRAIN]
		const lines = positions.map((last_event) => run_step.parent_action(input({ last_event })).line)

		expect(new Set(lines)).toEqual(new Set([run_step.HAND_OFF_COMMAND]))
	})

	it('waits at the cut cap, where the cut would be refused', () => {
		expect(run_step.parent_action(input({ is_at_cut_cap: true })).line).toBe(run_step.WAIT)
	})

	it('stops the session that already handed the record off', () => {
		const handed_off = input({ is_driving: false, is_handed_off: true })

		expect(run_step.parent_action(handed_off).line).toBe(run_step.STOP)
	})
})

describe('run_step.parent_action — the retrospective', () => {
	it('fires an owed retrospective at the drain before handing the loop back', () => {
		const drained = input({ last_event: KIND.DRAIN, is_retrospective_enabled: true })

		expect(run_step.parent_action(drained).line).toBe(run_step.RETROSPECTIVE_COMMAND)
	})

	it('hands the loop back once the retrospective has run', () => {
		const done = input({
			last_event: KIND.DRAIN,
			is_retrospective_enabled: true,
			is_retrospective_done: true,
		})

		expect(run_step.parent_action(done).line).toBe(run_step.HAND_OFF_COMMAND)
	})
})

describe('run_step.parent_action — a run that is not this session’s', () => {
	it('answers unknown with no carry record', () => {
		const none = input({ carry_kind: 'none', is_driving: false })

		expect(run_step.parent_action(none).line).toBe(run_step.UNKNOWN)
	})

	it('answers unknown for a record another session drives', () => {
		expect(run_step.parent_action(input({ is_driving: false })).line).toBe(run_step.UNKNOWN)
	})

	it('never hands a lane child the parent’s record', () => {
		expect(run_step.parent_action(input({ is_lane_child: true })).line).toBe(run_step.UNKNOWN)
	})

	it('answers unknown for an unreadable record', () => {
		const unreadable = input({ carry_kind: 'unreadable', is_driving: false })

		expect(run_step.parent_action(unreadable).line).toBe(run_step.UNKNOWN)
	})
})
