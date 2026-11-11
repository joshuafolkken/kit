import type { EpicChild } from '#scripts/epic/epic-graph'
import { issue_cap_files } from '#scripts/issue/issue-cap-files'
import { SPLIT_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { session_cite } from '#scripts/issue/session-cite'
import { size_estimate } from '#scripts/issue/size-estimate'
import type { ImplementRate } from '#scripts/lane/lane-implement-rate'
import type { SizeRatios } from '#scripts/lane/lane-size-stats'
import type { FileBudget } from '#scripts/lines/line-budget'
import { split_assess } from '#scripts/split/split-assess'
import type { PoolContext } from './backlog-gate-scope'

// An offered Issue whose declared estimate is over the split guide, with no reason it stays one —
// judged by the same `size_estimate.over_guide` `issue:file` refuses on, so a body edited past the
// guide after filing is still seen before a lane starts it (joshuafolkken/kit#5384). A split child
// passes the guide at filing, yet is warned on here too: lanes land past the doubled declaration
// (joshuafolkken/kit#5935).
//
// One over the cap or the size bar is offered too, with the same note (joshuafolkken/kit#7074): past
// the size bar `backlog:drive`'s split-only unit splits it before a lane opens
// (`backlog-drive-split-unit.ts`), and a lane it still reaches answers `split` at `lane:plan`, so the
// size never waits on a person. Holding it here stopped every lane once
// the measured rate rose (joshuafolkken/kit#7006).

// What the note asks of the issue: a further split for a split child, else the reason it stays one.
function remedy_of(route: string | undefined): string {
	return route === SPLIT_ROUTE_LABEL
		? `on a \`${SPLIT_ROUTE_LABEL}\` child — split it further`
		: `with no \`${split_assess.REASON_PREFIX}\``
}

// The cap's or the size bar's overrun — `issue:file`'s own refusals, read at offer time.
function limit_note(
	body: string,
	route: string | undefined,
	rate: ImplementRate | undefined,
	growth?: SizeRatios,
): string | undefined {
	const capped = size_estimate.over_cap(body, route, rate, growth)

	return capped === undefined
		? size_estimate.budget_note(body, rate, growth)
		: size_estimate.capped(capped, rate, growth)
}

function guide_note(
	body: string,
	route: string | undefined,
	rate: ImplementRate | undefined,
	growth?: SizeRatios,
): string | undefined {
	const guide =
		size_estimate.over_guide(body, route, rate, growth) ??
		size_estimate.split_over_guide(body, route, rate, growth)

	return guide === undefined
		? undefined
		: `${size_estimate.exceeded(guide, rate, growth)} ${remedy_of(route)}`
}

// The cap's or the size bar's overrun, else the guide's.
function size_note(row: EpicChild, context: PoolContext): string | undefined {
	const route = size_estimate.route_of(row.labels)
	const body = row.body ?? ''
	const { implement_rate, growth } = context

	return (
		limit_note(body, route, implement_rate, growth) ??
		guide_note(body, route, implement_rate, growth)
	)
}

function note_of(row: EpicChild, context: PoolContext): string | undefined {
	const note = size_note(row, context)

	if (note === undefined) return undefined
	const cited = session_cite.issue(row.number, undefined, row.repo)

	return `${cited} ${note} — split-assessment.md → "${split_assess.QUESTION_SECTION}"`
}

// A named file near its code-line cap, warned on and offered anyway (joshuafolkken/kit#7184).
function cap_note_of(row: EpicChild, near: ReadonlyArray<FileBudget> = []): string | undefined {
	const note = issue_cap_files.note(near)

	return note === undefined
		? undefined
		: `${session_cite.issue(row.number, undefined, row.repo)} ${note}`
}

// One stderr line per offered row over its size, and one per row naming a file near its cap — a
// standalone issue and an epic child alike; the stdout tokens stay bare numbers.
async function warn_over_guide(
	offered: ReadonlyArray<EpicChild>,
	context: PoolContext,
): Promise<void> {
	const bodies = offered.map((row) => row.body ?? '')
	const near = await issue_cap_files.near_cap_by_body(bodies, process.cwd())
	const notes = offered.flatMap((row, index) => [
		note_of(row, context),
		cap_note_of(row, near[index]),
	])

	for (const note of notes) if (note !== undefined) console.error(note)
}

const backlog_next_size = { warn_over_guide }

export { backlog_next_size }
