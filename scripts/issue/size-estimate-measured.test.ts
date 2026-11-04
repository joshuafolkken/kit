import { describe, expect, it } from 'vitest'
import { size_estimate } from './size-estimate'

const RATE = { median: 12, lanes: 4 }
const SPLIT = 'route:split'

function body_of(files: number, lines: number): string {
	return `## 背景\n\n- 規模見積もり: 約 ${String(files)} ファイル / ${String(lines)} 行（テスト除く）`
}

describe('size_estimate measured thresholds', () => {
	it('uses the same derived guide for verdict and refusal text', () => {
		const body = body_of(1, 60)
		const measured = size_estimate.over_guide(body, undefined, RATE)

		expect(measured).toEqual({ files: 1, lines: 60, verdict: 'split' })
		expect(size_estimate.guide_problem(body, undefined, RATE)).toContain('4 files or 100 lines')
		expect(size_estimate.over_guide(body, undefined)).toBeUndefined()
	})

	it('uses the derived cap in issue selection and refusal text', () => {
		const body = body_of(1, 80)
		const issue = { body, labels: [] }

		expect(size_estimate.is_issue_over_cap(issue, RATE)).toBe(true)
		expect(size_estimate.guide_problem(body, undefined, RATE)).toContain('6 files or 150 lines')
		expect(size_estimate.is_issue_over_cap(issue)).toBe(false)
	})

	it('preserves the split exemption while exposing its measured warning', () => {
		const body = body_of(1, 80)

		expect(size_estimate.guide_problem(body, SPLIT, RATE)).toBeUndefined()
		expect(size_estimate.over_cap(body, SPLIT, RATE)).toBeUndefined()
		expect(size_estimate.split_over_guide(body, SPLIT, RATE)?.verdict).toBe('split')
	})
})
