import type { EpicNextResult } from '#scripts/epic/epic-report'
import { AUTO_OK_LABEL, EPIC_LABEL, has_any_label } from '#scripts/git/issue-labels'
import type { OpenIssueData } from '#scripts/git/schemas'

// Which open issues the backlog will not run, and why (joshuafolkken/kit#1652).
//
// **The set is a subtraction, never a second membership rule.** Everything open that the pool did not
// classify is out of scope, so this cannot drift from what `backlog:next` offers the way a
// re-implemented "is it opted in" test would. What is decided per row is only the sentence saying
// why, and each of those is read off a label rather than judged.
//
// It exists because the exclusion used to be silent: an issue without `auto-ok`, or a child of an
// epic whose root lacks it, never enters the pool at all, so a person watching a `backlogrun` could
// not tell "not opted in" from "the backlog has not reached it yet".
//
// A child of an epic whose root lacks `auto-ok` is no longer one of those — since
// joshuafolkken/kit#1668 its own label carries it into the standalone half, so it is offered rather
// than explained. What is still explained here is the child of an epic that **is** opted in and that
// the epic did not place, and telling that apart from a row past the listing cap is the whole of
// `opted_in_reason` below.

const EPIC_LABELS: ReadonlySet<string> = new Set([EPIC_LABEL])
const AUTO_OK_LABELS: ReadonlySet<string> = new Set([AUTO_OK_LABEL])

const NO_OPT_IN_REASON = 'not opted in — no `auto-ok` label'
// Since joshuafolkken/kit#1668 this no longer speaks for the children: an epic that did not opt in
// offers none of them, but each child carrying `auto-ok` of its own is offered by the standalone
// half. Saying "its children are not offered" here would contradict the plan's own ready section.
const EPIC_NOT_OPTED_IN_REASON =
	'epic root without `auto-ok` — it offers no children, and only a child carrying `auto-ok` itself is offered'
const EPIC_ROOT_REASON = 'epic root — a container, so its children are planned instead of it'
const OPTED_IN_UNPLACED_REASON = 'opted in, but past the listing cap this ask could read'

// The cap is what the row above says, and it used to be said of every opted-in row the plan could
// not place — including the ones the cap had nothing to do with (joshuafolkken/kit#1668). An issue an
// opted-in epic tracks is offered through that epic and not standalone, so when the epic did not
// place it either, the epic is the fact worth naming and the cap is a misreport a reader acts on:
// "past the cap" reads as "the next ask will offer it", and the next ask never does.
function epic_tracked_reason(epic: number): string {
	return `tracked by epic #${String(epic)}, which offers it instead of the standalone half`
}

// `--exclude` drops an issue from every bucket, so an excluded one lands here. Named for what it is,
// because the label-derived reasons would otherwise report a cap that had nothing to do with it.
const EXCLUDED_REASON = 'excluded from this ask — it merged moments ago'

interface OutOfScopeRow {
	number: number
	title: string
	reason: string
}

// What the subtraction is made against: this repository, and the numbers the caller excluded.
interface ScopeContext {
	repo: string
	exclude: ReadonlyArray<number>
	// Which **opted-in** epic is withholding which issue — `epic_index.withheld_children`'s own answer,
	// the one the pool decided membership from, so the sentence and the decision cannot disagree
	// (joshuafolkken/kit#1668). A row in here is one an epic is genuinely offering instead.
	tracked: ReadonlyMap<number, number>
}

// A child elsewhere is excluded by repository rather than by number: two repositories legitimately
// have an issue of the same number, and the open listing this is subtracted from is this one's.
function planned_numbers(result: EpicNextResult, repo: string): ReadonlySet<number> {
	const children = [
		...result.candidates.flatMap((bundle) => bundle.children),
		...result.waiting,
		...result.blocked_on_people,
	]

	return new Set(children.filter((child) => child.repo === repo).map((child) => child.number))
}

// An epic root carrying `auto-ok` is not an omission — it is a container whose children are planned
// individually, which is the distinction a person reading "why is this not running" most needs.
function opted_in_reason(issue: OpenIssueData, tracked: ReadonlyMap<number, number>): string {
	const epic = tracked.get(issue.number)

	return epic === undefined ? OPTED_IN_UNPLACED_REASON : epic_tracked_reason(epic)
}

function label_reason(issue: OpenIssueData, tracked: ReadonlyMap<number, number>): string {
	const is_opted_in = has_any_label(issue.labels, AUTO_OK_LABELS)

	if (has_any_label(issue.labels, EPIC_LABELS)) {
		return is_opted_in ? EPIC_ROOT_REASON : EPIC_NOT_OPTED_IN_REASON
	}

	return is_opted_in ? opted_in_reason(issue, tracked) : NO_OPT_IN_REASON
}

// The exclusion is checked before the labels, because it is why the issue is here at all: an
// excluded row still carries whatever labels it had, and reading those would name a cause that had
// nothing to do with its absence from the plan.
function reason_for(issue: OpenIssueData, scope: ScopeContext): string {
	return scope.exclude.includes(issue.number) ? EXCLUDED_REASON : label_reason(issue, scope.tracked)
}

function out_of_scope(
	open_issues: ReadonlyArray<OpenIssueData>,
	result: EpicNextResult,
	scope: ScopeContext,
): ReadonlyArray<OutOfScopeRow> {
	const planned = planned_numbers(result, scope.repo)

	return open_issues
		.filter((issue) => !planned.has(issue.number))
		.map((issue) => ({
			number: issue.number,
			title: issue.title,
			reason: reason_for(issue, scope),
		}))
}

// The pool carries issue numbers and labels but no titles, and a plan of bare numbers is not a plan a
// person can read. The one open listing the subtraction already needs is where they come from, so no
// second read is made for them.
function titles_of(open_issues: ReadonlyArray<OpenIssueData>): ReadonlyMap<number, string> {
	return new Map(open_issues.map((issue) => [issue.number, issue.title]))
}

// The numbers still open in this repository, which is how a waiting row tells a standing blocker from
// one that has since closed. Same listing, so it costs nothing beyond the map above.
function open_numbers_of(open_issues: ReadonlyArray<OpenIssueData>): ReadonlySet<number> {
	return new Set(open_issues.map((issue) => issue.number))
}

const backlog_scope = {
	epic_tracked_reason,
	EPIC_NOT_OPTED_IN_REASON,
	EPIC_ROOT_REASON,
	EXCLUDED_REASON,
	NO_OPT_IN_REASON,
	OPTED_IN_UNPLACED_REASON,
	open_numbers_of,
	out_of_scope,
	planned_numbers,
	reason_for,
	titles_of,
}

export { backlog_scope }
export type { OutOfScopeRow, ScopeContext }
