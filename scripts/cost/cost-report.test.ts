import { describe, expect, it } from 'vitest'
import { cost_report, type CostReport, type MissingData } from './cost-report'
import { cost_usage, type UsageRecord, type UsageTotals } from './cost-usage'

const NO_MISSING: MissingData = { no_usage_lines: 0, malformed_lines: 0, unreadable_sessions: 0 }
const RESIDENT = 100_000
const MILLION = 1_000_000
const ISSUE_SCOPE = 'issue #962'
const SESSION_SCOPE = 'session x'
const IMAGINARY = 'claude-imaginary-9'
const OPUS = 'claude-opus-5'

function record(request_id: string, overrides: Partial<UsageTotals> = {}): UsageRecord {
	return {
		request_id,
		model: OPUS,
		branch: 'main',
		totals: { ...cost_usage.EMPTY_TOTALS, ...overrides },
	}
}

function report_of(records: ReadonlyArray<UsageRecord>, scope: string = SESSION_SCOPE): CostReport {
	const missing = NO_MISSING

	return cost_report.build_report({ scope, records, missing, resident_billed_tokens: 0 })
}

const TWO_REQUESTS = [
	record('a', { cache_write_1h_tokens: RESIDENT }),
	record('b', { cache_read_tokens: RESIDENT + 5000 }),
]

describe('cost_report.build_breakdown', () => {
	// A session's baseline is re-read by every one of its requests, so what the scope paid for the
	// resident half is that baseline times the request count — supplied by the caller, which is the
	// only party that knows which session each record came from.
	it('charges what the caller says the resident preamble cost', () => {
		const breakdown = cost_report.build_breakdown(TWO_REQUESTS, RESIDENT * 2)

		expect(breakdown.resident_billed_tokens).toBe(RESIDENT * 2)
		expect(breakdown.resident_baseline_tokens).toBe(RESIDENT)
	})

	it('leaves the rest of the billed input as conversation history', () => {
		expect(cost_report.build_breakdown(TWO_REQUESTS, RESIDENT * 2).history_billed_tokens).toBe(5000)
	})

	// A reader has to be able to check the split, so the two shares must reconstruct the total.
	it('splits the billed input exactly, with nothing unaccounted for', () => {
		const records = [
			record('a', { input_tokens: 10, cache_read_tokens: 90 }),
			record('b', { cache_read_tokens: 400 }),
		]
		const breakdown = cost_report.build_breakdown(records, 100)

		expect(breakdown.resident_billed_tokens + breakdown.history_billed_tokens).toBe(
			breakdown.billed_input_tokens,
		)
	})

	it('never charges more resident than the scope billed', () => {
		const records = [
			record('a', { cache_read_tokens: 1000 }),
			record('b', { cache_read_tokens: 10 }),
		]
		const breakdown = cost_report.build_breakdown(records, 5000)

		expect(breakdown.history_billed_tokens).toBe(0)
		expect(breakdown.resident_billed_tokens).toBe(1010)
	})

	it('reports zeroes for no requests instead of dividing by none', () => {
		const breakdown = cost_report.build_breakdown([], 0)

		expect(breakdown.billed_input_tokens).toBe(0)
		expect(breakdown.resident_baseline_tokens).toBe(0)
	})
})

// The defect the explicit parameter exists to fix: the first record of a *filtered* set is a warm
// mid-session request, and reading it as the preamble reported one issue as 86.5% resident where the
// session it came from was 27.7%.
describe('cost_report.build_breakdown on a filtered set', () => {
	it('does not infer the baseline from the first record it was handed', () => {
		const warm = [
			record('a', { cache_read_tokens: 200_000 }),
			record('b', { cache_read_tokens: 200_000 }),
		]
		const breakdown = cost_report.build_breakdown(warm, RESIDENT)

		expect(breakdown.resident_billed_tokens).toBe(RESIDENT)
		expect(breakdown.history_billed_tokens).toBe(300_000)
	})
})

