import { json_value } from '#scripts/json-value'
import { z } from 'zod'

// Reading Claude Code's own session transcripts for what a run actually cost
// (joshuafolkken/kit#962).
//
// **One API response is written to the transcript as several lines.** Every content block —
// thinking, text, each `tool_use` — becomes its own `assistant` line, and all of them carry the
// *same* `usage` object. Measured on a real session: 20 assistant lines for 8 requests. Summing
// lines therefore over-reports the cost by roughly 3x, which is why `request_id` is the unit of
// aggregation here and a line never is.

// Every optional field is `nullish`, not `optional`. The transcript writes an absent value as
// `null` rather than by omitting the key — `output_tokens_details: null`, `service_tier: null`,
// `iterations: null` — and a schema that accepts only `undefined` rejects the whole line. Measured
// against this project's own transcripts: 12 perfectly valid lines were being counted as
// unparseable, which is the reader silently mislabelling data in exactly the way this command
// exists to prevent.
const CACHE_CREATION_SCHEMA = z.object({
	ephemeral_1h_input_tokens: z.number().nullish(),
	ephemeral_5m_input_tokens: z.number().nullish(),
})

const USAGE_SCHEMA = z.object({
	input_tokens: z.number(),
	cache_creation_input_tokens: z.number().nullish(),
	cache_read_input_tokens: z.number().nullish(),
	output_tokens: z.number(),
	output_tokens_details: z.object({ thinking_tokens: z.number().nullish() }).nullish(),
	cache_creation: CACHE_CREATION_SCHEMA.nullish(),
})

const MESSAGE_SCHEMA = z.object({
	id: z.string().nullish(),
	model: z.string().nullish(),
	usage: USAGE_SCHEMA.nullish(),
})

const LINE_SCHEMA = z.object({
	type: z.string(),
	requestId: z.string().nullish(),
	uuid: z.string().nullish(),
	gitBranch: z.string().nullish(),
	timestamp: z.string().nullish(),
	message: MESSAGE_SCHEMA.nullish(),
})

// Claude Code writes its own locally-generated assistant messages — an API-error notice, a queued
// interruption — with this model id and an all-zero usage block. They were never sent to the API, so
// counting them would inflate the request count and raise an "unknown model" warning about
// something that was never priced.
const SYNTHETIC_MODEL = '<synthetic>'

// The five billed quantities, kept apart because each is priced differently. Splitting the cache
// write by TTL is not a refinement: a 1-hour write costs 2x base against a 5-minute write's 1.25x,
// and this project's sessions run on the 1-hour TTL, so folding them together would under-report
// every run by the larger half.
interface UsageTotals {
	input_tokens: number
	cache_write_5m_tokens: number
	cache_write_1h_tokens: number
	cache_read_tokens: number
	output_tokens: number
	thinking_tokens: number
}

interface UsageRecord {
	request_id: string
	model: string
	branch: string
	totals: UsageTotals
}

// What one transcript line turned out to be. `skipped` is the ordinary case — most lines are user
// turns, attachments and bookkeeping, and counting those as missing data would bury the two kinds
// that matter.
type LineOutcome =
	| { kind: 'record'; record: UsageRecord }
	| { kind: 'skipped' }
	| { kind: 'no_usage' }
	| { kind: 'malformed' }

const EMPTY_TOTALS: UsageTotals = {
	input_tokens: 0,
	cache_write_5m_tokens: 0,
	cache_write_1h_tokens: 0,
	cache_read_tokens: 0,
	output_tokens: 0,
	thinking_tokens: 0,
}

const UNKNOWN_MODEL = 'unknown'
const UNKNOWN_BRANCH = ''

type RawUsage = z.infer<typeof USAGE_SCHEMA>

// The TTL split, taken from `cache_creation` when the transcript carries it. Older lines have only
// the flat `cache_creation_input_tokens`; those are read as 5-minute writes, the cheaper of the two,
// so an unknown TTL never inflates the estimate.
interface CacheWrite {
	write_5m: number
	write_1h: number
}

function split_cache_write(usage: RawUsage): CacheWrite {
	const total = usage.cache_creation_input_tokens ?? 0
	const detail = usage.cache_creation

	if (!detail) return { write_5m: total, write_1h: 0 }

	const write_1h = detail.ephemeral_1h_input_tokens ?? 0

	return { write_5m: detail.ephemeral_5m_input_tokens ?? total - write_1h, write_1h }
}

