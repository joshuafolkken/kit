// The named-issue prefix of a `backlogrun` invocation (joshuafolkken/kit#1984). `backlogrun #N1 #N2 …`
// runs the issues typed after the keyword in the order they were typed, one at a time, and only once
// they are all done does the opted-in backlog drain. This module is the single source of that order
// and of what a failure partway through it does, so the plan a person reads (`backlog:plan`) and the
// loop that runs it (`backlogrun.md`) cannot disagree.
//
// **It replaces the old `queue` keyword.** `queue #N1 #N2 …` was a separate entry point for exactly
// this sequential run; folding it in means one command carries both the named prefix and the backlog
// that follows it, under one authorization and one carried budget.
//
// **A named item is a single issue or an epic** (joshuafolkken/kit#1985, folding in the old `epicrun`
// keyword). A single-issue item is one `fullrun`; an epic item runs every child in dependency order,
// across the free lanes, and is done only once every child has been processed — merged or parked. The
// run does not advance to the next named item until the epic item is complete, which is `epicrun`'s
// whole-epic execution at the granularity of one named item.

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

// One named item: a single issue (`is_epic: false`) or an epic (`is_epic: true`). The parser only sees
// `#N`, so which one it is is decided by the caller from GitHub state; the pure functions here carry
// the flag rather than re-derive it, so the plan and the loop agree on how each item runs.
interface NamedItem {
	issue: number
	is_epic: boolean
}

interface NamedStep {
	kind: typeof NAMED_KIND
	issue: number
	is_epic: boolean
}

interface BacklogStep {
	kind: typeof BACKLOG_KIND
}

type PlanStep = NamedStep | BacklogStep

// A named issue that could not finish parks like any other child; what is specific to a sequential run
// is that the issues declared *after* it are not started — the order was the point of naming them. What
// follows is the pool by default, or nothing under `--only`, so the run then drains the opted-in
// backlog or ends (joshuafolkken/kit#1984).
//
// **This skip only applies to a single-issue item.** An epic item does not park as a unit — its
// children park individually and the epic item completes anyway (`epic_item_outcome`), so a parked
// epic child, which is never in the named list, skips nothing and the run advances to the next item
// (joshuafolkken/kit#1985).
interface FailureOutcome {
	parked: number
	skipped: ReadonlyArray<number>
	next: typeof BACKLOG_KIND | typeof END_KIND
}

// The completion of one epic named item. It runs every child and finishes once each has been
// processed; the children that parked are carried here so the completion report can list them, and the
// item is complete regardless — a parked child never holds up the next named item
// (joshuafolkken/kit#1985).
interface EpicItemOutcome {
	epic: number
	parked: ReadonlyArray<number>
	complete: true
}

// One child of an epic item after it ran: merged (`parked: false`) or parked (`parked: true`).
interface EpicChildOutcome {
	issue: number
	parked: boolean
}

// The plan, or the refusal that stops it before it starts. `startup` is the single decision a
// `backlogrun` begins from, so the refusal and the order cannot drift into two places.
type Startup =
	{ kind: 'plan'; steps: ReadonlyArray<PlanStep> } | { kind: 'refused'; reason: string }

const BACKLOG_STEP: BacklogStep = { kind: BACKLOG_KIND }

function named_step(item: NamedItem): NamedStep {
	return { kind: NAMED_KIND, issue: item.issue, is_epic: item.is_epic }
}

// The execution plan: the named items in the order they were declared, then the opted-in backlog —
// unless `--only`, which stops after the named list. Each named step carries whether it is an epic, so
// the loop knows to run one `fullrun` or a whole epic. A bare `backlogrun` names none, so the plan is
// the backlog alone, which is the behavior that entry point always had.
function plan(named: ReadonlyArray<NamedItem>, is_only = false): ReadonlyArray<PlanStep> {
	const steps = named.map((item) => named_step(item))

	return is_only ? steps : [...steps, BACKLOG_STEP]
}

// The plan a `backlogrun` starts from, or the refusal that keeps it from starting. Only `--only` with
// no named items is refused; everything else is a plan, a bare `backlogrun` (the backlog alone)
// included.
function startup(named: ReadonlyArray<NamedItem>, is_only = false): Startup {
	if (is_only && named.length === 0) return { kind: 'refused', reason: NOTHING_TO_RUN }

	return { kind: 'plan', steps: plan(named, is_only) }
}

// A single-issue named item failed midway. It parks, the items declared after it are skipped (starting
// them would break the order they were named in), and the run proceeds to the backlog — or ends under
// `--only`, which never had a pool to fall through to. A failure whose number is not a *single-issue*
// named item skips nothing: an issue never named, and an epic child (which is not in the named list),
// both leave the order intact, so the run simply continues. An epic named item completes through
// `epic_item_outcome` rather than parking as a unit, so its number never skips the list either.
function after_failure(
	named: ReadonlyArray<NamedItem>,
	failed: number,
	is_only = false,
): FailureOutcome {
	const index = named.findIndex((item) => item.issue === failed && !item.is_epic)
	const skipped =
		index === NOT_FOUND ? [] : named.slice(index + NEXT_INDEX_OFFSET).map((item) => item.issue)

	return { parked: failed, skipped, next: is_only ? END_KIND : BACKLOG_KIND }
}

// An epic named item is complete once every child has been processed — merged or parked. The parked
// children are carried out so the completion report can list them, and the item is complete either
// way: a parked epic child does not hold up the next named item, which is `epicrun`'s park-and-continue
// at the granularity of one named epic item (joshuafolkken/kit#1985).
function epic_item_outcome(
	epic: number,
	children: ReadonlyArray<EpicChildOutcome>,
): EpicItemOutcome {
	const parked = children.filter((child) => child.parked).map((child) => child.issue)

	return { epic, parked, complete: true }
}

const backlog_named = {
	BACKLOG_KIND,
	END_KIND,
	NAMED_KIND,
	NOTHING_TO_RUN,
	after_failure,
	epic_item_outcome,
	plan,
	startup,
}

export type {
	BacklogStep,
	EpicChildOutcome,
	EpicItemOutcome,
	FailureOutcome,
	NamedItem,
	NamedStep,
	PlanStep,
	Startup,
}
export { backlog_named }
