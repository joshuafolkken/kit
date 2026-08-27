import { describe, expect, it } from 'vitest'
import { cost_usage, type UsageRecord } from './cost-usage'

const REQUEST_ID = 'req_1'
const ASSISTANT = 'assistant'
const OPUS = 'claude-opus-5'
const MINIMAL_USAGE = { input_tokens: 1, output_tokens: 1 }

function line(
	overrides: Record<string, unknown> = {},
	usage: Record<string, unknown> = {},
): string {
	return JSON.stringify({
		type: ASSISTANT,
		requestId: REQUEST_ID,
		gitBranch: 'main',
		message: {
			model: OPUS,
			usage: {
				input_tokens: 2,
				cache_creation_input_tokens: 100,
				cache_read_input_tokens: 1000,
				output_tokens: 50,
				output_tokens_details: { thinking_tokens: 10 },
				...usage,
			},
		},
		...overrides,
	})
}

function record(request_id: string, output_tokens: number): UsageRecord {
	return {
		request_id,
		model: OPUS,
		branch: 'main',
		totals: { ...cost_usage.EMPTY_TOTALS, output_tokens },
	}
}

describe('cost_usage.parse_line', () => {
	it('reads the billed quantities from an assistant line', () => {
		const outcome = cost_usage.parse_line(line())

		expect(outcome.kind).toBe('record')
		expect(outcome.kind === 'record' && outcome.record.totals.cache_read_tokens).toBe(1000)
	})

	it('reports an assistant line carrying no usage as missing, not as zero', () => {
		expect(cost_usage.parse_line(JSON.stringify({ type: ASSISTANT, message: {} })).kind).toBe(
			'no_usage',
		)
	})

	it('reports an unparseable line as malformed', () => {
		expect(cost_usage.parse_line('{ not json').kind).toBe('malformed')
	})

	it('skips lines that are not assistant turns', () => {
		expect(cost_usage.parse_line(JSON.stringify({ type: 'user' })).kind).toBe('skipped')
	})

	it('falls back to a model marker when the line names none', () => {
		const outcome = cost_usage.parse_line(
			JSON.stringify({ type: ASSISTANT, message: { usage: MINIMAL_USAGE } }),
		)

		expect(outcome.kind === 'record' && outcome.record.model).toBe(cost_usage.UNKNOWN_MODEL)
	})
})

// The transcript writes an absent value as `null`, not by omitting the key. A schema that accepts
// only `undefined` rejected 12 valid lines in this project's own transcripts and reported them as
// unparseable — the reader silently mislabelling data, which is what this command exists to stop.
const NULL_FIELDS_LINE = `{
	"type": "assistant",
	"requestId": "r1",
	"gitBranch": null,
	"message": {
		"model": "claude-opus-5",
		"usage": {
			"input_tokens": 1,
			"output_tokens": 2,
			"output_tokens_details": null,
			"cache_creation": null,
			"cache_read_input_tokens": null
		}
	}
}`.replaceAll('\n', '')

const NULL_USAGE_LINE = '{"type":"assistant","message":{"usage":null}}'

describe('cost_usage.parse_line on null-valued fields', () => {
	it('reads a line whose optional fields are null rather than absent', () => {
		const outcome = cost_usage.parse_line(NULL_FIELDS_LINE)

		expect(outcome.kind).toBe('record')
		expect(outcome.kind === 'record' && outcome.record.totals.output_tokens).toBe(2)
	})

	it('reports a usage of null as missing rather than as malformed', () => {
		expect(cost_usage.parse_line(NULL_USAGE_LINE).kind).toBe('no_usage')
	})

	// Locally generated, never sent to the API — counting it would inflate the request count and
	// raise an unknown-model warning about something that was never priced.
	it('skips a synthetic assistant message', () => {
		const outcome = cost_usage.parse_line(
			JSON.stringify({
				type: ASSISTANT,
				message: { model: cost_usage.SYNTHETIC_MODEL, usage: MINIMAL_USAGE },
			}),
		)

		expect(outcome.kind).toBe('skipped')
	})
})

describe('cost_usage.parse_line on the cache-write TTL', () => {
	it('splits the cache write by TTL when the line carries the detail', () => {
		const detail = { ephemeral_1h_input_tokens: 80, ephemeral_5m_input_tokens: 20 }
		const outcome = cost_usage.parse_line(line({}, { cache_creation: detail }))

		expect(outcome.kind === 'record' && outcome.record.totals.cache_write_1h_tokens).toBe(80)
		expect(outcome.kind === 'record' && outcome.record.totals.cache_write_5m_tokens).toBe(20)
	})

	it('reads a write with no TTL detail as the cheaper 5-minute kind', () => {
		const outcome = cost_usage.parse_line(line())

		expect(outcome.kind === 'record' && outcome.record.totals.cache_write_5m_tokens).toBe(100)
		expect(outcome.kind === 'record' && outcome.record.totals.cache_write_1h_tokens).toBe(0)
	})
})

describe('cost_usage.parse_line on lines it does not price', () => {
	it('skips a blank line', () => {
		expect(cost_usage.parse_line(' '.repeat(3)).kind).toBe('skipped')
	})
})

describe('cost_usage.dedupe', () => {
	// One API response is written as several assistant lines — one per content block — and every one
	// carries the same usage. Counting lines over-reports a real session's cost by about 3x.
	it('counts one request once however many lines carried it', () => {
		const parsed = [line(), line(), line()].map((raw) => cost_usage.parse_line(raw))
		const records = parsed.flatMap((outcome) => (outcome.kind === 'record' ? [outcome.record] : []))

		expect(records).toHaveLength(3)
		expect(cost_usage.dedupe(records)).toHaveLength(1)
	})

	it('keeps distinct requests apart', () => {
		expect(cost_usage.dedupe([record('a', 1), record('b', 2)])).toHaveLength(2)
	})

	it('keeps the order the requests were seen in', () => {
		const seen = [record('b', 1), record('a', 2), record('b', 3)]

		expect(cost_usage.dedupe(seen).map((entry) => entry.request_id)).toStrictEqual(['b', 'a'])
	})

	it('treats a line with no request id as its own request', () => {
		const first = cost_usage.parse_line(
			JSON.stringify({ type: ASSISTANT, timestamp: 't1', message: { usage: MINIMAL_USAGE } }),
		)
		const second = cost_usage.parse_line(
			JSON.stringify({ type: ASSISTANT, timestamp: 't2', message: { usage: MINIMAL_USAGE } }),
		)
		const records = [first, second].flatMap((outcome) =>
			outcome.kind === 'record' ? [outcome.record] : [],
		)

		expect(cost_usage.dedupe(records)).toHaveLength(2)
	})
})

describe('cost_usage.sum_totals', () => {
	it('adds every quantity across requests', () => {
		expect(cost_usage.sum_totals([record('a', 3), record('b', 4)]).output_tokens).toBe(7)
	})

	it('returns zeroes for no requests', () => {
		expect(cost_usage.sum_totals([])).toStrictEqual(cost_usage.EMPTY_TOTALS)
	})
})

describe('cost_usage.billed_input', () => {
	it('counts every kind of input the run paid to send', () => {
		expect(
			cost_usage.billed_input({
				...cost_usage.EMPTY_TOTALS,
				input_tokens: 1,
				cache_write_5m_tokens: 2,
				cache_write_1h_tokens: 4,
				cache_read_tokens: 8,
				output_tokens: 16,
			}),
		).toBe(15)
	})
})
