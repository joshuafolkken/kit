import { git_command } from '#scripts/git/git-command'
import { git_spawn } from '#scripts/git/git-spawn'
import { main_merge_guard } from '#scripts/git/main-merge-guard'
import { git_stash } from '#scripts/git/stash/git-stash'
import { lane_paths } from '#scripts/lane/lane-paths'

// The set-aside on the run's own lane branch: a WIP commit there instead of a stash
// (joshuafolkken/kit#5930). The branch carries the work — conflicts already resolved included — so the
// resume is a `main:merge` on the lane rather than a pop that replays them onto a moved main.
//
// **The commit skips the hooks (`--no-verify`)**: the work is unfinished by definition, and a
// `pre-commit` type check or a `commit-msg` rule refusing it would leave the tree neither committed nor
// stashed. The ledger rides on it, as it rides on the run's own commit (`stash-push-cli.ts`).

const COMMAND = 'run:pause'
const RERUN = 'the command that paused (`run:pause`, `run:split`)'
const COMMITTED_VERDICT = 'committed'
const CLEAN_VERDICT = 'clean'
const ALREADY = 'already'

async function is_lane(issue: string): Promise<boolean> {
	return (await git_command.branch()) === lane_paths.lane_branch(issue)
}

function message_of(stash_message: string): string {
	return `wip: ${stash_message}`
}

async function is_committed(stash_message: string): Promise<boolean> {
	return (await git_spawn.read(['log', '-1', '--format=%s'])) === message_of(stash_message)
}

async function commit(stash_message: string): Promise<string> {
	if (await is_committed(stash_message)) return ALREADY

	const unmerged = await git_stash.unmerged_paths()

	if (unmerged.length > 0) {
		throw new Error(main_merge_guard.unresolved_message(COMMAND, unmerged, RERUN))
	}

	if (!(await git_stash.has_stashable_changes())) return CLEAN_VERDICT

	await git_spawn.read(['add', '-A', '--', ':/'])
	await git_spawn.read(['commit', '--no-verify', '-m', message_of(stash_message)])

	return COMMITTED_VERDICT
}

const run_set_aside_commit = { is_lane, is_committed, message_of, commit }

export { run_set_aside_commit }
