// What a document read at a workflow entry costs, in dollars, for one run (joshuafolkken/kit#2289).
//
// **The dollars are not "tokens x one rate".** A token read at the entry is not paid once — it rides
// every later request of the run as cached context, so its cost is the per-token cache-read rate
// times the number of requests the run makes. Measured on the backlogrun of 2026-09-21: 13 runs
// averaged 118 requests each, cache reads were 52% of billed input, and the fresh information a run
// took in was 0.8% of what it was billed for. Reading `read:set` as tokens alone hid this — the
// reader had to multiply by the request count and the rate in their head to judge whether a document
// was worth moving off the entry read.
//
// **The rate is not defined here.** The per-million-token input rate and the cache-read multiplier
// come from `cost-pricing.ts` — the same constants `josh cost` and `josh time` price a run with — so
// there is no second price list to drift. This file is the model (a token rides every request as a
// cache read) and the one assumption the model needs (how many requests a run makes); the arithmetic
// is `cost_pricing.estimate_cost`'s.

import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import { cost_usage } from '#scripts/cost-runtime/cost-usage'

// The run size the dollar figure assumes, and the model it is priced against. The number is the
// measured mean of the 2026-09-21 backlogrun (epic #2280); `read:set` prints it as its stated premise
// so a reader can check the assumption rather than trust it. A run twice this size costs twice as
// much per entry-read token, so the figure is "per run of this size", never an absolute.
const ASSUMED_REQUESTS = 118

// The model these runs execute on. Its base input rate and the cache-read multiplier are read from
// the price table rather than written here, so the dollar figure tracks any price change with no edit
// to this file.
const REFERENCE_MODEL = 'claude-opus-4-8'

// A token read at the entry is written to cache once and then read back on every request. Modelled as
// a pure cache read across the run — the one-time write is under 1% of the total and folding it in
// would only obscure the term that dominates the cost — so the run's cost of holding `tokens` of
// entry-read context is `tokens x ASSUMED_REQUESTS` cache-read tokens, priced by the reference model.
function dollars_per_run(tokens: number): number {
	const price = cost_pricing.resolve_price(REFERENCE_MODEL)

	if (price === undefined) return 0

	return cost_pricing.estimate_cost(
		{ ...cost_usage.EMPTY_TOTALS, cache_read_tokens: tokens * ASSUMED_REQUESTS },
		price,
	)
}

const read_set_pricing = {
	ASSUMED_REQUESTS,
	REFERENCE_MODEL,
	dollars_per_run,
}

export { read_set_pricing }
