import { context_cut_payback } from './context-cut-payback'

// The scheduler entry/hand-off and lane worker implementation cut use one threshold. Keeping the
// value here prevents either side from drifting when the context budget changes.
// The threshold is a break-even, not a chosen number: the current per-request context at which a
// cut pays back over the expected remaining requests (`context-cut-payback.ts`). At
// `POST_CUT_CONTEXT` 60_000 and a 10-request horizon that is 135_000, derived from the cache-price
// multipliers and the horizon rather than restated, so it moves with the model.
const CONTEXT_CUT_THRESHOLD = context_cut_payback.break_even_context()

export { CONTEXT_CUT_THRESHOLD }
