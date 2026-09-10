import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import type { Classification } from '#scripts/epic/epic-classify'
import { epic_graph, type EpicChild } from '#scripts/epic/epic-graph'
import { epic_index } from '#scripts/epic/epic-index'
import { epic_issue } from '#scripts/epic/epic-issue'
import type { EpicView } from '#scripts/epic/epic-next-views'
import { git_next_issues } from '#scripts/git/git-next-issues'
import {
	ALREADY_DONE_LABEL,
	EPIC_LABEL,
	has_any_label,
	NEEDS_DECISION_LABEL,
} from '#scripts/git/issue-labels'
import type { OpenIssueData } from '#scripts/git/schemas'

// The candidate pool `josh backlog:next` answers from (joshuafolkken/kit#1630).
//
// Two sources feed one pool: the opted-in issues no epic tracks, and the children of the epics whose
// **root** carries `auto-ok`. Splitting them apart lives here so the command itself stays a list of
// steps, and so the two halves arrive as the one shape the verdict is decided from —
// `epic-classify.ts`'s `Classification`, which `epic-report.ts` then turns into the answer. Nothing
// here re-implements the dependency graph or the wave: the epic half arrives already classified by
// `epic:next`'s own pipeline, and this module only merges it with the standalone half.

const EPIC_LABELS: ReadonlySet<string> = new Set([EPIC_LABEL])
// The labels that put a withheld row in the "needs a person" bucket rather than the "waiting on
// time" one. `already-done` belongs with `needs-decision` because no amount of waiting moves it: the
// work is merged and the close is Tier C, so a person is the only thing that resolves it
// (joshuafolkken/kit#1679). Read as `time`, it would be reported as something that resolves itself
// and nobody would ever be told to close it.
const DECISION_LABELS: ReadonlySet<string> = new Set([NEEDS_DECISION_LABEL, ALREADY_DONE_LABEL])

// What decides whether a standalone row is offered: the children an opted-in epic is going to offer
// instead, the ones the caller has named as done, and the repository the rows belong to.
//
// `tracked` is the narrowed set `epic_index.withheld_children` builds, not every child an epic
// tracks (joshuafolkken/kit#1668) — the narrowing itself is defined there, once, for this half and
// `auto-ok:next` alike.
interface StandaloneContext {
	tracked: ReadonlyMap<number, number>
	exclude: ReadonlyArray<number>
	repo: string
}

function is_epic_row(issue: OpenIssueData): boolean {
	return has_any_label(issue.labels, EPIC_LABELS)
}

function needs_decision(issue: OpenIssueData): boolean {
	return has_any_label(issue.labels, DECISION_LABELS)
}

// An opted-in row as the graph's node type. Both halves of the pool are then the same shape, so one
// classification covers all of them and the verdict is decided once rather than per source.
//
// `repo` stamps the row itself, never its blockers: issue numbers are unique per repository, so a
// blocker read bare resolves against the *reading* repository and names a different issue there
// (joshuafolkken/kit#1654). `epic_issue.blocker_references_of` is the epic side's own resolution —
// `repository_url` when the node names one, this repository only as the fallback an unqualified
// relation has always meant — and it is reused rather than repeated.
function to_child(issue: OpenIssueData, repo: string): EpicChild {
	return {
		number: issue.number,
		repo,
		state: 'OPEN',
		labels: (issue.labels ?? []).map((label) => label.name),
		blocked_by: epic_issue.blocker_references_of(issue, repo),
	}
}

function to_children(issues: ReadonlyArray<OpenIssueData>, repo: string): Array<EpicChild> {
	return issues.map((issue) => to_child(issue, repo))
}

// The epic roots whose `auto-ok` stands for every child.
//
// They come out of the opted-in listing itself: an epic that carries `auto-ok` is a row in that
// listing which also carries `epic`. So no second listing has to read an epic's labels, and a child
// is never asked for one of its own — the root's label is the approval, exactly as typing
// `epicrun #<E>` approves every merge inside `#<E>`.
function opted_in_epics(issues: ReadonlyArray<OpenIssueData>): ReadonlyArray<number> {
	return [...epic_index.opted_in_epic_numbers(issues)]
}

// The rows that stand for themselves. An epic root is a container rather than work, so it is never a
// standalone candidate however it is labelled — `prioritize` drops it again below, and this keeps it
// out of the count as well.
function standalone_rows(issues: ReadonlyArray<OpenIssueData>): ReadonlyArray<OpenIssueData> {
	return issues.filter((issue) => !is_epic_row(issue))
}

// A row an **opted-in** epic tracks belongs to that epic's order and never to the standalone half —
// the rule joshuafolkken/kit#1633 established, narrowed by joshuafolkken/kit#1668 to the epics that
// are actually going to offer their children and applied here for the same reason. Which rows those
// are is `epic_index.withheld_children`'s answer, not a second test made here. A row the caller
// excluded is out of the pool entirely rather than merely unoffered: it has just merged.
function is_considered(issue: OpenIssueData, context: StandaloneContext): boolean {
	return !context.tracked.has(issue.number) && !context.exclude.includes(issue.number)
}

