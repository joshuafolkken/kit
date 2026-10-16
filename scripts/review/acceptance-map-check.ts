import { git_gh_command } from '#scripts/gh/git-gh-command'
import { session_cite } from '#scripts/issue/session-cite'
import { acceptance_map, type Deferral } from './acceptance-map'

// The reads behind `acceptance_map`: the Issue as it reads at the merge, the pull request body, and
// whether each issue a deferral row names exists. Kept apart so the comparison stays pure.

const ISSUE_SEPARATOR = '#'

// `owner/repo#12` reads that repository's issue; a bare `#12` reads this one's.
async function is_found(deferral: Deferral): Promise<boolean> {
	const [repo, number = ''] = deferral.issue.split(ISSUE_SEPARATOR)
	const read = await git_gh_command.issue_get_body_classified(
		number,
		repo === '' ? undefined : repo,
	)

	return read.kind === 'read'
}

async function absent_deferrals(
	deferrals: ReadonlyArray<Deferral>,
): Promise<ReadonlyArray<string>> {
	const found = await Promise.all(deferrals.map(async (deferral) => await is_found(deferral)))

	return deferrals
		.filter((_deferral, index) => found[index] !== true)
		.map((deferral) => `- \`${deferral.id}\` names ${deferral.issue}`)
}

function unreadable_message(issue: string): string {
	return `Issue ${session_cite.issue(issue)} could not be re-read to check its acceptance criteria, so the merge is refused; re-run once it can be.`
}

// **An Issue that cannot be re-read is a refusal, not a pass** — the criteria it would have named are
// exactly what this gate exists to see. An Issue with no acceptance section merges as before.
// `josh ship`'s preflight asks the body it is about to deliver, so a missing table stops it before the
// review rather than at the merge.
async function body_refusal(
	issue: string,
	pr_body: string | undefined,
): Promise<string | undefined> {
	const issue_read = await git_gh_command.issue_get_body_classified(issue)

	if (issue_read.kind !== 'read') return unreadable_message(issue)
	const criteria = acceptance_map.criteria_of(issue_read.text)
	const comparison = acceptance_map.compare(criteria, acceptance_map.rows_of(pr_body))
	const absent = await absent_deferrals(comparison.deferrals)

	if (comparison.missing.length === 0 && absent.length === 0) return undefined

	return acceptance_map.refusal_message(issue, comparison, absent)
}

async function refusal(issue: string, branch_name: string): Promise<string | undefined> {
	return await body_refusal(issue, await git_gh_command.pr_get_body(branch_name))
}

const acceptance_map_check = { body_refusal, refusal }

export { acceptance_map_check }
