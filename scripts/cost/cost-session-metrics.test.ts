import { cost_usage, type UsageRecord } from '#scripts/cost-runtime/cost-usage'
import { describe, expect, it } from 'vitest'
import { cost_session_metrics } from './cost-session-metrics'

const OPUS = 'claude-opus-4-8'
const SONNET = 'claude-sonnet-4-6'
const OUTPUT = 100

// A synthetic request. `thinking` omitted means the API sent no breakdown — measured false, the
// case a session row must print "not measured" for rather than 0%.
function record(model: string, input_tokens: number, thinking?: number): UsageRecord {
	return {
		request_id: `${model}-${String(input_tokens)}`,
		model,
		branch: 'main',
		at_ms: undefined,
		totals: {
			...cost_usage.EMPTY_TOTALS,
			input_tokens,
			output_tokens: OUTPUT,
			thinking_tokens: thinking ?? 0,
			thinking_measured: thinking !== undefined,
		},
	}
}

describe('cost_session_metrics.build — the model column', () => {
	it('names the most-used model first and lists the others after', () => {
		const metrics = cost_session_metrics.build([
			record(OPUS, 1000, 10),
			record(OPUS, 2000, 20),
			record(SONNET, 500, 5),
		])

		expect(metrics.primary_model).toBe(OPUS)
		expect(metrics.other_models).toEqual([SONNET])
	})

	// The transcript records no effort, so the column says so rather than inventing one.
	it('says effort is not recorded', () => {
		const metrics = cost_session_metrics.build([record(OPUS, 1000, 10)])

		expect(cost_session_metrics.format(metrics)).toContain('effort not recorded')
	})
})

describe('cost_session_metrics.build — the thinking column', () => {
	it('reports the thinking share when the API measured it', () => {
		const metrics = cost_session_metrics.build([record(OPUS, 1000, 40)])

		expect(metrics.thinking.measured).toBe(true)
		expect(cost_session_metrics.format(metrics)).toContain('thinking 40.0%')
	})

	// The distinction the whole flag exists for: absent is not zero.
	it('reports thinking as not measured when no request carried a count', () => {
		const metrics = cost_session_metrics.build([record(OPUS, 1000)])

		expect(metrics.thinking.measured).toBe(false)
		expect(cost_session_metrics.format(metrics)).toContain('thinking not measured')
	})

	it('counts the session measured once any one request carried a count', () => {
		const metrics = cost_session_metrics.build([record(OPUS, 1000), record(OPUS, 1000, 30)])

		expect(metrics.thinking.measured).toBe(true)
	})
})

describe('cost_session_metrics.build — the context column', () => {
	it('reports the per-request context-size distribution', () => {
		const metrics = cost_session_metrics.build([
			record(OPUS, 1000, 1),
			record(OPUS, 3000, 1),
			record(OPUS, 5000, 1),
		])

		expect(metrics.context.sample_count).toBe(3)
		expect(metrics.context.median_ms).toBe(3000)
		expect(metrics.context.max_ms).toBe(5000)
		expect(cost_session_metrics.format(metrics)).toContain('context med')
	})
})