// The standalone half, in the buckets the verdict is read from.
//
// The order is `git_next_issues.prioritize`'s and not a second one — the same ranking the
// `🗒 Next issues` display and `auto-ok:next` already answer with, cap included, so the three cannot
// disagree about what comes next. Anything it withholds is still open work: `needs-decision` is
// waiting on a person, and everything else — a standing blocker, a run already in progress, a row
// past the cap — resolves on its own and is waiting on time. **The cap is one of those**: a sixth
// runnable standalone issue is reported as waiting rather than offered, and the next ask offers it
// once one of the five above it merges, so the backlog drains without it ever being lost. That is
// the cost of having one ranking rather than two, and `docs/josh-commands.md` states it.
function classify_standalone(
	issues: ReadonlyArray<OpenIssueData>,
	context: StandaloneContext,
): Classification {
	const considered = issues.filter((issue) => is_considered(issue, context))
	const runnable = git_next_issues.prioritize(
		considered.filter((issue) => auto_ok_cli.is_runnable(issue, context.tracked, context.exclude)),
	)
	const offered = new Set(runnable.map((issue) => issue.number))
	const withheld = considered.filter((issue) => !offered.has(issue.number))

	return {
		runnable: to_children(runnable, context.repo),
		time: to_children(
			withheld.filter((issue) => !needs_decision(issue)),
			context.repo,
		),
		human: to_children(
			withheld.filter((issue) => needs_decision(issue)),
			context.repo,
		),
	}
}

// Two epics can list the same child. `epic:next` answers about one epic at a time and never sees it;
// here the child would reach standard output twice, and a loop starting one run per line would start
// it twice. Keyed by repository and number, because two repositories legitimately have an issue of
// the same number.
function unique_children(children: ReadonlyArray<EpicChild>): Array<EpicChild> {
	const seen = new Set<string>()
	const unique: Array<EpicChild> = []

	for (const child of children) {
		if (seen.has(epic_graph.key_of(child))) continue
		seen.add(epic_graph.key_of(child))
		unique.push(child)
	}

	return unique
}

function without(children: ReadonlyArray<EpicChild>, taken: ReadonlySet<string>): Array<EpicChild> {
	return children.filter((child) => !taken.has(epic_graph.key_of(child)))
}

function keys_of(children: ReadonlyArray<EpicChild>): Set<string> {
	return new Set(children.map((child) => epic_graph.key_of(child)))
}

// The epic half, already classified. `epic:next` decided each of these — the `blocked-by` graph, the
// wave, the anomalies — so this only flattens the per-repository bundles back into one list, in the
// order the epics' own task lists gave them.
//
// **Withholding wins across the buckets, not only within one.** Two epics can classify the same child
// differently — one tracks the blocker and calls it `time`, the other does not track it and calls it
// `runnable` — and a child offered on standard output while standard error lists it as waiting is
// work a loop would start against a dependency that is still standing. So `human` is settled first,
// `time` next, and `runnable` keeps only what neither claimed.
function epic_classification(views: ReadonlyArray<EpicView>): Classification {
	const human = unique_children(views.flatMap((view) => view.result.blocked_on_people))
	const time = without(
		unique_children(views.flatMap((view) => view.result.waiting)),
		keys_of(human),
	)
	const offered = views.flatMap((view) =>
		view.result.candidates.flatMap((bundle) => bundle.children),
	)

	return {
		runnable: without(unique_children(offered), keys_of([...human, ...time])),
		time,
		human,
	}
}

// `--exclude` takes bare numbers, and a bare number names an issue of the repository the command is
// running in. A child elsewhere with the same number is a different issue, so the comparison carries
// the repository rather than the number alone.
function is_kept(child: EpicChild, exclude: ReadonlyArray<number>, repo: string): boolean {
	return child.repo !== repo || !exclude.includes(child.number)
}

// A child that merged moments ago still reads as open until GitHub applies `closes #N`, so an
// exclusion drops it from every bucket rather than only from the offer: left in `time`, it would
// answer `wait` for a backlog with nothing left to wait for.
function drop_excluded(
	classification: Classification,
	exclude: ReadonlyArray<number>,
	repo: string,
): Classification {
	return {
		runnable: classification.runnable.filter((child) => is_kept(child, exclude, repo)),
		time: classification.time.filter((child) => is_kept(child, exclude, repo)),
		human: classification.human.filter((child) => is_kept(child, exclude, repo)),
	}
}

// The epic half first, then the standalone half. An epic's children are work somebody has already
// planned and ordered, so finishing what is in flight comes before starting something new.
function merge_classifications(left: Classification, right: Classification): Classification {
	return {
		runnable: [...left.runnable, ...right.runnable],
		time: [...left.time, ...right.time],
		human: [...left.human, ...right.human],
	}
}

const backlog_pool = {
	classify_standalone,
	drop_excluded,
	epic_classification,
	is_epic_row,
	keys_of,
	merge_classifications,
	opted_in_epics,
	standalone_rows,
	to_child,
	to_children,
	unique_children,
}

export { backlog_pool }
export type { StandaloneContext }
