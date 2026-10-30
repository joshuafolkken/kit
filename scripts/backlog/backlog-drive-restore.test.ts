import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { expect, it } from 'vitest'
import { backlog_drive_restore } from './backlog-drive-restore'

const CHILD = '2508'
const CHILD_LAUNCH = 'child-launch'
const CHILD_DISPATCHED = '#2508 dispatched'
const PARKED_2509 = '#2509 parked'
const DISPATCHED_2509 = '#2509 dispatched'

function event(pos: number, kind: string, text: string): RunEvent {
	return { pos, kind, text, at: '2026-09-24T00:00:00.000Z' }
}

it('settles a human-review dispatch without retiring the issue from the run', () => {
	const events = [
		event(1, CHILD_LAUNCH, CHILD_DISPATCHED),
		event(2, 'human-review', '#2508 waiting for human review'),
	]

	expect([...backlog_drive_restore.active_issues(events)]).toStrictEqual([])
	expect(backlog_drive_restore.restore([CHILD], events, [], [CHILD])).toStrictEqual([])
	expect([...backlog_drive_restore.settled_issues(events)]).toStrictEqual([Number(CHILD)])
	expect(backlog_drive_restore.offer_exclude(events)).toStrictEqual([])
	const resumed = [...events, event(3, CHILD_LAUNCH, CHILD_DISPATCHED)]

	expect(backlog_drive_restore.restore([CHILD], resumed, [])).toStrictEqual([CHILD])
})

it('excludes from the offer the merged children and the ones still in flight', () => {
	const events = [
		event(1, CHILD_LAUNCH, CHILD_DISPATCHED),
		event(2, CHILD_LAUNCH, DISPATCHED_2509),
		event(3, 'merge', '#2509 merged'),
		event(4, CHILD_LAUNCH, '#2510 dispatched'),
		event(5, 'park', '#2510 parked'),
	]

	expect(backlog_drive_restore.offer_exclude(events)).toStrictEqual(['2509', CHILD])
})

it('restores only live lanes launched by this invocation', () => {
	const events = [
		event(1, CHILD_LAUNCH, CHILD_DISPATCHED),
		event(2, CHILD_LAUNCH, DISPATCHED_2509),
		event(3, 'park', PARKED_2509),
	]

	expect(backlog_drive_restore.restore(['2504', CHILD, '2509'], events, [])).toStrictEqual([CHILD])
})

// joshuafolkken/kit#4745: a child a usage limit stopped was released, so its lane is not restored.
it('does not restore a lane whose child a usage limit stopped', () => {
	const events = [
		event(1, CHILD_LAUNCH, CHILD_DISPATCHED),
		event(2, 'usage-limit', '#2508 usage limit — resumes at 2026-09-24T01:00:00.000Z'),
	]

	expect(backlog_drive_restore.restore([CHILD], events, [])).toStrictEqual([])
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
const PERSON_WITHDRAWAL = '#2508 withdrawn by a person: superseded'
const WITHDRAWN = [
	event(1, CHILD_LAUNCH, CHILD_DISPATCHED),
	event(2, 'withdraw', PERSON_WITHDRAWAL),
]

it('does not restore a child a person withdrew whose lane remains registered', () => {
	expect(backlog_drive_restore.restore([CHILD], WITHDRAWN, [])).toStrictEqual([])
})

it('reads a child a person withdrew as settled', () => {
	expect(backlog_drive_restore.settled_issues(WITHDRAWN)).toStrictEqual(new Set([Number(CHILD)]))
})

// joshuafolkken/kit#4365: the withdrawn issue stays open, so this run's offer keeps it out itself; a
// later run reads a stream without the withdrawal and offers it again.
it('excludes from this run offer a child a person withdrew', () => {
	expect(backlog_drive_restore.offer_exclude(WITHDRAWN)).toStrictEqual([CHILD])
})

it('offers again a withdrawn child launched afresh after its withdrawal once that launch settles', () => {
	const events = [
		...WITHDRAWN,
		event(3, CHILD_LAUNCH, CHILD_DISPATCHED),
		event(4, 'park', '#2508 parked'),
	]

	expect(backlog_drive_restore.offer_exclude(events)).toStrictEqual([])
})

// joshuafolkken/kit#4926: a lane that yielded to an earlier lane stays in the run — its retained plan,
// not the exclusion, holds it back until the holder ends — and is not settled. The child only notes its
// yield; `run:merge` closes the lane with a withdrawal named as the yield.
const YIELD_NOTED = [
	event(1, CHILD_LAUNCH, CHILD_DISPATCHED),
	event(2, 'note', '#2508 yielded its lane: overlaps #2509'),
]
const YIELDED = [
	...YIELD_NOTED,
	event(3, 'withdraw', '#2508 withdrawn by its own lane:plan: overlaps #2509'),
]

it('neither excludes from the offer nor settles a child whose yielded lane was closed', () => {
	expect(backlog_drive_restore.offer_exclude(YIELDED)).toStrictEqual([])
	expect(backlog_drive_restore.withdrawn_issues(YIELDED)).toStrictEqual([])
	expect(backlog_drive_restore.settled_issues(YIELDED)).toStrictEqual(new Set())
})

// A restart between the yield and `run:merge` finds the lane still open, so it is handed back to
// `run:merge` to close.
it('restores a child that noted its yield before run:merge closed its lane', () => {
	expect(backlog_drive_restore.restore([CHILD], YIELD_NOTED, [])).toStrictEqual([CHILD])
})

it('excludes a child a person withdrew after a yield of an earlier launch', () => {
	const events = [
		...YIELDED,
		event(3, CHILD_LAUNCH, CHILD_DISPATCHED),
		event(4, 'withdraw', PERSON_WITHDRAWAL),
	]

	expect(backlog_drive_restore.offer_exclude(events)).toStrictEqual([CHILD])
})

it('offers a child withdrawn in another run', () => {
	expect(backlog_drive_restore.offer_exclude([])).toStrictEqual([])
})
