// The phase vocabulary — the names a run's wall clock is cut into, the order they print in, and the
// two tables keyed by them.
//
// **It sits apart from `time-phases.ts` for the reason `time-phase-fixture.ts` does**: that file
// grew past its length limit as phases were added to it, and this is the half with nothing to decide
// — it says what a phase *is*, while the file it left decides which one a span belongs to. Nothing
// here imports the classifier, so the dependency runs one way and the next phase added costs one
// line rather than a fresh argument about where to put it (joshuafolkken/kit#1331).

type PhaseName =
	| 'plan'
	| 'setup'
	| 'implement'
	| 'gate'
	| 'rework'
	| 'review'
	| 'pr'
	| 'wrapup'
	| 'ci'
	| 'merge'
	| 'wait'
	| 'wait-outside'
	| 'pre-run'
	| 'post-run'
	| 'other'

const PLAN_PHASE: PhaseName = 'plan'
const SETUP_PHASE: PhaseName = 'setup'
const IMPLEMENT_PHASE: PhaseName = 'implement'
const GATE_PHASE: PhaseName = 'gate'
const REWORK_PHASE: PhaseName = 'rework'
const REVIEW_PHASE: PhaseName = 'review'
const PR_PHASE: PhaseName = 'pr'
const WRAPUP_PHASE: PhaseName = 'wrapup'
const CI_PHASE: PhaseName = 'ci'
const MERGE_PHASE: PhaseName = 'merge'
const WAIT_PHASE: PhaseName = 'wait'
const WAIT_OUTSIDE_PHASE: PhaseName = 'wait-outside'
const PRE_RUN_PHASE: PhaseName = 'pre-run'
const POST_RUN_PHASE: PhaseName = 'post-run'
const OTHER_PHASE: PhaseName = 'other'

// Run order, which is the order they are printed in — by where a phase *opens*, so `wrapup` sits
// beside the pull request it starts at rather than after the merge it runs beside. The two wait
// rows, the two outside-the-run rows and `other` come last because none is a stage anything passes
// through: two are time spent between the stages, two are time that was not the run's at all, and
// the last is the remainder. **`wait-outside` sits immediately after `wait`** so the two halves of
// one quantity are read side by side — that comparison is the whole point of the split, and a row
// placed further down would have to be looked for.
const PHASE_ORDER: ReadonlyArray<PhaseName> = [
	PLAN_PHASE,
	SETUP_PHASE,
	IMPLEMENT_PHASE,
	GATE_PHASE,
	REWORK_PHASE,
	REVIEW_PHASE,
	PR_PHASE,
	WRAPUP_PHASE,
	CI_PHASE,
	MERGE_PHASE,
	WAIT_PHASE,
	WAIT_OUTSIDE_PHASE,
	PRE_RUN_PHASE,
	POST_RUN_PHASE,
	OTHER_PHASE,
]

// None is a boundary marker, so none can fail to be found: `other` is the remainder, and the two wait
// rows are read off the span's own category. A run nobody waited on genuinely waited zero minutes,
// which is the one answer `not detected` must not be given for — so these are detected whenever a
// transcript was read at all, rather than on a marker.
//
// **They are withheld on exactly the terms the three transcript category rows are**
// (joshuafolkken/kit#1295) — no span read at all. `wait` printing `0.0 min` where nothing was read
// asserts that nobody waited, and the run that produces it is the one a reader is least able to check.
// Keying every one of them off the same criterion is also what keeps `wait` + `wait-outside` equal to
// the `human wait` category row: they are withheld together or printed together, never some of each.
//
// **`wait-outside` is in this set rather than detected on the run's edges** (joshuafolkken/kit#1331),
// which is where it differs from `pre-run` and `post-run`. Its zero is not a claim about an unchecked
// half, because those two rows report the same two boundaries in their own right — a reader seeing
// `pre-run  not detected` beside `wait-outside  0.0 min` already knows that edge was never found, and
// a third row saying so would restate it at the price of the invariant above.
const SPAN_BACKED_PHASES: ReadonlySet<PhaseName> = new Set([
	WAIT_PHASE,
	WAIT_OUTSIDE_PHASE,
	OTHER_PHASE,
])

const GATE_COMMAND = 'josh gate'

// The `pnpm josh <cmd>` names `time-spans.ts` already reads off a Bash call, mapped to the phase
// each one *is*. Read from that field rather than re-detected here, so what counts as a gate run is
// one rule and not two.
const COMMAND_PHASES = new Map<string, PhaseName>([
	[GATE_COMMAND, GATE_PHASE],
	['josh git', PR_PHASE],
	['josh pr', PR_PHASE],
	['josh followup', MERGE_PHASE],
])

export type { PhaseName }
export {
	CI_PHASE,
	COMMAND_PHASES,
	GATE_COMMAND,
	GATE_PHASE,
	IMPLEMENT_PHASE,
	MERGE_PHASE,
	OTHER_PHASE,
	PHASE_ORDER,
	PLAN_PHASE,
	POST_RUN_PHASE,
	PRE_RUN_PHASE,
	PR_PHASE,
	REVIEW_PHASE,
	REWORK_PHASE,
	SETUP_PHASE,
	SPAN_BACKED_PHASES,
	WAIT_OUTSIDE_PHASE,
	WAIT_PHASE,
	WRAPUP_PHASE,
}