describe('cost_report.build_report', () => {
	it('prices the run and names its scope', () => {
		const report = report_of([record('a', { output_tokens: MILLION })], ISSUE_SCOPE)

		expect(report.scope).toBe(ISSUE_SCOPE)
		expect(report.cost_usd).toBe(25)
		expect(report.request_count).toBe(1)
	})

	it('carries the unpriced models forward so the total is read as a floor', () => {
		const report = report_of([{ ...record('a', { output_tokens: 10 }), model: IMAGINARY }])

		expect(report.unpriced_models).toStrictEqual([IMAGINARY])
	})

	// #921 needs a number it can cite as the basis for a budget cap, so the machine-readable shape
	// has to carry the cost and the request count, not only the prose.
	it('serializes to JSON carrying the cost and the request count', () => {
		const report = report_of([record('a')], ISSUE_SCOPE)
		const parsed: unknown = structuredClone(report)

		expect(parsed).toMatchObject({ scope: ISSUE_SCOPE, cost_usd: 0, request_count: 1 })
	})
})

function formatted(records: ReadonlyArray<UsageRecord>, missing: MissingData = NO_MISSING): string {
	return cost_report.format_report(
		cost_report.build_report({ scope: SESSION_SCOPE, records, missing, resident_billed_tokens: 0 }),
	)
}

describe('cost_report.format_report', () => {
	it('names the three input kinds with their multipliers', () => {
		const text = formatted([record('a', { cache_read_tokens: 10 })])

		expect(text).toContain('cache write 1h')
		expect(text).toContain('cache read')
		expect(text).toContain('x0.1')
	})

	it('reports missing data rather than passing it off as zero cost', () => {
		const text = formatted([record('a')], {
			no_usage_lines: 2,
			malformed_lines: 3,
			unreadable_sessions: 1,
		})

		expect(text).toContain('unparseable lines: 3')
		expect(text).toContain('assistant lines without usage: 2')
		expect(text).toContain('unreadable sessions: 1')
	})

	it('says nothing about missing data when there is none', () => {
		expect(formatted([record('a')])).not.toContain('Missing data')
	})

	it('warns that the total is a floor when a model could not be priced', () => {
		expect(formatted([{ ...record('a'), model: IMAGINARY }])).toContain('is not in the price table')
	})
})

describe('cost_report.format_report on an empty scope', () => {
	// A table of zeroes reads as "this run was free" — the failure the command exists to remove.
	it('says nothing was attributed instead of printing a zero cost', () => {
		const text = cost_report.format_report(report_of([], ISSUE_SCOPE))

		expect(text).toContain('no requests')
		expect(text).toContain('No requests are attributed')
		expect(text).not.toContain('$0.0000')
	})

	it('still reports what could not be read', () => {
		const missing = { ...NO_MISSING, malformed_lines: 12 }
		const report = cost_report.build_report({
			scope: ISSUE_SCOPE,
			records: [],
			missing,
			resident_billed_tokens: 0,
		})

		expect(cost_report.format_report(report)).toContain('unparseable lines: 12')
	})
})

describe('cost_report.format_totals_line', () => {
	it('sums the scopes it is given', () => {
		const reports = [
			report_of([record('a', { output_tokens: MILLION })], ISSUE_SCOPE),
			cost_report.build_report({
				scope: 'issue #963',
				records: [record('b', { output_tokens: MILLION })],
				missing: NO_MISSING,
				resident_billed_tokens: 0,
			}),
		]

		expect(cost_report.format_totals_line(reports)).toContain('$50.0000')
		expect(cost_report.format_totals_line(reports)).toContain('2 request(s)')
	})
})

describe('cost_report.format_share', () => {
	it('reports a share as a percentage', () => {
		expect(cost_report.format_share(1, 4)).toBe('25.0%')
	})

	it('refuses to divide by nothing', () => {
		expect(cost_report.format_share(0, 0)).toBe('n/a')
	})
})
