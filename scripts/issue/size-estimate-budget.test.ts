import { lane_implement_rate, type ImplementRate } from '#scripts/lane/lane-implement-rate'
import { lane_stage_budget } from '#scripts/lane/lane-stage-budget'
import { describe, expect, it } from 'vitest'
import { size_estimate } from './size-estimate'

// joshuafolkken/kit#6025: an estimate over the guide whose projected implement time — the declared
// lines grown by `DECLARED_GROWTH_FACTOR` at the ledger's implement minutes per 100 lines — exceeds the
// implement stage budget is refused; only a declared reason passes it (joshuafolkken/kit#6602) — a split
// filing is excused the guide, not the budget (joshuafolkken/kit#7005).

const SPLIT_ROUTE = 'route:split'
const REASON = '- 分割しない理由: 1 コミットで入れないと壊れる'
const EXCEEDS_GUIDE = 'exceeds the guide'
// The over-guide estimate below projects past the stage budget at the slow rate, within it at the fast.
const SLOW: ImplementRate = { median: 10, lanes: 4 }
const FAST: ImplementRate = { median: 4, lanes: 3 }
// The over-guide estimate below projects within the budget joshuafolkken/kit#6540 replaced and past
// the current one at this rate.
const BETWEEN: ImplementRate = { median: 5, lanes: 3 }
const FORMER_IMPLEMENT_BUDGET = 12
// The over-guide estimate's declared lines grown by the fallback factor.
const GROWN_OVER_GUIDE_LINES = 220
const OVER_BUDGET = 'over the 9-minute implement budget'
const BUDGET_REFUSAL_PARTS = [
	'22 implement minute(s)',
	'9-minute',
	'10.0 implement min',
	'4 lane(s)',
	'or declare `- 分割しない理由: <理由>`',
]

function body_with(...lines: ReadonlyArray<string>): string {
	return ['## 背景', '', '- 種別: 非不具合', ...lines, '', '## 現象', '', 'x'].join('\n')
}

function estimate(files: number, lines: number): string {
	return `- 規模見積もり: 約 ${String(files)} ファイル / ${String(lines)} 行（テスト除く）`
}

const OVER_GUIDE = body_with(estimate(2, 110))
const OVER_GUIDE_EXCUSED = body_with(estimate(2, 110), REASON)
const UNDER_GUIDE = body_with(estimate(1, 40))

describe('size_estimate.guide_problem — the projected implement time', () => {
	it('refuses an over-budget estimate within the floor without claiming a guide overrun', () => {
		const problem = size_estimate.guide_problem(body_with(estimate(1, 70)), undefined, SLOW)

		expect(problem).toContain('14 implement minute(s)')
		expect(problem).toContain(OVER_BUDGET)
		expect(problem).not.toContain(EXCEEDS_GUIDE)
	})

	it('refuses an unreasoned estimate over the guide projecting past the budget', () => {
		const problem = size_estimate.guide_problem(OVER_GUIDE, undefined, SLOW) ?? ''

		for (const part of BUDGET_REFUSAL_PARTS) {
			expect(problem).toContain(part)
		}
	})

	// joshuafolkken/kit#6602: the declared reason is the pre-start decision, so it excuses the budget.
	it('passes a reasoned estimate past or within the budget', () => {
		expect(size_estimate.guide_problem(OVER_GUIDE_EXCUSED, undefined, SLOW)).toBeUndefined()
		expect(size_estimate.guide_problem(OVER_GUIDE_EXCUSED, undefined, FAST)).toBeUndefined()
	})

	it('keeps the guide refusal for an unreasoned estimate within the budget', () => {
		const problem = size_estimate.guide_problem(body_with(estimate(6, 110)), undefined, FAST)

		expect(problem).toContain(EXCEEDS_GUIDE)
		expect(problem).not.toContain('implement budget')
	})

	it('judges as before when no rate is measured', () => {
		expect(size_estimate.guide_problem(OVER_GUIDE_EXCUSED, undefined)).toBeUndefined()
	})

	it('passes an estimate under the measured guide within the budget', () => {
		expect(size_estimate.guide_problem(UNDER_GUIDE, undefined, SLOW)).toBeUndefined()
	})
})

// joshuafolkken/kit#7005: the split route excuses the guide only.
describe('size_estimate.guide_problem — a split filing and the budget', () => {
	it('refuses a split filing projecting past the budget', () => {
		const problem = size_estimate.guide_problem(OVER_GUIDE, SPLIT_ROUTE, SLOW)

		expect(problem).toContain(OVER_BUDGET)
		expect(problem).not.toContain('--route split')
	})

	it('passes a split filing over the guide within the budget', () => {
		expect(size_estimate.guide_problem(OVER_GUIDE, SPLIT_ROUTE, FAST)).toBeUndefined()
	})

	it('passes a reasoned split filing past the budget', () => {
		expect(size_estimate.guide_problem(OVER_GUIDE_EXCUSED, SPLIT_ROUTE, SLOW)).toBeUndefined()
	})
})

describe('size_estimate.guide_problem — the cap and the projection', () => {
	it('keeps the cap refusal ahead of the projection', () => {
		const body = body_with(estimate(30, 900))

		expect(size_estimate.guide_problem(body, undefined, SLOW)).toContain('exceeds the cap')
	})
})

// joshuafolkken/kit#6066: the judgment `backlog:next` notes on, shared with the filing refusal.
describe('size_estimate.over_budget', () => {
	it('uses the measured lines growth at the budget boundary', () => {
		const body = body_with(estimate(1, 60))

		expect(size_estimate.over_budget(body, SLOW, { files: 9, lines: 1.5 })).toBeUndefined()
		expect(size_estimate.over_budget(body, SLOW, { files: 1, lines: 1.6 })).toBeDefined()
		expect(
			size_estimate.guide_problem(body, undefined, SLOW, { files: 1, lines: 1.5 }),
		).toBeUndefined()
	})

	it('answers the estimate of an unreasoned body projecting past the budget', () => {
		expect(size_estimate.over_budget(OVER_GUIDE, SLOW)).toEqual({
			files: 2,
			lines: 110,
			verdict: 'split',
		})
	})

	it('answers nothing within the budget, with no rate, or for a reasoned body', () => {
		expect(size_estimate.over_budget(OVER_GUIDE, FAST)).toBeUndefined()
		expect(size_estimate.over_budget(OVER_GUIDE, undefined)).toBeUndefined()
		expect(size_estimate.over_budget(OVER_GUIDE_EXCUSED, SLOW)).toBeUndefined()
	})
})

// joshuafolkken/kit#6540: the lane budget rebalance shrank the implement budget.
describe('size_estimate.guide_problem — the rebalanced implement budget', () => {
	it('refuses an estimate the former implement budget passed (ac-a815e182)', () => {
		const projected = lane_implement_rate.minutes_for(GROWN_OVER_GUIDE_LINES, BETWEEN)
		const problem = size_estimate.guide_problem(OVER_GUIDE, undefined, BETWEEN)

		expect(projected).toBeLessThanOrEqual(FORMER_IMPLEMENT_BUDGET)
		expect(projected).toBeGreaterThan(lane_stage_budget.BUDGET_MINUTES.implement)
		expect(problem).toContain('11 implement minute(s)')
		expect(problem).toContain(OVER_BUDGET)
	})
})
