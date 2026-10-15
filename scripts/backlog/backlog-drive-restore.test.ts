import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { expect, it } from 'vitest'
import { backlog_drive_restore } from './backlog-drive-restore'

const CHILD = '2508'
const CHILD_LAUNCH = 'child-launch'
const CHILD_DISPATCHED = '#2508 dispatched'

function event(pos: number, kind: string, text: string): RunEvent {
	return { pos, kind, text, at: '2026-09-24T00:00:00.000Z' }
}

it('restores only live lanes launched by this invocation', () => {
	const events = [
		event(1, CHILD_LAUNCH, CHILD_DISPATCHED),
		event(2, CHILD_LAUNCH, '#2509 dispatched'),
		event(3, 'park', '#2509 parked'),
	]

	expect(backlog_drive_restore.restore(['2504', CHILD, '2509'], events, [])).toStrictEqual([CHILD])
})

// joshuafolkken/kit#3884: a lane the previous run launched and nothing settled is restored, so a driver
// handed the run collects its dead unit instead of waiting on it — but not a lane dispatched by hand
// between two runs, which neither run launched.
const STARTED_AT = '2026-09-23T23:00:00.000Z'
const PREVIOUS_RUN = {
	invocation: 'backlogrun',
	started_at: '2026-09-22T23:00:00.000Z',
	ended_at: '2026-09-23T12:00:00.000Z',
}

const IN_PREVIOUS_RUN = '2026-09-23T00:00:00.000Z'
const BETWEEN_RUNS = '2026-09-23T18:00:00.000Z'

function launch_at(pos: number, at: string): RunEvent {
	return { pos, kind: CHILD_LAUNCH, text: `#${String(pos)} dispatched`, at }
}

it('keeps the previous run and this one, less a launch made between them', () => {
	const events = [
		launch_at(1, '2026-09-22T00:00:00.000Z'),
		launch_at(2, IN_PREVIOUS_RUN),
		launch_at(3, BETWEEN_RUNS),
		{ pos: 4, kind: 'park', text: '#2507 parked', at: BETWEEN_RUNS },
	]

	const kept = backlog_drive_restore.run_events(events, STARTED_AT, PREVIOUS_RUN)

	expect(kept.map((kept_event) => kept_event.pos)).toStrictEqual([2, 4])
})

it('reads only this run when no run has ended before it', () => {
	const events = [launch_at(1, IN_PREVIOUS_RUN), event(2, CHILD_LAUNCH, CHILD_DISPATCHED)]

	const kept = backlog_drive_restore.run_events(events, STARTED_AT, undefined)

	expect(kept.map((kept_event) => kept_event.pos)).toStrictEqual([2])
})

it('does not restore a child whose unit was interrupted and not relaunched', () => {
	const events = [
		event(1, CHILD_LAUNCH, CHILD_DISPATCHED),
		event(2, 'interrupt', '#2508 interrupted (re-dispatchable)'),
	]

	expect(backlog_drive_restore.restore([CHILD], events, [])).toStrictEqual([])
})

it('does not merge a child whose count was committed before its event', () => {
	const events = [event(1, CHILD_LAUNCH, CHILD_DISPATCHED)]

	expect(backlog_drive_restore.restore([CHILD], events, [2508])).toStrictEqual([])
})

it('does not restore a split child whose lane remains registered', () => {
	const events = [event(1, CHILD_LAUNCH, CHILD_DISPATCHED), event(2, 'split', '#2508 split')]

	expect(backlog_drive_restore.restore([CHILD], events, [])).toStrictEqual([])
})
