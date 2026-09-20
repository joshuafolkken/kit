// The scheduler entry/hand-off and lane worker implementation cut use one threshold. Keeping the
// value here prevents either side from drifting when the context budget changes.
const CONTEXT_CUT_THRESHOLD = 200_000

export { CONTEXT_CUT_THRESHOLD }
