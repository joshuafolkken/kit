import { PORCELAIN_FLAG } from './constants'
import { git_push_transport } from './git-push-transport'
import { git_spawn } from './git-spawn'

async function branch(): Promise<string> {
	return await git_spawn.read(['rev-parse', '--abbrev-ref', 'HEAD'])
}

// **`--untracked-files=normal` is passed rather than inherited** (joshuafolkken/kit#1381). Every
// reader of this output depends on the `??` lines being there: `git-staging.ts` stages exactly those,
// and `hook-gate-reuse.ts` reads an empty output as "this push carries the recorded tree". A person
// with `status.showUntrackedFiles=no` in their git config — a common setting on large repositories —
// gets porcelain output with those lines silently absent, so untracked files go unstaged and the
// pre-push hook reuses a record for a commit that does not contain them. Naming git's own default
// makes the reading answer to this codebase rather than to whoever ran it.
async function status(): Promise<string> {
	return await git_spawn.read(['status', PORCELAIN_FLAG, '--untracked-files=normal'])
}

// The absolute path every other git command's output is relative to. Asking git rather than reading
// `process.cwd()` is the whole point: run from a subdirectory, joining a repository-relative path
// onto the working directory resolves to nothing, and a digest map built that way collapses to
// "every file absent" — which compares *equal* to another such map (joshuafolkken/kit#1241).
async function repository_root(): Promise<string> {
	return await git_spawn.read(['rev-parse', '--show-toplevel'])
}

// The commit this checkout is sitting on, as opposed to `change_base_commit`'s commit a change is
// measured against. Read by `josh review:brief` to say which tree a review was
// briefed on, so a review that read a different one can be told apart from one that read this one
// (joshuafolkken/kit#1522).
async function head_commit(): Promise<string> {
	return await git_spawn.read(['rev-parse', 'HEAD'])
}

// Both git directories this checkout has, absolute, one per line. In the main work tree they are the
// same path; in a linked work tree the first is `<repo>/.git/worktrees/<name>` and the second is
// `<repo>/.git`, and the commit-message file lives under the first. Asking git rather than assuming
// a directory named `.git` is what makes a bare repository and a `--separate-git-dir` clone answer
// correctly too (joshuafolkken/kit#1106).
async function git_directories(): Promise<Array<string>> {
	const output = await git_spawn.read([
		'rev-parse',
		'--absolute-git-dir',
		'--path-format=absolute',
		'--git-common-dir',
	])

	return output.split('\n').filter((line) => line !== '')
}

async function diff_cached(file_path: string): Promise<string> {
	return await git_spawn.read(['diff', '--cached', file_path])
}

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

// **The ref the default branch is actually at**, which is not the same thing as its name
// (joshuafolkken/kit#1535). `get_default_branch` returns the bare name, and git resolves that to the
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
// linked work tree that ref is shared with every other lane** (joshuafolkken/kit#1527). So when one
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
// expensive half of the thing it exists to make cheaper (joshuafolkken/kit#966).
//
// `core.quotePath=false` is not cosmetic. With git's default, a path containing any non-ASCII byte
// comes back C-quoted — `"prompts/\343\202\263.md"` — and a classifier testing `startsWith('prompts/')`
// against a string that begins with a quote character answers no. `review:level` fails safe there
// (non-inert wins), but `josh eval:scope` would answer `skip` for a change it is meant to measure,
// so the quoting is turned off at the source all three readers share (joshuafolkken/kit#907).
const NO_PATH_QUOTING: ReadonlyArray<string> = ['-c', 'core.quotePath=false']

// Repository-root-relative paths, whatever the checkout is configured to prefer. `diff.relative` is
// a per-repository setting a person may have turned on for their own reading, and with it `git diff
// --name-only` run from a subdirectory prints cwd-relative paths — which every caller of this
// reading then joins onto the repository root (joshuafolkken/kit#1257). The flag pins the spelling
// at the source rather than leaving each caller to discover the configuration.
const NO_RELATIVE_PATHS = '--no-relative'

