import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_repo } from '#scripts/gh/git-gh-repo'
import { git_closes_keyword } from '#scripts/git/git-closes-keyword'
import { parse_json_object_or_undefined } from '#scripts/git/parse-json-array'
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

const LINE_SEPARATOR = '\n'
// One compact JSON object per pull request that cross-references the issue, and a
// `{"reopened":true}` marker per reopen, in timeline order.
const TIMELINE_FILTER = [
	'.[]',
	'| if .event == "cross-referenced" and .source.issue.pull_request != null',
	'then {url: .source.issue.html_url, repo: .source.issue.repository.full_name, body: (.source.issue.body // ""), state: (if .source.issue.pull_request.merged_at != null then "merged" else .source.issue.state end)}',
	'elif .event == "reopened" then {reopened: true}',
	'else empty end',
].join(' ')

const reference_schema = z.object({
	url: z.string(),
	repo: z.string(),
	body: z.string(),
	state: z.enum(['open', 'closed', 'merged']).default('merged'),
})
const reopen_schema = z.object({ reopened: z.literal(true) })
const row_schema = z.union([reference_schema, reopen_schema])

type MergedReference = z.infer<typeof reference_schema>
type TimelineRow = z.infer<typeof row_schema>
type ClosingRead = { kind: 'read'; url: string | undefined } | { kind: 'unreadable' }
type ClosingNumberRead = { kind: 'read'; number: number | undefined } | { kind: 'unreadable' }

function is_reference(row: TimelineRow): row is MergedReference {
	return 'url' in row
}

function parse_row(line: string): TimelineRow {
	const row = parse_json_object_or_undefined(line, row_schema)
	if (row === undefined) throw new Error('the issue timeline contains an unreadable row')

	return row
}

function parse_references(raw: string): Array<MergedReference> {
	const rows = raw
		.split(LINE_SEPARATOR)
		.filter((line) => line.trim() !== '')
		.map((line) => parse_row(line))
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
			reference.state === 'merged' &&
			git_closes_keyword.parse_closes_issue_number(reference.body) === issue,
	)?.url
}

async function read_closing_result(issue: string): Promise<ClosingRead> {
	try {
		// The canonical name, not the remote as typed: the timeline names the repository GitHub's way
		// (joshuafolkken/kit#6752).
		const [raw, repo] = await Promise.all([
			git_gh_exec.exec_gh_api({
				path: `${git_gh_api_path.issue_api_path(issue)}/timeline?per_page=100`,
				should_paginate: true,
				jq_filter: TIMELINE_FILTER,
			}),
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
