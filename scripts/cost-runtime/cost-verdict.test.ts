import { run_cut } from '#scripts/run/run-cut'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { context_cut_payback } from './context-cut-payback'
import { CONTEXT_CUT_THRESHOLD } from './context-cut-threshold'
import { cost_usage, type UsageRecord, type UsageTotals } from './cost-usage'
import { cost_verdict, type OverMeasurement } from './cost-verdict'

const OPUS = 'claude-opus-5'
const FAILURE_EXIT_CODE = 1
const SHORT_LOW = 100
const SHORT_HIGH = 300
const state = { out: [] as Array<string>, err: [] as Array<string> }

function record(input_tokens: number, overrides: Partial<UsageTotals> = {}): UsageRecord {
	return {
		request_id: `r${String(input_tokens)}`,
		model: OPUS,
		branch: 'main',
		at_ms: undefined,
		totals: { ...cost_usage.EMPTY_TOTALS, input_tokens, ...overrides },
	}
}

// The `--over` verdict reads the billed input each request paid, taken from the same runtime
// aggregation the light path uses — one entry per request, oldest first.
function over_of(records: ReadonlyArray<UsageRecord>): OverMeasurement {
	return { billed_input_per_request: records.map((entry) => cost_usage.billed_input(entry.totals)) }
}

// A measurement built straight from a per-request billed-input sequence, for the cases
// that care about the shape of the sequence rather than how a record maps to it.
function over_from(billed: ReadonlyArray<number>): OverMeasurement {
	return { billed_input_per_request: billed }
}

beforeEach(() => {
	state.out = []
	state.err = []
	vi.spyOn(console, 'info').mockImplementation((message: unknown) => {
		state.out.push(String(message))
	})
	vi.spyOn(console, 'error').mockImplementation((message: unknown) => {
		state.err.push(String(message))
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

function stdout(): string {
	return state.out.join('\n').trim()
}

function stderr(): string {
	return state.err.join('\n').trim()
}

describe('cost_verdict.per_request_cost', () => {
	it('answers the billed input of the newest request', () => {
		const measurement = over_of([record(SHORT_LOW), record(SHORT_HIGH)])

		expect(cost_verdict.per_request_cost(measurement)).toBe(SHORT_HIGH)
	})

	// A session that asked nothing has nothing to hand off.
	it('answers zero for a session with no requests', () => {
		expect(cost_verdict.per_request_cost(over_of([]))).toBe(0)
	})
})

// joshuafolkken/kit#3224: the hand-off prices the newest request, so a growing context hands off at
// the request that crosses the threshold rather than once an average trailing it catches up.
describe('cost_verdict.classify on the newest request', () => {
	// The billed input of wake session 03367124's requests 60–69 on 2026-10-05: the newest crossed
	// 135k at request 65, while the ten-request average stayed under until request 70.
	const GROWING_CONTEXT = [
		126_663, 127_928, 132_110, 133_003, 134_270, 135_535, 136_676, 137_953, 138_506, 139_243,
	]
	const BEFORE_CROSSING = 5

	it('answers over at the first request past the threshold, while an average still trails it', () => {
		const average = Math.round(
			GROWING_CONTEXT.reduce((sum, billed) => sum + billed, 0) / GROWING_CONTEXT.length,
		)

		expect(average).toBeLessThan(CONTEXT_CUT_THRESHOLD)
		expect(cost_verdict.classify(over_from(GROWING_CONTEXT), CONTEXT_CUT_THRESHOLD)).toBe(
			cost_verdict.OVER_VERDICT,
		)
	})

	it('stays under at the request just before the crossing', () => {
		const before = GROWING_CONTEXT.slice(0, BEFORE_CROSSING)

		expect(cost_verdict.classify(over_from(before), CONTEXT_CUT_THRESHOLD)).toBe(
			cost_verdict.UNDER_VERDICT,
		)
	})

	// A compaction drops the context; the newest request reads the drop at once, where an average
	// would keep the session over for several more requests.
	it('answers under once the newest request falls back below the threshold', () => {
		const compacted = [...GROWING_CONTEXT, SHORT_HIGH]

		expect(cost_verdict.classify(over_from(compacted), CONTEXT_CUT_THRESHOLD)).toBe(
			cost_verdict.UNDER_VERDICT,
		)
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

	// joshuafolkken/kit#3224: the stderr line names the request priced, so it is not mistaken for an
	// average over the session.
	it('names the newest request as the one priced', () => {
		cost_verdict.report_over(over_from([SHORT_LOW, SHORT_HIGH]), CONTEXT_CUT_THRESHOLD)

		expect(stderr()).toContain(
			`${String(SHORT_HIGH)} billed input tokens per request, on the newest of 2 request(s)`,
		)
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
	// joshuafolkken/kit#2406 replaced the hand-picked ceiling with the break-even context: at
	// POST_CUT_CONTEXT 60_000 and a 10-request horizon that is 135_000, and it is derived from the
	// payback model rather than restated, so this pins the derivation, not a second literal.
	const EXPECTED_CONTEXT_CUT_THRESHOLD = 135_000
	const threshold = CONTEXT_CUT_THRESHOLD

	it('uses the break-even context as the shared threshold', () => {
		expect(CONTEXT_CUT_THRESHOLD).toBe(EXPECTED_CONTEXT_CUT_THRESHOLD)
		expect(CONTEXT_CUT_THRESHOLD).toBe(context_cut_payback.break_even_context())
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
