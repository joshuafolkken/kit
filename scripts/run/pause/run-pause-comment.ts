import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { parse_json_array_or_undefined } from '#scripts/git/parse-json-array'
import { issue_cite } from '#scripts/issue/issue-cite'
import { session_cite } from '#scripts/issue/session-cite'
import { z } from 'zod'

const comment_schema = z.object({ body: z.string().nullish() })

async function has_comment(request: { issue: string; marker: string }): Promise<boolean> {
	const json = await git_gh_issue_read.issue_list_comments(request.issue)
	const rows = json === undefined ? undefined : parse_json_array_or_undefined(json, comment_schema)

	if (rows === undefined) {
		throw new Error(`the comments on ${session_cite.issue(request.issue)} could not be read`)
	}

	return rows.some((row) => row.body?.includes(request.marker) === true)
}

function marker_of(issue: string): string {
	return `<!-- josh:run-pause ${issue_cite.plain_for('program', issue)} for `
}

async function is_paused(issue: string): Promise<boolean> {
	return await has_comment({ issue, marker: marker_of(issue) })
}

const run_pause_comment = { has_comment, marker_of, is_paused }

export { run_pause_comment }
