import { cost_pricing } from './cost-pricing'

// **When a context cut pays back, priced from the cost model rather than fixed at a ceiling**
// (joshuafolkken/kit#2406). A cut ends the oversized session and relaunches a fresh one that rebuilds
// only its preamble, so what it saves is not decided by a ceiling on the accumulated context but by a
// *rate*: a cache read bills the whole context on every request, so whether to cut turns on how many
// requests are still to come and what each would pay, not on how much has piled up.
//
// The arithmetic is a break-even. A cut costs one preamble rewrite — `POST_CUT_CONTEXT` tokens written
// to cache once — and saves, on every later request, the cache read of the context it dropped
// (`current − POST_CUT_CONTEXT` tokens). The base input rate cancels: both the cost and the saving are
// billed at the same model's input rate, so only the two cache multipliers survive, and they are read
// from `cost-pricing.ts` rather than restated here — no second price list.

// The context a resumed request pays: the preamble plus the carried hand-off a fresh process rebuilds.
// Measured at ~60,000 — `.claude/skills/workflow-commands/pre-gate-cut.md` records the cut carrying a
// request from ~130k down to ~60k. It is both the cut's one-time cost (written once) and the floor the
// per-request saving is measured above.
const POST_CUT_CONTEXT = 60_000

// The requests a resumed session is expected to still run — the horizon the break-even is measured
// against. A cut only pays if enough requests remain to recoup the preamble rewrite; even the shortest
// resume (into the gate, commit, PR and merge) runs on the order of ten. Ten is the conservative
// horizon: it keeps the shared threshold near joshuafolkken/kit#2374's empirically validated 150_000
// (this lands at 135_000, inside the 100k–200k band that PR simulated) while pricing the decision from
// the cost model. It is the knob a before/after lane measurement tunes.
const EXPECTED_REMAINING_REQUESTS = 10

// The price of a dropped token relative to a rewritten one, from `cost-pricing.ts`. A cache read bills
// `CACHE_READ_MULTIPLIER` of base input and a 5-minute cache write `CACHE_WRITE_5M_MULTIPLIER`, so a
// preamble rewrite costs this many per-request cache reads. The base input rate is common to both and
// cancels, which is why only the ratio appears.
function write_over_read(): number {
	return cost_pricing.CACHE_WRITE_5M_MULTIPLIER / cost_pricing.CACHE_READ_MULTIPLIER
}

// The current per-request context at which a cut breaks even over exactly `remaining` requests. The
// shared cut threshold is this evaluated at `EXPECTED_REMAINING_REQUESTS`; rounded to an integer so the
// `>` comparison against a per-request billed-input count has no floating-point seam.
function break_even_context(remaining: number = EXPECTED_REMAINING_REQUESTS): number {
	if (remaining <= 0) return Infinity

	return Math.round(POST_CUT_CONTEXT * (1 + write_over_read() / remaining))
}

// The requests a cut must save over before it recoups its own preamble rewrite, at a given current
// per-request context. Decreasing in context: the more a request currently pays, the fewer resumed
// requests are needed to earn the cut back. Exposed as the diagnostic the break-even is read in —
// `break_even_requests(current) < remaining` is the same decision as `pays_back`.
function break_even_requests(current_context: number): number {
	const saved_per_request = current_context - POST_CUT_CONTEXT

	if (saved_per_request <= 0) return Infinity

	return (POST_CUT_CONTEXT * write_over_read()) / saved_per_request
}

// Whether cutting now pays back: the current per-request context has grown past the break-even point
// for the expected remaining requests. Compared against the rounded `break_even_context` with `>`, so
// it agrees to the token with `cost_verdict.classify` reading the derived `CONTEXT_CUT_THRESHOLD` — the
// same one decision, whether a caller holds the threshold or asks this function.
function pays_back(
	current_context: number,
	remaining: number = EXPECTED_REMAINING_REQUESTS,
): boolean {
	return current_context > break_even_context(remaining)
}

const context_cut_payback = {
	POST_CUT_CONTEXT,
	EXPECTED_REMAINING_REQUESTS,
	break_even_context,
	break_even_requests,
	pays_back,
}

export { context_cut_payback }
