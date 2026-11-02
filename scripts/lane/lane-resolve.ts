import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_command } from '#scripts/git/git-command'
import { git_spawn } from '#scripts/git/git-spawn'
import { main_merge } from '#scripts/git/main-merge'
import { issue_read, type IssueComment } from '#scripts/issue/issue-read'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_resolve_hunks } from './lane-resolve-hunks'

// `josh lane:resolve <issue>` — the merge-conflict path of `backlogrun-recovery.md` as one verdict
// (joshuafolkken/kit#5837). The step-back conditions a command can read without judgement are judged
// here: condition 3 off the Issue's resolution comments, before any merge starts, and condition 2 off
// the hunk structure of each conflicted path. Conditions 1 and 4 stay the run's: one is a
// specification question, the other the gate and the review that follow a resolution.

const RESOLUTION_HEADING = '## Lane conflict resolved'
const OVERLAP_CONDITION = 2
const REPEAT_CONDITION = 3
const HEAD = 'HEAD'
const MERGE_HEAD = 'MERGE_HEAD'
const LANE_BRANCH_SUFFIX = '-lane'

type ResolveOutcome =
	| { kind: 'resolved' }
	| { kind: 'conflict'; files: ReadonlyArray<string> }
	| { kind: 'step-back'; condition: number; files: ReadonlyArray<string> }
	| { kind: 'refused'; message: string }

// A resolution is counted only off a trusted author, so a person quoting the heading counts nothing.
function is_resolution(comment: IssueComment): boolean {
	return comment.is_trusted === true && comment.body.trimStart().startsWith(RESOLUTION_HEADING)
}

async function resolution_count(issue: string): Promise<number | undefined> {
	const json = await git_gh_issue_read.issue_list_comments(issue)
	const comments = await issue_read.parse_comments(json)

	return comments?.filter((comment) => is_resolution(comment)).length
}

async function side_diff(base: string, side: string, file: string): Promise<string> {
	return await git_spawn.read(['diff', '--unified=0', base, side, '--', file])
}

async function is_overlapping(base: string, file: string): Promise<boolean> {
	const [ours, theirs] = await Promise.all([
		side_diff(base, HEAD, file),
		side_diff(base, MERGE_HEAD, file),
	])

	return lane_resolve_hunks.overlaps(ours, theirs)
}

async function overlapping_files(files: ReadonlyArray<string>): Promise<ReadonlyArray<string>> {
	const base = await git_spawn.read(['merge-base', HEAD, MERGE_HEAD])
	const verdicts = await Promise.all(files.map(async (file) => await is_overlapping(base, file)))

	return files.filter((_file, index) => verdicts[index] === true)
}

// Condition 2 parks the child, and a park leaves the tree clean, so the merge is aborted here.
async function judge_conflict(files: ReadonlyArray<string>): Promise<ResolveOutcome> {
	const overlapping = await overlapping_files(files)

	if (overlapping.length === 0) return { kind: 'conflict', files }

	await git_spawn.read(['merge', '--abort'])

	return { kind: 'step-back', condition: OVERLAP_CONDITION, files: overlapping }
}

async function judge_merge(): Promise<ResolveOutcome> {
	const outcome = await main_merge.merge()

	if (outcome.kind === 'conflict') return await judge_conflict(outcome.files)
	if (outcome.kind === 'refused') return outcome

	return { kind: 'resolved' }
}

// The issue names both the thread condition 3 reads and the branch the merge lands on, so a run in
// another checkout is refused rather than judged against one issue and merged into another.
async function wrong_branch(issue: string): Promise<ResolveOutcome | undefined> {
	const branch = await git_command.branch()
	const expected = `${issue}${LANE_BRANCH_SUFFIX}`

	if (branch === expected) return undefined

	return { kind: 'refused', message: `lane:resolve runs on ${expected}, not ${branch}` }
}

async function judge(issue: string): Promise<ResolveOutcome> {
	const count = await resolution_count(issue)

	if (count === undefined) {
		return {
			kind: 'refused',
			message: `the comments of ${session_cite.issue(issue)} could not be read`,
		}
	}

	if (count > 0) return { kind: 'step-back', condition: REPEAT_CONDITION, files: [] }

	return await judge_merge()
}

async function resolve(issue: string): Promise<ResolveOutcome> {
	return (await wrong_branch(issue)) ?? (await judge(issue))
}

// The one line the run branches on: `resolved`, `conflict <paths>` or `step-back <condition> [<paths>]`.
function verdict_line(outcome: Exclude<ResolveOutcome, { kind: 'refused' }>): string {
	if (outcome.kind === 'resolved') return outcome.kind
	const words =
		outcome.kind === 'conflict' ? [outcome.kind] : [outcome.kind, String(outcome.condition)]

	return [...words, ...outcome.files].join(' ')
}

const lane_resolve = { RESOLUTION_HEADING, LANE_BRANCH_SUFFIX, resolve, verdict_line, wrong_branch }

export { lane_resolve }
export type { ResolveOutcome }
