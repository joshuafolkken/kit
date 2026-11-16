import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_etag_read } from '#scripts/gh/git-gh-etag-read'
import { git_gh_repo } from '#scripts/gh/git-gh-repo'
import { git_closes_keyword } from '#scripts/git/git-closes-keyword'
import { read_json_listing } from '#scripts/git/parse-json-array'
import { z } from 'zod'

// **The merged pull request that closes an issue GitHub left open**. A
// `backlogrun` child whose pull request merged while GitHub did not apply its `closes #N`
// came back OPEN, and `run:merge` counted it a failure and parked it — the
// work had landed, only the issue's close had not.
//
// **A merged reference is not enough; the body must close this issue.** A merged pull request that
// merely mentions the issue — a follow-up, a sibling in the same epic — cross-references it too, and
// closing on that would close unfinished work. So the pull request counts only when its body's
// `closes #N` names this issue, read through the one parser every `closes #N` reader shares.
//
// **Only references after the last reopen count.** A reopened issue whose earlier attempt merged
// still carries that pull request's reference, and reading it would close the reopened work — the
// same reason `issue-merged.ts` reads the last closed/reopened event.
//
// **Only a pull request in this repository counts.** A bare `closes #N` names an issue in the pull
// request's own repository, so a merged pull request elsewhere whose `closes #N` carries the same
// number closes a different issue — its cross-reference here is a mention, not a close.
//
// **The first page goes through the ETag layer** (joshuafolkken/kit#7619), so a sweep re-reading an
// unchanged timeline costs no rate limit; a full first page is read whole with `--paginate`, and both
// answers are the same JSON array, parsed here rather than by a jq filter.

const CROSS_REFERENCED_EVENT = 'cross-referenced'
const REOPENED_EVENT = 'reopened'

// The fields of one timeline event this reader needs; GitHub's other fields are dropped.
const source_issue_schema = z.object({
	html_url: z.string(),
	repository: z.object({ full_name: z.string() }),
	body: z
		.string()
		.nullish()
		.transform((body) => body ?? ''),
	pull_request: z.object({ merged_at: z.string().nullish() }).nullish(),
})
const event_schema = z.object({
	event: z.string().default(''),
	source: z.object({ issue: source_issue_schema.optional() }).optional(),
})

type TimelineEvent = z.infer<typeof event_schema>
type SourceIssue = z.infer<typeof source_issue_schema>

interface MergedReference {
	url: string
	repo: string
	body: string
}

type TimelineRow = MergedReference | { reopened: true }
type ClosingRead = { kind: 'read'; url: string | undefined } | { kind: 'unreadable' }
type ClosingNumberRead = { kind: 'read'; number: number | undefined } | { kind: 'unreadable' }

function is_reference(row: TimelineRow): row is MergedReference {
	return 'url' in row
}

// Only a merged pull request can close the issue; an open or closed one is no reference here.
function merged_reference_of(issue: SourceIssue | undefined): Array<TimelineRow> {
	if (typeof issue?.pull_request?.merged_at !== 'string') return []

	return [{ url: issue.html_url, repo: issue.repository.full_name, body: issue.body }]
}

// A merged pull request that cross-references the issue, or a reopen marker; every other event is
// dropped.
function row_of(entry: TimelineEvent): Array<TimelineRow> {
	if (entry.event === REOPENED_EVENT) return [{ reopened: true }]

	return entry.event === CROSS_REFERENCED_EVENT ? merged_reference_of(entry.source?.issue) : []
}

function parse_references(raw: string): Array<MergedReference> {
	const page = read_json_listing(raw, event_schema)
	if (page.kind !== 'read') throw new Error('the issue timeline is unreadable')
	const rows = page.rows.flatMap((entry) => row_of(entry))
	const last_reopen = rows.findLastIndex((row) => !is_reference(row))

	return rows.slice(last_reopen + 1).filter((row) => is_reference(row))
}

function pick_closing_pr(
	references: ReadonlyArray<MergedReference>,
	issue: string,
	repo: string,
): string | undefined {
	return references.find(
		(reference) =>
			reference.repo === repo &&
			git_closes_keyword.parse_closes_issue_number(reference.body) === issue,
	)?.url
}

async function read_closing_result(issue: string): Promise<ClosingRead> {
	try {
		// The canonical name, not the remote as typed: the timeline names the repository GitHub's way
		// (joshuafolkken/kit#6752).
		const [raw, repo] = await Promise.all([
			git_gh_etag_read.read_listing(
				`${git_gh_api_path.issue_api_path(issue)}/timeline${git_gh_api_path.FULL_PAGE_QUERY}`,
				git_gh_api_path.FULL_PAGE_SIZE,
			),
			git_gh_repo.repo_get_canonical_name_with_owner(),
		])

		if (repo === undefined) return { kind: 'unreadable' }

		return { kind: 'read', url: pick_closing_pr(parse_references(raw), issue, repo) }
	} catch {
		return { kind: 'unreadable' }
	}
}

// Legacy callers leave the child unchanged when discovery is unavailable.
async function read_closing_pr(issue: string): Promise<string | undefined> {
	const result = await read_closing_result(issue)

	return result.kind === 'read' ? result.url : undefined
}

async function read_closing_number_result(issue: number): Promise<ClosingNumberRead> {
	const result = await read_closing_result(String(issue))
	if (result.kind === 'unreadable') return result
	const number =
		result.url === undefined ? undefined : Number(result.url.slice(result.url.lastIndexOf('/') + 1))

	return { kind: 'read', number }
}

// The closing pull request's number, read off the URL `read_closing_pr` answers.
async function read_closing_number(issue: number): Promise<number | undefined> {
	const result = await read_closing_number_result(issue)

	return result.kind === 'read' ? result.number : undefined
}

const issue_closing_pr = {
	read_closing_number,
	read_closing_number_result,
	read_closing_pr,
}

export { issue_closing_pr }
