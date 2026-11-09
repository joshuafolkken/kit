import type { OpenIssueData } from '#scripts/git/git-schemas'
import { test_pinned_logic } from '#scripts/test/test-pinned-logic'
import { describe, expect, it } from 'vitest'
import type { LanePlan } from './lane-plan'
import { lane_plan_size, type Oversize, type PlanSignals } from './lane-plan-size'

// joshuafolkken/kit#6543: a plan that edits a `test:related` hub answers `split (hub)` naming it; a plan
// with none, or no graph to read one off, is judged as before.

const ISSUE = 6543
const PLANNED_AT = '2026-11-08T00:00:00.000Z'
const DECLARED_BODY = '## 背景\n\n- 規模見積もり: 約 4 ファイル / 80 行（テスト除く）\n'
const HUB = 'scripts/split/split-assess.ts'
const PLAIN = 'scripts/lane/plain.ts'
const QUIET: PlanSignals = {
	hunk_files: [],
	committed_files: [],
	lines_ratio: undefined,
	implement_rate: undefined,
	split_filed: false,
}
const ISSUES: Array<OpenIssueData> = [
	{ number: ISSUE, title: 'lane', createdAt: PLANNED_AT, labels: [], body: DECLARED_BODY },
]

function oversize_of(
	hubs: PlanSignals['hubs'],
	plan: Partial<LanePlan> = {},
): Oversize | undefined {
	const planned: LanePlan = { issue: ISSUE, paths: [HUB, PLAIN], planned_at: PLANNED_AT, ...plan }

	return lane_plan_size.oversize(planned, ISSUES, undefined, { ...QUIET, hubs })
}

describe('lane_plan_size.oversize on a planned hub', () => {
	it('answers split with the hub as its reason', () => {
		expect(oversize_of([HUB])).toMatchObject({
			reason: 'hub',
			limit: test_pinned_logic.MAX_TEST_FILES,
			hubs: [HUB],
		})
	})

	it('names the hub in the refusal', () => {
		const over = oversize_of([HUB])
		const text = over === undefined ? '' : lane_plan_size.refusal_text(ISSUE, over)

		expect(text).toMatch(
			/^split \(hub\): .*scripts\/split\/split-assess\.ts, whose `test:related`/u,
		)
	})

	it('only warns on a --single plan', () => {
		const plan = { single: true }
		const over = oversize_of([HUB], plan)
		const planned: LanePlan = { issue: ISSUE, paths: [], planned_at: PLANNED_AT, ...plan }

		expect(over?.reason).toBe('hub')
		expect(lane_plan_size.is_waived(planned, over)).toBe(true)
	})
})

describe('lane_plan_size.oversize with no planned hub', () => {
	it.each([
		['no hub among the planned files', []],
		['no graph to read hubs off', undefined],
	])('passes a plan within its declaration with %s', (_, hubs) => {
		expect(oversize_of(hubs)).toBeUndefined()
	})
})
