import type { ImplementRate } from '#scripts/lane/lane-implement-rate'
import { describe, expect, it } from 'vitest'
import { size_estimate } from './size-estimate'

// joshuafolkken/kit#6025: an estimate over the guide whose projected implement time — the declared
// lines grown by `DECLARED_GROWTH_FACTOR` at the ledger's implement minutes per 100 lines — exceeds the
// implement stage budget is refused even with a reason declared; only a split filing passes it.

const SPLIT_ROUTE = 'route:split'
const REASON = '- 分割しない理由: 1 コミットで入れないと壊れる'
// The over-guide estimate below projects past the stage budget at the slow rate, within it at the fast.
const SLOW: ImplementRate = { median: 10, lanes: 4 }
const FAST: ImplementRate = { median: 4, lanes: 3 }

function body_with(...lines: ReadonlyArray<string>): string {
	return ['## 背景', '', '- 種別: 非不具合', ...lines, '', '## 現象', '', 'x'].join('\n')
}

function estimate(files: number, lines: number): string {
	return `- 規模見積もり: 約 ${String(files)} ファイル / ${String(lines)} 行（テスト除く）`
}

const OVER_GUIDE = body_with(estimate(5, 120))
const OVER_GUIDE_EXCUSED = body_with(estimate(5, 120), REASON)
const UNDER_GUIDE = body_with(estimate(4, 100))

describe('size_estimate.guide_problem — the projected implement time', () => {
	it('refuses a reasoned estimate over the guide projecting past the budget', () => {
		const problem = size_estimate.guide_problem(OVER_GUIDE_EXCUSED, undefined, SLOW) ?? ''

		for (const part of ['24 implement minute(s)', '12-minute', '10.0 implement min', '4 lane(s)']) {
			expect(problem).toContain(part)
		}
	})

	it('passes a reasoned estimate projecting within the budget', () => {
		expect(size_estimate.guide_problem(OVER_GUIDE_EXCUSED, undefined, FAST)).toBeUndefined()
	})

	it('keeps the guide refusal for an unreasoned estimate within the budget', () => {
		const problem = size_estimate.guide_problem(OVER_GUIDE, undefined, FAST)

		expect(problem).toContain('exceeds the guide')
		expect(problem).not.toContain('implement budget')
	})

	it('judges as before when no rate is measured', () => {
		expect(size_estimate.guide_problem(OVER_GUIDE_EXCUSED, undefined)).toBeUndefined()
	})

	it('passes a split filing whatever it projects', () => {
		expect(size_estimate.guide_problem(OVER_GUIDE, SPLIT_ROUTE, SLOW)).toBeUndefined()
	})

	it('passes an estimate under the guide whatever it projects', () => {
		expect(size_estimate.guide_problem(UNDER_GUIDE, undefined, SLOW)).toBeUndefined()
	})

	it('keeps the cap refusal ahead of the projection', () => {
		const body = body_with(estimate(30, 900), REASON)

		expect(size_estimate.guide_problem(body, undefined, SLOW)).toContain('exceeds the cap')
	})
})
