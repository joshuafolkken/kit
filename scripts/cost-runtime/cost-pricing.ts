import { cost_usage, type UsageTotals } from './cost-usage'

// The current Claude price list, and the multipliers that make a token's price depend on how it was
// sent.
//
// A run's cost is not "tokens x one rate". A cache read costs a fraction of base input that depends
// on the model, a 5-minute cache write 1.25x, a 1-hour cache write 2x, and output 5x. On a measured
// request with `cache_read_input_tokens` 97,190 against `input_tokens` 2, an estimate that ignored
// the multipliers would be wrong by more than an order of magnitude in either direction depending on
// which single rate it picked.

const CACHE_WRITE_5M_MULTIPLIER = 1.25
const CACHE_WRITE_1H_MULTIPLIER = 2
// The standard cache-read rate, a tenth of base input — what a model bills unless its row says
// otherwise. Named the default because it is not every model's rate: pricing a model reads the row's
// multiplier through `estimate_cost`, never this constant.
const DEFAULT_CACHE_READ_MULTIPLIER = 0.1
// The discounted cache-read rates of the 5.5 generation (platform.claude.com "Model pricing", read
// 2026-10-12): Opus 5.5 and Sonnet 5.5 bill a cache read at 0.05x base input, Fable 5.1 and Mythos
// 5.1 at 0.025x.
const HALVED_CACHE_READ_MULTIPLIER = 0.05
const QUARTERED_CACHE_READ_MULTIPLIER = 0.025
const TOKENS_PER_MILLION = 1_000_000

interface ModelPrice {
	// USD per million tokens.
	input: number
	output: number
	// The cache-read rate as a multiple of `input`. Absent on a model billed at the standard
	// `DEFAULT_CACHE_READ_MULTIPLIER`, so a row states a multiplier only where it differs.
	cache_read_multiplier?: number
}

// A model priced by prompt length carries a second row under its id plus this suffix — the rates a
// request over `LONG_PROMPT_THRESHOLD` pays. The suffixed name is not an id the API reports; it is
// what `cost_by_model` bills such a request under, so the higher-priced requests show as their own
// row and resolve to their own price like any other.
const LONG_PROMPT_SUFFIX = ':long-prompt'
const LONG_PROMPT_THRESHOLD = 100_000

// Base input/output rates per million tokens. Cache rates are derived from `input` by the
// multipliers above rather than listed, because they are defined as multiples of it — writing them
// out would let the two drift.
/* eslint-disable @typescript-eslint/naming-convention */
const MODEL_PRICES: Record<string, ModelPrice> = {
	'claude-fable-5-1': {
		input: 10,
		output: 50,
		cache_read_multiplier: QUARTERED_CACHE_READ_MULTIPLIER,
	},
	'claude-mythos-5-1': {
		input: 10,
		output: 50,
		cache_read_multiplier: QUARTERED_CACHE_READ_MULTIPLIER,
	},
	'claude-fable-5': { input: 10, output: 50 },
	'claude-mythos-5': { input: 10, output: 50 },
	'claude-opus-5-5': { input: 4, output: 20, cache_read_multiplier: HALVED_CACHE_READ_MULTIPLIER },
	'claude-opus-5': { input: 5, output: 25 },
	'claude-opus-4-8': { input: 5, output: 25 },
	'claude-opus-4-7': { input: 5, output: 25 },
	'claude-opus-4-6': { input: 5, output: 25 },
	'claude-sonnet-5-5': {
		input: 2,
		output: 10,
		cache_read_multiplier: HALVED_CACHE_READ_MULTIPLIER,
	},
	'claude-sonnet-5': { input: 2, output: 10 },
	'claude-sonnet-4-6': { input: 3, output: 15 },
	'claude-haiku-5-5': { input: 0.1, output: 0.5 },
	[`claude-haiku-5-5${LONG_PROMPT_SUFFIX}`]: { input: 0.5, output: 2.5 },
	'claude-haiku-4-5': { input: 1, output: 5 },
}
/* eslint-enable @typescript-eslint/naming-convention */

const CONTEXT_MARKER = '['
// A deployment's date suffix — `claude-haiku-4-5-20251001`. Eight digits and nothing else, so a
// version segment (the last `-5` of `claude-opus-5-5`) is never read as one.
const DATE_SUFFIX = /-\d{8}$/u

// Claude Code appends a context-window marker to the model id it records — `claude-opus-5[1m]` —
// and a deployment may carry a date suffix. Both name the same priced model, so the id is reduced
// to the table's id by removing exactly those two decorations.
//
// **Nothing else is removed.** The reduction was once "the longest prefix the table knows", which
// priced `claude-opus-5-5` at `claude-opus-5`'s rates and `claude-fable-5-1` at `claude-fable-5`'s —
// another model's price list, reported with no warning. A version the table does not carry is
// unpriced, which `total_cost` names, rather than billed as the closest id it resembles.
//
// The `[1m]` marker is the 1M-context beta, and stripping it to the base rate is confirmed correct,
// not an approximation. The published price list — platform.claude.com "Long context pricing", read
// 2026-10-12 — states that Claude 4.6 and later models other than Haiku 5.5 "include the full 1M
// token context window at standard pricing (a 900k-token request is billed at the same per-token
// rate as a 9k-token request)". The one model with an input-size band is priced from the request's
// own size by `billed_model`, not from the marker. (Fast mode is a separate premium, but it is
// signalled by `speed: "fast"` rather than by the context marker, so it is not this marker's
// concern.)
function known_id(model: string): string | undefined {
	const base = model.split(CONTEXT_MARKER)[0] ?? model

	return [base, base.replace(DATE_SUFFIX, '')].find((id) => Object.hasOwn(MODEL_PRICES, id))
}

