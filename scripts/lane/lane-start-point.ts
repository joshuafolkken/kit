import { git_command } from '#scripts/git/git-command'

// Where a lane is cut from (joshuafolkken/kit#1535).
//
// **The bare default-branch name is the wrong start point, because git resolves it to the *local*
// `refs/heads/<default>` — a ref nothing in this workflow ever advances.** Merges happen on GitHub
// through `pnpm josh followup --merge`, and this repository's main work tree does not have the
// default branch checked out, so there is no fast-forward for it to receive. It falls one commit
// further behind on every merge, and a lane opened from it starts without the work that was just
// merged. Measured on 2026-09-07: `refs/heads/main` was `e3a68c04` while `refs/remotes/origin/main`
// was `78f746f9`.
//
// **The remote-tracking ref is the one that is current**, because a fetch updates it without anyone
// checking anything out — which is exactly the property the local branch lacks. It is named in full
// (`refs/remotes/origin/<default>`) rather than as `origin/<default>`, so a local branch that
// happens to be called `origin/<default>` cannot capture the reading.

const REFS_REMOTES_ORIGIN_PREFIX = 'refs/remotes/origin/'
const ORIGIN_SHORT_PREFIX = 'origin/'

// A fetch failure is reported and stepped over rather than raised. `lane:open` is a local operation
// and has to keep working with no network at all — offline, on a clone with no `origin`, and while
// GitHub's ssh endpoint is timing out. What it degrades to is whatever `origin/<default>` already
// holds, which is still never *behind* the local branch.
async function refresh_default_branch(default_branch: string): Promise<void> {
	try {
		await git_command.fetch_branch(default_branch)
	} catch {
		console.error(
			`Could not fetch origin/${default_branch}; opening the lane from the remote-tracking ref as it stands.`,
		)
	}
}

async function has_remote_tracking_branch(default_branch: string): Promise<boolean> {
	const pattern = `${ORIGIN_SHORT_PREFIX}${default_branch}`
	const names = await git_command.branch_names_remote(pattern)

	return names.includes(pattern)
}

/**
 * The commit-ish `git worktree add` should branch a lane from.
 *
 * Falls back to the bare default-branch name where no remote-tracking ref exists — a fresh
 * `git init`, or a clone whose `origin` was removed. There the local branch is the only answer
 * there is, and it is not stale, because nothing else is advancing past it.
 */
async function resolve(): Promise<string> {
	const default_branch = await git_command.get_default_branch()

	await refresh_default_branch(default_branch)

	if (await has_remote_tracking_branch(default_branch)) {
		return `${REFS_REMOTES_ORIGIN_PREFIX}${default_branch}`
	}

	// Said out loud rather than taken quietly. `git branch --list` answers `[]` for a repository that
	// has no remote *and* for a git call that failed, and the second reading puts the lane back on the
	// stale ref this module exists to avoid — so the fallback is never silent.
	console.error(
		`No refs/remotes/origin/${default_branch} to cut the lane from; using the local ${default_branch}, which may be behind what has been merged.`,
	)

	return default_branch
}

const lane_start_point = { resolve }

export { lane_start_point }
