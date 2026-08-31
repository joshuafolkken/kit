import { z } from 'zod'
import { MERGED_STATE, to_gh_state } from './git-gh-rest-state'
import { parse_json_array_or_undefined, parse_json_object_safe } from './parse-json-array'
import { blocking_issue_schema } from './schemas'

// The translation between one REST issue (`repos/{owner}/{repo}/issues/{N}`) and the JSON shape
// `gh issue view --json <fields>` used to answer with.
//
// `gh issue view` goes through GraphQL, which a cloud session is answered 403 for while the REST
// endpoint is served normally (joshuafolkken/kit#1022). The reads in `git-gh-issue-read.ts` are what
// every epic command goes through, so they move to REST — and every caller downstream keeps reading
// the field names it already reads. The mapping lives here rather than beside the requests because
// it is pure: given the two responses, it decides the answer with nothing else to know
// (joshuafolkken/kit#1024).

// Only the fields the mapping itself reads are named; every other key passes through untouched,
// which is what lets a caller ask for a field this file has never heard of.
//
// `number` is required so that a 200 carrying something other than an issue — a proxy's HTML error
// page, an API message object — fails the parse rather than passing as an issue whose every field is
// missing. `git-epic-close` would turn that into `is_closed: false` for every child and report it as
// fact. The dependency summary is absent on a pull request, which the issue endpoint serves as
// readily as an issue, so it stays optional and tolerates an explicit null.
const rest_issue_schema = z.looseObject({
	number: z.number(),
	issue_dependencies_summary: z.looseObject({ total_blocked_by: z.number().optional() }).nullish(),
	// Present only on a pull request, which this endpoint serves as readily as an issue.
	pull_request: z.looseObject({ merged_at: z.string().nullish() }).nullish(),
})

type RestIssue = z.infer<typeof rest_issue_schema>
type BlockingIssue = z.infer<typeof blocking_issue_schema>

// The `blockedBy` connection as `gh` reported it: `nodes` is a page, `totalCount` is exact.
interface BlockedBy {
	nodes: Array<BlockingIssue>
	totalCount: number
}

// `https://api.github.com/repos/<owner>/<repo>` — the only shape REST writes, matched at the end so
// a host or an api prefix that changes does not break the read.
const REPOSITORY_URL = /\/repos\/([\w.-]+\/[\w.-]+)$/u
const REPOSITORY_URL_GROUP = 1

const BLOCKED_BY_FIELD = 'blockedBy'
const STATE_FIELD = 'state'
const BODY_FIELD = 'body'
const FIELD_SEPARATOR = ','
const EMPTY_BODY = ''

// The two field names REST and `gh --json` disagree on. `url` is the one that bites: REST's `url` is
// the API endpoint, while `gh` answers the browser URL — and `epic_issue.is_pull_request` decides
// from `/pull/` appearing in it, which the API endpoint never carries.
//
// A Map rather than an object literal so a camelCase key needs no naming-convention exemption.
const REST_FIELD_NAMES = new Map<string, string>([
	['url', 'html_url'],
	['createdAt', 'created_at'],
])

const NOT_AN_ISSUE_MESSAGE = 'gh api answered something other than an issue object'
const NOT_AN_ISSUE_LISTING_MESSAGE = 'gh api answered something other than an issue listing'
const NOT_A_BLOCKER_LISTING_MESSAGE = 'gh api answered something other than a blocked-by listing'

function rest_field_name(field: string): string {
	return REST_FIELD_NAMES.get(field) ?? field
}

// `number,state,labels,blockedBy` — the argument every caller already passes, unchanged so that the
// call sites keep naming the fields `gh` named.
function split_fields(fields: string): Array<string> {
	return fields
		.split(FIELD_SEPARATOR)
		.map((field) => field.trim())
		.filter((field) => field.length > 0)
}

// `gh issue view` served a pull request as readily as an issue, and reported a merged one as
// `MERGED`. REST answers `closed`, and the difference is not cosmetic: `epic_issue.normalize_state`
// maps everything that is not `CLOSED` to `OPEN`, so `MERGED` is what keeps a pull request pasted
// into an epic's task list from letting the auto-close run, and what keeps `epic:audit`'s
// "both closed" check on its loud side. Mapping it to `CLOSED` would flip both guards in silence.
function to_issue_state(rest: RestIssue, value: unknown): unknown {
	if (typeof rest.pull_request?.merged_at === 'string') return MERGED_STATE

	return typeof value === 'string' ? to_gh_state(value) : value
}

function to_gh_field_value(field: string, rest: RestIssue): unknown {
	const value = rest[rest_field_name(field)]

	if (field === STATE_FIELD) return to_issue_state(rest, value)

	// REST answers JSON null for an issue with no body, where `gh --json body` answers an empty
	// string — and `issue_get_body` hands its result straight to callers that expect text.
	return field === BODY_FIELD ? (value ?? EMPTY_BODY) : value
}

