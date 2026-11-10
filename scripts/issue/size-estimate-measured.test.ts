import { describe, expect, it } from 'vitest'
import { size_estimate } from './size-estimate'

const RATE = { median: 3, lanes: 4 }
const SPLIT = 'route:split'

function body_of(files: number, lines: number): string {
	return `## 背景\n\n- 規模見積もり: 約 ${String(files)} ファイル / ${String(lines)} 行（テスト除く）`
}

describe('size_estimate measured thresholds', () => {
	it('uses the same derived guide for verdict and refusal text', () => {
		const body = body_of(1, 160)
		const measured = size_estimate.over_guide(body, undefined, RATE)

		expect(measured).toEqual({ files: 1, lines: 160, verdict: 'split' })
		expect(size_estimate.guide_problem(body, undefined, RATE)).toContain('12 files or 300 lines')
		expect(size_estimate.over_guide(body_of(1, 120), undefined, RATE)).toBeUndefined()
	})

	it('uses the derived cap in the refusal text', () => {
		expect(size_estimate.guide_problem(body_of(1, 460), undefined, RATE)).toContain(
			'18 files or 450 lines',
		)
		expect(size_estimate.over_cap(body_of(1, 200), undefined, RATE)).toBeUndefined()
	})

	// joshuafolkken/kit#7074: within the cap, an unreasoned projection over the size bar is
	// `over_budget` — offered with a note, never held; the implement budget alone bars nothing.
	it('judges an issue within the cap by the size bar, not the implement budget', () => {
		const body = body_of(1, 400)

		expect(size_estimate.over_budget(body, RATE)).toEqual({
			files: 1,
			lines: 400,
			verdict: 'split',
		})
		expect(size_estimate.over_budget(`${body}\n- 分割しない理由: 一体`, RATE)).toBeUndefined()
		expect(size_estimate.over_budget(body_of(1, 200), RATE)).toBeUndefined()
	})

	// joshuafolkken/kit#7005: the split exemption covers the guide and cap, not the size bar.
	it('preserves the split exemption while exposing its measured warning', () => {
		const body = body_of(1, 400)
		const problem = size_estimate.guide_problem(body, SPLIT, RATE)

		expect(problem).toContain('over the 18-minute size bar')
		expect(problem).not.toContain('exceeds the cap')
		expect(size_estimate.over_cap(body, SPLIT, RATE)).toBeUndefined()
		expect(size_estimate.split_over_guide(body, SPLIT, RATE)?.verdict).toBe('split')
	})
})
