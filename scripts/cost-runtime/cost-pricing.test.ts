import { describe, expect, it } from 'vitest'
import { cost_pricing } from './cost-pricing'
import { cost_usage, type UsageTotals } from './cost-usage'

const MILLION = 1_000_000
const OPUS_PRICE = { input: 5, output: 25 }
const OPUS = 'claude-opus-5'
const IMAGINARY = 'claude-imaginary-9'
// The 5.5 generation, whose ids extend a listed id by one version segment.
const OPUS_NEXT = 'claude-opus-5-5'
const HAIKU_NEXT = 'claude-haiku-5-5'

function totals(overrides: Partial<UsageTotals> = {}): UsageTotals {
	return { ...cost_usage.EMPTY_TOTALS, ...overrides }
}

function million_of(key: keyof UsageTotals): number {
	return cost_pricing.estimate_cost(totals({ [key]: MILLION }), OPUS_PRICE)
}

describe('cost_pricing.resolve_price', () => {
	it('prices a known model', () => {
		expect(cost_pricing.resolve_price(OPUS)).toStrictEqual(OPUS_PRICE)
	})

	it('prices an id carrying a context-window marker', () => {
		expect(cost_pricing.resolve_price(`${OPUS}[1m]`)).toStrictEqual(OPUS_PRICE)
	})

	// joshuafolkken/kit#1838: the 1M-context marker carries no surcharge band for any priced model
	// (platform.claude.com "Long context pricing", read 2026-09), so a large request on a `[1m]` id is
	// billed at the base per-token rate rather than a premium — the reason the marker is stripped.
	it('bills a large 1m-context request at the base rate, with no long-context surcharge', () => {
		const price = cost_pricing.resolve_price(`${OPUS}[1m]`) ?? OPUS_PRICE

		expect(cost_pricing.estimate_cost(totals({ input_tokens: MILLION }), price)).toBe(5)
	})

	it('prices an id carrying a date suffix', () => {
		expect(cost_pricing.resolve_price('claude-haiku-4-5-20251001')?.input).toBe(1)
	})

	it('returns nothing for a model the table does not know', () => {
		expect(cost_pricing.resolve_price(IMAGINARY)).toBeUndefined()
	})

	// joshuafolkken/kit#3682: the longest-prefix match priced a version the table did not carry at
	// another version's rates. `claude-opus-5-5` resolved to `claude-opus-5` ($5 / $25) with no warning.
	it('does not price a 5.5 model at the rates of the version its id starts with', () => {
		expect(cost_pricing.resolve_price(OPUS_NEXT)).not.toStrictEqual(OPUS_PRICE)
	})

	it.each(['claude-opus-5-9', 'claude-fable-5-2', `${OPUS_NEXT}-preview`])(
		'leaves the unlisted version %j unpriced rather than borrowing a listed one',
		(model) => {
			expect(cost_pricing.resolve_price(model)).toBeUndefined()
		},
	)

	it('resolves a 5.5 id carrying both a date suffix and a context-window marker', () => {
		expect(cost_pricing.resolve_price(`${OPUS_NEXT}-20261001[1m]`)).toStrictEqual(
			cost_pricing.resolve_price(OPUS_NEXT),
		)
	})
})

// joshuafolkken/kit#3682. Dollars per million tokens, as published on platform.claude.com "Model
// pricing" (read 2026-10-12): input, 5-minute write, 1-hour write, cache read, output.
const PUBLISHED: ReadonlyArray<[string, ReadonlyArray<number>]> = [
	[OPUS_NEXT, [4, 5, 8, 0.2, 20]],
	['claude-sonnet-5-5', [2, 2.5, 4, 0.1, 10]],
	['claude-fable-5-1', [10, 12.5, 20, 0.25, 50]],
	['claude-mythos-5-1', [10, 12.5, 20, 0.25, 50]],
	['claude-fable-5', [10, 12.5, 20, 1, 50]],
	['claude-mythos-5', [10, 12.5, 20, 1, 50]],
	['claude-sonnet-5', [2, 2.5, 4, 0.2, 10]],
	[HAIKU_NEXT, [0.1, 0.125, 0.2, 0.01, 0.5]],
	// Haiku 5.5's second published row, "for prompts over 100,000 tokens".
	[`${HAIKU_NEXT}:long-prompt`, [0.5, 0.625, 1, 0.05, 2.5]],
]

const MILLION_OF_EACH = totals({
	input_tokens: MILLION,
	cache_write_5m_tokens: MILLION,
	cache_write_1h_tokens: MILLION,
	cache_read_tokens: MILLION,
	output_tokens: MILLION,
})

const MIXED_REQUEST = totals({
	input_tokens: 2,
	cache_write_5m_tokens: 40_000,
	cache_write_1h_tokens: 97_190,
	cache_read_tokens: 500_000,
	output_tokens: 1234,
})

// The five dollar terms of `usage` at `model`'s price, in the column order of `PUBLISHED`.
function five_terms(model: string, usage: UsageTotals): Array<number> {
	const price = cost_pricing.resolve_price(model)

	if (price === undefined) throw new Error(`${model} should be priced`)

	const parts = cost_pricing.estimate_composition(usage, price)

	return [
		parts.input_usd,
		parts.cache_write_5m_usd,
		parts.cache_write_1h_usd,
		parts.cache_read_usd,
		parts.output_usd,
	]
}

