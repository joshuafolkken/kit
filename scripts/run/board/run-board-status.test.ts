import { backlog_idle } from '#scripts/backlog/backlog-idle'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { describe, expect, it } from 'vitest'
import type { ClosedIssue } from './run-board-closed'
import { run_board_notes } from './run-board-notes'
import { run_board_status, type ItemStatus, type OpenRead } from './run-board-status'

// joshuafolkken/kit#3430: what each child of a run is doing, and the run's own activity, read off the
// event stream and the open lanes — no GitHub read.

const KIND = run_event_stream.EVENT_KIND
const T0 = '2026-10-08T09:00:00.000Z'
const T1 = '2026-10-08T09:05:00.000Z'
const T2 = '2026-10-08T09:10:00.000Z'
const T3 = '2026-10-08T09:15:00.000Z'
const LAUNCH_3409 = '#3409 launched'
const MERGE_3409 = '#3409 merged'
const PLAN_3415 = 'planned #3415'
const DECISION_PARK = '#3433 parked (needs-decision)'
const NONE: ReadonlySet<number> = new Set()

const { STAGE } = run_ship_stage
const IMPLEMENT_3409: Step = [KIND.LANE_PHASE, '#3409 implement']

// One event after #3409's launch, as its kind and text.
type Step = [string, string]

function event_at(pos: number, at: string, kind: string, text: string): RunEvent {
	return { pos, at, kind, text }
}

function ship_3409(stage: string): Step {
	return [KIND.SHIP_STAGE, `#3409 ${stage} start`]
}

// The phase #3409 has reached after its launch and the given steps.
function phase_after(...later: ReadonlyArray<Step>): string | undefined {
	const steps: Array<Step> = [[KIND.CHILD_LAUNCH, LAUNCH_3409], ...later]
	const events = steps.map(([kind, text], index) => event_at(index + 1, T0, kind, text))

	return run_board_status.statuses_of(events, [], NONE).get(3409)?.phase
}

const IDLE_TEXT = backlog_idle.text_of({
	since_ms: Date.parse(T2),
	until_ms: Date.parse(T3),
	bound: 'idle',
	asked_ms: Date.parse(T2),
})

describe('run_board_status.statuses_of', () => {
	it('follows each child from launch to merge or park, keeping when it started', () => {
		const events = [
			event_at(1, T0, KIND.CHILD_LAUNCH, LAUNCH_3409),
			event_at(2, T0, KIND.CHILD_LAUNCH, '#3415 launched'),
			event_at(3, T1, KIND.PLAN, PLAN_3415),
			event_at(4, T2, KIND.MERGE, MERGE_3409),
			event_at(5, T3, KIND.PARK, DECISION_PARK),
		]
		const statuses = run_board_status.statuses_of(events, [], NONE)

		expect(statuses.get(3409)).toStrictEqual({
			state: 'merged',
			started_ms: Date.parse(T0),
			ended_ms: Date.parse(T2),
		})
		expect(statuses.get(3415)).toMatchObject({ state: 'running', phase: 'plan' })
		expect(statuses.get(3433)?.state).toBe('parked')
	})

	it('reads an in-scope lane the stream never saw launched as running, with its lane', () => {
		const statuses = run_board_status.statuses_of([], ['3420'], new Set([3420]))

		expect(statuses.get(3420)).toStrictEqual({ state: 'running', lane: 'lane 3420' })
	})

	it('leaves a settled child settled even while its lane is still open', () => {
		const events = [event_at(1, T0, KIND.MERGE, MERGE_3409)]

		expect(run_board_status.statuses_of(events, ['3409'], NONE).get(3409)?.state).toBe('merged')
	})
})

describe('run_board_status.statuses_of lanes', () => {
	it('leaves out a lane whose issue is neither on the stream nor in the run', () => {
		const statuses = run_board_status.statuses_of([], ['3347'], new Set([3441]))

		expect(statuses.has(3347)).toBe(false)
	})

	it('keeps a launched child running with its lane even when the plan does not name it', () => {
		const events = [event_at(1, T0, KIND.CHILD_LAUNCH, LAUNCH_3409)]
		const statuses = run_board_status.statuses_of(events, ['3409'], NONE)

		expect(statuses.get(3409)).toStrictEqual({
			state: 'running',
			started_ms: Date.parse(T0),
			phase: 'investigate',
			lane: 'lane 3409',
		})
	})
})

// joshuafolkken/kit#3444: a running child's phase, read from the records its steps already write.
describe('run_board_status.statuses_of phases', () => {
	it('walks from investigate through plan and implement to the ship stages', () => {
		expect(phase_after()).toBe('investigate')
		expect(phase_after([KIND.PLAN, 'planned #3409'])).toBe('plan')
		expect(phase_after(IMPLEMENT_3409)).toBe('implement')
		expect(phase_after(ship_3409(STAGE.GATE))).toBe('gate')
		expect(phase_after(ship_3409(STAGE.FOLLOWUP))).toBe('followup')
	})

	it('never goes back to an earlier phase', () => {
		expect(phase_after(ship_3409(STAGE.GATE), IMPLEMENT_3409)).toBe('gate')
	})

	it('keeps the phase across a cut and its resume', () => {
		const cut: Step = [KIND.CUT, '#3409 cut']

		expect(phase_after(IMPLEMENT_3409, cut, [KIND.RESUME, '#3409'])).toBe('implement')
	})

	it('takes no phase from another issue', () => {
		expect(phase_after([KIND.LANE_PHASE, '#3415 implement'])).toBe('investigate')
	})

	it('does not revive a merged child on a ship report after its merge', () => {
		const events = [
			event_at(1, T0, KIND.CHILD_LAUNCH, LAUNCH_3409),
			event_at(2, T1, KIND.MERGE, MERGE_3409),
			event_at(3, T2, ...ship_3409(STAGE.REPORT)),
		]

		expect(run_board_status.statuses_of(events, [], NONE).get(3409)?.state).toBe('merged')
	})

	it('ignores a plan event for an issue no lane has launched', () => {
		const events = [event_at(1, T0, KIND.PLAN, 'planned #3999')]

		expect(run_board_status.statuses_of(events, [], NONE).has(3999)).toBe(false)
	})
})

