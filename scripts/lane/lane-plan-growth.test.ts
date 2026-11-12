import type { OpenIssueData } from '#scripts/git/git-schemas'
import { describe, expect, it } from 'vitest'
import type { LanePlan } from './lane-plan'
import { lane_plan_size, type Oversize, type PlanSignals } from './lane-plan-size'

const ISSUE = 6594
const PLANNED_AT = '2026-11-06T00:00:00.000Z'
const BODY = '## 背景\n\n- 規模見積もり: 約 4 ファイル / 70 行（テスト除く）\n'
const ISSUES: ReadonlyArray<OpenIssueData> = [
	{ number: ISSUE, title: 'Growth', createdAt: PLANNED_AT, labels: [], body: BODY },
]
const QUIET: PlanSignals = {
	hunk_files: [],
	committed_files: [],
	lines_ratio: undefined,
	implement_rate: undefined,
	split_filed: false,
}

function paths(count: number): Array<string> {
	return Array.from({ length: count }, (_, index) => `file-${String(index)}.ts`)
}

function hunks(count: number): Array<string> {
	return Array.from({ length: count }, () => 'other.ts')
}

function over(count: number, signals: Partial<PlanSignals>): Oversize | undefined {
	const plan: LanePlan = { issue: ISSUE, paths: paths(count), planned_at: PLANNED_AT }

	return lane_plan_size.oversize(plan, ISSUES, undefined, { ...QUIET, ...signals })
}

function refusal(count: number, signals: Partial<PlanSignals>): string {
	const result = over(count, signals)

	return result === undefined ? '' : lane_plan_size.refusal_text(ISSUE, result)
}

describe('lane plan measured declaration growth', () => {
	it('uses the files ratio at its strict boundary without a measured speed (ac-54136377)', () => {
		expect(over(6, { files_ratio: 1.5 })).toBeUndefined()
		expect(over(7, { files_ratio: 1.5 })).toMatchObject({ reason: 'files', limit: 6 })
	})

	it('uses the files ratio for hunks independently of the lines ratio (ac-54136377)', () => {
		const signals = { files_ratio: 1.5, lines_ratio: 1, hunk_files: hunks(6) }

		expect(over(1, signals)).toBeUndefined()
		expect(over(1, { ...signals, hunk_files: hunks(7) })).toMatchObject({
			reason: 'hunks',
			limit: 6,
			measured: 7,
		})
	})

	it('uses the lines ratio independently of files and speed (ac-54136377)', () => {
		expect(over(1, { files_ratio: 1.5, lines_ratio: 3 })).toMatchObject({
			reason: 'lines',
			measured: 210,
			limit: 66,
		})
	})
})

describe('lane plan declaration fallback', () => {
	it('falls back only on an unmeasured files axis (ac-45cdc50c)', () => {
		expect(over(8, { lines_ratio: 1 })).toBeUndefined()
		expect(over(9, { lines_ratio: 1 })).toMatchObject({ reason: 'files', limit: 8 })
	})

	it('falls back only on an unmeasured lines axis (ac-45cdc50c)', () => {
		expect(over(1, { files_ratio: 1, lines_ratio: 3 })).toMatchObject({ reason: 'lines' })
		expect(over(1, { files_ratio: 1 })).toBeUndefined()
	})
})

describe('lane plan growth provenance', () => {
	it('prints the measured guide and both measured ratios (ac-75138e94)', () => {
		const text = refusal(7, {
			files_ratio: 1.5,
			lines_ratio: 3,
			implement_rate: { median: 3, lanes: 1 },
		})

		expect(text).toContain('guide 12 files / 300 lines (measured)')
		expect(text).toContain('growth files × 1.5 (measured) / lines × 3 (measured)')
		expect(text).not.toContain('\n')
	})

	it('prints the floor guide and each growth source (ac-75138e94)', () => {
		const text = refusal(9, { lines_ratio: 1 })

		expect(text).toContain('guide 8 files / 200 lines (fallback)')
		expect(text).toContain('growth files × 2 (fallback) / lines × 1 (measured)')
	})
})