// A response that is not an issue object throws rather than degrading to an empty read: the callers
// catch it into `undefined`, which is the same "the read failed" every other failure produces, while
// a partial object would be reported as an issue whose fields are all missing.
function parse_rest_issue(rest_json: string): RestIssue {
	const parsed = parse_json_object_safe(rest_json, rest_issue_schema)
	if (parsed === undefined) throw new Error(NOT_AN_ISSUE_MESSAGE)

	return parsed
}

// `repos/{owner}/{repo}/issues` serves pull requests alongside issues; `gh issue list` never did,
// and its six callers all read the answer as issues. The key is present on a pull request and
// absent on an issue, which is the same signal `to_issue_state` already reads
// (joshuafolkken/kit#1025).
function is_pull_request(rest: RestIssue): boolean {
	return rest.pull_request !== undefined && rest.pull_request !== null
}

// One page of the listing endpoint, whose elements are the same objects `parse_rest_issue` reads one
// of. It throws for the reason that one does: a response that is not a listing — `gh` answering
// `{"message":"API rate limit exceeded"}` — must not degrade into an empty listing, which every
// caller here reads as "there is nothing" (joshuafolkken/kit#950).
function parse_rest_issues(rest_json: string): Array<RestIssue> {
	const parsed = parse_json_array_or_undefined(rest_json, rest_issue_schema)
	if (parsed === undefined) throw new Error(NOT_AN_ISSUE_LISTING_MESSAGE)

	return parsed
}

// The exact blocker count GitHub reports on the issue itself. `nodes` is one page, so this is what
// keeps `totalCount` meaning what it meant under GraphQL rather than collapsing to the page size.
function total_blocked_by(rest: RestIssue): number | undefined {
	return rest.issue_dependencies_summary?.total_blocked_by
}

// The connection for an issue GitHub itself says has no blockers, answered without a request. `gh`
// sent `blockedBy` inside the issue response, so a second request per issue would double
// `epic:bundle`'s pass over the whole open backlog — and the issue's own summary settles the common
// case, which is an issue with no blockers at all (joshuafolkken/kit#1024).
function empty_blocked_by(): BlockedBy {
	return { nodes: [], totalCount: 0 }
}

// The `owner/repo` a REST `repository_url` names — `https://api.github.com/repos/<owner>/<repo>`.
//
// A blocker relation may cross a repository, and the number alone cannot say which one it is: issue
// numbers are unique per repository, so a blocker read bare resolves against the blocked child's own
// repository and names a different issue there (joshuafolkken/kit#1126). Undefined when the field is
// absent or shaped otherwise; the caller then falls back to the repository it is reading in, which is
// what an unqualified relation has always meant.
function repo_of_url(repository_url: string | undefined): string | undefined {
	const match = REPOSITORY_URL.exec(repository_url ?? '')

	return match?.[REPOSITORY_URL_GROUP]
}

// `repos/{owner}/{repo}/issues/{N}/dependencies/blocked_by` answers a bare array of issues, which is
// mapped into the connection `blocked_by_schema` expects.
//
// A listing that will not parse throws instead of answering an empty connection. That direction is
// the point: an empty `nodes` reads as "this child has no blockers", and `epic:next` would then hand
// a dependent to an unattended run before its prerequisite (joshuafolkken/kit#1005).
function to_blocked_by(blockers_json: string, exact_total?: number): BlockedBy {
	const parsed = parse_json_array_or_undefined(blockers_json, blocking_issue_schema)
	if (parsed === undefined) throw new Error(NOT_A_BLOCKER_LISTING_MESSAGE)

	const nodes = parsed.map((blocker) => ({ ...blocker, state: to_gh_state(blocker.state) }))

	return { nodes, totalCount: exact_total ?? nodes.length }
}

// The requested fields, under the names `gh` gave them. A field REST does not carry is left out
// rather than filled in, exactly as an unknown `--json` field produced nothing before.
function to_gh_issue(
	rest: RestIssue,
	fields: ReadonlyArray<string>,
	blocked_by?: BlockedBy,
): Record<string, unknown> {
	return Object.fromEntries(
		fields.map((field) => [
			field,
			field === BLOCKED_BY_FIELD ? blocked_by : to_gh_field_value(field, rest),
		]),
	)
}

// One field as `--jq .<field>` printed it: a string bare, anything else as JSON, an absent value as
// the empty answer that already meant "there is nothing to show".
function to_field_text(value: unknown): string {
	if (typeof value === 'string') return value

	return value === undefined || value === null ? EMPTY_BODY : JSON.stringify(value)
}

const git_gh_issue_rest = {
	empty_blocked_by,
	repo_of_url,
	split_fields,
	is_pull_request,
	parse_rest_issue,
	parse_rest_issues,
	total_blocked_by,
	to_blocked_by,
	to_gh_issue,
	to_field_text,
}

export type { BlockedBy, RestIssue }
export { git_gh_issue_rest, BLOCKED_BY_FIELD }
