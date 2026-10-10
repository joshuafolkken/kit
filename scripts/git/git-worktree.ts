import { INSTALL_TIMEOUT_MS, SUITE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { PORCELAIN_FLAG } from './constants'
import { ls_remote_branch_arguments } from './git-ls-remote'
import { git_spawn } from './git-spawn'
import { repository_lock } from './repository-lock'

// The four worktree reads and writes a lane's lifecycle needs, plus the branch deletion that ends it.
// They live
// beside the other git commands rather than in `scripts/lane/` because `git_spawn.read` is what
// resolves the git binary and turns a non-zero exit into an error — a second spawn helper next to it
// would be the clone `CLAUDE.md` prohibits, so this module imports the shared one.
//
// **`ls_remote_branch` is here for the same reason, though it registers no work tree**: it is the
// asynchronous `git ls-remote` spawn, and a second spawn helper beside it would be that same clone.
// **It is not the only one in this package** — `propagate_git.has_remote_branch` runs the same query
// synchronously against a consumer's path, and the two share their arguments through
// `git-ls-remote.ts` rather than the spawn. Its sole caller is `git-remote-branch.ts`, which turns
// the raw output into the three-way answer (`absent` / `present` / `unreachable`) that
// `lane-start-point.ts` and `release-publish.ts` both act on — so this module stops at "what git
// printed" and the meaning of it is decided there.
const WORKTREE = 'worktree'

// **Every call that writes `.git/worktrees/` runs under one repository-wide lock**.
// `git worktree add` is not safe against itself: while one add is still
// building `.git/worktrees/<id>/` — its `commondir` not yet written — a second add enumerates the
// existing registrations, reads the half-built one and fails with `fatal: failed to read
// .git/worktrees/<id>/commondir`. Two lanes opened at once do exactly that, and the per-seat lock in
// `lane-open.ts` does not serialize them. `remove` and `prune` edit the same directory, so they take
// the same lock. The lock wraps the git call alone; the slow steps a caller runs afterwards — a lane's
// dependency install — stay outside it.
const WORKTREE_LOCK_PREFIX = 'josh-worktree-lock-'
// A holder runs one local git command, so the wait only bounds a checkout that hung; it is generous
// because a large repository's checkout is itself several seconds, and several lanes queue behind it.
const WORKTREE_LOCK_MAX_WAIT_MS = 120_000

// `timeout_ms` is left out by every call that only edits git's own records. An add checks a tree out
// and so runs the `post-checkout` hook — a `pnpm install` in some consumers — on a suite's budget
// instead of a local git command's, and a removal names the budget of what it deletes.
async function locked(arguments_: Array<string>, timeout_ms?: number): Promise<string> {
	const target = repository_lock.lock_path(WORKTREE_LOCK_PREFIX)
	const output = await repository_lock.with_lock(
		async () => await git_spawn.read(arguments_, timeout_ms),
		target,
		WORKTREE_LOCK_MAX_WAIT_MS,
	)

	if (output === undefined) {
		throw new Error(
			`git ${arguments_.join(' ')}: timed out waiting for the work-tree lock ${target}`,
		)
	}

	return output
}

// Every registered work tree of this repository, in git's own machine-readable form: one `worktree
// <path>` / `HEAD <sha>` / `branch <ref>` block per tree, blocks separated by a blank line. Parsing
// it is the caller's, so this module keeps one shape for every reader.
async function worktree_list(): Promise<string> {
	return await git_spawn.read([WORKTREE, 'list', PORCELAIN_FLAG])
}

// `-b` creates the branch as part of the add, so there is no window in which the directory exists on
// a detached HEAD; `start_point` is passed explicitly rather than left to `HEAD`, because a lane is
// branched from the default branch whatever the checkout that opened it happens to be sitting on.
//
// **`--no-track` is load-bearing now that the start point is a remote-tracking ref**.
// Branching from `refs/remotes/origin/<default>` makes git's default
// `branch.autoSetupMerge` set `branch.<lane>.merge=refs/heads/<default>`, and a bare `git push` from
// the lane then fails with "the upstream branch of your current branch does not match the name of
// your current branch" — which is *not* the missing-upstream error `push()` retries as
// `--set-upstream`, so every lane's `pnpm josh git` would stop there. Measured against git 2.x.
//
// **An absent `start_point` attaches the tree to the branch that is already there, and neither flag
// is passed then**. `-b` refuses a branch that exists, so a lane whose child
// had already pushed could not be reopened at all; deleting the branch first to get `-b` back would
// discard those commits and orphan the pull request. `--no-track` cannot ride along either — git
// answers `--[no-]track can only be used if a new branch is created` — and it has nothing to do here:
// whatever upstream the branch was given when it was created is still on it.
async function worktree_add(
	directory: string,
	branch_name: string,
	start_point: string | undefined,
): Promise<string> {
	const flags = start_point === undefined ? ['add'] : ['add', '--no-track', '-b', branch_name]

	return await locked([WORKTREE, ...flags, directory, start_point ?? branch_name], SUITE_TIMEOUT_MS)
}

// A throwaway tree at one commit, on no branch — `josh test:red` checks the merge-base out here, so
// the pre-fix tree is built without creating a branch or touching the caller's tree and index.
async function worktree_add_detached(directory: string, commit: string): Promise<string> {
	return await locked([WORKTREE, 'add', '--detach', directory, commit], SUITE_TIMEOUT_MS)
}

// **`--force` is the point, not a convenience.** A lane is closed after a park, a failure or an
// interruption as readily as after a success, and in each of those the tree still holds uncommitted
// or untracked work. Refusing to remove it there would leave exactly the debris the close exists to
// prevent.
//
// **It takes an install's budget, not a local git command's.** The tree it deletes holds the
// `node_modules` an install wrote, and a removal cut partway leaves a half-deleted tree git still
// registers — which `release_worktree.remove` does not step over, so the release branch stays too.
async function worktree_remove(directory: string): Promise<string> {
	return await locked([WORKTREE, 'remove', '--force', directory], INSTALL_TIMEOUT_MS)
}

// Drops the registrations whose directories are already gone — what makes a lane whose directory was
// deleted by hand recoverable rather than a permanent `worktree add` refusal on that path.
async function worktree_prune(): Promise<string> {
	return await locked([WORKTREE, 'prune'])
}

// **Asked of the remote itself, because nothing prunes the remote-tracking refs**.
// `lane:close` deletes the local branch, GitHub deletes the remote one at
// the merge, and `refs/remotes/origin/<N>-lane` outlives both: this repository carried sixteen of
// them for branches the remote no longer had. Empty output on a zero exit is therefore "not on the
// remote", which a stale ref cannot say, and a non-zero exit is "could not ask" — a different answer
// again, and the reason the caller cannot use `fetch` for this: `fetch` fails identically for a
// branch that is gone and for a network that is down, and prunes neither (measured on git 2.x).
//
// **The arguments come from `git-ls-remote.ts`, which is the single source of the full ref path.**
// An unanchored ref would make the message untruthful rather than the answer unsafe: `lane:open`
// would be told origin has the lane branch and then stop naming a branch nobody could find there,
// and the release guard would refuse a name that was free.
//
// **It takes the remote budget, not `read`'s**: that default is a local command's, and an ssh that
// is slow to connect or waiting at a passphrase prompt would be cut there and read as `unreachable`.
async function ls_remote_branch(branch_name: string): Promise<string> {
	return await git_spawn.read_remote(ls_remote_branch_arguments(branch_name))
}

// `-D` rather than `-d`: a lane branch is deleted whatever state its work reached, and `-d` refuses
// one that was never merged — which is every lane closed after a park or a failure.
async function branch_delete(branch_name: string): Promise<string> {
	return await git_spawn.read(['branch', '-D', branch_name])
}

const git_worktree = {
	branch_delete,
	ls_remote_branch,
	worktree_add,
	worktree_add_detached,
	worktree_list,
	worktree_prune,
	worktree_remove,
}

export { git_worktree }
