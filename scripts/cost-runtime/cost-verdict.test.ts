import { run_cut } from '#scripts/run/run-cut'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONTEXT_CUT_THRESHOLD } from './context-cut-threshold'
import { cost_usage, type UsageRecord, type UsageTotals } from './cost-usage'
import { cost_verdict, type OverMeasurement } from './cost-verdict'

const OPUS = 'claude-opus-5'
const FAILURE_EXIT_CODE = 1
const state = { out: [] as Array<string> }

function record(input_tokens: number, overrides: Partial<UsageTotals> = {}): UsageRecord {
	return {
		request_id: `r${String(input_tokens)}`,
		model: OPUS,
		branch: 'main',
		at_ms: undefined,
		totals: { ...cost_usage.EMPTY_TOTALS, input_tokens, ...overrides },
	}
}

// The `--over` verdict reads only how many requests paid and the billed input they paid, taken from
// the same runtime aggregation the light path uses.
function over_of(records: ReadonlyArray<UsageRecord>): OverMeasurement {
	return {
		request_count: records.length,
		billed_input_tokens: cost_usage.billed_input(cost_usage.sum_totals(records)),
	}
}

beforeEach(() => {
	state.out = []
	vi.spyOn(console, 'info').mockImplementation((message: unknown) => {
		state.out.push(String(message))
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

function stdout(): string {
	return state.out.join('\n').trim()
}

describe('cost_verdict.per_request_cost', () => {
	it('divides billed input by the requests that paid for it', () => {
		const measurement = over_of([record(100), record(100)])

		expect(cost_verdict.per_request_cost(measurement)).toBe(100)
	})

	// Dividing by no requests would throw or answer Infinity; a session that asked nothing has
	// nothing to hand off.
	it('answers zero for a session with no requests', () => {
		expect(cost_verdict.per_request_cost(over_of([]))).toBe(0)
	})
})

describe('cost_verdict.report_over', () => {
	const one = over_of([record(100)])

	it('answers over when the marginal cost exceeds the limit', () => {
		expect(cost_verdict.report_over(one, 0)).toBe(0)
		expect(stdout()).toBe('over')
	})

	it('answers under when it does not', () => {
		cost_verdict.report_over(one, 999_999)

		expect(stdout()).toBe('under')
	})

	it('reports an empty session rather than a verdict', () => {
		expect(cost_verdict.report_over(over_of([]), 0)).toBe(FAILURE_EXIT_CODE)
	})
})

describe('cost_verdict.classify', () => {
	const one = over_of([record(100)])

	it('answers over when the marginal cost exceeds the limit, printing nothing', () => {
		expect(cost_verdict.classify(one, 0)).toBe(cost_verdict.OVER_VERDICT)
		expect(stdout()).toBe('')
	})

	it('answers under at exactly the limit', () => {
		expect(cost_verdict.classify(one, 100)).toBe(cost_verdict.UNDER_VERDICT)
	})
})

// joshuafolkken/kit#1933: the implementation-phase cut of a lane child is decided by this same
// `report_over` measurement — `pnpm josh cost --cut` — not by a
// second decision function. This pins the boundary against the real path: over the threshold a lane
// child cuts, at or below it it keeps implementing, and the shared threshold is single-sourced so
// the scheduler and worker cannot drift.
describe("cost_verdict.report_over at the lane child's implementation threshold", () => {
	const EXPECTED_CONTEXT_CUT_THRESHOLD = 200_000
	const threshold = CONTEXT_CUT_THRESHOLD

	it('uses the shared 200k threshold', () => {
		expect(CONTEXT_CUT_THRESHOLD).toBe(EXPECTED_CONTEXT_CUT_THRESHOLD)
		expect(run_cut.IMPLEMENTATION_CONTEXT_THRESHOLD).toBe(CONTEXT_CUT_THRESHOLD)
	})

	it.each([
		[cost_verdict.UNDER_VERDICT, threshold - 1],
		[cost_verdict.UNDER_VERDICT, threshold],
		[cost_verdict.OVER_VERDICT, threshold + 1],
	])('answers %s at the shared boundary for %s billed tokens', (verdict, tokens) => {
		cost_verdict.report_over(over_of([record(tokens)]), threshold)

		expect(stdout()).toBe(verdict)
	})
})
