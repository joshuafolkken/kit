import { git_spawn } from './git-spawn'

// The default branch, the base a change is measured against, and every "changed" reading taken
// against that base — split out of `git-command.ts` when it reached its line limit.
// `git_command` re-exports each one under the name it always had, so the
// move changed no call site and no suite that mocks or spies on `git_command`.

const REFS_REMOTES_ORIGIN_PREFIX = 'refs/remotes/origin/'
const NAME_ONLY_FLAG = '--name-only'
const DEFAULT_BRANCH_FALLBACK = 'main'

async function get_default_branch(): Promise<string> {
	try {
		const output = await git_spawn.read(['symbolic-ref', 'refs/remotes/origin/HEAD'])
		const trimmed = output.trim()

		if (trimmed.startsWith(REFS_REMOTES_ORIGIN_PREFIX)) {
			return trimmed.slice(REFS_REMOTES_ORIGIN_PREFIX.length)
		}
	} catch {
		// fall through to default
	}

	return DEFAULT_BRANCH_FALLBACK
}

const MERGE_BASE_COMMAND = 'merge-base'

// **The ref the default branch is actually at**, which is not the same thing as its name.
// `get_default_branch` returns the bare name, and git resolves that to the
// *local* `refs/heads/<default>` — a ref nothing in this workflow advances, because merges happen on
// GitHub and the default branch is checked out in no work tree. This is the single source both the
// lane's start point and `change_base` below resolve through, so a lane cut from
// `refs/remotes/origin/<default>` is measured against that same commit. Measured without it: a lane
// cut from a remote-tracking ref three commits ahead reported those three commits' files as its own.
//
// It falls back to the bare name where there is no remote-tracking ref — a fresh `git init`, a clone
// with no `origin` — which is the reading every caller had before. The one case it reads differently
// is a local default branch *ahead* of the remote, which this workflow does not produce and
// `prevent-main-commit.ts` exists to stop.
async function reference_exists(reference: string): Promise<boolean> {
	try {
		await git_spawn.read(['rev-parse', '--verify', '--quiet', reference])

		return true
	} catch {
		return false
	}
}

async function default_branch_reference(): Promise<string> {
	const default_branch = await get_default_branch()
	const remote_reference = `${REFS_REMOTES_ORIGIN_PREFIX}${default_branch}`

	return (await reference_exists(remote_reference)) ? remote_reference : default_branch
}

// The commit this branch was cut from — and the base every "changed" reading below measures
// against, in place of the default branch itself.
//
// **A two-dot `git diff <default-branch>` compares a moving *ref* to the working tree, and in a
// linked work tree that ref is shared with every other lane**. So when one
// lane merges, an unmerged lane's diff picks that lane's files up in reverse: files this branch
// never touched arrive in `josh review:brief`'s target list, in the digest map `josh gate` stamps,
// and in `josh review:round2`'s fix delta.
//
// **The merge base is the fixed point that removes it**, because it is a commit rather than a ref:
// an advance of the default branch that this branch is an ancestor of does not move it. It is also
// the right answer at both points of a run, and a lane passes through both — with the work still
// uncommitted `HEAD` is the cut commit and the merge base is that same commit, so the diff is the
// uncommitted work; once the branch commits, `HEAD` moves ahead while the merge base stays put, so
// the diff is the branch's whole change plus anything still uncommitted. `<default-branch>...HEAD`
// answers neither, because a three-dot diff ends at `HEAD` and a lane's work is uncommitted for
// most of its run.
//
// **It never reports less than the old reading did.** The new set is the branch's own change; the
// old one was that same set plus the inverse of whatever the default branch had advanced by — so
// this narrows the reading and cannot hide a file the branch actually changed.
//
// In a checkout sitting on the default branch the merge base *is* that branch's commit, so nothing
// changes there. A repository with no common ancestor to find falls back to the previous reading
// rather than failing the callers, all of which treat a throw as "nothing can be reused".
async function change_base(): Promise<string> {
	const default_branch = await default_branch_reference()

	try {
		return await git_spawn.read([MERGE_BASE_COMMAND, default_branch, 'HEAD'])
	} catch {
		return default_branch
	}
}

async function diff_main(file_path: string): Promise<string> {
	return await git_spawn.read(['diff', await change_base(), '--', file_path])
}

// Names only, for callers that classify a change rather than read it — `josh review:level` decides
// the review depth from the paths alone, and reading the whole diff to get them would be the
// expensive half of the thing it exists to make cheaper.
//
// `core.quotePath=false` is not cosmetic. With git's default, a path containing any non-ASCII byte
// comes back C-quoted — `"prompts/\343\202\263.md"` — and a classifier testing `startsWith('prompts/')`
// against a string that begins with a quote character answers no. `review:level` fails safe there
// (non-inert wins), but a classifier that answered `skip` would drop a change it is meant to catch,
// so the quoting is turned off at the source every reader shares.
const NO_PATH_QUOTING: ReadonlyArray<string> = ['-c', 'core.quotePath=false']