// **Rename detection is turned off because this listing is a description of a tree, not a summary of
// a change** (joshuafolkken/kit#1533). With git's default `diff.renames=true`, a rename prints only
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
// **Every other reader moves in the safe direction.** `josh review:level` and `josh eval:scope` see
// one more path and can only widen; `josh lint:related` and `josh test:related` drop what the tree
// no longer holds through `changed-file-scope.ts`, which they already had to do for a plain delete.
const NO_RENAME_DETECTION = '--no-renames'

// The commit `change_base` resolves to. Every "changed" reading below is a diff against it, so a set
// of changed paths — or a map of their digests — means nothing without it: fetch an advanced default
// branch and rebase onto it, and each digest can stay identical while the rest of the tree is
// replaced by code no check has read (joshuafolkken/kit#1328). A rebase still invalidates a stamp
// taken against it — the rebase moves `HEAD`, and with it the merge base — while another lane
// merging into the shared default branch no longer does, because it moves neither
// (joshuafolkken/kit#1527).
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

// Files git is not tracking yet. `git diff` never lists them, so a classifier built on the diff
// alone sees a change that adds a whole new module as an empty one — which is how a run adding new
// code could have been handed a reduced review level (joshuafolkken/kit#966).
//
// **`--full-name` and the `:/` pathspec are what make this reading agree with the diff beside it**
// (joshuafolkken/kit#1257). `git diff --name-only` prints repository-root-relative paths for the
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

// One branch from `origin`, fetched by name. `gh pr checkout` did this itself after resolving the
// head branch through GraphQL, which a cloud session is answered 403 for (joshuafolkken/kit#1022);
// the resolution moved to REST and the fetch is spelled out here instead of being re-wrapped.
//
// The refspec is written out rather than left to the remote's configuration. A bare branch name is
// fetched under `origin`'s own refspec **only where it has the default one**: a `--single-branch`
// clone, and every `actions/checkout` checkout, narrow it to one branch, and there a bare name
// updates `FETCH_HEAD` alone. The `checkout` and the fast-forward that follow both read
// `refs/remotes/origin/<branch>`, so naming the destination is what keeps them working off this
// repository's own machine (joshuafolkken/kit#1029). `+` allows a forced update, matching what the
// default refspec does.
async function fetch_branch(branch_name: string): Promise<string> {
	const refspec = `+refs/heads/${branch_name}:refs/remotes/origin/${branch_name}`

	return await git_spawn.read(['fetch', 'origin', refspec])
}

// The fast-forward `gh pr checkout` ran after its fetch, for the case the branch is already local.
// Without it a second `josh sdp <pr>` run works on the commit the first one left behind: the pin
// sync reads a stale `.github/workflows` and either reports "already in sync" or commits onto a base
// that `push` then rejects (joshuafolkken/kit#1029).
//
// `--ff-only` is the whole point — a branch that has diverged fails loudly rather than growing a
// merge commit nobody asked for, which is the behavior the CLI had.
async function merge_fast_forward(branch_name: string): Promise<string> {
	return await git_spawn.read(['merge', '--ff-only', `origin/${branch_name}`])
}

// The merge `josh main:merge` runs, and the deliberate opposite of the one above: **no `--ff-only`**,
// because the branch it is called on has diverged whenever the command is worth typing at all
// (joshuafolkken/kit#1659). Naming the strategy here is the whole fix — `git pull` decides it from
// `pull.rebase` / `pull.ff`, and with neither set it decides nothing and aborts.
//
// `with_output` rather than `read`: a merge that conflicts has to put git's own report in front of
// the person, which is what the `git pull` this replaced did.
async function merge_branch(branch_name: string): Promise<void> {
	await git_spawn.with_output('merge', [`origin/${branch_name}`])
}

async function checkout_b(branch_name: string): Promise<string> {
	return await git_spawn.read(['checkout', '-b', branch_name])
}

