import { run_cut } from '#scripts/run/run-cut'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cost_curve, type CapSimulation } from './cost-curve'
import { cost_usage, type UsageRecord, type UsageTotals } from './cost-usage'
import { cost_verdict, type OverMeasurement } from './cost-verdict'

const OPUS = 'claude-opus-5'
const IMAGINARY = 'claude-imaginary-9'
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

// The `--cap` verdict reads a cap simulation; an empty scope has none, exactly as the report path's
// `optional_cap` withholds one for no records.
function cap_of(records: ReadonlyArray<UsageRecord>, cap: number): CapSimulation | undefined {
	return records.length === 0 ? undefined : cost_curve.simulate_cap(records, cap)
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

// joshuafolkken/kit#1933: the implementation-phase cut of a lane child is decided by this same
// `report_over` measurement — `pnpm josh cost --over <IMPLEMENTATION_CONTEXT_THRESHOLD>` — not by a
// second decision function. This pins the boundary against the real path: over the threshold a lane
// child cuts, at or below it it keeps implementing, and the threshold's initial value is the
// documented 200k, single-sourced from `run_cut` so this test and the doc cannot drift.
describe("cost_verdict.report_over at the lane child's implementation threshold", () => {
	const INITIAL_THRESHOLD = 200_000
	const threshold = run_cut.IMPLEMENTATION_CONTEXT_THRESHOLD

	it('starts at the documented 200k initial value', () => {
		expect(run_cut.IMPLEMENTATION_CONTEXT_THRESHOLD).toBe(INITIAL_THRESHOLD)
	})

	it('answers over — the lane child cuts — above the threshold', () => {
		cost_verdict.report_over(over_of([record(threshold + 1)]), threshold)

		expect(stdout()).toBe(cost_verdict.OVER_VERDICT)
	})

	it('answers under — the lane child keeps implementing — at or below the threshold', () => {
		cost_verdict.report_over(over_of([record(threshold)]), threshold)

		expect(stdout()).toBe(cost_verdict.UNDER_VERDICT)
	})
})

describe('cost_verdict.report_cap', () => {
	// context 200K (cost $1) and 800K (cost $4); a 500K cap keeps only the first — 20% of the cost.
	const two = [record(200_000), record(800_000)]

	it('prints the share of cost at or under the cap', () => {
		expect(cost_verdict.report_cap(cap_of(two, 500_000), 500_000)).toBe(0)
		expect(stdout()).toBe('20.0%')
	})

	// The withheld convention: nothing priced is "not measured", never a ratio of 0.
	it('prints "not measured" when nothing could be priced', () => {
		const unpriced = [{ ...record(100), model: IMAGINARY }]

		cost_verdict.report_cap(cap_of(unpriced, 500_000), 500_000)

		expect(stdout()).toBe('not measured')
	})

	it('reports an empty scope rather than a ratio', () => {
		expect(cost_verdict.report_cap(cap_of([], 500_000), 500_000)).toBe(FAILURE_EXIT_CODE)
	})
})
