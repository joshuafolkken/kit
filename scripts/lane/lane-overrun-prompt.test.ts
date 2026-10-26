import { describe, expect, it } from 'vitest'
import { lane_overrun_prompt } from './lane-overrun-prompt'

// joshuafolkken/kit#4928: an investigation reads only its lane's record and files its five largest
// reducible causes of a minute or more — a share over every merge thins a new mechanism's cost below
// any line, so no share is computed.

const ISSUE = 4695
const MINUTES = 65

function handling(): string {
	return lane_overrun_prompt.handling(ISSUE, MINUTES)
}

describe('lane_overrun_prompt.handling — which causes are filed', () => {
	it('files the five largest reducible causes of a minute or more, from this lane alone', () => {
		for (const part of [
			"Estimate each cause's reducible minutes: what its fix would cut from this lane alone, judged from its own record.",
			'Take at most the 5 causes with the most reducible minutes, largest first, each cutting 1 minute or more, and drop the rest',
		]) {
			expect(handling()).toContain(part)
		}
	})

	it('counts the time the work inherently takes only for the part a fix removes', () => {
		expect(handling()).toContain(
			'Time the work inherently takes (a CI wait the pipeline requires, a review) counts only for the part a fix removes, and not at all when no fix removes any.',
		)
	})

	it('picks the causes before grouping and filing them', () => {
		const text = handling()

		expect(text.indexOf('Take at most the 5 causes')).toBeLessThan(
			text.indexOf('Causes whose fixes'),
		)
	})

	it('files a defect as a defect and any other cause as time shortening', () => {
		expect(handling()).toContain('as `- 種別: 不具合`, any other cause as `- 目的: 時間短縮`.')
	})
})

describe('lane_overrun_prompt.handling — no share of merges', () => {
	it('names no share, no 2–3% line, no period average and no cross-lane sum', () => {
		for (const part of [
			'%',
			'share of',
			'median lane',
			'per merge',
			'7 day',
			'overrun:mechanisms',
		]) {
			expect(handling()).not.toContain(part)
		}
	})
})

describe('lane_overrun_prompt.handling — a recurrence', () => {
	it('appends its own cause-loss line to the open issue, which ranking sums', () => {
		expect(handling()).toContain(
			'the cause-loss line appended beside the ones already there, since ranking sums every `- 原因の損失:` line',
		)
	})

	// joshuafolkken/kit#4960: the body edit applies no label, so the floor is re-read after it.
	it('re-reads the floor with issue:priority after the body edit', () => {
		expect(handling()).toContain(
			'-F body=@<file>`). Then run `pnpm josh issue:priority <N>`, which labels it once the sum reaches the high floor.',
		)
	})
})

describe("lane_overrun_prompt.handling — the lane's minutes", () => {
	it('carries them on the ranked lines of a 65-minute lane, with no priority label', () => {
		expect(handling()).toContain(`- 原因のレーン: ${String(MINUTES)} 分（#${String(ISSUE)}）`)
		expect(handling()).not.toContain('priority:')
	})
})