function to_totals(usage: RawUsage): UsageTotals {
	const { write_5m, write_1h } = split_cache_write(usage)

	return {
		input_tokens: usage.input_tokens,
		cache_write_5m_tokens: write_5m,
		cache_write_1h_tokens: write_1h,
		cache_read_tokens: usage.cache_read_input_tokens ?? 0,
		output_tokens: usage.output_tokens,
		thinking_tokens: usage.output_tokens_details?.thinking_tokens ?? 0,
	}
}

type ParsedLine = z.infer<typeof LINE_SCHEMA>

// A line with neither id is its own request rather than a duplicate of one, so the fallback has to
// be unique per line; an empty string would collapse every such line into one.
// The id the API gave the request, when the line carries one. `message.id` is the response id, so
// it identifies the same billed request that `requestId` does.
function declared_id(data: ParsedLine): string | undefined {
	return data.requestId ?? data.message?.id ?? data.uuid ?? undefined
}

function request_id_of(data: ParsedLine, usage: RawUsage): string {
	const fallback = `${data.timestamp ?? ''}-${String(usage.output_tokens)}`

	return declared_id(data) ?? fallback
}

function to_record(data: ParsedLine, usage: RawUsage): UsageRecord {
	return {
		request_id: request_id_of(data, usage),
		model: data.message?.model ?? UNKNOWN_MODEL,
		branch: data.gitBranch ?? UNKNOWN_BRANCH,
		totals: to_totals(usage),
	}
}

const ASSISTANT_TYPE = 'assistant'

function is_priced_line(data: ParsedLine): boolean {
	return data.type === ASSISTANT_TYPE && data.message?.model !== SYNTHETIC_MODEL
}

function classify(data: ParsedLine): LineOutcome {
	if (!is_priced_line(data)) return { kind: 'skipped' }

	const usage = data.message?.usage

	return usage ? { kind: 'record', record: to_record(data, usage) } : { kind: 'no_usage' }
}

function parse_line(line: string): LineOutcome {
	if (line.trim() === '') return { kind: 'skipped' }

	const parsed = LINE_SCHEMA.safeParse(json_value.parse_or_undefined(line))

	return parsed.success ? classify(parsed.data) : { kind: 'malformed' }
}

// One record per request, in first-seen order. Order matters downstream: issue attribution reads
// the branch sequence, so a Map (which preserves insertion order) is the right container and a Set
// of ids plus a filter would be the same thing written twice.
function dedupe(records: ReadonlyArray<UsageRecord>): Array<UsageRecord> {
	const seen = new Set<string>()
	const unique: Array<UsageRecord> = []

	for (const record of records) {
		if (seen.has(record.request_id)) continue

		seen.add(record.request_id)
		unique.push(record)
	}

	return unique
}

function add_totals(left: UsageTotals, right: UsageTotals): UsageTotals {
	return {
		input_tokens: left.input_tokens + right.input_tokens,
		cache_write_5m_tokens: left.cache_write_5m_tokens + right.cache_write_5m_tokens,
		cache_write_1h_tokens: left.cache_write_1h_tokens + right.cache_write_1h_tokens,
		cache_read_tokens: left.cache_read_tokens + right.cache_read_tokens,
		output_tokens: left.output_tokens + right.output_tokens,
		thinking_tokens: left.thinking_tokens + right.thinking_tokens,
	}
}

function sum_totals(records: ReadonlyArray<UsageRecord>): UsageTotals {
	let total = EMPTY_TOTALS

	for (const record of records) total = add_totals(total, record.totals)

	return total
}

// Everything the run paid to send, whatever rate each part was billed at. The breakdown between
// resident preamble and conversation history is computed from this in `cost-report.ts`.
function billed_input(totals: UsageTotals): number {
	return (
		totals.input_tokens +
		totals.cache_write_5m_tokens +
		totals.cache_write_1h_tokens +
		totals.cache_read_tokens
	)
}

const cost_usage = {
	EMPTY_TOTALS,
	UNKNOWN_MODEL,
	SYNTHETIC_MODEL,
	parse_line,
	dedupe,
	add_totals,
	sum_totals,
	billed_input,
}

export type { LineOutcome, UsageRecord, UsageTotals }
export { cost_usage }
