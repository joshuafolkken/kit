import { backlog_idle } from '#scripts/backlog/backlog-idle'
import { IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { describe, expect, it } from 'vitest'
import type { ClosedIssue } from './run-board-closed'
import type { Phase } from './run-board-phase'
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
const PARK_3409 = '#3409 parked'
const PLAN_3415 = 'planned #3415'
const DECISION_PARK = '#3433 parked (needs-decision)'
const NONE: ReadonlySet<number> = new Set()

const { STAGE } = run_ship_stage
const IMPLEMENT_3409: Step = [KIND.LANE_PHASE, '#3409 implement']
const PLAN_3409: Step = [KIND.PLAN, 'planned #3409']
const SHIP_LAUNCH_3409: Step = [KIND.SHIP_LAUNCH, '#3409 ship supervisor launched']

// One event after #3409's launch, as its kind and text.
type Step = [string, string]

function event_at(pos: number, at: string, kind: string, text: string): RunEvent {
	return { pos, at, kind, text }
}

function ship_3409(stage: string): Step {
	return [KIND.SHIP_STAGE, `#3409 ${stage} start`]
}

// Every phase #3409 has passed after its launch and the given steps.
function track_after(...later: ReadonlyArray<Step>): ReadonlyArray<string> {
	const steps: Array<Step> = [[KIND.CHILD_LAUNCH, LAUNCH_3409], ...later]
	const events = steps.map(([kind, text], index) => event_at(index + 1, T0, kind, text))

	return run_board_status.statuses_of(events, [], NONE).get(3409)?.track ?? []
}

// The phase #3409 is on after its launch and the given steps.
function phase_after(...later: ReadonlyArray<Step>): string | undefined {
	return track_after(...later).at(-1)
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
			track: ['investigate'],
		})
		expect(statuses.get(3415)).toMatchObject({ state: 'running', track: ['investigate', 'plan'] })
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
			track: ['investigate'],
			lane: 'lane 3409',
		})
	})
})

