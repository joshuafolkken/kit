import { git_gh_api_path } from './git-gh-api-path'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_helpers } from './git-gh-helpers'
import {
	BLOCKED_BY_FIELD,
	git_gh_issue_rest,
	type BlockedBy,
	type RestIssue,
} from './git-gh-issue-rest'

// Reading one issue. Split out of `git-gh-issue.ts`, which had grown past the file-length limit
// while holding both the reads and the writes; the reads are what every epic command goes through,
// and telling a number that resolves to nothing from a read that failed belongs with them
// (joshuafolkken/kit#957).

// The blocker relations, which REST serves from their own endpoint rather than inside the issue.
// `gh issue view --json blockedBy` answered them in the same response because GraphQL selects them
// as a connection; REST needs a second request (joshuafolkken/kit#1024).
//
// One page of a hundred — `FULL_PAGE_QUERY`, the same one every other listing here asks for — where
// GraphQL asked for `blockedBy(first:50)`, so `nodes` is at least as complete as it was, while
// `totalCount` comes from the issue's own dependency summary and stays exact whatever the page
// holds. The endpoint itself is named in `git-gh-api-path.ts`, which the two writes address as well
// (joshuafolkken/kit#1026).
//
// The request is skipped when the issue's own summary says the count is zero, which is the common
// case and the one that matters for cost: `epic:bundle` reads relations for the whole open backlog,
// up to two hundred issues, and every one of those reads names `blockedBy`. Without the skip the
// pass would be four hundred requests where `gh` made two hundred.
//
// A pull request is skipped ahead of that, structurally rather than on a count. It carries no
// `issue_dependencies_summary` at all, and an absent summary is deliberately not read as a zero — so
// the numeric skip cannot fire for one, and the endpoint was asked every time. GitHub answers an
// empty array today, but a 404 there would fail the whole read and `epic:bundle` would report the
// reference as `unreadable` **before** the `/pull/` check that drops it (joshuafolkken/kit#947) ever
// ran. The guard rested on API behavior nobody controls; this makes it a fact about pull requests
// (joshuafolkken/kit#1066).
//
// Exported because the *listings* need exactly this, and for exactly this reason: a listing response
// carries every row's `issue_dependencies_summary` but no `blockedBy`, so the pickup that asks for
// the field pays one request per row that declares a blocker and nothing for the rest. A second copy
// beside the listing requests is the clone `CLAUDE.md` prohibits (joshuafolkken/kit#1025).
async function read_blocked_by(
	issue_number: string,
	rest: RestIssue,
	repo?: string,
): Promise<BlockedBy> {
	if (git_gh_issue_rest.is_pull_request(rest)) return git_gh_issue_rest.empty_blocked_by()

	const exact_total = git_gh_issue_rest.total_blocked_by(rest)
	if (exact_total === 0) return git_gh_issue_rest.empty_blocked_by()

	const json = await git_gh_exec.exec_gh_api({
		path: `${git_gh_api_path.blocked_by_api_path(issue_number, repo)}${git_gh_api_path.FULL_PAGE_QUERY}`,
	})

	return git_gh_issue_rest.to_blocked_by(json, exact_total)
}

// One issue through REST, answered in the field names `gh issue view --json` used. Every read below
// goes through it, so the request, the field mapping and the blocker relations are decided once
// (joshuafolkken/kit#1024).
//
// The blocker request is made **only** when `blockedBy` was asked for — the title, body and
// labels-and-body reads never name it — and, when it was, only when the issue itself reports a
// blocker to fetch. Both guards are about the same cost: relations are read per issue across the
// whole open backlog, so an unconditional second request would double that pass.
async function read_issue_fields(
	issue_number: string,
	fields: string,
	repo?: string,
): Promise<Record<string, unknown>> {
	const rest = git_gh_issue_rest.parse_rest_issue(
		await git_gh_exec.exec_gh_api({ path: git_gh_api_path.issue_api_path(issue_number, repo) }),
	)
	const requested = git_gh_issue_rest.split_fields(fields)
	const blocked_by = requested.includes(BLOCKED_BY_FIELD)
		? await read_blocked_by(issue_number, rest, repo)
		: undefined

	return git_gh_issue_rest.to_gh_issue(rest, requested, blocked_by)
}

// One field of one issue, unwrapped so the caller gets the value rather than an object.
async function issue_view_field(
	issue_number: string,
	field: string,
	repo?: string,
): Promise<string | undefined> {
	try {
		const issue = await read_issue_fields(issue_number, field, repo)

		return git_gh_issue_rest.to_field_text(issue[field])
	} catch {
		return undefined
	}
}

// An extracted string arrives raw — nothing quotes it — and an empty answer is not a title
// (joshuafolkken/kit#993).
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

// A JSON view of one issue, for every caller that wants several fields at once. Callers differ only
// in which fields they ask for, and a helper per field list is how four near-identical functions
// accumulated (joshuafolkken/kit#862).
//
// The field list is still spelled the way `gh issue view --json` spelled it, and so is the answer:
// the translation to and from REST is `git-gh-issue-rest.ts`, so no caller downstream changed.
async function issue_view_json(
	issue_number: string,
	fields: string,
	repo?: string,
): Promise<string | undefined> {
	try {
		return JSON.stringify(await read_issue_fields(issue_number, fields, repo))
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
// The read itself is REST now, but `exec_gh_api` surfaces a failure as gh's stderr text — the status
// code is not on the Error — and classifying by that wording is exactly what the status probe exists
// to avoid: a message is prose that can be reworded between releases. So the probe stays, and the
// three branches come out on the conditions they came out on before (joshuafolkken/kit#1024). What
// did change is that both requests now go through the same transport, so the probe can no longer
// disagree with the read about which API answered.
//
// The probe costs one extra request. It is spent **only** on the failure path, and only
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

// The conversation comments of one issue, as REST serves them. `undefined` — never `'[]'` — when the
// listing could not be read: the one caller has to tell "this epic carries no closing comment" from
// "nobody looked", because posting on the second answer is the duplicate it exists to prevent
// (joshuafolkken/kit#1039).
//
// Paged, and for the same reason `pr_get_comments` is: REST answers 30 rows and an epic's
// conversation outgrows that, while the comment being looked for is the **newest** one — so an
// unpaged read would miss exactly the comment it is asking about. The endpoint answers a bare array,
// which `--paginate` merges into one array, so nothing is slurped (`git-gh-exec.ts`).
//
// Deliberately not routed through `git-gh-pr-read.ts`'s `read_comments`, near-identical though the
// request is: that one is keyed by **branch name** and exists to bridge gh's branch argument to
// REST's number, and it maps the rows into the `gh --json` spelling its own callers read. This one
// is already keyed by a number and wants the rows as served. What the two genuinely share — the path
// and the page size — is single-sourced in `git-gh-api-path.ts` and read from there by both.
//
// No `repo` parameter, unlike the reads above: the auto-close lists its candidate epics from the
// repository it runs in, so the epic whose comments are read is always a local one. The path builder
// takes one when a caller that needs it appears.
async function issue_list_comments(issue_number: string): Promise<string | undefined> {
	const path = `${git_gh_api_path.issue_comments_api_path(issue_number)}${git_gh_api_path.FULL_PAGE_QUERY}`

	try {
		return await git_gh_exec.exec_gh_api({ path, should_paginate: true })
	} catch {
		return undefined
	}
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
	issue_list_comments,
}

export type { IssueRead }
export { git_gh_issue_read, read_blocked_by, NOT_FOUND_STATUS }
