import type { RunEvent } from '#scripts/run/run-event-stream'
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

it('does not merge a child whose count was committed before its event', () => {
	const events = [event(1, CHILD_LAUNCH, CHILD_DISPATCHED)]

	expect(backlog_drive_restore.restore([CHILD], events, [2508])).toStrictEqual([])
})

it('does not restore a split child whose lane remains registered', () => {
	const events = [event(1, CHILD_LAUNCH, CHILD_DISPATCHED), event(2, 'split', '#2508 split')]

	expect(backlog_drive_restore.restore([CHILD], events, [])).toStrictEqual([])
})
