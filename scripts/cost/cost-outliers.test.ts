import { describe, expect, it } from 'vitest'
import { cost_outliers } from './cost-outliers'
import { cost_usage, type UsageRecord } from './cost-usage'

const OPUS = 'claude-opus-5'
const IMAGINARY = 'claude-imaginary-9'
const TWO_MINUTES_MS = 120_000

function record(cache_write: number, at_ms?: number, model: string = OPUS): UsageRecord {
	return {
		request_id: `r${String(cache_write)}-${model}`,
		model,
		branch: 'main',
		at_ms,
		totals: { ...cost_usage.EMPTY_TOTALS, cache_write_1h_tokens: cache_write },
	}
}

describe('cost_outliers.build_outliers', () => {
	it('ranks the requests by cache write, largest first', () => {
		const { requests } = cost_outliers.build_outliers([record(100), record(900), record(300)])

		expect(requests.map((one) => one.cache_creation_tokens)).toEqual([900, 300, 100])
	})

	it('keeps at most the top few', () => {
		const many = Array.from({ length: 8 }, (_unused, index) => record((index + 1) * 1000))

		expect(cost_outliers.build_outliers(many).requests).toHaveLength(cost_outliers.TOP_N)
	})

	// A run of small requests has no spike to show, rather than a list padded with zeroes.
	it('drops requests that wrote no cache', () => {
		expect(cost_outliers.build_outliers([record(0), record(0)]).requests).toHaveLength(0)
	})

	it('reports the minute offset from the scope first request', () => {
		const [outlier] = cost_outliers.build_outliers([
			record(100, 0),
			record(900, TWO_MINUTES_MS),
		]).requests

		expect(outlier?.at_minute).toBe(2)
	})

	// Absent, never 0: a request with no readable instant is not one that happened at the start.
	it('withholds the minute when a timestamp is missing', () => {
		const [outlier] = cost_outliers.build_outliers([record(900)]).requests

		expect(outlier?.at_minute).toBeUndefined()
	})

	it('withholds the cost of an unpriced model', () => {
		const [outlier] = cost_outliers.build_outliers([record(900, undefined, IMAGINARY)]).requests

		expect(outlier?.cost_usd).toBeUndefined()
	})
})

describe('cost_outliers.format_outlier_lines', () => {
	it('renders the largest-request lines', () => {
		const lines = cost_outliers.format_outlier_lines(cost_outliers.build_outliers([record(900, 0)]))

		expect(lines.join('\n')).toContain('Largest requests')
	})

	it('prints nothing when there is no outlier', () => {
		expect(cost_outliers.format_outlier_lines({ requests: [] })).toHaveLength(0)
	})
})
