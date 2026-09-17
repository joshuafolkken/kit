// How origin is asked whether it carries a branch — the one place that says it
// (joshuafolkken/kit#1732).
//
// **The pattern is the full ref path, because `ls-remote` matches a pattern against the *tail* of a
// ref at a slash boundary** (joshuafolkken/kit#1709). A bare name therefore answers for any branch
// ending in it: `1641-lane` matches `refs/heads/wip/1641-lane`, and `release/v1.2.0` matches
// `refs/heads/foo/release/v1.2.0`. **`--heads` does not close it** — that limits which refs are
// considered, not where inside one the pattern may match. Anchored at `refs/heads/`, only the exact
// branch is left, since no shorter tail of `refs/heads/wip/1641-lane` starts with `refs/heads/`.
// Callers pass a bare branch name, so the prefix goes on once even for a name that already carries a
// slash.
//
// **It is the arguments that are shared, not the spawn.** `git_worktree.ls_remote_branch` runs this
// asynchronously against the process's own cwd with no timeout, while
// `propagate_git.has_remote_branch` runs it synchronously against a consumer's path under a remote
// budget — three differences that belong to those callers. What was duplicated is the knowledge
// above, and joshuafolkken/kit#1709 fixed it in only one of the two places, which is the defect
// joshuafolkken/kit#1732 was filed for. Kept in one module, the next such fix reaches both.
const LS_REMOTE_COMMAND = 'ls-remote'
const HEADS_FLAG = '--heads'
const ORIGIN_REMOTE = 'origin'
const HEADS_REF_PREFIX = 'refs/heads/'

function ls_remote_branch_arguments(branch_name: string): Array<string> {
	return [LS_REMOTE_COMMAND, HEADS_FLAG, ORIGIN_REMOTE, `${HEADS_REF_PREFIX}${branch_name}`]
}

export { ls_remote_branch_arguments }
