import type { OpenIssueData } from '#scripts/git/git-schemas'
import { describe, expect, it } from 'vitest'
import type { LanePlan } from './lane-plan'
import { lane_plan_size, type PlanSignals } from './lane-plan-size'

const ISSUE = 7381
const PLAN: LanePlan = { issue: ISSUE, paths: ['scripts/a.ts'], planned_at: '' }
const ISSUES: Array<OpenIssueData> = [
	{
		number: ISSUE,
		title: 'scope',
		createdAt: '',
		labels: [],
		body: '## 背景\n\n- 規模見積もり: 約 2 ファイル / 40 行（テスト除く）\n',
	},
]
const SIGNALS: PlanSignals = {
	hunk_files: [],
	committed_files: [],
	lines_ratio: undefined,
	implement_rate: undefined,
	split_filed: false,
}

describe('lane_plan_size on file-by-file estimates', () => {
	it.each([
		{ lines: 40, over: false },
		{ lines: 104, over: true },
		{ lines: 229, over: true },
	])('uses the estimated $lines lines with the existing bar', ({ lines, over }) => {
		const plan = { ...PLAN, estimated_size: { files: 1, lines } }
		const result = lane_plan_size.oversize(plan, ISSUES, undefined, SIGNALS)

		expect(result !== undefined).toBe(over)
		if (over) expect(result).toMatchObject({ reason: 'lines', declared: lines, limit: 100 })
	})

	it('does not lower the original declaration with a smaller new estimate', () => {
		const plan = { ...PLAN, estimated_size: { files: 1, lines: 0 } }
		const issues = ISSUES.map((issue) => ({
			...issue,
			body: issue.body?.replace('40 行', '229 行'),
		}))

		expect(lane_plan_size.oversize(plan, issues, undefined, SIGNALS)).toMatchObject({
			reason: 'lines',
			declared: 229,
		})
	})

	it('records a warning for one indivisible contract without proposing an unsafe split', () => {
		const plan = { ...PLAN, single: true, estimated_size: { files: 1, lines: 229 } }
		const over = lane_plan_size.oversize(plan, ISSUES, undefined, SIGNALS)

		expect(over).toMatchObject({ reason: 'lines' })
		expect(lane_plan_size.is_waived(plan, over)).toBe(true)
	})
})