// Repository-root-relative paths, whatever the checkout is configured to prefer. `diff.relative` is
// a per-repository setting a person may have turned on for their own reading, and with it `git diff
// --name-only` run from a subdirectory prints cwd-relative paths — which every caller of this
// reading then joins onto the repository root. The flag pins the spelling
// at the source rather than leaving each caller to discover the configuration.
const NO_RELATIVE_PATHS = '--no-relative'

// **Rename detection is turned off because this listing is a description of a tree, not a summary of
// a change**. With git's default `diff.renames=true`, a rename prints only
// its *destination*: `git diff --name-only <base>` across a commit that moved `scripts/init-logic.ts`
// to `scripts/init/init-logic.ts` names the second path and never the first.
//
// That omission is what breaks `josh gate`'s reuse. The green record it compares is `base` plus a
// digest per listed path, and the whole claim that the record still describes the tree rests on one
// property: **every path that differs from `base` is in the list**, so `base` plus the digests
// determines the tracked tree completely. A rename's source path differs from `base` — it is gone —
// and it is not in the list. So a tree in which the file was renamed away and a tree in which it has
// since come back produce the *same* record: the returned file matches `base`, so it enters no diff,
// while the destination is an addition either way. The gate then reuses a green taken on the first
// tree for the second, without running one check on it, and a duplicated module that lint, the type
// check and the unit suite would all have failed on is committed on a "passed".
//
// Off, a rename is listed as its two halves — a delete and an add — and the delete is what makes the
// two trees compare unequal. `review-tree.ts` already records a listed path the tree does not hold
// as `ABSENT_DIGEST` rather than dropping it, which is exactly the entry this flag produces.
//
// **Every other reader moves in the safe direction.** `josh review:level` sees
// one more path and can only widen; `josh lint:related` and `josh test:related` drop what the tree
// no longer holds through `changed-file-scope.ts`, which they already had to do for a plain delete.
const NO_RENAME_DETECTION = '--no-renames'

// The commit `change_base` resolves to. Every "changed" reading below is a diff against it, so a set
// of changed paths — or a map of their digests — means nothing without it: fetch an advanced default
// branch and rebase onto it, and each digest can stay identical while the rest of the tree is
// replaced by code no check has read. A rebase still invalidates a stamp
// taken against it — the rebase moves `HEAD`, and with it the merge base — while another lane
// merging into the shared default branch no longer does, because it moves neither.
async function change_base_commit(): Promise<string> {
	return await git_spawn.read(['rev-parse', await change_base()])
}

async function diff_main_names(): Promise<string> {
	return await git_spawn.read([
		...NO_PATH_QUOTING,
		'diff',
		NAME_ONLY_FLAG,
		NO_RELATIVE_PATHS,
		NO_RENAME_DETECTION,
		await change_base(),
		'--',
	])
}

async function diff_cached_names(): Promise<string> {
	return await git_spawn.read([
		...NO_PATH_QUOTING,
		'diff',
		'--cached',
		NAME_ONLY_FLAG,
		NO_RELATIVE_PATHS,
		NO_RENAME_DETECTION,
	])
}

// The branch diff as `added\tdeleted\tpath` rows — the same base and flags as `diff_main_names`, so
// the size read against and the name read agree on what "changed" is. A binary file prints `-` for
// both counts; the parser above `josh split:assess` reads it treats those as zero changed lines.
async function diff_main_numstat(): Promise<string> {
	return await git_spawn.read([
		...NO_PATH_QUOTING,
		'diff',
		'--numstat',
		NO_RELATIVE_PATHS,
		NO_RENAME_DETECTION,
		await change_base(),
		'--',
	])
}

// Files git is not tracking yet. `git diff` never lists them, so a classifier built on the diff
// alone sees a change that adds a whole new module as an empty one — which is how a run adding new
// code could have been handed a reduced review level.
//
// **`--full-name` and the `:/` pathspec are what make this reading agree with the diff beside it**.
// `git diff --name-only` prints repository-root-relative paths for the
// whole tree wherever it is run; `git ls-files --others` prints *cwd*-relative paths and lists only
// what is below cwd. Read from a subdirectory, the two halves of `changed_paths` therefore came
// back in two different coordinate systems, and every caller that resolves a path against the
// repository root — `review-tree`, `josh test:related` — turned a new file into one that does not
// exist, or, where the same tail exists elsewhere in the tree, into a different file entirely. The
// pathspec restores the whole tree; the flag restores the root-relative spelling.
const WHOLE_TREE_PATHSPEC = ':/'

async function untracked_names(): Promise<string> {
	return await git_spawn.read([
		...NO_PATH_QUOTING,
		'ls-files',
		'--others',
		'--exclude-standard',
		'--full-name',
		WHOLE_TREE_PATHSPEC,
	])
}

const git_diff_reads = {
	change_base,
	change_base_commit,
	default_branch_reference,
	diff_cached_names,
	diff_main,
	diff_main_names,
	diff_main_numstat,
	get_default_branch,
	untracked_names,
}

export { git_diff_reads }
