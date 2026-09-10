import { PORCELAIN_FLAG } from './constants'
import { git_spawn } from './git-spawn'

// The four worktree reads and writes a lane's lifecycle needs, plus the branch deletion that ends it
// (joshuafolkken/kit#1490; split out of `git-command.ts` under joshuafolkken/kit#1640). They live
// beside the other git commands rather than in `scripts/lane/` because `git_spawn.read` is what
// resolves the git binary and turns a non-zero exit into an error — a second spawn helper next to it
// would be the clone `CLAUDE.md` prohibits, so this module imports the shared one.
//
// **`ls_remote_branch` is here for the same reason, though it registers no work tree**: it is the one
// raw `git ls-remote` spawn, and a second spawn helper beside it would be that same clone. Its sole
// caller is now `git-remote-branch.ts`, which turns the raw output into the three-way answer
// (`absent` / `present` / `unreachable`) that `lane-start-point.ts` and `release-publish.ts` both act
// on — so this module stops at "what git printed" and the meaning of it is decided there
// (joshuafolkken/kit#1641; before it, `lane-start-point.ts` was the only reader and did both).
const WORKTREE = 'worktree'

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
// **`--no-track` is load-bearing now that the start point is a remote-tracking ref**
// (joshuafolkken/kit#1535). Branching from `refs/remotes/origin/<default>` makes git's default
// `branch.autoSetupMerge` set `branch.<lane>.merge=refs/heads/<default>`, and a bare `git push` from
// the lane then fails with "the upstream branch of your current branch does not match the name of
// your current branch" — which is *not* the missing-upstream error `push()` retries as
// `--set-upstream`, so every lane's `pnpm josh git` would stop there. Measured against git 2.x.
//
// **An absent `start_point` attaches the tree to the branch that is already there, and neither flag
// is passed then** (joshuafolkken/kit#1627). `-b` refuses a branch that exists, so a lane whose child
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

	return await git_spawn.read([WORKTREE, ...flags, directory, start_point ?? branch_name])
}

// **`--force` is the point, not a convenience.** A lane is closed after a park, a failure or an
// interruption as readily as after a success, and in each of those the tree still holds uncommitted
// or untracked work. Refusing to remove it there would leave exactly the debris the close exists to
// prevent.
async function worktree_remove(directory: string): Promise<string> {
	return await git_spawn.read([WORKTREE, 'remove', '--force', directory])
}

// Drops the registrations whose directories are already gone — what makes a lane whose directory was
// deleted by hand recoverable rather than a permanent `worktree add` refusal on that path.
async function worktree_prune(): Promise<string> {
	return await git_spawn.read([WORKTREE, 'prune'])
}

// **Asked of the remote itself, because nothing prunes the remote-tracking refs**
// (joshuafolkken/kit#1627). `lane:close` deletes the local branch, GitHub deletes the remote one at
// the merge, and `refs/remotes/origin/<N>-lane` outlives both: this repository carried sixteen of
// them for branches the remote no longer had. Empty output on a zero exit is therefore "not on the
// remote", which a stale ref cannot say, and a non-zero exit is "could not ask" — a different answer
// again, and the reason the caller cannot use `fetch` for this: `fetch` fails identically for a
// branch that is gone and for a network that is down, and prunes neither (measured on git 2.x).
async function ls_remote_branch(branch_name: string): Promise<string> {
	return await git_spawn.read(['ls-remote', '--heads', 'origin', branch_name])
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
	worktree_list,
	worktree_prune,
	worktree_remove,
}

export { git_worktree }
