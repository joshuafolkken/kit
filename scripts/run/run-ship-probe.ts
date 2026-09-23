import { git_command } from '#scripts/git/git-command'
import { git_worktree } from '#scripts/git/git-worktree'
import { run_hold } from './run-hold'
import { run_preflight } from './run-preflight'
import { run_ship_stage, type ShipState } from './run-ship-stage'

// The read side of a resumed `josh ship` (joshuafolkken/kit#2426): the repository's actual state, asked
// before any stage runs, and where the stage record lives. `run-ship-stage.ts` decides from what this
// reads; this module only reads.
//
// **Every read that cannot complete answers `false`** — "not done yet" — so the stage runs and its own
// guard answers instead: `git -y` refuses an empty commit, a push of a commit origin already holds
// changes nothing, and `followup` reads the pull request itself before it merges.

const REPOSITORY_DIRECTORY_INDEX = 1
const REMOTE_SHA_INDEX = 0
const REMOTE_FIELD_SEPARATOR = /\s/u
const HEAD_REFERENCE = 'HEAD'

async function or_false(is_true: () => Promise<boolean>): Promise<boolean> {
	try {
		return await is_true()
	} catch {
		return false
	}
}

// A clean tree whose branch holds commits the default branch does not: the commit stage's output. A
// dirty tree is uncommitted work, whatever is already committed beneath it.
async function read_committed(): Promise<boolean> {
	if (await run_hold.is_tree_dirty()) return false

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

const NOTHING_DONE: ShipState = { is_committed: false, is_pushed: false, is_merged: false }

async function read_branch_state(branch_name: string): Promise<ShipState> {
	const [is_committed, is_pushed, is_merged] = await Promise.all([
		or_false(read_committed),
		or_false(async () => await read_pushed(branch_name)),
		or_false(async () => await read_merged(branch_name)),
	])

	return { is_committed, is_pushed, is_merged }
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
	try {
		const directories = await git_command.git_directories()
		const repository = directories[REPOSITORY_DIRECTORY_INDEX]

		return repository === undefined ? undefined : run_ship_stage.record_path(repository, issue)
	} catch {
		return undefined
	}
}

const run_ship_probe = { read_state, record_target }

export { run_ship_probe }
