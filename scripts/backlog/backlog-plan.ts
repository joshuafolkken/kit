import type { EpicChild } from '#scripts/epic/epic-graph'
import { epic_report, type EpicNextResult } from '#scripts/epic/epic-report'
import type { IssueReference } from '#scripts/git/git-epic-reference'
import { has_label_name, IN_PROGRESS_LABEL } from '#scripts/git/issue-labels'
import type { OutOfScopeRow } from './backlog-scope'

// The plan a person reads before a `backlogrun` starts (joshuafolkken/kit#1652).
//
// `backlog:next` answers the **next** question — which numbers may start now — and its report is
// shaped for the loop that consumes it. This renders the **whole** picture from the same classified
// pool: what may start in parallel, what is waiting and on which issue, what is waiting on a person,
// and what the backlog will not run at all. Rendering only: the classification is
// `backlog-next.ts`'s, so a plan can never promise an order the run does not take.

// Two spaces deeper than `epic_report`'s repository headings, so a child reads as sitting under one.
const ROW_INDENT_WIDTH = 4
const ROW_INDENT = ' '.repeat(ROW_INDENT_WIDTH)
const NOTHING = `${ROW_INDENT}(none)`

const READY_HEADING =
	'Ready now — each takes a free lane in its repository, so these may run in parallel:'
const WAITING_HEADING = 'Waiting — each names what it is waiting on:'
const HUMAN_HEADING =
	'Waiting on a person (`needs-decision`) — resolve these before the run starts:'
const SCOPE_HEADING = 'Out of scope — open, but the backlog will not run these:'
// `epic_report`'s own words for the same condition, so the plan and the run name it identically.
const UNUSABLE_HEADING = 'The dependency graph is unusable, so there is no plan:'

const IN_PROGRESS_NOTE = 'a run already has it'
const PAST_OFFER_NOTE = 'ready, but past the offer this ask could make'

// The repository the plan is written from, and the titles the pool does not carry. Passed together
// because every row needs both: a bare number is not a plan, and a child elsewhere has to be
// qualified or it names this repository's issue of that number.
interface PlanContext {
	repo: string
	titles: ReadonlyMap<number, string>
	// The open issues of this repository, by number. A `blocked_by` edge keeps a blocker that has since
	// closed — `backlog-pool.ts`'s `to_child` drops the node's state — so without this a waiting row
	// names a blocker nobody is waiting for.
	open_numbers: ReadonlySet<number>
}

// A child elsewhere is qualified, because a bare number would name *this* repository's issue of that
// number — a different issue (joshuafolkken/kit#1016). Takes the reference rather than the child, so
// a `blocked_by` edge is named by the same rule the child itself is.
function reference_of(reference: IssueReference, repo: string): string {
	const number = String(reference.number)

	return reference.repo === repo ? `#${number}` : `${reference.repo}#${number}`
}

// A title is only known for this repository's issues — the open listing the titles come from is this
// repository's. A child elsewhere is still named, just without one.
function title_of(child: EpicChild, context: PlanContext): string {
	return child.repo === context.repo ? (context.titles.get(child.number) ?? '') : ''
}

function join_row(reference: string, title: string, note: string): string {
	const parts = [reference, title, note === '' ? '' : `— ${note}`].filter((part) => part !== '')

	return `${ROW_INDENT}${parts.join('  ')}`
}

function row_of(child: EpicChild, context: PlanContext, note: string): string {
	return join_row(reference_of(child, context.repo), title_of(child, context), note)
}

// Why this one is not offered yet. The blocker numbers are the answer whenever there are any — that
// is the dependency the report has never shown — and the two label-free cases are told apart so
// "waiting" does not read as "blocked" for an issue that is simply next in line.
function open_blockers(child: EpicChild, context: PlanContext): Array<string> {
	return child.blocked_by
		.filter((edge) => edge.repo !== context.repo || context.open_numbers.has(edge.number))
		.map((edge) => reference_of(edge, context.repo))
}

// The label is read before the edges, the order `epic_classify.local_category` already settles the
// same question in: a child a run already holds is withheld for that reason whatever else it
// declares, and saying it waits on an issue would send a person to the wrong place.
function waiting_note(child: EpicChild, context: PlanContext): string {
	if (has_label_name(child.labels, IN_PROGRESS_LABEL)) return IN_PROGRESS_NOTE
	const blockers = open_blockers(child, context)

	if (blockers.length > 0) return `waiting on ${blockers.join(', ')}`

	return PAST_OFFER_NOTE
}

function section(heading: string, lines: ReadonlyArray<string>): string {
	return [heading, ...(lines.length === 0 ? [NOTHING] : lines)].join('\n')
}

// The three child sections differ only in the note each row carries, so one function renders all of
// them and the note is what varies.
function child_lines(
	children: ReadonlyArray<EpicChild>,
	context: PlanContext,
	note: (child: EpicChild) => string,
): Array<string> {
	return children.map((child) => row_of(child, context, note(child)))
}

// A section whose rows say nothing beyond naming the issue: being under the heading is the whole
// statement.
function no_note(): string {
	return ''
}

// Grouped by repository, because a lane is per repository — so the grouping is the parallelism, not
// a presentational choice. The heading is `epic_report`'s own, checkout path included.
function ready_lines(result: EpicNextResult, context: PlanContext): Array<string> {
	return result.candidates.flatMap((bundle) => [
		epic_report.format_bundle_heading(bundle),
		...child_lines(bundle.children, context, no_note),
	])
}

function waiting_lines(children: ReadonlyArray<EpicChild>, context: PlanContext): Array<string> {
	return child_lines(children, context, function note(child: EpicChild): string {
		return waiting_note(child, context)
	})
}

function scope_lines(rows: ReadonlyArray<OutOfScopeRow>): Array<string> {
	return rows.map((row) => join_row(`#${String(row.number)}`, row.title, row.reason))
}

// The classification could not be made, so every section below it would be rendered from buckets
// that mean nothing — and `build_result` empties only `candidates`, so an unusable graph would
// otherwise print as an ordinary plan with nothing ready. `backlog:next` answers `error` for this
// same pool, and a plan that read as normal beside it is exactly the disagreement this command
// promises cannot happen.
function format_unusable(result: EpicNextResult): string {
	const lines = result.anomalies.map((anomaly) => `${ROW_INDENT}${anomaly.message}`)

	return [UNUSABLE_HEADING, ...(lines.length === 0 ? [NOTHING] : lines)].join('\n')
}

function format_plan(
	result: EpicNextResult,
	out_of_scope: ReadonlyArray<OutOfScopeRow>,
	context: PlanContext,
): string {
	if (result.verdict === 'error') return format_unusable(result)

	return [
		`Backlog plan — ${context.repo}`,
		'',
		section(READY_HEADING, ready_lines(result, context)),
		'',
		section(WAITING_HEADING, waiting_lines(result.waiting, context)),
		'',
		section(HUMAN_HEADING, child_lines(result.blocked_on_people, context, no_note)),
		'',
		section(SCOPE_HEADING, scope_lines(out_of_scope)),
	].join('\n')
}

const backlog_plan = {
	HUMAN_HEADING,
	IN_PROGRESS_NOTE,
	NOTHING,
	PAST_OFFER_NOTE,
	READY_HEADING,
	SCOPE_HEADING,
	UNUSABLE_HEADING,
	WAITING_HEADING,
	format_plan,
	waiting_note,
}

export { backlog_plan }
export type { PlanContext }
