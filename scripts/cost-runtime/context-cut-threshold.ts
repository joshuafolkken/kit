import { context_cut_payback } from './context-cut-payback'

// The scheduler entry/hand-off and lane worker implementation cut use one threshold. Keeping the
// value here prevents either side from drifting when the context budget changes.
// joshuafolkken/kit#2374 lowered it from 200_000 by simulation; joshuafolkken/kit#2406 replaced the
// hand-picked ceiling with a break-even: the threshold is no longer a chosen number but the current
// per-request context at which a cut pays back over the expected remaining requests
// (`context-cut-payback.ts`). At `POST_CUT_CONTEXT` 60_000 and a 10-request horizon that is 135_000 —
// 10% under #2374's empirical 150_000 and inside the 100k–200k band that PR simulated — now derived
// from the cache-price multipliers and the horizon rather than restated, so it moves with the model.
const CONTEXT_CUT_THRESHOLD = context_cut_payback.break_even_context()

export { CONTEXT_CUT_THRESHOLD }
