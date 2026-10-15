const SKIP_MARKER = '— skipping'

// **A check that ran and had nothing of the project's to look at says so with this, not with the skip
// marker.** `josh exports:unused` in a consumer and `josh behavior` with no transcript are out of scope
// by design rather than unverified, so they must not withhold the gate's green record the way a skip
// does — but neither checked anything, and the gate's verdict has to be able to tell them from a check
// that did. Shared for the reason the skip marker is: the notice and its reader cannot drift apart.
const NOTHING_TO_CHECK_MARKER = 'nothing to check'

// **A skip of a tool the project does not use carries this beside the skip marker.** A `basic`
// project with no ESLint configuration skips eslint, and the notice stays a visible skip the verdict
// counts — but nothing the project asked for went unverified, so it must not withhold the gate's
// green record the way a unit suite that did not run does.
const NOT_USED_MARKER = 'which this project does not use'

export { NOT_USED_MARKER, NOTHING_TO_CHECK_MARKER, SKIP_MARKER }
