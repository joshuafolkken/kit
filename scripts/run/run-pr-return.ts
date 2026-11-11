import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_gh_pr_snapshot } from '#scripts/gh/git-gh-pr-snapshot'
import { matches_any } from '#scripts/gh/git-pr-checks-eval'
import {
	CHECK_STATUS_FAIL,
	parse_pr_state_snapshot,
	type PrStateSnapshot,
} from '#scripts/gh/git-pr-checks-parse'
import { git_command } from '#scripts/git/git-command'
import { issue_watch_diff, type WatchComment } from '#scripts/issue/issue-watch-diff'

// Whether an open pull request was returned for a fix (joshuafolkken/kit#7313): a required check
// failed on it, or a person commented on the issue after the run's own last comment — the fix asked
// for once the run stopped. Either sends the resumed run to implementation instead of the gate, and
// both are printed so it reads what to fix. A comment listing that cannot be read counts as none:
// the red checks still decide, and the issue section the entry prints carries every comment.

const HEADING = '=== returned for a fix ==='
const RED_PREFIX = 'red required check: '
const COMMENT_PREFIX = 'read the comment by '
const AT = ' at '

interface PrReturn {
	red_checks: ReadonlyArray<string>
	comments: ReadonlyArray<WatchComment>
}

function red_required_checks(snapshot: PrStateSnapshot): ReadonlyArray<string> {
	const required = snapshot.required_contexts ?? []

	return snapshot.rollup
		.filter((check) => check.status === CHECK_STATUS_FAIL && matches_any(check.name, required))
		.map((check) => check.name)
}

function is_run_comment(comment: WatchComment): boolean {
	return comment.is_trusted === true && comment.body.includes(issue_watch_diff.RUN_MARKER)
}

// The comments after the run's last own one that a person wrote — a failed write-access lookup still
// counts, as `issue-watch-diff.ts` counts it.
function comments_since_run(comments: ReadonlyArray<WatchComment>): ReadonlyArray<WatchComment> {
	const last_run = comments.findLastIndex((comment) => is_run_comment(comment))

	return comments
		.slice(last_run + 1)
		.filter((comment) => comment.is_trusted !== false && !comment.is_automated)
}

function is_returned(pr_return: PrReturn): boolean {
	return pr_return.red_checks.length > 0 || pr_return.comments.length > 0
}

// The section the entry prints, or `undefined` when nothing returned the pull request.
function format(pr_return: PrReturn): string | undefined {
	if (!is_returned(pr_return)) return undefined

	const reds = pr_return.red_checks.map((name) => `${RED_PREFIX}${name}`)
	const comments = pr_return.comments.map(
		(comment) => `${COMMENT_PREFIX}${comment.author}${AT}${comment.created_at}`,
	)

	return [HEADING, ...reds, ...comments].join('\n')
}

async function read_comments(issue: string): Promise<ReadonlyArray<WatchComment>> {
	const json = await git_gh_issue_read.issue_list_comments(issue)

	return (await issue_watch_diff.parse_comments(json)) ?? []
}

async function read(issue: string): Promise<PrReturn> {
	const branch = await git_command.branch()
	const [snapshot_json, comments] = await Promise.all([
		git_gh_pr_snapshot.pr_get_state_snapshot(branch),
		read_comments(issue),
	])

	return {
		red_checks: red_required_checks(parse_pr_state_snapshot(snapshot_json)),
		comments: comments_since_run(comments),
	}
}

const run_pr_return = { comments_since_run, format, read, red_required_checks }

export type { PrReturn }
export { run_pr_return }
