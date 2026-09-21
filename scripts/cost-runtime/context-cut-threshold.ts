// The scheduler entry/hand-off and lane worker implementation cut use one threshold. Keeping the
// value here prevents either side from drifting when the context budget changes.
const CONTEXT_CUT_THRESHOLD = 200_000

// The hand-off prices the average billed input of the most recent requests, not the whole session
// (joshuafolkken/kit#2295). A long parent session's whole-session average lags its current context by
// dozens of requests — measured at 85 requests (~4 hours) behind on the 2026-09-21 parent — so it
// keeps supervising an already-oversized context long after a cut was due. Ten requests is enough to
// smooth a single outlier without reaching back into the cheap early context; it sits beside the
// threshold so the window and the limit are read from one place and cannot drift.
const RECENT_REQUEST_WINDOW = 10

export { CONTEXT_CUT_THRESHOLD, RECENT_REQUEST_WINDOW }
