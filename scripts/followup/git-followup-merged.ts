import { git_gh_command } from '#scripts/gh/git-gh-command'
import type { PullMergeState } from '#scripts/gh/git-gh-pr-read'
import { git_command } from '#scripts/git/git-command'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// `prrun` stops at a green, mergeable pull request and a person merges it by
// hand. Re-running `pnpm josh followup` then has to finish what a merged `fullrun` finishes — the
// completion report, the epic close, the merged issue's close, the `in-progress` removal, the hold
// release and the completion Telegram — **from the one tail `followup` already runs**, not a copy of
// it elsewhere: the hold release and `josh ms` act on the local work tree, which CI never sees.
//
// **A merged pull request is read, not declared.** No flag says "a person merged this"; `followup`
// asks the pull request, so the same command works whichever of the two merged it. The merge plan
// below is what the rest of the run branches on: merged skips every pre-merge step — the review and
// live-evidence gates, the CI wait, the AI-review scans and the merge call — and runs the tail as a
// merged run's, even under `--no-merge`, because there is nothing left for that flag to hold back.
//
// **A second run must not repeat the report.** Every other tail step is idempotent by nature (a
// closed epic is not closed twice, a released hold releases nothing), but the completion comment and
// the completion Telegram are writes that would land again. The comment is the record that the tail
// already ran: a `✅` report naming this pull request, **posted on the issue at or after the merge**.
// The time is what tells it apart from the report the `prrun` stop itself posted — a `--no-merge`
// run's tail posts the same `✅` report naming the same pull request before anything merged, and
// reading that one as the merged run's would skip the only report that says it merged. A report the
// tail wrote into a blank issue body carries no time, so it is not counted: a re-run then posts it
// once more as a comment, the cheaper failure than a merged run that reported nothing.

interface MergePlan {
	is_merged: boolean
	should_merge: boolean
	merged_at: string | undefined
}

const COMPLETION_MARK = '✅ '
const PR_LINE_PREFIX = 'PR: '
const LINE_SEPARATOR = '\n'

const COMMENTS_SCHEMA = z.array(
	z.object({ body: z.string().nullish(), created_at: z.string().nullish() }),
)

type IssueComment = z.infer<typeof COMMENTS_SCHEMA>[number]

function to_merge_plan(state: PullMergeState | undefined, is_merge_requested: boolean): MergePlan {
	const is_merged = state?.is_merged === true

	return { is_merged, should_merge: is_merged || is_merge_requested, merged_at: state?.merged_at }
}

async function read_merge_plan(
	branch_name: string,
	is_merge_requested: boolean,
): Promise<MergePlan> {
	return to_merge_plan(await git_gh_command.pr_get_merge_state(branch_name), is_merge_requested)
}

// **A hand-merged pull request is followed up from wherever the person stands** — often the default
// branch, its head branch deleted (joshuafolkken/kit#7646). The default branch names no pull request,
// so the merged one closing the issue names the branch the rest of the run reads; none found keeps the
// branch, and the run goes on as before.
async function resolve_merged_branch(
	branch_name: string,
	issue_number: string | undefined,
): Promise<string> {
	if (issue_number === undefined) return branch_name
	const default_branch = await git_command.get_default_branch()
	if (branch_name !== default_branch) return branch_name

	return (await git_gh_command.pr_merged_head_of_issue(issue_number)) ?? branch_name
}

function is_completion_text(text: string | null | undefined, pr_url: string): boolean {
	if (typeof text !== 'string' || !text.startsWith(COMPLETION_MARK)) return false

	return text.split(LINE_SEPARATOR).includes(`${PR_LINE_PREFIX}${pr_url}`)
}

function is_posted_since(comment: IssueComment, merged_at: string): boolean {
	if (typeof comment.created_at !== 'string') return false

	return Date.parse(comment.created_at) >= Date.parse(merged_at)
}

function parse_comments(comments_json: string | undefined = ''): Array<IssueComment> {
	const parsed = COMMENTS_SCHEMA.safeParse(json_value.parse_or_undefined(comments_json))

	return parsed.success ? parsed.data : []
}

// The pure half: whether one of the issue's comments is this pull request's report, posted since it merged.
function has_completion_record(input: {
	comments_json: string | undefined
	pr_url: string
	merged_at: string
}): boolean {
	return parse_comments(input.comments_json).some(
		(comment) =>
			is_completion_text(comment.body, input.pr_url) && is_posted_since(comment, input.merged_at),
	)
}

// Asked only on a merged pull request: an unmerged run has never reached the tail, so its report
// cannot be there yet. **An unreadable issue reads as "not recorded"** — the tail then posts, and a
// duplicate report is the cheaper failure than a merged run that reported nothing.
async function is_completion_recorded(input: {
	merged_at: string | undefined
	issue_number: string | undefined
	pr_url: string | undefined
}): Promise<boolean> {
	const { merged_at, issue_number, pr_url } = input

	if (issue_number === undefined || pr_url === undefined || merged_at === undefined) return false

	const comments_json = await git_gh_command.issue_list_comments(issue_number)

	return has_completion_record({ comments_json, pr_url, merged_at })
}

const git_followup_merged = {
	has_completion_record,
	is_completion_recorded,
	read_merge_plan,
	resolve_merged_branch,
	to_merge_plan,
}

export type { MergePlan }
export { git_followup_merged }
