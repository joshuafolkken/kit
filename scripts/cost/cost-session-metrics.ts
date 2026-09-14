import { cost_format } from '#scripts/cost-runtime/cost-format'
import { cost_usage, type UsageRecord } from '#scripts/cost-runtime/cost-usage'
import { time_distribution, type Distribution } from '#scripts/time/time-distribution'

// The model, thinking-share and context-size figures added to each `by_session` row
// (joshuafolkken/kit#1969). All three are read from the session's own `UsageRecord`s, so the module
// takes the records and returns one struct the row carries and renders.

const NONE = 0
const FIRST = 0
const FULL_PERCENT = 100
// One decimal on the share — enough to tell 0.4% from 4%, without a spurious third digit on a
// figure the reader scans rather than reconciles.
const SHARE_DECIMALS = 1

// The share of a session's output that was thinking, beside the flag that says whether the API
// reported it at all. `measured: false` is "the transcript never carried a thinking count", which
// the renderer prints as "not measured" rather than 0%.
interface ThinkingShare {
	measured: boolean
	thinking_tokens: number
	output_tokens: number
}

interface SessionMetrics {
	// The model the most requests in the session ran on, and the others it also used. Effort is not
	// carried: the transcript records none, so there is nothing to distribute and the renderer says
	// "effort not recorded" rather than inventing one.
	primary_model: string
	other_models: Array<string>
	thinking: ThinkingShare
	// The per-request billed-input distribution — how large the context grew across the session's
	// requests. Built from the shared `time_distribution` rather than a second percentile helper
	// (no clone: `CLAUDE.md`); its `*_ms` field names are the generic module's, read here as tokens.
	context: Distribution
}

function model_counts(records: ReadonlyArray<UsageRecord>): Map<string, number> {
	const counts = new Map<string, number>()

	for (const record of records) counts.set(record.model, (counts.get(record.model) ?? NONE) + 1)

	return counts
}

// Models most-used first. Insertion order breaks a tie, so the model seen first in the session wins
// over a later one it drew level with — the earliest is the likeliest to be the session's main one.
function ranked_models(records: ReadonlyArray<UsageRecord>): Array<string> {
	const counts = [...model_counts(records)]

	return counts.toSorted((left, right) => right[1] - left[1]).map((entry) => entry[0])
}

function thinking_share(records: ReadonlyArray<UsageRecord>): ThinkingShare {
	const totals = cost_usage.sum_totals(records)

	return {
		measured: totals.thinking_measured,
		thinking_tokens: totals.thinking_tokens,
		output_tokens: totals.output_tokens,
	}
}

function context_distribution(records: ReadonlyArray<UsageRecord>): Distribution {
	return time_distribution.build(records.map((record) => cost_usage.billed_input(record.totals)))
}

function build(records: ReadonlyArray<UsageRecord>): SessionMetrics {
	const ranked = ranked_models(records)

	return {
		primary_model: ranked[FIRST] ?? cost_usage.UNKNOWN_MODEL,
		other_models: ranked.slice(FIRST + 1),
		thinking: thinking_share(records),
		context: context_distribution(records),
	}
}

function model_label(metrics: SessionMetrics): string {
	const rest = metrics.other_models
	const others = rest.length === NONE ? '' : ` +${rest.join(', ')}`

	return `${metrics.primary_model}${others} (effort not recorded)`
}

function share_label(thinking: ThinkingShare): string {
	if (!thinking.measured) return 'thinking not measured'
	if (thinking.output_tokens === NONE) return 'thinking 0%'

	const pct = ((thinking.thinking_tokens / thinking.output_tokens) * FULL_PERCENT).toFixed(
		SHARE_DECIMALS,
	)
	const counts = `${cost_format.format_tokens(thinking.thinking_tokens)} / ${cost_format.format_tokens(thinking.output_tokens)}`

	return `thinking ${pct}% (${counts})`
}

function context_label(context: Distribution): string {
	if (!time_distribution.is_measured(context)) return 'context not measured'

	const med = cost_format.format_tokens(context.median_ms)
	const p90 = cost_format.format_tokens(context.p90_ms)
	const max = cost_format.format_tokens(context.max_ms)

	return `context med ${med} / p90 ${p90} / max ${max}`
}

const INDENT_WIDTH = 4
const INDENT = ' '.repeat(INDENT_WIDTH)

// The continuation line printed under each session row (joshuafolkken/kit#1969). Kept a second line
// rather than appended inline because three token figures plus the model list overflow one terminal
// width, and the row above already carries the money and counts a reader scans first.
function format(metrics: SessionMetrics): string {
	return `${INDENT}${model_label(metrics)} · ${share_label(metrics.thinking)} · ${context_label(metrics.context)}`
}

const cost_session_metrics = { build, format }

export type { SessionMetrics }
export { cost_session_metrics }