function resolve_price(model: string): ModelPrice | undefined {
	const id = known_id(model)

	return id === undefined ? undefined : MODEL_PRICES[id]
}

function cache_read_multiplier(price: ModelPrice): number {
	return price.cache_read_multiplier ?? DEFAULT_CACHE_READ_MULTIPLIER
}

// The cache-read multiplier a model bills, by id. A model with no price row — an unpriced id, or no
// model at all — reads at the standard rate.
function cache_read_multiplier_of(model: string | undefined): number {
	const price = model === undefined ? undefined : resolve_price(model)

	return price === undefined ? DEFAULT_CACHE_READ_MULTIPLIER : cache_read_multiplier(price)
}

function estimate_cost(totals: UsageTotals, price: ModelPrice): number {
	const weighted_input =
		totals.input_tokens +
		totals.cache_write_5m_tokens * CACHE_WRITE_5M_MULTIPLIER +
		totals.cache_write_1h_tokens * CACHE_WRITE_1H_MULTIPLIER +
		totals.cache_read_tokens * cache_read_multiplier(price)

	return (weighted_input * price.input + totals.output_tokens * price.output) / TOKENS_PER_MILLION
}

// The five dollar terms `estimate_cost` sums, kept apart so a report can say what a run's dollars
// were spent on rather than only their total. Each is priced by the same multipliers `estimate_cost`
// uses — the write constants above and the price's own cache-read multiplier — so the five always
// sum to `estimate_cost(totals, price)`. It is a decomposition of the same arithmetic, not a second
// price list, which is why the weights live where both read them rather than in either function.
interface CostComposition {
	input_usd: number
	cache_write_5m_usd: number
	cache_write_1h_usd: number
	cache_read_usd: number
	output_usd: number
}

function priced(tokens: number, rate: number): number {
	return (tokens * rate) / TOKENS_PER_MILLION
}

function estimate_composition(totals: UsageTotals, price: ModelPrice): CostComposition {
	return {
		input_usd: priced(totals.input_tokens, price.input),
		cache_write_5m_usd: priced(
			totals.cache_write_5m_tokens * CACHE_WRITE_5M_MULTIPLIER,
			price.input,
		),
		cache_write_1h_usd: priced(
			totals.cache_write_1h_tokens * CACHE_WRITE_1H_MULTIPLIER,
			price.input,
		),
		cache_read_usd: priced(totals.cache_read_tokens * cache_read_multiplier(price), price.input),
		output_usd: priced(totals.output_tokens, price.output),
	}
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

// The id a request is billed under: its own, unless the model is priced by prompt length and this
// request is over the threshold, in which case the model's long-prompt row. The prompt length is
// everything the request sent — cache reads and writes included — and each request is priced on its
// own (platform.claude.com "Long context pricing", read 2026-10-12), which is why this reads one
// request's totals and cannot be asked of a sum.
function billed_model(usage: ModelUsage): string {
	const long_id = `${known_id(usage.model) ?? usage.model}${LONG_PROMPT_SUFFIX}`
	const is_long = cost_usage.billed_input(usage.totals) > LONG_PROMPT_THRESHOLD

	return is_long && Object.hasOwn(MODEL_PRICES, long_id) ? long_id : usage.model
}

// Per-model, because a session routinely mixes tiers — a subagent on Haiku inside an Opus run — and
// one blended rate would be wrong for both. Grouped by `billed_model`, so each record is one request:
// a model priced by prompt length is split into the rows its requests were billed at.
function cost_by_model(records: ReadonlyArray<ModelUsage>): Array<ModelCost> {
	const grouped = new Map<string, UsageTotals>()

	for (const record of records) {
		const model = billed_model(record)
		const running = grouped.get(model) ?? cost_usage.EMPTY_TOTALS

		grouped.set(model, cost_usage.add_totals(running, record.totals))
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

// The priced total in dollars, discarding the unpriced-model list — the one-line composition of
// `total_cost` over `cost_by_model` that callers reach for when they need only the number, kept here
// so it is not spelled out at each call site.
function cost_of(records: ReadonlyArray<ModelUsage>): number {
	return total_cost(cost_by_model(records)).usd
}

const cost_pricing = {
	CACHE_WRITE_5M_MULTIPLIER,
	CACHE_WRITE_1H_MULTIPLIER,
	DEFAULT_CACHE_READ_MULTIPLIER,
	LONG_PROMPT_THRESHOLD,
	resolve_price,
	cache_read_multiplier_of,
	estimate_cost,
	estimate_composition,
	cost_by_model,
	total_cost,
	cost_of,
}

export type { CostComposition, ModelCost, ModelPrice, ModelUsage }
export { cost_pricing }
