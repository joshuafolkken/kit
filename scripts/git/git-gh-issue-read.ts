import { git_gh_api_path } from './git-gh-api-path'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_helpers } from './git-gh-helpers'

// Reading one issue. Split out of `git-gh-issue.ts`, which had grown past the file-length limit
// while holding both the reads and the writes; the reads are what every epic command goes through,
// and telling a number that resolves to nothing from a read that failed belongs with them
// (joshuafolkken/kit#957).

// `repo` reads an issue in another repository — the form a cross-repository epic is referenced in
// (joshuafolkken/kit#864). Without it a qualified reference would read *this* repository's issue of
// that number, a different issue entirely.
//
// Exported because a *listing* needs the same two arguments: `epic:next`'s repository-level busy
// check asks one named repository for its `in-progress` issues (joshuafolkken/kit#925). One
// definition rather than a second spelling of `['--repo', repo]` in `git-gh-issue.ts`.
function repo_scope(repo?: string): Array<string> {
	return repo === undefined ? [] : ['--repo', repo]
}

// One field of one issue, unwrapped by `--jq` so the caller gets the value rather than an object.
async function issue_view_field(
	issue_number: string,
	field: string,
	repo?: string,
): Promise<string | undefined> {
	try {
		return await git_gh_exec.exec_gh_command([
			'issue',
			'view',
			issue_number,
			...repo_scope(repo),
			'--json',
			field,
			'--jq',
			`.${field}`,
		])
	} catch {
		return undefined
	}
}

// A `--jq`-extracted string arrives raw — `gh` does not quote it — and an empty answer is not a
// title (joshuafolkken/kit#993).
//
// `repo` reads the title of an issue in another repository — what `josh notify` needs when the
// `--issue-url` it was given points outside the repository the session runs in
// (joshuafolkken/kit#903).
async function issue_get_title(issue_number: string, repo?: string): Promise<string | undefined> {
	const result = await issue_view_field(issue_number, 'title', repo)

	return result === undefined ? undefined : git_gh_helpers.parse_pr_state_string(result)
}

async function issue_get_body(issue_number: string, repo?: string): Promise<string | undefined> {
	return await issue_view_field(issue_number, 'body', repo)
}

// One `gh issue view --json <fields>`, for every caller that wants a JSON view of one issue. Callers
// differ only in which fields they ask for, and a helper per field list is how four near-identical
// functions accumulated (joshuafolkken/kit#862).
async function issue_view_json(
	issue_number: string,
	fields: string,
	repo?: string,
): Promise<string | undefined> {
	try {
		return await git_gh_exec.exec_gh_command([
			'issue',
			'view',
			issue_number,
			...repo_scope(repo),
			'--json',
			fields,
		])
	} catch {
		return undefined
	}
}

// Why a read produced no issue. `missing` is GitHub resolving the number to nothing — a typo, or
// another repository's number quoted in prose — which is an answer rather than a gap. `unreadable`
// is a gap: a rate limit, expired auth, a dropped connection. Folding the two together had one
// non-existent number reported as something the command had failed to read, which stops an
// unattended run for a reference that never existed (joshuafolkken/kit#957).
type IssueRead = { kind: 'read'; json: string } | { kind: 'missing' } | { kind: 'unreadable' }

// 404 is the number resolving to nothing. Every other status — 403 and 429 for a rate limit, 5xx,
// or no status at all — is a read that failed over something the number is not responsible for.
//
// GitHub also answers 404 rather than 403 for an issue the token may not see, so that it does not
// leak the issue's existence — the two are indistinguishable by design, and no reading of the status
// could separate them. It does not reach the caller this exists for: `epic:bundle` probes the
// repository whose open issues it has just listed, so a number it cannot see there is one that is
// not there.
const NOT_FOUND_STATUS = 404

// The same view as `issue_view_json`, plus why it produced nothing when it did.
//
// `gh issue view` goes through GraphQL, which reports a failure as prose and carries no status code,
// so the classification costs one REST request. It is spent **only** on the failure path, and only
// by callers that need the distinction — which is why it is a separate function rather than a change
// to `issue_view_json`. That matters most for the caller that does *not* opt in: `epic:bundle` reads
// relations for the whole open backlog, up to two hundred issues, and a rate limit that failed all
// of them would spend two hundred more requests finding out why. The classified path is bounded by
// `REFERENCED_LOOKUP_LIMIT` instead, so a rate limit costs it at most twenty extra probes.
async function issue_view_json_classified(
	issue_number: string,
	fields: string,
	repo?: string,
): Promise<IssueRead> {
	const json = await issue_view_json(issue_number, fields, repo)

	if (json !== undefined) return { kind: 'read', json }

	const status = await git_gh_exec.exec_gh_api_status(
		git_gh_api_path.issue_api_path(issue_number, repo),
	)

	return status === NOT_FOUND_STATUS ? { kind: 'missing' } : { kind: 'unreadable' }
}

// State, labels and dependency relations in one read: the epic auto-close needs state and relations
// per child, `epic:next` needs the labels too, and splitting them would multiply the API calls for
// no gain (joshuafolkken/kit#860).
//
// `repo` reads a child in another repository. Cross-repository children are read this way rather
// than from a local checkout: their state is a GitHub fact, and requiring a clone to learn it is
// what kept the auto-close from ever running on such an epic (joshuafolkken/kit#864).
async function issue_get_state_and_relations(
	issue_number: string,
	repo?: string,
): Promise<string | undefined> {
	return await issue_view_json(issue_number, 'number,state,labels,blockedBy', repo)
}

// Everything `epic:plan` puts in front of the batch decision. Read separately from the poll above
// because it carries the bodies, which a `wait` poll never looks at.
//
// `epic:bundle` reads a referenced issue through the same call rather than adding a helper for its
// own field list — it needs the body and the state, which is a subset of this one, and a helper per
// field list is exactly how the four near-identical functions above accumulated
// (joshuafolkken/kit#947).
const PLAN_FIELDS = 'number,title,body,state,url,labels,blockedBy'

async function issue_get_plan_fields(issue_number: string): Promise<string | undefined> {
	return await issue_view_json(issue_number, PLAN_FIELDS)
}

// The same fields, with a failed read told apart from a number that resolves to nothing.
// `epic:bundle` reads a reference this way because the two answers belong in different places: a
// missing number is neither a candidate nor a gap, while an unreadable one is reported so a verdict
// is never quietly based on data that never arrived (joshuafolkken/kit#957).
async function issue_get_plan_fields_classified(issue_number: string): Promise<IssueRead> {
	return await issue_view_json_classified(issue_number, PLAN_FIELDS)
}

async function issue_get_labels_and_body(issue_number: string): Promise<string | undefined> {
	return await issue_view_json(issue_number, 'number,labels,body')
}

const git_gh_issue_read = {
	issue_get_title,
	issue_get_body,
	issue_view_json,
	issue_view_json_classified,
	issue_get_state_and_relations,
	issue_get_plan_fields,
	issue_get_plan_fields_classified,
	issue_get_labels_and_body,
}

export type { IssueRead }
export { git_gh_issue_read, NOT_FOUND_STATUS, repo_scope }
