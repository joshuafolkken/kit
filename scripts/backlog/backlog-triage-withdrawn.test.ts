import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { expect, it } from 'vitest'
import { backlog_triage_withdrawn } from './backlog-triage-withdrawn'

const ISSUE = '7945'
const CHILD_LAUNCH = 'child-launch'
const LAUNCHED = '#7945 dispatched'

function event(pos: number, kind: string, text: string): RunEvent {
	return { pos, kind, text, at: '2026-11-18T10:00:00.000Z' }
}

// joshuafolkken/kit#7983: the #7945 stream — parked, then withdrawn by a person.
const WITHDRAWN = [
	event(1, CHILD_LAUNCH, LAUNCHED),
	event(2, 'park', '#7945 parked'),
	event(3, 'withdraw', '#7945 withdrawn by a person: ships with #7951'),
]

it('counts a lane a person withdrew after its park as withdrawn', () => {
	expect(backlog_triage_withdrawn.is_withdrawn(WITHDRAWN, ISSUE)).toBe(true)
})

it('does not count a withdrawal a yield wrote, which requeues the lane', () => {
	const events = [
		event(1, CHILD_LAUNCH, LAUNCHED),
		event(2, 'note', '#7945 yielded its lane: overlaps #7951'),
		event(3, 'withdraw', '#7945 withdrawn by its own lane:plan: overlaps #7951'),
	]

	expect(backlog_triage_withdrawn.is_withdrawn(events, ISSUE)).toBe(false)
})

it('does not count a withdrawal a later launch superseded', () => {
	const events = [...WITHDRAWN, event(4, CHILD_LAUNCH, LAUNCHED)]

	expect(backlog_triage_withdrawn.is_withdrawn(events, ISSUE)).toBe(false)
})
