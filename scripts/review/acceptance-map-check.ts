import { git_gh_command } from '#scripts/gh/git-gh-command'
import { session_cite } from '#scripts/issue/session-cite'
import {
	acceptance_map,
	type Criterion,
	type Deferral,
	type MapComparison,
	type MapRows,
} from './acceptance-map'
import { acceptance_map_defer, type Resolution } from './acceptance-map-defer'

// The reads behind `acceptance_map`: the Issue as it reads at the merge, the pull request body, and
// whether each issue a deferral row names exists. Kept apart so the comparison stays pure.

const ISSUE_SEPARATOR = '#'

interface BodyRefusalOptions {
	// A pending row counts as a row: the draft before the gate, not the body at the merge.
	pending_present?: boolean
}

// `owner/repo#12` reads that repository's issue; a bare `#12` reads this one's. Undefined when it
// cannot be read.
async function target_body(reference: string): Promise<string | undefined> {
	const [repo, number = ''] = reference.split(ISSUE_SEPARATOR)
	const read = await git_gh_command.issue_get_body_classified(
		number,
		repo === '' ? undefined : repo,
	)

	return read.kind === 'read' ? (read.text ?? '') : undefined
}

async function is_found(deferral: Deferral): Promise<boolean> {
	return (await target_body(deferral.issue)) !== undefined
}

async function dropped(criteria: ReadonlyArray<Criterion>): Promise<ReadonlyArray<Criterion>> {
	const marked = acceptance_map_defer.marked(criteria)
	const bodies = await Promise.all(
		marked.map(async (criterion) => await target_body(criterion.deferred_to ?? '')),
	)

	return marked.filter(
		(criterion, index) => !acceptance_map_defer.carries(bodies[index], criterion.id),
	)
}

async function absent_deferrals(
	deferrals: ReadonlyArray<Deferral>,
): Promise<ReadonlyArray<string>> {
	const found = await Promise.all(deferrals.map(async (deferral) => await is_found(deferral)))

	return deferrals
		.filter((_deferral, index) => found[index] !== true)
		.map((deferral) => `- \`${deferral.id}\` names ${deferral.issue}`)
}

function rows_asked(pr_body: string | undefined, options: BodyRefusalOptions): MapRows {
	if (options.pending_present === true) return acceptance_map.with_pending(pr_body)

	return acceptance_map.rows_of(pr_body)
}

function is_accounted(
	comparison: MapComparison,
	absent: ReadonlyArray<string>,
	resolution: Resolution,
): boolean {
	return (
		comparison.missing.length === 0 &&
		absent.length === 0 &&
		acceptance_map_defer.is_clear(resolution)
	)
}

function unreadable_message(issue: string): string {
	return `Issue ${session_cite.issue(issue)} could not be re-read to check its acceptance criteria, so the merge is refused; re-run once it can be.`
}

// **An Issue that cannot be re-read is a refusal, not a pass** — the criteria it would have named are
// exactly what this gate exists to see. An Issue with no acceptance section merges as before.
// `josh ship`'s preflight asks the body it is about to deliver, so a missing table stops it before the
// review rather than at the merge; `acceptance:check` asks the draft with `pending_present`, so a row
// still pending passes there and only a criterion with no row stops it (joshuafolkken/kit#7727).
async function body_refusal(
	issue: string,
	pr_body: string | undefined,
	options: BodyRefusalOptions = {},
): Promise<string | undefined> {
	const issue_read = await git_gh_command.issue_get_body_classified(issue)

	if (issue_read.kind !== 'read') return unreadable_message(issue)
	const criteria = acceptance_map.criteria_of(issue_read.text)
	const rows = rows_asked(pr_body, options)
	const comparison = acceptance_map.compare(criteria, rows)
	const absent = await absent_deferrals(comparison.deferrals)
	const resolution = {
		open: acceptance_map_defer.open_criteria(criteria, rows, options.pending_present === true),
		dropped: await dropped(criteria),
	}

	if (is_accounted(comparison, absent, resolution)) return undefined

	return acceptance_map.refusal_message(
		issue,
		comparison,
		absent,
		acceptance_map_defer.resolution_lines(issue, resolution),
	)
}

async function refusal(issue: string, branch_name: string): Promise<string | undefined> {
	return await body_refusal(issue, await git_gh_command.pr_get_body(branch_name))
}

const acceptance_map_check = { body_refusal, refusal }

export { acceptance_map_check }
