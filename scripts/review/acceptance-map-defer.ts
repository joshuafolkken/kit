import { issue_cite } from '#scripts/issue/issue-cite'
import { acceptance_map, type Criterion, type MapRows } from './acceptance-map'

// **A criterion is settled on the Issue, not only in the pull request body** (joshuafolkken/kit#9146):
// ticked, marked `→ #M` by `josh issue:defer`, or left to the merge (`POST_MERGE_PREFIX`). A deferral row
// alone left the Issue reading as unmet, and the issue it named was never asked whether it took the
// criterion over — so the merge also refuses a mark whose issue carries no reference to the criterion's
// identifier. Whether a tick is true is not checked here.

const REFERENCE_LABEL = '引き継ぎ:'

interface Resolution {
	open: ReadonlyArray<Criterion>
	dropped: ReadonlyArray<Criterion>
}

// Before the gate a met row's criterion is ticked later in the run, so only a deferral row asks for
// the Issue's mark there; at the merge every open criterion is refused.
function open_criteria(
	criteria: ReadonlyArray<Criterion>,
	rows: MapRows,
	is_draft: boolean,
): ReadonlyArray<Criterion> {
	const deferred = new Set(rows.deferrals.map((deferral) => deferral.id))

	return criteria.filter(
		(criterion) => criterion.is_open === true && (!is_draft || deferred.has(criterion.id)),
	)
}

function marked(criteria: ReadonlyArray<Criterion>): ReadonlyArray<Criterion> {
	return criteria.filter((criterion) => criterion.deferred_to !== undefined)
}

// The issue a criterion moved to takes it over by carrying its identifier — in the reference line
// `josh issue:defer` writes, or anywhere the rewritten criterion quotes it.
function carries(target_body: string | undefined, id: string): boolean {
	return target_body?.includes(id) === true
}

function reference_line(issue: string, id: string, reason: string): string {
	return `${REFERENCE_LABEL} ${issue_cite.plain_for('github', issue)} \`${id}\` ${reason}`
}

function is_clear(resolution: Resolution): boolean {
	return resolution.open.length === 0 && resolution.dropped.length === 0
}

function resolution_lines(issue: string, resolution: Resolution): ReadonlyArray<string> {
	const tick = `pnpm josh issue:tick ${issue} <ac-id>`
	const defer = `pnpm josh issue:defer ${issue} <ac-id> #<M> <reason>`

	return [
		...acceptance_map.listed(
			`Criteria neither ticked nor marked deferred on the Issue — a met one: \`${tick}\`; a moved one: \`${defer}\`:`,
			resolution.open.map((criterion) => `- \`${criterion.id}\` ${criterion.text}`),
		),
		...acceptance_map.listed(
			`Deferrals whose issue carries no reference to the criterion — re-run \`${defer}\`, which adds its \`${REFERENCE_LABEL}\` line:`,
			resolution.dropped.map(
				(criterion) => `- \`${criterion.id}\` → ${criterion.deferred_to ?? ''}`,
			),
		),
	]
}

const acceptance_map_defer = {
	carries,
	is_clear,
	marked,
	open_criteria,
	reference_line,
	resolution_lines,
}

export type { Resolution }
export { acceptance_map_defer }
