import { readFileSync } from 'node:fs'
import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import { cost_usage } from '#scripts/cost-runtime/cost-usage'
import { describe, expect, it } from 'vitest'
import { read_set_pricing } from './read-set-pricing'

// joshuafolkken/kit#2289. The dollar figure `read:set` prints per row. What is pinned here is that it
// reuses `cost-pricing.ts`'s rates rather than carrying a second price list, that the run size it
// assumes is one named constant, and that the model is "a token rides every request as a cache read".

const TEN_THOUSAND = 10_000
const NOTHING = 0
const REFERENCE_MODEL = 'claude-opus-4-8'

describe('read_set_pricing.dollars_per_run', () => {
	it('prices a token as a cache read on every request of the assumed run', () => {
		const price = cost_pricing.resolve_price(REFERENCE_MODEL)
		const expected = cost_pricing.estimate_cost(
			{
				...cost_usage.EMPTY_TOTALS,
				cache_read_tokens: TEN_THOUSAND * read_set_pricing.ASSUMED_REQUESTS,
			},
			price ?? { input: 0, output: 0 },
		)

		expect(read_set_pricing.dollars_per_run(TEN_THOUSAND)).toBe(expected)
	})

	// The whole point of the column: 10k tokens read at the entry cost about half a dollar over a run,
	// because they ride every request. Order-of-magnitude, matching the epic #2280 measurement rather
	// than a spuriously exact figure.
	it('lands 10k entry-read tokens near half a dollar for a full-size run', () => {
		const dollars = read_set_pricing.dollars_per_run(TEN_THOUSAND)

		expect(dollars).toBeGreaterThan(0.4)
		expect(dollars).toBeLessThan(0.8)
	})

	it('is zero for a zero-token read', () => {
		expect(read_set_pricing.dollars_per_run(NOTHING)).toBe(NOTHING)
	})

	it('scales linearly with the token count', () => {
		expect(read_set_pricing.dollars_per_run(TEN_THOUSAND * 2)).toBeCloseTo(
			read_set_pricing.dollars_per_run(TEN_THOUSAND) * 2,
		)
	})
})

describe('read_set_pricing — the run size is one printed assumption', () => {
	it('carries the assumed request count as a single constant', () => {
		expect(read_set_pricing.ASSUMED_REQUESTS).toBeGreaterThan(NOTHING)
		expect(Number.isSafeInteger(read_set_pricing.ASSUMED_REQUESTS)).toBe(true)
	})
})

// The acceptance criterion: the price is defined once, in `cost-pricing.ts`, and this file does not
// keep a copy. A rate literal here would be the second price list the issue forbids — so the source
// must carry neither a per-million rate nor a cache multiplier of its own.
describe('read_set_pricing — no duplicated price table', () => {
	const source = readFileSync(new URL('read-set-pricing.ts', import.meta.url), 'utf8')

	it.each(['TOKENS_PER_MILLION', 'CACHE_READ_MULTIPLIER', 'CACHE_WRITE_5M_MULTIPLIER'])(
		'does not redeclare the pricing constant %j',
		(token) => {
			expect(source.includes(`const ${token}`)).toBe(false)
		},
	)

	it('imports the price model from cost-pricing', () => {
		expect(source).toContain("from '#scripts/cost-runtime/cost-pricing'")
	})
})