// joshuafolkken/kit#3444: a running child's phase, read from the records its steps already write.
describe('run_board_status.statuses_of phases', () => {
	it('walks from investigate through plan and implement to the ship stages', () => {
		expect(phase_after()).toBe('investigate')
		expect(phase_after(PLAN_3409)).toBe('plan')
		expect(phase_after(IMPLEMENT_3409)).toBe('implement')
		expect(phase_after(ship_3409(STAGE.GATE))).toBe('gate')
		expect(phase_after(ship_3409(STAGE.FOLLOWUP))).toBe('followup')
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

// joshuafolkken/kit#3526: the phases a history, so a ship that stops sends the row back to 🔨.
describe('run_board_status.statuses_of failed ship', () => {
	const failed_ship: ReadonlyArray<Step> = [
		PLAN_3409,
		IMPLEMENT_3409,
		SHIP_LAUNCH_3409,
		ship_3409(STAGE.PREFLIGHT),
		ship_3409(STAGE.REVIEW),
		[KIND.SHIP_STOP, '#3409 review failed'],
		IMPLEMENT_3409,
	]
	const after_failure = ['investigate', 'plan', 'implement', 'ship', 'failed', 'implement']

	it('goes back to implement, folding the failed ship into ship and failed', () => {
		expect(track_after(...failed_ship)).toStrictEqual(after_failure)
	})

	it('writes the next ship after the failed one', () => {
		const retried = [SHIP_LAUNCH_3409, ship_3409(STAGE.REVIEW), ship_3409(STAGE.GATE)]

		expect(track_after(...failed_ship, ...retried)).toStrictEqual([
			...after_failure,
			'ship',
			'review',
			'gate',
		])
	})
})

const RUNNING: ReadonlyMap<number, ItemStatus> = new Map([
	[3409, { state: 'running', started_ms: Date.parse(T0) }],
])
const NOT_READ: ReadonlyMap<number, ClosedIssue> = new Map()

const NO_LABELS: ReadonlyMap<number, ReadonlyArray<string>> = new Map()
// An open listing read after the launch that no longer holds #3409, with no closed read for it yet.
const GONE: OpenRead = {
	open_numbers: NONE,
	read_ms: Date.parse(T1),
	closed: NOT_READ,
	labels: NO_LABELS,
}

function read_closed(closed: ClosedIssue): OpenRead {
	return {
		open_numbers: NONE,
		read_ms: Date.parse(T1),
		closed: new Map([[3409, closed]]),
		labels: NO_LABELS,
	}
}

describe('run_board_status.settle_closed', () => {
	it('draws a running child the open listing no longer holds as done', () => {
		const settled = run_board_status.settle_closed(RUNNING, GONE)

		expect(settled.get(3409)).toStrictEqual({ state: 'done', started_ms: Date.parse(T0) })
	})

	it.each<[string, Omit<OpenRead, 'labels'>]>([
		['still open', { open_numbers: new Set([3409]), read_ms: Date.parse(T1), closed: NOT_READ }],
		['a capped listing', { open_numbers: undefined, read_ms: Date.parse(T1), closed: NOT_READ }],
		[
			'launched after the read',
			{ open_numbers: NONE, read_ms: Date.parse(T0) - 1, closed: NOT_READ },
		],
	])('keeps the child running when %s', (_label, read) => {
		const settled = run_board_status.settle_closed(RUNNING, { ...read, labels: NO_LABELS })

		expect(settled.get(3409)?.state).toBe('running')
	})
})

// An open listing read at `read_ms` holding #3409 with the given labels.
function read_labelled(
	labels: ReadonlyArray<string> | undefined,
	read_ms = Date.parse(T1),
): OpenRead {
	return {
		open_numbers: new Set([3409]),
		read_ms,
		closed: NOT_READ,
		labels: labels === undefined ? NO_LABELS : new Map([[3409, labels]]),
	}
}

// joshuafolkken/kit#3459: a lane child that stopped with no parent to write its park read as running.
describe('run_board_status.settle_closed with the listing’s labels', () => {
	it.each<[string, ReadonlyArray<string>, string]>([
		['needs-decision as waiting on a person', [NEEDS_DECISION_LABEL, IN_PROGRESS_LABEL], 'human'],
		['no in-progress as stopped', ['bug'], 'stopped'],
		['in-progress as still running', ['bug', IN_PROGRESS_LABEL], 'running'],
	])('draws a running child labelled %s', (_label, labels, state) => {
		const settled = run_board_status.settle_closed(RUNNING, read_labelled(labels))

		expect(settled.get(3409)?.state).toBe(state)
	})

	it('keeps the launch time of a stopped child and draws no end', () => {
		const settled = run_board_status.settle_closed(RUNNING, read_labelled(['bug']))

		expect(settled.get(3409)).toStrictEqual({ state: 'stopped', started_ms: Date.parse(T0) })
	})

	it.each<[string, OpenRead]>([
		['the listing was cut before its row', read_labelled(undefined)],
		['the listing was read before the launch', read_labelled(['bug'], Date.parse(T0) - 1)],
	])('keeps the labelled child running when %s', (_label, read) => {
		expect(run_board_status.settle_closed(RUNNING, read).get(3409)?.state).toBe('running')
	})
})

// joshuafolkken/kit#3451: a child read closed from GitHub ends when it closed, merged or not.
describe('run_board_status.settle_closed with a closed read', () => {
	it.each<[string, boolean, string]>([
		['merged', true, 'merged'],
		['done', false, 'done'],
	])('draws a child read closed as %s, timed to its close', (_label, is_merged, state) => {
		const read = read_closed({ title: 'Fix', labels: [], closed_ms: Date.parse(T2), is_merged })

		expect(run_board_status.settle_closed(RUNNING, read).get(3409)).toStrictEqual({
			state,
			started_ms: Date.parse(T0),
			ended_ms: Date.parse(T2),
		})
	})

	it('ignores a close dated before the launch', () => {
		const read = read_closed({
			title: 'Fix',
			labels: [],
			closed_ms: Date.parse(T0) - 1,
			is_merged: true,
		})

		expect(run_board_status.settle_closed(RUNNING, read).get(3409)).toStrictEqual({
			state: 'done',
			started_ms: Date.parse(T0),
		})
	})
})

// joshuafolkken/kit#3535: a settled child keeps the track it had reached, and takes no phase after it.
describe('run_board_status settled tracks', () => {
	const reached: ReadonlyArray<Phase> = ['investigate', 'plan']

	it.each<[string, Step]>([
		['merge', [KIND.MERGE, MERGE_3409]],
		['park', [KIND.PARK, PARK_3409]],
		['split', [KIND.SPLIT, '#3409 split']],
		['stop', [KIND.STOP, '#3409 stopped']],
	])('keeps the track through a %s', (_label, ending) => {
		expect(track_after(PLAN_3409, ending, ship_3409(STAGE.REPORT))).toStrictEqual(reached)
	})

	const tracked: ReadonlyMap<number, ItemStatus> = new Map([
		[3409, { state: 'running', started_ms: Date.parse(T0), track: reached }],
	])

	it.each<[string, OpenRead]>([
		[
			'read closed',
			read_closed({ title: 'Fix', labels: [], closed_ms: Date.parse(T2), is_merged: true }),
		],
		['gone from the listing', GONE],
		['labelled stopped', read_labelled(['bug'])],
		['labelled needs-decision', read_labelled([NEEDS_DECISION_LABEL])],
	])('keeps the track of a child %s', (_label, read) => {
		const settled = run_board_status.settle_closed(tracked, read).get(3409)

		expect(settled?.state).not.toBe('running')
		expect(settled?.track).toStrictEqual(reached)
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
