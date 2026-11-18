import { backlog_triage_unblock } from '#scripts/backlog/backlog-triage-unblock'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { git_stash } from '#scripts/git/stash/git-stash'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_read } from '#scripts/issue/issue-read'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_fold_prose } from './lane-fold-prose'
import { lane_withdraw } from './lane-withdraw'

// `josh lane:fold <N> --into <M> --reason <text>` — a component Issue `N` ships in the pull request of
// the Issue `M` that wires it (joshuafolkken/kit#7982). Three existing operations run in order: `N`'s
// lane is withdrawn with its work stashed, `M` is told how to bring the stash in and to close `N`, and
// `M`'s blocked-by on `N` (with the epic's `N -> M` declaration) is removed — left in place, `M` would
// wait forever on an Issue only its own pull request closes.
//
// No state of its own: a re-run reads each step back and does only what is left. A lane already
// withdrawn reads `no-lane`, its stash name is read from `N`'s withdrawal comment, a note already on `M`
// carries the fold's marker, and the unblock is itself a no-op on an absent relation or declaration.
// `N` stays open: withdrawn, it leaves the run's candidates (`backlog-drive-restore.ts`), and `M`'s
// pull request closes it.

type FoldStep = 'withdraw' | 'note' | 'unblock'

interface FoldRequest {
	issue: string
	into: string
	reason: string
}

interface Folded {
	kind: 'folded'
	// `false` when an earlier run had already withdrawn the lane.
	is_withdrawn: boolean
	stash: string | undefined
	// `false` when `M` already carried the note.
	is_noted: boolean
}

interface FoldFailed {
	kind: 'failed'
	step: FoldStep
	message: string
}

type FoldOutcome = Folded | FoldFailed

interface Progress {
	step: FoldStep
}

interface Withdrawal {
	is_withdrawn: boolean
	stash: string | undefined
}

async function trusted_bodies_of(issue: string): Promise<ReadonlyArray<string>> {
	const comments = await issue_read.parse_comments(
		await git_gh_issue_read.issue_list_comments(issue),
	)

	if (comments === undefined) {
		throw new Error(`the comments of ${session_cite.issue(issue)} could not be read`)
	}

	return issue_read.trusted_bodies(comments)
}

// The stash an earlier run's withdrawal recorded on `N`, or `undefined` when its lane held no work.
async function recorded_stash(issue: string): Promise<string | undefined> {
	const stash = git_stash.work_message(issue, lane_withdraw.WITHDRAW_OCCASION)
	const bodies = await trusted_bodies_of(issue)

	return bodies.some((body) => body.includes(`stash:pop "${stash}"`)) ? stash : undefined
}

async function withdraw_lane({ issue, into, reason }: FoldRequest): Promise<Withdrawal> {
	const outcome = await lane_withdraw.withdraw(
		issue,
		`ships with ${issue_cite.plain_for('github', into)}: ${reason}`,
	)

	if (outcome.kind === 'withdrawn') return { is_withdrawn: true, stash: outcome.stash }
	if (outcome.kind !== 'no-lane') throw new Error(lane_withdraw.describe(outcome, issue))

	return { is_withdrawn: false, stash: await recorded_stash(issue) }
}

async function note_taker(
	{ issue, into, reason }: FoldRequest,
	stash: string | undefined,
): Promise<boolean> {
	if (lane_fold_prose.is_noted(await trusted_bodies_of(into), issue)) return false

	await git_gh_issue_write.issue_comment(into, lane_fold_prose.comment(issue, stash, reason))

	return true
}

async function run_steps(request: FoldRequest, progress: Progress): Promise<Folded> {
	const withdrawal = await withdraw_lane(request)

	progress.step = 'note'
	const is_noted = await note_taker(request, withdrawal.stash)

	progress.step = 'unblock'
	await backlog_triage_unblock.remove({ issue: request.into, prerequisite: request.issue })

	return { kind: 'folded', ...withdrawal, is_noted }
}

/** Fold `issue` into `into`, naming the step that failed so a re-run finishes the rest. */
async function fold(request: FoldRequest): Promise<FoldOutcome> {
	const progress: Progress = { step: 'withdraw' }

	try {
		return await run_steps(request, progress)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)

		return { kind: 'failed', step: progress.step, message }
	}
}

const lane_fold = { fold }

export type { FoldOutcome, FoldRequest }
export { lane_fold }