async function checkout(branch_name: string): Promise<string> {
	return await git_spawn.read(['checkout', branch_name])
}

async function commit(message: string): Promise<void> {
	await git_spawn.with_output('commit', ['-m', message])
}

function is_exit_code_128(cause: unknown): boolean {
	return (
		typeof cause === 'object' && cause !== null && 'exit_code' in cause && cause.exit_code === '128'
	)
}

function is_upstream_not_set_error(error: unknown): boolean {
	if (!(error instanceof Error)) return false
	const { cause } = error

	return cause !== undefined && is_exit_code_128(cause)
}

// Both pushes go through `git_push_transport` rather than `git_spawn.with_output`, which is
// what gives them a timeout and an SSH keepalive the local git commands beside them do not need
// (joshuafolkken/kit#1251). The thrown error keeps the same `cause.exit_code` shape, so the 128
// fallback below reads it exactly as it did.
async function push_with_upstream(branch_name: string): Promise<void> {
	await git_push_transport.push(['--set-upstream', 'origin', branch_name])
}

async function push(): Promise<void> {
	try {
		await git_push_transport.push([])
	} catch (error) {
		if (is_upstream_not_set_error(error)) {
			const current_branch = await branch()

			await push_with_upstream(current_branch)

			return
		}

		throw error
	}
}

// **`--ff-only` is named here rather than read out of whoever's git configuration is in force**
// (joshuafolkken/kit#1683). A bare `git pull` decides its strategy from `pull.rebase` / `pull.ff`,
// and with neither set — the state of a checkout nobody has configured — it decides nothing and
// aborts the moment the two sides have each moved:
//
//     fatal: Need to specify how to reconcile divergent branches
//
// This is joshuafolkken/kit#1659's defect at the second of that issue's two `git pull` sites, left
// there deliberately because the callers and the conditions differ. Every caller turns out to want
// the same thing: it is on the default branch, bringing it up to date before doing something else —
// `main-sync.ts` for `josh ms`, `release-cli.ts` / `release-publish.ts` around the release pull
// request, `scripts-ai/prep.ts` before it snapshots the overrides, and `git-branch.ts` →
// `pull_latest` — reached from `scripts-ai/git-workflow.ts`, so it runs on every `josh git` /
// `josh pr` started from the default branch, which makes it the hottest of the five rather than a
// dormant one. **None of them is
// asking to absorb divergence**, so `merge_branch`'s reasoning inverts here: a default branch that
// has diverged is a state to fail loudly on rather than to grow a merge commit over. The name says
// which of the two this is, as `merge_fast_forward` does beside `merge_branch`.
async function pull_fast_forward(): Promise<void> {
	await git_spawn.with_output('pull', ['--ff-only'])
}

// Every local branch matching a `git branch --list` pattern, one name per line. The boolean below is
// this same read, expressed on top of it rather than beside it: `run:preflight` needs the name
// itself, because the pull request an interrupted run left behind is keyed by its head branch and the
// slug is not derivable from an issue number alone (joshuafolkken/kit#926).
const SHORT_NAME_FORMAT = '--format=%(refname:short)'
const REMOTES_FLAG = '--remotes'

async function list_branches(
	flags: ReadonlyArray<string>,
	pattern: string,
): Promise<Array<string>> {
	try {
		const output: string = await git_spawn.read([
			'branch',
			'--list',
			SHORT_NAME_FORMAT,
			...flags,
			pattern,
		])

		return output.split('\n').filter((line) => line.trim() !== '')
	} catch {
		return []
	}
}

async function branch_names(pattern: string): Promise<Array<string>> {
	return await list_branches([], pattern)
}

// **The pattern is matched against the short name, which for a remote-tracking branch includes the
// remote** — `origin/926-x`, not `926-x` — so a caller passes `*/926-*` here and strips the remote
// back off itself.
async function branch_names_remote(pattern: string): Promise<Array<string>> {
	return await list_branches([REMOTES_FLAG], pattern)
}

