import { git_command } from '#scripts/git/git-command'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { git_worktree } from '#scripts/git/git-worktree'
import { error_text } from '#scripts/lib/error-message'
import { review_round_reuse } from '#scripts/review/review-round-reuse'
import { run_hold } from '#scripts/run/hold/run-hold'
import { run_preflight } from '#scripts/run/run-preflight'
import { run_ship_stage, type ShipState } from './run-ship-stage'

// The read side of a resumed `josh ship`: the repository's actual state, asked before any stage runs,
// and where the stage record lives. `run-ship-stage.ts` decides from what this reads; this module
// only reads.
//
// **Every read that cannot complete answers `false`** — "not done yet" — so the stage runs and its own
// guard answers instead: `git -y` refuses an empty commit, a push of a commit origin already holds
// changes nothing, and `followup` reads the pull request itself before it merges.

const REMOTE_SHA_INDEX = 0
const REMOTE_FIELD_SEPARATOR = /\s/u
const HEAD_REFERENCE = 'HEAD'

async function or_false(is_true: () => Promise<boolean>): Promise<boolean> {
	try {
		return await is_true()
	} catch (error) {
		error_text.trace_swallowed('run_ship_probe.or_false', error)

		return false
	}
}

// A clean tree whose branch holds commits the default branch does not: the commit stage's output. A
// dirty tree is uncommitted work, whatever is already committed beneath it.
async function read_committed(is_dirty: boolean): Promise<boolean> {
	if (is_dirty) return false

	const base = await git_command.default_branch_reference()

	return (await git_command.commit_count_beyond(base, HEAD_REFERENCE)) > 0
}

// Origin's branch tip is this checkout's `HEAD` — the push has nothing left to send.
async function read_pushed(branch_name: string): Promise<boolean> {
	const [remote, head] = await Promise.all([
		git_worktree.ls_remote_branch(branch_name),
		git_command.head_commit(),
	])

	return remote.split(REMOTE_FIELD_SEPARATOR)[REMOTE_SHA_INDEX] === head
}

// The branch's pull request is merged **and** the default branch already holds `HEAD`. A branch whose
// earlier pull request merged and which has since gained commits still reads `MERGED` from GitHub, and
// taking that alone would skip the gate, the commit and the merge of the new work. A stale default
// branch reads as not merged, so `followup` runs and reads the pull request itself.
async function read_merged(branch_name: string): Promise<boolean> {
	if ((await run_preflight.read_pr_state(branch_name)) !== run_preflight.MERGED_PR) return false

	const base = await git_command.default_branch_reference()

	return (await git_command.commit_count_beyond(base, HEAD_REFERENCE)) === 0
}

// A stale review re-runs the review stage instead of the followup failing again.
async function read_review_stale(): Promise<boolean> {
	return await review_round_reuse.is_stale_here()
}

const NOTHING_DONE: ShipState = { is_committed: false, is_pushed: false, is_merged: false }

async function read_branch_state(branch_name: string): Promise<ShipState> {
	const is_dirty = await run_hold.is_tree_dirty()
	const [is_committed, is_pushed, is_merged, is_review_stale] = await Promise.all([
		or_false(async () => await read_committed(is_dirty)),
		or_false(async () => await read_pushed(branch_name)),
		or_false(async () => await read_merged(branch_name)),
		read_review_stale(),
	])

	return { is_committed, is_pushed, is_merged, is_review_stale, is_dirty }
}

// Origin holds `HEAD` and nothing is left uncommitted: a line written to the tree now has no commit of
// the run's own to ride, so pushing it would restart the pull request's CI (joshuafolkken/kit#4907).
async function is_pushed_clean(): Promise<boolean> {
	if (await run_hold.is_tree_dirty()) return false

	return await or_false(async () => await read_pushed(await git_command.branch()))
}

// A branch that cannot be named leaves nothing to ask about, so it reads as nothing done.
async function read_state(): Promise<ShipState> {
	try {
		return await read_branch_state(await git_command.branch())
	} catch {
		return NOTHING_DONE
	}
}

// The record's path for this issue, or `undefined` outside a repository — there is nothing to key on,
// and a ship without a record still resumes from the state alone.
async function record_target(issue: string): Promise<string | undefined> {
	const repository = await git_common_directory.read_repository()

	return repository === undefined ? undefined : run_ship_stage.record_path(repository, issue)
}

const run_ship_probe = {
	is_pushed_clean,
	read_review_stale,
	read_state,
	record_target,
	// The leaf's read, kept on the ship's surface for its own callers; a module outside the ship's
	// stages imports `git_common_directory` so it does not reach the review modules this one does.
	repository_directory: git_common_directory.read_repository,
}

export { run_ship_probe }
