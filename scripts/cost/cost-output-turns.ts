import { cost_format } from './cost-format'
import type { UsageRecord } from './cost-usage'

// How a run's output tokens were distributed across its turns, and how much of that output came from
// a handful of long ones (joshuafolkken/kit#1912). A run's cost is dominated by output — it is priced
// at five times input — and a hand measurement of `fullrun #1876` found roughly half a session's
// output (49.5k of 102k) came from six turns that each wrote more than 5k tokens. The averages the
// rest of the report carries hide that shape; this is the distribution that shows it.
//
// **One turn is one billed request** — the deduped `UsageRecord`, one per API response — so
// `output_tokens` is what that response wrote, which is the grain a "long think" is counted at.

// 5,000 output tokens marks a long turn. The figure is the one the hand measurement above used: at it,
// six turns of a 102k-output session accounted for about half the output, which is the concentration
// this block exists to surface. It is a named constant so a future re-measurement moves it in one place.
const LARGE_OUTPUT_THRESHOLD = 5000
const MEDIAN_FRACTION = 0.5
const P90_FRACTION = 0.9

interface OutputTurns {
	turn_count: number
	median: number
	p90: number
	max: number
	threshold: number
	over_threshold_count: number
	// The share of the run's *output tokens* — not of its turns — that the over-threshold turns wrote.
	// A run whose output is concentrated in a few long turns reads high here even when their count is small.
	over_threshold_share: number
	// False when no turn was read: the quantiles are then unknown rather than zero, the same
	// withheld-is-not-zero distinction the rest of the cost report draws.
	is_measured: boolean
}

const NOT_MEASURED: OutputTurns = {
	turn_count: 0,
	median: 0,
	p90: 0,
	max: 0,
	threshold: LARGE_OUTPUT_THRESHOLD,
	over_threshold_count: 0,
	over_threshold_share: 0,
	is_measured: false,
}

// Nearest-rank on the sorted values: the smallest value at or above the given fraction of the run.
// `sorted` is ascending and non-empty by the time this is reached.
function percentile(sorted: ReadonlyArray<number>, fraction: number): number {
	const rank = Math.ceil(fraction * sorted.length) - 1
	const index = Math.min(Math.max(rank, 0), sorted.length - 1)

	return sorted[index] ?? 0
}

function sum(values: ReadonlyArray<number>): number {
	return values.reduce((total, value) => total + value, 0)
}

function build(records: ReadonlyArray<UsageRecord>): OutputTurns {
	const outputs = records.map((record) => record.totals.output_tokens)

	if (outputs.length === 0) return NOT_MEASURED

	const sorted = [...outputs].toSorted((left, right) => left - right)
	const total = sum(outputs)
	const over = outputs.filter((value) => value > LARGE_OUTPUT_THRESHOLD)

	return {
		turn_count: outputs.length,
		median: percentile(sorted, MEDIAN_FRACTION),
		p90: percentile(sorted, P90_FRACTION),
		max: sorted.at(-1) ?? 0,
		threshold: LARGE_OUTPUT_THRESHOLD,
		over_threshold_count: over.length,
		over_threshold_share: total === 0 ? 0 : sum(over) / total,
		is_measured: true,
	}
}

const HEADING = 'Output per turn:'
const PERCENT = 100
const SHARE_DECIMALS = 1

function format(turns: OutputTurns): Array<string> {
	if (!turns.is_measured) return ['', HEADING, '  not measured']

	const spread = `median ${cost_format.format_tokens(turns.median)} · p90 ${cost_format.format_tokens(turns.p90)} · max ${cost_format.format_tokens(turns.max)}`
	const share = `${(turns.over_threshold_share * PERCENT).toFixed(SHARE_DECIMALS)}% of output`
	const over = `over ${cost_format.format_tokens(turns.threshold)}: ${String(turns.over_threshold_count)} turn(s), ${share}`

	return ['', HEADING, `  ${spread}`, `  ${over}`]
}

const cost_output_turns = { LARGE_OUTPUT_THRESHOLD, HEADING, build, format }

export type { OutputTurns }
export { cost_output_turns }
