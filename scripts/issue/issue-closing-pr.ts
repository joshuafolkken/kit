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
// One compact JSON object per merged pull request that cross-references the issue, and a
// `{"reopened":true}` marker per reopen, in timeline order.
const TIMELINE_FILTER = [
	'.[]',
	'| if .event == "cross-referenced" and .source.issue.pull_request.merged_at != null',
	'then {url: .source.issue.html_url, repo: .source.issue.repository.full_name, body: (.source.issue.body // "")}',
	'elif .event == "reopened" then {reopened: true}',
	'else empty end',
].join(' ')

const reference_schema = z.object({ url: z.string(), repo: z.string(), body: z.string() })
const reopen_schema = z.object({ reopened: z.literal(true) })
const row_schema = z.union([reference_schema, reopen_schema])

type MergedReference = z.infer<typeof reference_schema>
type TimelineRow = z.infer<typeof row_schema>

function is_reference(row: TimelineRow): row is MergedReference {
	return 'url' in row
}

function parse_references(raw: string): Array<MergedReference> {
	const rows = raw
		.split(LINE_SEPARATOR)
		.map((line) => parse_json_object_or_undefined(line, row_schema))
		.filter((row) => row !== undefined)
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

// Every doubt falls to `undefined` — an unreadable timeline or repository name leaves the child
// judged as it was, never closed on a guess.
async function read_closing_pr(issue: string): Promise<string | undefined> {
	try {
		const [raw, repo] = await Promise.all([
			git_gh_exec.exec_gh_api({
				path: `${git_gh_api_path.issue_api_path(issue)}/timeline?per_page=100`,
				should_paginate: true,
				jq_filter: TIMELINE_FILTER,
			}),
			git_gh_repo.repo_get_name_with_owner(),
		])

		if (repo === undefined) return undefined

		return pick_closing_pr(parse_references(raw), issue, repo)
	} catch {
		return undefined
	}
}

const issue_closing_pr = { read_closing_pr }

export { issue_closing_pr }