async function branch_exists(branch_name: string): Promise<boolean> {
	const names = await branch_names(branch_name)

	return names.length > 0
}

async function add_tracked(): Promise<void> {
	await git_spawn.read(['add', '-u'])
}

async function add_path(file_path: string): Promise<void> {
	await git_spawn.with_output('add', ['--', file_path])
}

// Main's own line of history. Both reads below restrict themselves to it, and for one reason: a
// child's commits are merged into main rather than being main's, so a walk that follows every parent
// answers about everything ever merged instead of about main (joshuafolkken/kit#1169).
const FIRST_PARENT_FLAG = '--first-parent'

// The commits that touched `file_path` along `tip`'s own first-parent line, newest first.
// **`--first-parent` is what keeps the answer about main's history rather than about everything ever
// merged into it**: a child's own commits are not main's, and the version question
// (joshuafolkken/kit#1169) is asked of main.
//
// **`tip` is not decoration.** `--first-parent` only reads as "main's line" when the walk starts on
// main; started on a feature branch it walks that branch's commits first, and any merge main took
// after the branch was cut is not an ancestor at all. A caller that is not on main names the ref it
// means — `origin/main`, say — rather than inheriting `HEAD` (joshuafolkken/kit#1486).
async function log_first_parent(
	limit: number,
	file_path: string,
	tip = 'HEAD',
): Promise<Array<string>> {
	const output = await git_spawn.read([
		'log',
		FIRST_PARENT_FLAG,
		'--format=%H',
		`-n`,
		String(limit),
		tip,
		'--',
		file_path,
	])

	return output.split('\n').filter((line) => line.length > 0)
}

// One blob at one revision — `git show <ref>:<path>`. It throws when the path is absent there, which
// the caller reads as "no version at this revision" rather than as an error.
async function show_file(spec: string): Promise<string> {
	return await git_spawn.read(['show', spec])
}

// **`--first-parent` is what makes this a count of pull requests rather than of merge commits.**
// Without it `rev-list` walks every ancestor of `HEAD` that `base` cannot reach, which includes
// merges made *inside* a pull request branch — GitHub's "Update branch" button, or a local
// `git merge main` before pushing. Measured on this repository, `HEAD~200..HEAD` counts 201 merges
// unrestricted and 200 along the first-parent line, so one such merge is already in the last two
// hundred commits and would have inflated a release by a whole minor (joshuafolkken/kit#1169).
const MERGE_COUNT_ARGUMENTS: ReadonlyArray<string> = [
	'rev-list',
	'--count',
	'--merges',
	FIRST_PARENT_FLAG,
]

function merge_count_arguments(range: string): Array<string> {
	return [...MERGE_COUNT_ARGUMENTS, range]
}

// How many pull requests were merged into this branch's own line in the range. **A git failure
// throws**, as every read here does; the `isFinite` guard is only for output that is not a number,
// and zero is the safe answer there because zero means "nothing to release".
async function count_merges(range: string): Promise<number> {
	const output = await git_spawn.read(merge_count_arguments(range))
	const parsed = Number(output.trim())

	return Number.isFinite(parsed) ? parsed : 0
}

const git_command = {
	branch,
	status,
	repository_root,
	head_commit,
	git_directories,
	diff_cached,
	diff_cached_names,
	diff_main,
	change_base,
	change_base_commit,
	diff_main_names,
	untracked_names,
	get_default_branch,
	default_branch_reference,
	fetch_branch,
	merge_fast_forward,
	merge_branch,
	checkout_b,
	checkout,
	commit,
	push,
	pull_fast_forward,
	branch_exists,
	branch_names,
	branch_names_remote,
	add_tracked,
	add_path,
	log_first_parent,
	show_file,
	count_merges,
	merge_count_arguments,
	is_upstream_not_set_error,
}

export { git_command }
