import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { git_worktree } from '#scripts/git/git-worktree'
import { lane_install } from '#scripts/lane/lane-install'
import { lane_paths } from '#scripts/lane/lane-paths'

// The dedicated linked work tree `pnpm josh release` runs inside (joshuafolkken/kit#2411). The whole
// point is that the release never touches the root checkout: it is cut fresh from
// `origin/<default>` as the `release/v<version>` branch, the version bump / commit / push all happen
// there, and it is removed whichever way the run ends. That lets a release run beside a `backlogrun`
// — which keeps the root on the default branch — and lets a release start even when the root is dirty
// or sitting on another branch.

// The release work tree lives under the same sibling hidden directory the lanes do
// (`.<repo>-lanes/`), so it inherits the same "not inside the repository" placement. Lanes are named
// by their numeric issue number (`lane_paths` matches `^\d+$`) and their seat locks are named
// separately, so a fixed non-numeric name collides with neither.
const RELEASE_WORKTREE_NAME = 'release'

function directory_for(repository_root: string): string {
	return path.join(lane_paths.lane_root(repository_root), RELEASE_WORKTREE_NAME)
}

function install_failed_message(directory: string, output: string): string {
	return `Could not install dependencies in the release work tree \`${directory}\`:\n${output}`
}

// The work tree and its local branch both go, in that order: a branch checked out in a work tree
// cannot be deleted, so the tree is removed first. `branch_delete` uses `-D` because the release
// branch is unmerged against the *local* default (the merge happened on GitHub), which `-d` refuses.
async function remove(directory: string, branch_name: string): Promise<void> {
	await git_worktree.worktree_remove(directory)
	await git_worktree.branch_delete(branch_name)
}

// **The dependency install is not optional, and disabling the hook is not the way around it**
// (joshuafolkken/kit#2411). The release commit goes through lefthook's pre-commit, which runs
// `pnpm exec` / `pnpm josh`, and a sibling work tree has no `node_modules` above it — so the tree
// needs its own, installed the same way a lane's is. A failed install cleans up the tree it created
// rather than leaving debris, then reports what git printed.
async function install_or_clean(directory: string, branch_name: string): Promise<void> {
	const result = await lane_install.install_dependencies(directory)

	if (result.is_installed) return

	await remove(directory, branch_name)
	throw new Error(install_failed_message(directory, result.output))
}

// **The tree is cut from `origin/<default>`, not from the root's HEAD.** git refuses a second work
// tree on the default branch, so the tree is created directly on the release branch — `git worktree
// add --no-track -b release/v<version> <dir> origin/<default>`, which `worktree_add` already spells
// when it is given a start point.
async function create(branch_name: string): Promise<string> {
	const directory = directory_for(process.cwd())
	const default_branch = await git_command.get_default_branch()

	await git_worktree.worktree_add(directory, branch_name, `origin/${default_branch}`)
	await install_or_clean(directory, branch_name)

	return directory
}

const release_worktree = {
	directory_for,
	create,
	remove,
	RELEASE_WORKTREE_NAME,
}

export { release_worktree }
