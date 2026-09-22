import { describe, expect, it } from 'vitest'
import { lane_child_invocation } from './lane-child-invocation'

// The prompts a lane child is launched with. The outage-resume prompt is the one joshuafolkken/kit#2317
// adds; what these pin is the property the parent's liveness poll rests on — every prompt ends with the
// bare `fullrun #<N>`, so `pgrep -laf "<invocation>$"` still matches a relaunched process.

const ISSUE = '2317'

describe('the lane child invocation prompts', () => {
	it('composes the bare fullrun invocation from a digits-only issue number', () => {
		expect(lane_child_invocation.child_invocation(ISSUE)).toBe(`fullrun #${ISSUE}`)
	})

	it('ends the outage-resume prompt with the bare invocation so the poll still matches', () => {
		expect(
			lane_child_invocation.outage_resume_invocation(ISSUE).endsWith(`fullrun #${ISSUE}`),
		).toBe(true)
	})

	it('tells the resumed child its context is restored and to continue from where it stopped', () => {
		const prompt = lane_child_invocation.outage_resume_invocation(ISSUE)

		expect(prompt).toContain('after an API disconnection')
		expect(prompt).toContain(`run:step ${ISSUE}`)
	})
})
