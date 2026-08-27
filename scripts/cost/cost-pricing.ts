import { cost_usage, type UsageTotals } from './cost-usage'

// The current Claude price list, and the three multipliers that make a token's price depend on how
// it was sent (joshuafolkken/kit#962).
//
// A run's cost is not "tokens x one rate". A cache read costs a tenth of base input, a 5-minute
// cache write 1.25x, a 1-hour cache write 2x, and output 5x. On a measured request with
// `cache_read_input_tokens` 97,190 against `input_tokens` 2, an estimate that ignored the
// multipliers would be wrong by more than an order of magnitude in either direction depending on
// which single rate it picked.

const CACHE_WRITE_5M_MULTIPLIER = 1.25
const CACHE_WRITE_1H_MULTIPLIER = 2
const CACHE_READ_MULTIPLIER = 0.1
const TOKENS_PER_MILLION = 1_000_000

interface ModelPrice {
	// USD per million tokens.
	input: number
	output: number
}

// Base input/output rates per million tokens. Cache rates are derived from `input` by the
// multipliers above rather than listed, because they are defined as multiples of it — writing them
// out would let the two drift.
/* eslint-disable @typescript-eslint/naming-convention */
const MODEL_PRICES: Record<string, ModelPrice> = {
	'claude-fable-5': { input: 10, output: 50 },
	'claude-mythos-5': { input: 10, output: 50 },
	'claude-opus-5': { input: 5, output: 25 },
	'claude-opus-4-8': { input: 5, output: 25 },
	'claude-opus-4-7': { input: 5, output: 25 },
	'claude-opus-4-6': { input: 5, output: 25 },
	'claude-sonnet-5': { input: 2, output: 10 },
	'claude-sonnet-4-6': { input: 3, output: 15 },
	'claude-haiku-4-5': { input: 1, output: 5 },
}
/* eslint-enable @typescript-eslint/naming-convention */

const CONTEXT_MARKER = '['

// Claude Code appends a context-window marker to the model id it records — `claude-opus-5[1m]` —
// and a deployment may carry a date suffix. Both name the same priced model, so the id is reduced
// to its longest prefix that the table knows rather than reported as unknown.
function resolve_price(model: string): ModelPrice | undefined {
	const base = model.split(CONTEXT_MARKER)[0] ?? model
	const direct = MODEL_PRICES[base]

	if (direct !== undefined) return direct

	const [matched] = Object.keys(MODEL_PRICES)
		.filter((id) => base.startsWith(id))
		.toSorted((left, right) => right.length - left.length)

	return matched === undefined ? undefined : MODEL_PRICES[matched]
}

function estimate_cost(totals: UsageTotals, price: ModelPrice): number {
	const weighted_input =
		totals.input_tokens +
		totals.cache_write_5m_tokens * CACHE_WRITE_5M_MULTIPLIER +
		totals.cache_write_1h_tokens * CACHE_WRITE_1H_MULTIPLIER +
		totals.cache_read_tokens * CACHE_READ_MULTIPLIER

	return (weighted_input * price.input + totals.output_tokens * price.output) / TOKENS_PER_MILLION
}

interface ModelCost {
	model: string
	totals: UsageTotals
	// Absent when the model id is not in the price table. Reported as unknown rather than priced at
	// zero: a silent zero reads as "this run was free", which is the one answer that is never true.
	cost_usd?: number
}

function to_model_cost(model: string, totals: UsageTotals): ModelCost {
	const price = resolve_price(model)

	if (price === undefined) return { model, totals }

	return { model, totals, cost_usd: estimate_cost(totals, price) }
}

interface ModelUsage {
	model: string
	totals: UsageTotals
}

// Per-model, because a session routinely mixes tiers — a subagent on Haiku inside an Opus run — and
// one blended rate would be wrong for both.
function cost_by_model(records: ReadonlyArray<ModelUsage>): Array<ModelCost> {
	const grouped = new Map<string, UsageTotals>()

	for (const record of records) {
		const running = grouped.get(record.model) ?? cost_usage.EMPTY_TOTALS

		grouped.set(record.model, cost_usage.add_totals(running, record.totals))
	}

	return [...grouped].map(([model, totals]) => to_model_cost(model, totals))
}

// The priced total, and what could not be priced. Both halves are returned: a caller that showed
// only the sum would present a partial figure as the whole answer.
function total_cost(costs: ReadonlyArray<ModelCost>): { usd: number; unpriced: Array<string> } {
	return {
		usd: costs.reduce((sum, entry) => sum + (entry.cost_usd ?? 0), 0),
		unpriced: costs.filter((entry) => entry.cost_usd === undefined).map((entry) => entry.model),
	}
}

const cost_pricing = {
	CACHE_WRITE_5M_MULTIPLIER,
	CACHE_WRITE_1H_MULTIPLIER,
	CACHE_READ_MULTIPLIER,
	MODEL_PRICES,
	resolve_price,
	estimate_cost,
	cost_by_model,
	total_cost,
}

export type { ModelCost, ModelPrice, ModelUsage }
export { cost_pricing }
