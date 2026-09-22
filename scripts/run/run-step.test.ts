import { describe, expect, it } from 'vitest'
import { run_event_stream } from './run-event-stream'
import { run_step, type StepInput } from './run-step'

const KIND = run_event_stream.EVENT_KIND
const ISSUE = '2248'
const MERGE_COMMAND = `pnpm josh run:merge ${ISSUE}`
const FOLLOWUP_COMMAND = 'pnpm josh followup'

function input(overrides: Partial<StepInput>): StepInput {
	return {
		issue_number: ISSUE,
		state: 'OPEN',
		is_human_review: false,
		latest_scope: 'skip',
		last_event: undefined,
		carry_kind: 'none',
		is_retrospective_done: false,
		is_lane_child: false,
		is_consumer: false,
		...overrides,
	}
}

// Every verdict is a single lower-case token, and every command starts with the josh prefix — neither
// is a prose sentence. The `decide` line is the one multi-word output, and it names its options.
const NOT_A_PROCEDURE = /^(pnpm josh [\w:.\- ]+|decide: .+|[a-z-]+)$/u

describe('run_step.pre_verdict', () => {
	it('implements an open issue with nothing owed', () => {
		expect(run_step.pre_verdict(input({}))).toBe(run_step.IMPLEMENT)
	})

	it('closed wins over a required update', () => {
		expect(run_step.pre_verdict(input({ state: 'CLOSED', latest_scope: 'required' }))).toBe(
			run_step.ALREADY_DONE,
		)
	})

	it('puts a required dependency update ahead of implementing', () => {
		expect(run_step.pre_verdict(input({ latest_scope: 'required' }))).toBe(run_step.UPDATE_DEPS)
	})

	it('surfaces a human-review stop ahead of the ordinary implement', () => {
		expect(run_step.pre_verdict(input({ is_human_review: true }))).toBe(run_step.HUMAN_REVIEW)
	})

	it('answers an unreadable state rather than falling through to implement', () => {
		expect(run_step.pre_verdict(input({ state: undefined }))).toBe(run_step.UNKNOWN)
	})
})

describe('run_step.next_action — carry and state guards', () => {
	it('answers unknown when the carry record is unreadable', () => {
		expect(run_step.next_action(input({ carry_kind: 'unreadable' }))).toEqual({
			kind: 'verdict',
			line: run_step.UNKNOWN,
		})
	})

	it('surfaces the expired budget as a person’s decision', () => {
		const action = run_step.next_action(input({ carry_kind: 'expired' }))

		expect(action.kind).toBe('decide')
		expect(action.line).toBe(run_step.EXPIRED_DECISION)
	})

	it('answers already-done for a closed issue whatever the event', () => {
		expect(run_step.next_action(input({ state: 'CLOSED', last_event: KIND.MERGE })).line).toBe(
			run_step.ALREADY_DONE,
		)
	})

	it('answers unknown for an unreadable state', () => {
		expect(run_step.next_action(input({ state: undefined })).line).toBe(run_step.UNKNOWN)
	})
})

describe('run_step.next_action — pre-implementation position', () => {
	it('reads a plan as still the pre-implementation position', () => {
		expect(run_step.next_action(input({ last_event: KIND.PLAN })).line).toBe(run_step.IMPLEMENT)
	})

	it('implements an open issue with an empty stream', () => {
		expect(run_step.next_action(input({})).line).toBe(run_step.IMPLEMENT)
	})
})

describe('run_step.next_action — event-driven position', () => {
	it.each([
		[KIND.PR_OPENED, FOLLOWUP_COMMAND],
		[KIND.REVIEW_ROUND, 'pnpm josh review:round2'],
		[KIND.MERGE, MERGE_COMMAND],
		[KIND.OUTAGE, MERGE_COMMAND],
		[KIND.PARK, 'pnpm josh backlog:next'],
		[KIND.CUT, `pnpm josh run:cut --resume ${ISSUE}`],
	])('dispatches to a command after %s', (last_event, line) => {
		expect(run_step.next_action(input({ last_event }))).toEqual({ kind: 'command', line })
	})

	it('answers a wait verdict after a child launch', () => {
		expect(run_step.next_action(input({ last_event: KIND.CHILD_LAUNCH })).line).toBe(run_step.WAIT)
	})
})

// joshuafolkken/kit#2328: a run that drained its backlog owes an end-of-run retrospective before it
// ends. `run:step` prints it at the stop position — once, gated by the carry flag — and never for a
// dispatched lane child, which runs one at the batch's own end (the `release:scope` precedent).
describe('run_step.next_action — the end-of-run retrospective at the stop position', () => {
	it('dispatches the retrospective at a stop that has not run one', () => {
		expect(run_step.next_action(input({ last_event: KIND.STOP }))).toEqual({
			kind: 'command',
			line: run_step.RETROSPECTIVE_COMMAND,
		})
	})

	it('stops rather than repeating a retrospective already run this invocation', () => {
		expect(
			run_step.next_action(input({ last_event: KIND.STOP, is_retrospective_done: true })).line,
		).toBe(run_step.STOP)
	})

	it('never runs a retrospective in a dispatched lane child', () => {
		expect(run_step.next_action(input({ last_event: KIND.STOP, is_lane_child: true })).line).toBe(
			run_step.STOP,
		)
	})

	it('never runs the kit-only retrospective in a consumer checkout', () => {
		expect(run_step.next_action(input({ last_event: KIND.STOP, is_consumer: true })).line).toBe(
			run_step.STOP,
		)
	})
})

// joshuafolkken/kit#2297: a dispatched lane child is never handed `run:merge` — the parent's budget
// command, which returns `busy` in a child (joshuafolkken/kit#2267). It stops at a parent-only
// position instead, so the child is never pointed at a command the runtime guard would refuse.
describe('run_step.next_action — the lane child never reaches run:merge', () => {
	it.each([[KIND.MERGE], [KIND.OUTAGE]])('answers stop after %s in a lane child', (last_event) => {
		expect(run_step.next_action(input({ last_event, is_lane_child: true })).line).toBe(
			run_step.STOP,
		)
	})

	it.each([[KIND.MERGE], [KIND.OUTAGE]])(
		'still dispatches run:merge after %s outside a lane',
		(last_event) => {
			expect(run_step.next_action(input({ last_event, is_lane_child: false })).line).toBe(
				MERGE_COMMAND,
			)
		},
	)

	it('leaves the other event positions unchanged in a lane child', () => {
		const action = run_step.next_action(input({ last_event: KIND.PR_OPENED, is_lane_child: true }))

		expect(action.line).toBe(FOLLOWUP_COMMAND)
	})
})

describe('run_step.next_action — the printed contract', () => {
	const CASES: ReadonlyArray<Partial<StepInput>> = [
		{},
		{ state: 'CLOSED' },
		{ state: undefined },
		{ latest_scope: 'required' },
		{ is_human_review: true },
		{ carry_kind: 'unreadable' },
		{ carry_kind: 'expired' },
		...Object.values(KIND).map((last_event) => ({ last_event })),
	]

	it('never prints a prose procedure', () => {
		for (const overrides of CASES) {
			expect(run_step.next_action(input(overrides)).line).toMatch(NOT_A_PROCEDURE)
		}
	})

	it('returns the same line for the same state', () => {
		for (const overrides of CASES) {
			const first = run_step.next_action(input(overrides)).line
			const second = run_step.next_action(input(overrides)).line

			expect(second).toBe(first)
		}
	})
})
