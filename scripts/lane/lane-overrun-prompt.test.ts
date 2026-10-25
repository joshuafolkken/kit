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
	it('folds it or leaves it keyed in the result, never filing it on its own', () => {
		for (const part of [
			'A cause whose fix saves under 3% of the median lane time per merge',
			'is not filed on its own — `issue:file` refuses it under `- 目的: 時間短縮`.',
			'Under 3%, fold it into an open issue as above, else end the result below',
			'with ` — under 3%: <key> <minutes> min: <cause, in a few words>`',
		]) {
			expect(handling()).toContain(part)
		}
	})

	// joshuafolkken/kit#4886: one mechanism's losses are summed across lanes before a cause is dropped.
	it("reads its mechanism's summed loss before dropping it, and files the mechanism at 3%", () => {
		for (const part of [
			'Key it by its mechanism (a josh command or step, e.g. `test:pinned`)',
			'Before dropping it, run that command:',
			'`pnpm josh overrun:mechanisms`',
			'When a closed issue already fixed the mechanism, re-run it with `--since <that close time>`',
			'At 3% or over, the mechanism is one root-cause issue — fold into an open issue that fixes it',
			"The key's cause count is the recurrence to put into its `効く率`.",
		]) {
			expect(handling()).toContain(part)
		}
	})
})

describe("lane_overrun_prompt.handling — the lane's minutes", () => {
	it('carries them on the ranked lines of a 65-minute lane, with no priority label', () => {
		expect(handling()).toContain(`- 原因のレーン: ${String(MINUTES)} 分（#${String(ISSUE)}）`)
		expect(handling()).not.toContain('priority:')
	})
})
