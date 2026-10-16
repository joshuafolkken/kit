import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { expect, it } from 'vitest'
import { backlog_drive_restore } from './backlog-drive-restore'

const CHILD = '2508'
const CHILD_LAUNCH = 'child-launch'
const CHILD_DISPATCHED = '#2508 dispatched'
const PARKED_2509 = '#2509 parked'

function event(pos: number, kind: string, text: string): RunEvent {
	return { pos, kind, text, at: '2026-09-24T00:00:00.000Z' }
}

it('restores only live lanes launched by this invocation', () => {
	const events = [
		event(1, CHILD_LAUNCH, CHILD_DISPATCHED),
		event(2, CHILD_LAUNCH, '#2509 dispatched'),
		event(3, 'park', PARKED_2509),
	]

	expect(backlog_drive_restore.restore(['2504', CHILD, '2509'], events, [])).toStrictEqual([CHILD])
})

it('restores a dispatched lane carried in from an earlier invocation', () => {
	const events = [event(1, CHILD_LAUNCH, CHILD_DISPATCHED), event(2, 'park', PARKED_2509)]
	const restored = backlog_drive_restore.restore(
		['2504', '2509', '2510'],
		events,
		[],
		['2504', '2509'],
	)

	expect(restored).toStrictEqual(['2504'])
})

it('does not merge a child whose count was committed before its event', () => {
	const events = [event(1, CHILD_LAUNCH, CHILD_DISPATCHED)]

	expect(backlog_drive_restore.restore([CHILD], events, [2508])).toStrictEqual([])
})

it('does not restore a split child whose lane remains registered', () => {
	const events = [event(1, CHILD_LAUNCH, CHILD_DISPATCHED), event(2, 'split', '#2508 split')]

	expect(backlog_drive_restore.restore([CHILD], events, [])).toStrictEqual([])
})

// joshuafolkken/kit#3908: `lane:withdraw` settles the child itself, so a driver restarted after it
// neither waits on the lane nor offers the closed issue again in a named run.
const WITHDRAWN = [
	event(1, CHILD_LAUNCH, CHILD_DISPATCHED),
	event(2, 'withdraw', '#2508 withdrawn by a person: superseded'),
]

it('does not restore a child a person withdrew whose lane remains registered', () => {
	expect(backlog_drive_restore.restore([CHILD], WITHDRAWN, [])).toStrictEqual([])
})

it('reads a child a person withdrew as settled', () => {
	expect(backlog_drive_restore.settled_issues(WITHDRAWN)).toStrictEqual(new Set([Number(CHILD)]))
})
