import { describe, expect, it } from 'vitest'
import { context_cut_payback } from './context-cut-payback'
import { cost_pricing } from './cost-pricing'

// joshuafolkken/kit#2406: the cut decision is a break-even, not a ceiling. These pin the arithmetic —
// that the decision flips at the break-even point, that it is read from `cost-pricing.ts` rather than a
// second price list, and that the two directions (`break_even_context` and `break_even_requests`) are
// one decision seen from either end.

const HORIZON = context_cut_payback.EXPECTED_REMAINING_REQUESTS
const POST = context_cut_payback.POST_CUT_CONTEXT
const OPUS = 'claude-opus-5-5'
const STANDARD = 'claude-sonnet-4-6'
const UNPRICED = 'unpriced-model'

describe('context_cut_payback.pays_back flips at the break-even context', () => {
	const boundary = context_cut_payback.break_even_context(OPUS, HORIZON)

	it('does not pay back just below the break-even context', () => {
		expect(context_cut_payback.pays_back(boundary - 1, OPUS)).toBe(false)
	})

	it('does not pay back at exactly the break-even context', () => {
		expect(context_cut_payback.pays_back(boundary, OPUS)).toBe(false)
	})

	it('pays back just above the break-even context', () => {
		expect(context_cut_payback.pays_back(boundary + 1, OPUS)).toBe(true)
	})

	// Below the post-cut floor a cut drops nothing, so it can never pay back however many requests
	// remain — the saving per request is zero or negative.
	it('never pays back at or below the post-cut floor', () => {
		expect(context_cut_payback.pays_back(POST, OPUS)).toBe(false)
		expect(context_cut_payback.pays_back(POST - 1, OPUS)).toBe(false)
	})
})

describe('context_cut_payback.break_even_context', () => {
	// The more requests remain, the sooner a cut pays back — so the context it breaks even at falls as
	// the horizon grows. This is why a fixed ceiling is the wrong shape: the same context is worth
	// cutting at on a long session and not on a short one.
	it('falls as the expected remaining requests rise', () => {
		expect(context_cut_payback.break_even_context(STANDARD, 5)).toBeGreaterThan(
			context_cut_payback.break_even_context(STANDARD, 20),
		)
	})

	// The floor a cut cannot pay back below, whatever the horizon.
	it('never drops below the post-cut floor', () => {
		expect(context_cut_payback.break_even_context(STANDARD, 1000)).toBeGreaterThan(POST)
	})

	it('is infinite when no requests remain', () => {
		expect(context_cut_payback.break_even_context(STANDARD, 0)).toBe(Infinity)
	})
})

// joshuafolkken/kit#5341: the threshold was computed at the standard 0.1x read rate for every model, so
// Opus 5.5's 0.05x read discount left its cut firing at 135,000 instead of its own break-even.
describe("context_cut_payback.break_even_context reads the model's cache-read rate", () => {
	const TEN_REQUESTS = 10

	it('breaks even at 210,000 for Opus 5.5 over ten requests', () => {
		expect(context_cut_payback.break_even_context(OPUS, TEN_REQUESTS)).toBe(210_000)
	})

	it('breaks even at 135,000 at the standard rate over ten requests', () => {
		expect(context_cut_payback.break_even_context(STANDARD, TEN_REQUESTS)).toBe(135_000)
	})

	// The default horizon is the measured median of 23 requests per resumed lane session, so the
	// limit `pnpm josh cost --cut` prints is these figures (rounded to whole tokens).
	it.each([
		[OPUS, 125_217],
		[STANDARD, 92_609],
	])('breaks even for %s at %i over the measured horizon', (model, tokens) => {
		expect(Math.round(context_cut_payback.break_even_context(model))).toBe(tokens)
	})

	it('reads an unpriced or absent model at the standard rate', () => {
		const standard = context_cut_payback.break_even_context(STANDARD)

		expect(context_cut_payback.break_even_context(UNPRICED)).toBe(standard)
		expect(context_cut_payback.break_even_context(undefined)).toBe(standard)
	})
})

describe('context_cut_payback.break_even_requests is the same decision from the other end', () => {
	const boundary = context_cut_payback.break_even_context(OPUS, HORIZON)

	// At the break-even context the requests needed equal the horizon, so `< horizon` and `> boundary`
	// name the same crossing — the guarantee `pays_back` can be read either way without drift.
	it('needs the horizon of requests at the break-even context', () => {
		expect(context_cut_payback.break_even_requests(boundary + 1, OPUS)).toBeLessThan(HORIZON)
		expect(context_cut_payback.break_even_requests(boundary - 1, OPUS)).toBeGreaterThan(HORIZON)
	})

	it('is infinite at or below the post-cut floor', () => {
		expect(context_cut_payback.break_even_requests(POST, OPUS)).toBe(Infinity)
	})
})

describe('context_cut_payback reads the cache multipliers from cost-pricing', () => {
	// No second price list: the break-even is the write/read ratio scaled by the post-cut floor, so
	// rebuilding it from `cost-pricing.ts` reproduces the boundary to the token.
	it('reconstructs the break-even context from the pricing multipliers', () => {
		const ratio =
			cost_pricing.CACHE_WRITE_5M_MULTIPLIER / cost_pricing.cache_read_multiplier_of(OPUS)
		const expected = Math.round(POST * (1 + ratio / HORIZON))

		expect(context_cut_payback.break_even_context(OPUS)).toBe(expected)
	})
})
