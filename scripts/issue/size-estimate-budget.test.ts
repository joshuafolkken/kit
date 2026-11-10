import { lane_implement_rate, type ImplementRate } from '#scripts/lane/lane-implement-rate'
import { lane_stage_budget } from '#scripts/lane/lane-stage-budget'
import { describe, expect, it } from 'vitest'
import { size_estimate } from './size-estimate'

// joshuafolkken/kit#6025: an estimate whose projected implement time — the declared lines grown by
// `DECLARED_GROWTH_FACTOR` at the ledger's implement minutes per 100 lines — exceeds the size bar,
// twice the implement stage budget (joshuafolkken/kit#7074), is refused; only a declared reason passes
// it (joshuafolkken/kit#6602) — a split filing is excused the guide, not the bar (joshuafolkken/kit#7005).

const SPLIT_ROUTE = 'route:split'
const REASON = '- 分割しない理由: 1 コミットで入れないと壊れる'
const EXCEEDS_GUIDE = 'exceeds the guide'
// The over-guide estimate below projects past the size bar at the slow rate, within it at the fast.
const SLOW: ImplementRate = { median: 20, lanes: 4 }
const FAST: ImplementRate = { median: 4, lanes: 3 }
// The over-guide estimate below projects past the implement budget and within the size bar at this rate.
const BETWEEN: ImplementRate = { median: 5, lanes: 3 }
// The ledger's measured rate and lines growth when joshuafolkken/kit#7074 set the size bar.
const MEASURED: ImplementRate = { median: 20.6, lanes: 372 }
const MEASURED_GROWTH = { lines: 1.59375 }
// The over-guide estimate's declared lines grown by the fallback factor.
const GROWN_OVER_GUIDE_LINES = 220
const OVER_BUDGET = 'over the 18-minute size bar'
const BUDGET_REFUSAL_PARTS = [
	'44 implement minute(s)',
	'2 × the 9-minute implement budget',
	'at most 45 declared line(s)',
	'20.0 implement min',
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

		expect(problem).toContain('28 implement minute(s)')
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

// joshuafolkken/kit#7074: the size bar is twice the implement budget.
describe('size_estimate.guide_problem — the size bar', () => {
	it('passes the budget on an estimate projecting past it within twice it', () => {
		const projected = lane_implement_rate.minutes_for(GROWN_OVER_GUIDE_LINES, BETWEEN)
		const problem = size_estimate.guide_problem(OVER_GUIDE, undefined, BETWEEN)

		expect(projected).toBeGreaterThan(lane_stage_budget.BUDGET_MINUTES.implement)
		expect(problem).toContain(EXCEEDS_GUIDE)
		expect(problem).not.toContain(OVER_BUDGET)
	})

	it.each([40, 50])('neither refuses nor bars %s declared lines at the measured rate', (lines) => {
		const body = body_with(estimate(1, lines))

		expect(size_estimate.guide_problem(body, undefined, MEASURED, MEASURED_GROWTH)).toBeUndefined()
		expect(size_estimate.over_budget(body, MEASURED, MEASURED_GROWTH)).toBeUndefined()
	})

	it('bars 60 declared lines at the measured rate and prints the 54-line bar', () => {
		const body = body_with(estimate(1, 60))
		const problem = size_estimate.guide_problem(body, undefined, MEASURED, MEASURED_GROWTH)

		expect(size_estimate.over_budget(body, MEASURED, MEASURED_GROWTH)).toBeDefined()
		expect(size_estimate.declared_lines_bar(MEASURED, MEASURED_GROWTH)).toBe(54)
		expect(problem).toContain('at most 54 declared line(s)')
	})
})