describe('cost_pricing — the published rates of each model', () => {
	it.each(PUBLISHED)('prices %s at its published rates', (model, expected) => {
		const rates = five_terms(model, MILLION_OF_EACH)

		for (const [index, rate] of rates.entries()) expect(rate).toBeCloseTo(expected[index] ?? -1)
	})

	it.each(PUBLISHED)('sums the five terms of %s to estimate_cost', (model) => {
		const price = cost_pricing.resolve_price(model) ?? OPUS_PRICE
		const sum = five_terms(model, MIXED_REQUEST).reduce((left, right) => left + right, 0)

		expect(sum).toBeCloseTo(cost_pricing.estimate_cost(MIXED_REQUEST, price))
	})

	it("charges a cache read at the price's own multiplier when it names one", () => {
		const price = { ...OPUS_PRICE, cache_read_multiplier: 0.05 }

		expect(cost_pricing.estimate_cost(totals({ cache_read_tokens: MILLION }), price)).toBeCloseTo(
			0.25,
		)
	})
})

describe('cost_pricing.cost_by_model — a model priced by prompt length', () => {
	const HAIKU = HAIKU_NEXT
	const AT_THRESHOLD = cost_pricing.LONG_PROMPT_THRESHOLD

	function haiku_request(cache_read_tokens: number): { model: string; totals: UsageTotals } {
		return { model: HAIKU, totals: totals({ cache_read_tokens, output_tokens: MILLION }) }
	}

	it('bills a request at the threshold at the lower rates', () => {
		const [cost] = cost_pricing.cost_by_model([haiku_request(AT_THRESHOLD)])

		expect(cost?.model).toBe(HAIKU)
		expect(cost?.cost_usd).toBeCloseTo(0.501)
	})

	// The prompt length counts cache reads, so a request that is all cache hit still crosses the band.
	it('bills a request over the threshold at the higher rates, cache reads included', () => {
		const [cost] = cost_pricing.cost_by_model([haiku_request(AT_THRESHOLD + 1)])

		expect(cost?.model).not.toBe(HAIKU)
		expect(cost?.cost_usd).toBeCloseTo(2.505)
	})

	// Each request is priced on its own: two short requests whose sum is over the threshold stay short.
	it('decides the band per request, never from the sum', () => {
		const costs = cost_pricing.cost_by_model([
			haiku_request(AT_THRESHOLD),
			haiku_request(AT_THRESHOLD),
		])

		expect(costs.map((entry) => entry.model)).toStrictEqual([HAIKU])
	})

	it('keeps the long-prompt row resolvable, so its dollars can be decomposed', () => {
		const [cost] = cost_pricing.cost_by_model([haiku_request(AT_THRESHOLD + 1)])

		expect(cost_pricing.resolve_price(cost?.model ?? IMAGINARY)?.output).toBe(2.5)
	})

	it('leaves a long request of a model with no prompt-length band under its own id', () => {
		const [cost] = cost_pricing.cost_by_model([
			{ model: OPUS, totals: totals({ cache_read_tokens: MILLION }) },
		])

		expect(cost?.model).toBe(OPUS)
	})
})

describe('cost_pricing.estimate_cost', () => {
	it('charges uncached input at the base rate', () => {
		expect(cost_pricing.estimate_cost(totals({ input_tokens: MILLION }), OPUS_PRICE)).toBe(5)
	})

	it('charges a 5-minute cache write at 1.25x base', () => {
		expect(
			cost_pricing.estimate_cost(totals({ cache_write_5m_tokens: MILLION }), OPUS_PRICE),
		).toBeCloseTo(5 * cost_pricing.CACHE_WRITE_5M_MULTIPLIER)
	})

	it('charges a 1-hour cache write at 2x base', () => {
		expect(
			cost_pricing.estimate_cost(totals({ cache_write_1h_tokens: MILLION }), OPUS_PRICE),
		).toBeCloseTo(5 * cost_pricing.CACHE_WRITE_1H_MULTIPLIER)
	})

	it('charges a cache read at a tenth of base when the price names no multiplier', () => {
		expect(
			cost_pricing.estimate_cost(totals({ cache_read_tokens: MILLION }), OPUS_PRICE),
		).toBeCloseTo(5 * cost_pricing.DEFAULT_CACHE_READ_MULTIPLIER)
	})

	it('charges output at the output rate', () => {
		expect(cost_pricing.estimate_cost(totals({ output_tokens: MILLION }), OPUS_PRICE)).toBe(25)
	})

	// The whole reason the multipliers are kept apart: a million cache reads and a million uncached
	// input tokens are the same token count and prices that differ by a factor of fifty against output.
	it('keeps the three input kinds at different prices', () => {
		const uncached = million_of('input_tokens')
		const written = million_of('cache_write_1h_tokens')
		const read = million_of('cache_read_tokens')

		expect(written).toBeGreaterThan(uncached)
		expect(read).toBeLessThan(uncached)
	})
})

describe('cost_pricing.cost_by_model', () => {
	it('groups requests by model and prices each', () => {
		const costs = cost_pricing.cost_by_model([
			{ model: OPUS, totals: totals({ output_tokens: MILLION }) },
			{ model: 'claude-haiku-4-5', totals: totals({ output_tokens: MILLION }) },
		])

		expect(costs.map((entry) => entry.cost_usd)).toStrictEqual([25, 5])
	})

	it('leaves an unknown model unpriced rather than free', () => {
		const costs = cost_pricing.cost_by_model([
			{ model: IMAGINARY, totals: totals({ output_tokens: MILLION }) },
		])

		expect(costs[0]?.cost_usd).toBeUndefined()
	})
})

describe('cost_pricing.total_cost', () => {
	it('sums what could be priced and names what could not', () => {
		const result = cost_pricing.total_cost(
			cost_pricing.cost_by_model([
				{ model: OPUS, totals: totals({ output_tokens: MILLION }) },
				{ model: IMAGINARY, totals: totals({ output_tokens: MILLION }) },
			]),
		)

		expect(result.usd).toBe(25)
		expect(result.unpriced).toStrictEqual([IMAGINARY])
	})
})
