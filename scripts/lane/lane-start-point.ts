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

// A fetch *failure* is reported and stepped over rather than raised. `lane:open` has to keep working
// with no network at all — offline, and on a clone with no `origin` — and what it degrades to is
// whatever `origin/<default>` already holds, which is still never *behind* the local branch. Note
// what this does not cover: `fetch_branch` runs through `exec_git_command_read`, which sets no
// timeout, so a connection that hangs rather than failing blocks here instead of degrading.
async function refresh_default_branch(default_branch: string): Promise<void> {
	try {
		await git_command.fetch_branch(default_branch)
	} catch {
		console.error(
			`Could not fetch origin/${default_branch}; opening the lane from the remote-tracking ref as it stands.`,
		)
	}
}

// Said out loud rather than taken quietly. The resolver answers the bare name for a repository with
// no remote *and* for a `rev-parse` that failed, and the second reading puts the lane back on the
// stale ref this module exists to avoid — so the fallback is never silent.
function report_local_fallback(default_branch: string): void {
	console.error(
		`No ${REFS_REMOTES_ORIGIN_PREFIX}${default_branch} to cut the lane from; using the local ${default_branch}, which may be behind what has been merged.`,
	)
}

/**
 * The commit-ish `git worktree add` should branch a lane from.
 *
 * The ref itself comes from `git_command.default_branch_reference`, which `change_base` resolves through
 * too — one resolution rather than two, so a lane is measured against the commit it was cut from.
 * What is added here is the fetch, which belongs to opening a lane and not to reading a diff.
 *
 * Falls back to the bare default-branch name where no remote-tracking ref exists — a fresh
 * `git init`, or a clone whose `origin` was removed. There the local branch is the only answer
 * there is, and it is not stale, because nothing else is advancing past it.
 */
async function resolve(): Promise<string> {
	const default_branch = await git_command.get_default_branch()

	await refresh_default_branch(default_branch)

	const start_point = await git_command.default_branch_reference()

	if (!start_point.startsWith(REFS_REMOTES_ORIGIN_PREFIX)) report_local_fallback(default_branch)

	return start_point
}

const lane_start_point = { resolve }

export { lane_start_point }
