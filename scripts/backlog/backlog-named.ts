// The named-issue prefix of a `backlogrun` invocation (joshuafolkken/kit#1984). `backlogrun #N1 #N2 …`
// runs the issues typed after the keyword in the order they were typed, one at a time, and only once
// they are all done does the opted-in backlog drain. This module is the single source of that order
// and of what a failure partway through it does, so the plan a person reads (`backlog:plan`) and the
// loop that runs it (`backlogrun.md`) cannot disagree.
//
// **It replaces the old `queue` keyword.** `queue #N1 #N2 …` was a separate entry point for exactly
// this sequential run; folding it in means one command carries both the named prefix and the backlog
// that follows it, under one authorization and one carried budget.

const NAMED_KIND = 'named'
const BACKLOG_KIND = 'backlog'
// What follows the named list when `--only` was typed: nothing. `end` is `backlog`'s counterpart in
// `after_failure.next`, so the loop reads one field to know whether the pool is next or the run is over.
const END_KIND = 'end'
const NEXT_INDEX_OFFSET = 1
const NOT_FOUND = -1

// `backlogrun --only` with no named issues has nothing to run — the flag says "run the named list and
// stop", and an empty named list makes that the empty run. Refused before anything starts rather than
// begun and found empty, the same way a budget-only invocation is still a valid bare `backlogrun`.
const NOTHING_TO_RUN =
	'`--only` runs the named issues and stops, but none were named, so there is nothing to run. Name the issues (`backlogrun #N1 #N2 … --only`), or drop `--only` to drain the opted-in backlog.'

interface NamedStep {
	kind: typeof NAMED_KIND
	issue: number
}

interface BacklogStep {
	kind: typeof BACKLOG_KIND
}

type PlanStep = NamedStep | BacklogStep

// A named issue that could not finish parks like any other child; what is specific to a sequential run
// is that the issues declared *after* it are not started — the order was the point of naming them. What
// follows is the pool by default, or nothing under `--only`, so the run then drains the opted-in
// backlog or ends (joshuafolkken/kit#1984).
interface FailureOutcome {
	parked: number
	skipped: ReadonlyArray<number>
	next: typeof BACKLOG_KIND | typeof END_KIND
}

// The plan, or the refusal that stops it before it starts. `startup` is the single decision a
// `backlogrun` begins from, so the refusal and the order cannot drift into two places.
type Startup =
	{ kind: 'plan'; steps: ReadonlyArray<PlanStep> } | { kind: 'refused'; reason: string }

const BACKLOG_STEP: BacklogStep = { kind: BACKLOG_KIND }

function named_step(issue: number): NamedStep {
	return { kind: NAMED_KIND, issue }
}

// The execution plan: the named issues in the order they were declared, then the opted-in backlog —
// unless `--only`, which stops after the named list. A bare `backlogrun` names none, so the plan is the
// backlog alone, which is the behavior that entry point always had.
function plan(named: ReadonlyArray<number>, is_only = false): ReadonlyArray<PlanStep> {
	const steps = named.map((issue) => named_step(issue))

	return is_only ? steps : [...steps, BACKLOG_STEP]
}

// The plan a `backlogrun` starts from, or the refusal that keeps it from starting. Only `--only` with
// no named issues is refused; everything else is a plan, a bare `backlogrun` (the backlog alone)
// included.
function startup(named: ReadonlyArray<number>, is_only = false): Startup {
	if (is_only && named.length === 0) return { kind: 'refused', reason: NOTHING_TO_RUN }

	return { kind: 'plan', steps: plan(named, is_only) }
}

// A named issue failed midway. It parks, the issues declared after it are skipped (starting them would
// break the order they were named in), and the run proceeds to the backlog — or ends under `--only`,
// which never had a pool to fall through to. A failure of an issue that is not in the named list skips
// nothing, so the run simply continues.
function after_failure(
	named: ReadonlyArray<number>,
	failed: number,
	is_only = false,
): FailureOutcome {
	const index = named.indexOf(failed)
	const skipped = index === NOT_FOUND ? [] : named.slice(index + NEXT_INDEX_OFFSET)

	return { parked: failed, skipped, next: is_only ? END_KIND : BACKLOG_KIND }
}

const backlog_named = {
	BACKLOG_KIND,
	END_KIND,
	NAMED_KIND,
	NOTHING_TO_RUN,
	after_failure,
	plan,
	startup,
}

export type { BacklogStep, FailureOutcome, NamedStep, PlanStep, Startup }
export { backlog_named }
