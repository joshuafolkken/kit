import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import type { IssueComment } from '#scripts/issue/issue-read'
import { lane_registry } from '#scripts/lane/lane-registry'
import { atomic_write } from '#scripts/lib/atomic-write'
import { JOSH_TMP_DIRECTORY } from '#scripts/lib/josh-temporary-directory'
import { file_reader } from '#scripts/lib/read-file'
import type { ApprovalRange } from '#scripts/run/park/run-park-body'

// The size approval `backlog:triage --adopt` grants when the option it takes carries a range
// (joshuafolkken/kit#6776): a trusted approval comment on the child, then the `--size-approval` json
// `lane-plan-approval.ts` reads — both axes (joshuafolkken/kit#6657), that comment's URL as `source` —
// in the main checkout's `.josh/tmp/`, where the requeued child's `run:step` finds it by name.
//
// A trusted comment already stating the same range is reused, so a re-run writes no second one.

const HEADING = '## 規模承認（backlog:triage --adopt）'
const JSON_INDENT = '\t'

interface ApprovalGrant {
	issue: string
	reason: string
	range: ApprovalRange
	comments: ReadonlyArray<IssueComment>
}

async function file_of(issue: string): Promise<string> {
	const root = await lane_registry.main_repository_root()

	return path.join(root, JOSH_TMP_DIRECTORY, `size-approval-${issue}.json`)
}

// The json path when the parent wrote one for `issue`, else `undefined`.
async function existing_file(issue: string): Promise<string | undefined> {
	const file = await file_of(issue)

	return file_reader.read_if_readable(file) === undefined ? undefined : file
}

function range_text({ range }: ApprovalGrant): string {
	return [
		HEADING,
		'',
		`- 範囲（paths）: \`${range.paths.join('`, `')}\``,
		`- declared_files: ${String(range.files.declared)} / max_files: ${String(range.files.max)}`,
		`- declared_lines: ${String(range.lines.declared)} / max_lines: ${String(range.lines.max)}`,
	].join('\n')
}

async function source_of(grant: ApprovalGrant): Promise<string> {
	const range = range_text(grant)
	// The newline ends the last bound, so `max_files: 60` never stands in for `max_files: 6`.
	const written = grant.comments.find(
		(comment) => comment.is_trusted === true && comment.body.startsWith(`${range}\n`),
	)?.html_url

	return (
		written ??
		(await git_gh_issue_write.issue_comment(grant.issue, `${range}\n- 理由: ${grant.reason}`))
	)
}

function json_of(grant: ApprovalGrant, source: string): string {
	const { issue, reason, range } = grant
	const approval = {
		issue: Number(issue),
		paths: range.paths,
		source,
		rationale: reason,
		declared_lines: range.lines.declared,
		max_lines: range.lines.max,
		declared_files: range.files.declared,
		max_files: range.files.max,
	}

	return `${JSON.stringify(approval, undefined, JSON_INDENT)}\n`
}

// Writes the approval comment (unless already there) and the json; returns the json's path.
async function write(approval: ApprovalGrant): Promise<string> {
	const source = await source_of(approval)
	const file = await file_of(approval.issue)

	mkdirSync(path.dirname(file), { recursive: true })
	atomic_write.replace_file(file, json_of(approval, source))

	return file
}

const backlog_triage_approval = { existing_file, write }

export type { ApprovalGrant }
export { backlog_triage_approval }
