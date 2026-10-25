import { describe, expect, it } from 'vitest'
import { lane_overrun_prompt } from './lane-overrun-prompt'

// joshuafolkken/kit#4870: a cause whose fix saves under the filing floor per merge is not worth a lane of
// its own, so the session folds it or records it, and the lane's minutes set no filing's priority.

const ISSUE = 4695
const MINUTES = 65

function handling(): string {
	return lane_overrun_prompt.handling(ISSUE, MINUTES)
}

describe('lane_overrun_prompt.handling — a cause under the filing floor', () => {
	it('folds it or leaves it keyed in the result, never filing it on its own', () => {
		for (const part of [
			'A cause whose fix saves under 2% of the median lane time per merge',
			'is not filed on its own — `issue:file` refuses it under `- 目的: 時間短縮`.',
			'Under 2%, fold it into an open issue as above, else end the result below',
			'with ` — under 2%: <key> <minutes> min: <cause, in a few words>`',
		]) {
			expect(handling()).toContain(part)
		}
	})

	// joshuafolkken/kit#4886: one mechanism's losses are summed across lanes before a cause is dropped.
	it("reads its mechanism's summed loss before dropping it, and files the mechanism at 2%", () => {
		for (const part of [
			'Key it by its mechanism (a josh command or step, e.g. `test:pinned`)',
			'Before dropping it, run that command:',
			'`pnpm josh overrun:mechanisms`',
			'When a closed issue already fixed the mechanism, re-run it with `--since <that close time>`',
			'At 2% or over, the mechanism is one root-cause issue — fold into an open issue that fixes it',
			"The key's cause count is the recurrence to put into its `効く率`.",
		]) {
			expect(handling()).toContain(part)
		}
	})
})

// joshuafolkken/kit#4910: only the time the work inherently takes is judged by the floor.
describe('lane_overrun_prompt.handling — a defect and a grown mechanism', () => {
	it('sorts each cause into a defect or inherent time before any share rule', () => {
		const text = handling()
		const sort = text.indexOf('Sort each cause first: a defect')

		expect(sort).toBeGreaterThan(-1)
		expect(sort).toBeLessThan(text.indexOf('A cause whose fix saves under 2%'))
		expect(text).toContain('time the work inherently takes (CI wait, review)')
	})

	it('files a defect at any share, as a defect with no time-shortening line', () => {
		expect(handling()).toContain(
			'File a defect at any share as `- 種別: 不具合`, with no `- 目的: 時間短縮` line and so no reduction percentage.',
		)
	})

	it('files a mechanism `overrun:mechanisms` marks grown at any share', () => {
		expect(handling()).toContain(
			'A key `pnpm josh overrun:mechanisms` marks `grown` lost more than over the period of the same length before it: file its mechanism as one root-cause issue at any share too.',
		)
	})
})

describe("lane_overrun_prompt.handling — the lane's minutes", () => {
	it('carries them on the ranked lines of a 65-minute lane, with no priority label', () => {
		expect(handling()).toContain(`- 原因のレーン: ${String(MINUTES)} 分（#${String(ISSUE)}）`)
		expect(handling()).not.toContain('priority:')
	})
})
