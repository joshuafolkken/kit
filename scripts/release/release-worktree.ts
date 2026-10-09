import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { git_remote_branch } from '#scripts/git/git-remote-branch'
import { git_worktree } from '#scripts/git/git-worktree'
import { lane_install } from '#scripts/lane/lane-install'
import { lane_leftover } from '#scripts/lane/lane-leftover'
import { lane_paths } from '#scripts/lane/lane-paths'

// The dedicated linked work tree `pnpm josh release` runs inside. The whole
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

// **The dependency install is not optional, and disabling the hook is not the way around it**.
// The release commit goes through lefthook's pre-commit, which runs
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
//
// **A failed add takes back the branch it made**. `git worktree add -b`
// creates the branch before it looks at the path, so an add refused for a path that already exists
// still leaves `release/v<version>` behind — and the next run's branch guard then refuses that name
// as a release already opened. The guard ran before this call and found no such branch, so one
// present now is this call's own.
async function add_or_take_back(directory: string, branch_name: string): Promise<void> {
	const default_branch = await git_command.get_default_branch()

	try {
		await git_worktree.worktree_add(directory, branch_name, `origin/${default_branch}`)
	} catch (error) {
		if (await git_command.branch_exists(branch_name)) await git_worktree.branch_delete(branch_name)

		throw error
	}
}

async function create(branch_name: string): Promise<string> {
	const directory = directory_for(process.cwd())

	await add_or_take_back(directory, branch_name)
	await install_or_clean(directory, branch_name)

	return directory
}

// **A run that never reached its `finally` leaves its tree and branch behind**
// — a Ctrl-C, a closed terminal — and every later release then fails on them until a person removes
// both by hand. They are cleared here only when clearing loses nothing: a release branch origin does
// not have and that carries no commit beyond `origin/<default>`. Uncommitted edits in the tree are
// the version bump the next run writes again, so they are not counted as a loss. A branch that was
// pushed, or that holds a commit, may be a release still in flight, so it is reported and kept. A
// live run with neither yet is excluded by the caller: `release_publish.publish` holds the release
// lock, so no other release is alive when this runs.
const RELEASE_BRANCH_PATTERN = 'release/v*'

async function leftover_reason(branch_name: string, base: string): Promise<string | undefined> {
	const answer = await git_remote_branch.ask(branch_name)

	if (answer !== 'absent') return `origin answers \`${answer}\` for it`

	const ahead = await git_command.commit_count_beyond(base, branch_name)

	return ahead === 0 ? undefined : `it holds ${String(ahead)} commit(s) not on \`${base}\``
}

function kept_message(directory: string, kept: ReadonlyArray<[string, string]>): string {
	const lines = kept.map(([branch_name, reason]) => `- \`${branch_name}\`: ${reason}`)
	const commands = [
		`git worktree remove --force ${directory}`,
		...kept.map(([branch_name]) => `git branch -D ${branch_name}`),
	].join('; ')

	return [
		'A previous `pnpm josh release` left release branches that may still be in use, so nothing was removed:',
		...lines,
		`If no release is running, finish or close its pull request, delete the remote branch if it was pushed, then run \`${commands}\` and \`pnpm josh release\` again.`,
	].join('\n')
}

async function kept_branches(branches: ReadonlyArray<string>): Promise<Array<[string, string]>> {
	const base = `origin/${await git_command.get_default_branch()}`
	const reasons = await Promise.all(branches.map(async (name) => await leftover_reason(name, base)))

	return branches.flatMap((name, index) => {
		const reason = reasons[index]

		return reason === undefined ? [] : [[name, reason] as [string, string]]
	})
}

async function is_registered(directory: string): Promise<boolean> {
	const listing = await git_worktree.worktree_list()

	return listing.split('\n').includes(`worktree ${directory}`)
}

// The tree goes before the branches, for the reason `remove` gives. A directory git does not register
// is `lane_leftover.reclaim`'s to remove or refuse — the same test a lane's leftover path gets.
// Registration is asked before existence: a directory deleted by hand stays registered, and git
// refuses to delete a branch a registered tree holds until `worktree remove` drops the registration.
async function remove_leftover_tree(directory: string): Promise<void> {
	if (await is_registered(directory)) await git_worktree.worktree_remove(directory)
	else await lane_leftover.reclaim(directory)
}

async function clear_leftover(): Promise<void> {
	const directory = directory_for(process.cwd())
	const branches = await git_command.branch_names(RELEASE_BRANCH_PATTERN)
	const kept = await kept_branches(branches)

	if (kept.length > 0) throw new Error(kept_message(directory, kept))

	await remove_leftover_tree(directory)

	for (const branch_name of branches) {
		// eslint-disable-next-line no-await-in-loop -- each `branch -D` takes the same ref lock
		await git_worktree.branch_delete(branch_name)
	}
}

const release_worktree = {
	directory_for,
	clear_leftover,
	create,
	remove,
	RELEASE_WORKTREE_NAME,
}

export { release_worktree }
