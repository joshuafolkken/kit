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

	// joshuafolkken/kit#2421: the one pattern both the liveness wait and the reaper search with — anchored
	// at the end so `#2317` never matches the child of `#23170`.
	it('anchors the process pattern at the end of the bare invocation', () => {
		expect(lane_child_invocation.process_pattern(ISSUE)).toMatch(/ #2317\$$/u)
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

// joshuafolkken/kit#2428: the agent ends once it hands the region to a detached ship supervisor, so the
// pattern the parent polls must find that supervisor too, or a shipping lane is booked finished.
describe('the process pattern read as the extended regex pgrep applies', () => {
	const pattern = new RegExp(lane_child_invocation.process_pattern(ISSUE), 'u')

	it.each([
		[`claude -p Resuming the lane child ... fullrun #${ISSUE}`],
		[`node tsx scripts/run/run-ship-cli.ts --review Hand the region over #${ISSUE}`],
		[`node /usr/local/bin/pnpm josh ship --review Hand the region over #${ISSUE}`],
		[`node tsx/dist/cli.mjs scripts/josh/josh.ts ship --review Hand the region over #${ISSUE}`],
		[`node node_modules/@joshuafolkken/kit/dist/josh.js ship Hand the region over #${ISSUE}`],
	])('matches a live child or ship supervisor: %s', (line) => {
		expect(pattern.test(line)).toBe(true)
	})

	it.each([
		[`claude -p fullrun #${ISSUE}0`],
		[`node tsx scripts/run/run-ship-cli.ts Other work #${ISSUE}0`],
		[`node tsx scripts/run/run-step-cli.ts Something #${ISSUE}`],
	])('does not match another issue or another script: %s', (line) => {
		expect(pattern.test(line)).toBe(false)
	})

	it('ends the ship-stop prompt with the bare invocation and names run:step', () => {
		const prompt = lane_child_invocation.ship_stop_invocation(ISSUE)

		expect(prompt.endsWith(`fullrun #${ISSUE}`)).toBe(true)
		expect(prompt).toContain(`run:step ${ISSUE}`)
	})
})
