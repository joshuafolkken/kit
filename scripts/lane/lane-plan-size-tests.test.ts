import type { OpenIssueData } from '#scripts/git/git-schemas'
import { describe, expect, it } from 'vitest'
import { lane_plan_size, type PlanSignals } from './lane-plan-size'

// joshuafolkken/kit#8589: tests count toward the files bar, so a split-off cut keeps a test with its
// planned module, and an estimate filed excluding tests is not compared with a tests-included plan.

const ISSUE = 8589
const PLANNED_AT = '2026-11-22T00:00:00.000Z'
const QUIET: PlanSignals = {
	hunk_files: [],
	committed_files: [],
	lines_ratio: undefined,
	implement_rate: undefined,
	split_filed: false,
}

function issues_declaring(counting: string, declared = '4'): Array<OpenIssueData> {
	const body = `## 背景\n\n- 規模見積もり: 約 ${declared} ファイル / 70 行（テスト${counting}）\n`

	return [{ number: ISSUE, title: 'lane', createdAt: PLANNED_AT, labels: [], body }]
}

function files(count: number): Array<string> {
	return Array.from({ length: count }, (_, index) => `scripts/lane/file-${String(index + 1)}.ts`)
}

function oversize_of(paths: ReadonlyArray<string>, counting: string): unknown {
	const plan = { issue: ISSUE, paths: [...paths], planned_at: PLANNED_AT }

	return lane_plan_size.oversize(plan, issues_declaring(counting), undefined, QUIET)
}

describe('lane_plan_size.oversize with test files', () => {
	it('keeps a test with its planned module when splitting files off', () => {
		const module_test = 'scripts/lane/file-1.test.ts'

		expect(oversize_of([...files(8), module_test], '含む')).toMatchObject({
			kept: [...files(7), module_test],
			split_off: ['scripts/lane/file-8.ts'],
		})
	})

	it('keeps a first test group larger than the limit whole rather than keeping nothing', () => {
		const plan = { issue: ISSUE, paths: ['a.ts', 'a.test.ts', 'b.ts'], planned_at: PLANNED_AT }
		const over = lane_plan_size.oversize(plan, issues_declaring('含む', '1'), undefined, QUIET)

		expect(over).toMatchObject({ kept: ['a.ts', 'a.test.ts'], split_off: ['b.ts'] })
	})

	it('does not hold a plan to an estimate filed excluding tests', () => {
		expect(oversize_of(files(9), '含む')).toMatchObject({ reason: 'files' })
		expect(oversize_of(files(9), '除く')).toBeUndefined()
	})
})
