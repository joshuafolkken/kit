import { describe, expect, it } from 'vitest'
import { lane_overrun_prompt } from './lane-overrun-prompt'

// joshuafolkken/kit#4870: a cause whose fix saves under 3% per merge is not worth a lane of its own, so
// the session folds it or records it, and the lane's minutes set no filing's priority.

const ISSUE = 4695
const MINUTES = 65

function handling(): string {
	return lane_overrun_prompt.handling(ISSUE, MINUTES)
}

describe('lane_overrun_prompt.handling — a cause under the high reduction', () => {
	it('folds it or leaves it in the result, never filing it', () => {
		for (const part of [
			'A cause whose fix saves under 3% of the median lane time per merge',
			'is not filed — `issue:file` refuses it under `- 目的: 時間短縮`: fold it into an open issue',
			'else end the result below with ` — under 3%: <cause, in a few words>`',
		]) {
			expect(handling()).toContain(part)
		}
	})

	it('counts the recurrence earlier overrun notes record into the effect rate', () => {
		expect(handling()).toContain('earlier `overrun:` notes on the run events naming the same cause')
		expect(handling()).toContain('recurrence into its `効く率`')
	})
})

describe("lane_overrun_prompt.handling — the lane's minutes", () => {
	it('carries them on the ranked lines of a 65-minute lane, with no priority label', () => {
		expect(handling()).toContain(`- 原因のレーン: ${String(MINUTES)} 分（#${String(ISSUE)}）`)
		expect(handling()).not.toContain('priority:')
	})
})