const RUNNING: ReadonlyMap<number, ItemStatus> = new Map([
	[3409, { state: 'running', started_ms: Date.parse(T0) }],
])
const NOT_READ: ReadonlyMap<number, ClosedIssue> = new Map()

function read_closed(closed: ClosedIssue): OpenRead {
	return { open_numbers: NONE, read_ms: Date.parse(T1), closed: new Map([[3409, closed]]) }
}

describe('run_board_status.settle_closed', () => {
	it('draws a running child the open listing no longer holds as done', () => {
		const settled = run_board_status.settle_closed(RUNNING, {
			open_numbers: NONE,
			read_ms: Date.parse(T1),
			closed: NOT_READ,
		})

		expect(settled.get(3409)).toStrictEqual({ state: 'done', started_ms: Date.parse(T0) })
	})

	it.each<[string, OpenRead]>([
		['still open', { open_numbers: new Set([3409]), read_ms: Date.parse(T1), closed: NOT_READ }],
		['a capped listing', { open_numbers: undefined, read_ms: Date.parse(T1), closed: NOT_READ }],
		[
			'launched after the read',
			{ open_numbers: NONE, read_ms: Date.parse(T0) - 1, closed: NOT_READ },
		],
	])('keeps the child running when %s', (_label, read) => {
		expect(run_board_status.settle_closed(RUNNING, read).get(3409)?.state).toBe('running')
	})
})

// joshuafolkken/kit#3451: a child read closed from GitHub ends when it closed, merged or not.
describe('run_board_status.settle_closed with a closed read', () => {
	it.each<[string, boolean, string]>([
		['merged', true, 'merged'],
		['done', false, 'done'],
	])('draws a child read closed as %s, timed to its close', (_label, is_merged, state) => {
		const read = read_closed({ title: 'Fix', closed_ms: Date.parse(T2), is_merged })

		expect(run_board_status.settle_closed(RUNNING, read).get(3409)).toStrictEqual({
			state,
			started_ms: Date.parse(T0),
			ended_ms: Date.parse(T2),
		})
	})

	it('ignores a close dated before the launch', () => {
		const read = read_closed({ title: 'Fix', closed_ms: Date.parse(T0) - 1, is_merged: true })

		expect(run_board_status.settle_closed(RUNNING, read).get(3409)).toStrictEqual({
			state: 'done',
			started_ms: Date.parse(T0),
		})
	})
})

describe('run_board_status.activity_of', () => {
	it('reads the newest idle window opened after the newest launch', () => {
		const events = [
			event_at(1, T0, KIND.CHILD_LAUNCH, LAUNCH_3409),
			event_at(2, T2, KIND.IDLE, IDLE_TEXT),
		]

		expect(run_board_status.activity_of(events)).toStrictEqual({
			last_event_ms: Date.parse(T2),
			idle: backlog_idle.parse(IDLE_TEXT),
			is_stopped: false,
		})
	})

	it('drops an idle window a later launch ended', () => {
		const events = [
			event_at(1, T2, KIND.IDLE, IDLE_TEXT),
			event_at(2, T3, KIND.CHILD_LAUNCH, '#3438 launched'),
		]

		expect(run_board_status.activity_of(events).idle).toBeUndefined()
	})

	it('reads a stop naming no child as the run itself ending, past trailing trace events', () => {
		const events = [
			event_at(1, T0, KIND.STOP, 'backlog drained'),
			event_at(2, T1, KIND.HEARTBEAT, 'still here'),
		]

		expect(run_board_status.activity_of(events).is_stopped).toBe(true)
		expect(run_board_status.activity_of([]).last_event_ms).toBeUndefined()
	})
})

describe('run_board_notes.notes_of', () => {
	it('lists filings, parks and notes newest first, telling a needs-decision park apart', () => {
		const events = [
			event_at(1, T0, KIND.FILED, '#3438 Count the seats again (found during #3415)'),
			event_at(2, T1, KIND.PARK, DECISION_PARK),
			event_at(3, T2, KIND.NOTE, '#3415 gate took 40% longer'),
			event_at(4, T3, KIND.PARK, '#3409 parked'),
			event_at(5, T3, KIND.MERGE, '#3420 merged'),
		]
		const notes = run_board_notes.notes_of(events)

		expect(notes.map((note) => [note.kind, note.issue, note.is_decision])).toStrictEqual([
			['park', '3409', false],
			['note', '3415', false],
			['park', '3433', true],
			['filed', '3438', false],
		])
		expect(notes.at(-1)).toMatchObject({ text: 'Count the seats again', found_during: '3415' })
	})

	it('keeps an Issue filed elsewhere qualified', () => {
		const [note] = run_board_notes.notes_of([
			event_at(1, T0, KIND.FILED, 'joshuafolkken/app-kit#12 Fix the port'),
		])

		expect(note?.issue).toBe('joshuafolkken/app-kit#12')
	})
})
