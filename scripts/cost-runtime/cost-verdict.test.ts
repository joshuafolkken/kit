import { run_cut } from '#scripts/run/run-cut'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONTEXT_CUT_THRESHOLD, RECENT_REQUEST_WINDOW } from './context-cut-threshold'
import { cost_usage, type UsageRecord, type UsageTotals } from './cost-usage'
import { cost_verdict, type OverMeasurement } from './cost-verdict'

const OPUS = 'claude-opus-5'
const FAILURE_EXIT_CODE = 1
const SHORT_LOW = 100
const SHORT_HIGH = 300
const SHORT_MEAN = 200
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

// A measurement built straight from a per-request billed-input sequence, for the recent-window cases
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

// joshuafolkken/kit#2295: the hand-off prices the recent tail, not the whole session, so a long
// parent whose context has grown hands off on its current cost rather than an average that lags it.
describe('cost_verdict.per_request_cost recent window', () => {
	const CHEAP_EARLY = 60_000
	const EARLY_COUNT = 40
	const DEAR_LATE = 260_000
	const UNDER_EACH = 100_000

	// Many cheap early requests, then a tail above the threshold: the whole-session average stays well
	// under, so the old measurement kept supervising; the recent window prices the tail and hands off.
	it('prices the recent tail so a late context spike reads over', () => {
		const early = Array.from({ length: EARLY_COUNT }, () => CHEAP_EARLY)
		const late = Array.from({ length: RECENT_REQUEST_WINDOW }, () => DEAR_LATE)

		expect(cost_verdict.classify(over_from([...early, ...late]), CONTEXT_CUT_THRESHOLD)).toBe(
			cost_verdict.OVER_VERDICT,
		)
	})

	it('stays under when every recent request is below the threshold', () => {
		const requests = Array.from({ length: EARLY_COUNT }, () => UNDER_EACH)

		expect(cost_verdict.classify(over_from(requests), CONTEXT_CUT_THRESHOLD)).toBe(
			cost_verdict.UNDER_VERDICT,
		)
	})

	// Fewer requests than the window: the average is taken over the requests that exist, never a
	// division by a padded window.
	it('averages only the requests present when fewer than the window', () => {
		expect(cost_verdict.per_request_cost(over_from([SHORT_LOW, SHORT_HIGH]))).toBe(SHORT_MEAN)
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

	// joshuafolkken/kit#2295: the stderr line names how many of the session's requests the average
	// covers, so a recent-tail average is not mistaken for a whole-session one.
	it('names the window the average covers', () => {
		cost_verdict.report_over(over_from([SHORT_LOW, SHORT_HIGH]), CONTEXT_CUT_THRESHOLD)

		expect(stderr()).toContain('over the last 2 of 2 request(s)')
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
