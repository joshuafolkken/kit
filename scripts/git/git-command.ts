import { SUITE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { PORCELAIN_FLAG, UNTRACKED_FILES_FLAG } from './constants'
import { git_diff_reads } from './git-diff-reads'
import { create_spawn_error } from './git-execa-error'
import { git_pre_push_hook } from './git-pre-push-hook'
import { git_push_transport } from './git-push-transport'
import { git_spawn } from './git-spawn'
import { git_spawn_sync } from './git-spawn-sync'

async function branch(): Promise<string> {
	return await git_spawn.read(['rev-parse', '--abbrev-ref', 'HEAD'])
}

// **The untracked-files mode is passed rather than inherited**. Every
// reader of this output depends on the `??` lines being there: `git-staging.ts` stages exactly those,
// and `hook-gate-reuse.ts` reads an empty output as "this push carries the recorded tree". A person
// with `status.showUntrackedFiles=no` in their git config — a common setting on large repositories —
// gets porcelain output with those lines silently absent, so untracked files go unstaged and the
// pre-push hook reuses a record for a commit that does not contain them. Naming the mode makes the
// reading answer to this codebase rather than to whoever ran it.
//
// **`all` rather than `normal`, so a new file is named even inside an untracked directory**.
// `normal` collapses it to `?? docs/maintainers/`, and every reader that
// recognizes the observation ledger by its path then misses it: `git-staging.ts` stages the directory
// — ledger included — into an unrelated pull request, and the flush refuses the directory as "other
// changes".
// `directory` reads another work tree of the repository — a lane — instead of this one.
async function status(directory?: string): Promise<string> {
	const location = directory === undefined ? [] : ['-C', directory]

	return await git_spawn.read([...location, 'status', PORCELAIN_FLAG, UNTRACKED_FILES_FLAG])
}

// The absolute path every other git command's output is relative to. Asking git rather than reading
// `process.cwd()` is the whole point: run from a subdirectory, joining a repository-relative path
// onto the working directory resolves to nothing, and a digest map built that way collapses to
// "every file absent" — which compares *equal* to another such map.
async function repository_root(): Promise<string> {
	const result = git_spawn_sync.toplevel()
	if (result.exit_code !== 0) throw create_spawn_error('rev-parse', result.exit_code)

	return result.stdout.trim()
}

// The commit this checkout is sitting on, as opposed to `change_base_commit`'s commit a change is
// measured against. Read by `josh review:brief` to say which tree a review was
// briefed on, so a review that read a different one can be told apart from one that read this one.
async function head_commit(): Promise<string> {
	return await git_spawn.read(['rev-parse', 'HEAD'])
}

// Both git directories this checkout has, absolute, one per line. In the main work tree they are the
// same path; in a linked work tree the first is `<repo>/.git/worktrees/<name>` and the second is
// `<repo>/.git`, and the commit-message file lives under the first. Asking git rather than assuming
// a directory named `.git` is what makes a bare repository and a `--separate-git-dir` clone answer
// correctly too.
// Exported so a caller that must ask the same question **synchronously** asks it with the same
// arguments rather than a second spelling of them. `git_spawn` is
// asynchronous throughout and a `PreToolUse` guard is synchronous by contract, so the one place that
// needs it runs these arguments itself — sharing the list is what keeps that from becoming a clone.
const GIT_DIRECTORY_ARGUMENTS: ReadonlyArray<string> = [
	'rev-parse',
	'--absolute-git-dir',
	'--path-format=absolute',
	'--git-common-dir',
]

async function git_directories(): Promise<Array<string>> {
	const output = await git_spawn.read([...GIT_DIRECTORY_ARGUMENTS])

	return output.split('\n').filter((line) => line !== '')
}

async function diff_cached(file_path: string): Promise<string> {
	return await git_spawn.read(['diff', '--cached', file_path])
}

// One branch from `origin`, fetched by name. `gh pr checkout` did this itself after resolving the
// head branch through GraphQL, which a cloud session is answered 403 for;
// the resolution moved to REST and the fetch is spelled out here instead of being re-wrapped.
//
// The refspec is written out rather than left to the remote's configuration. A bare branch name is
// fetched under `origin`'s own refspec **only where it has the default one**: a `--single-branch`
// clone, and every `actions/checkout` checkout, narrow it to one branch, and there a bare name
// updates `FETCH_HEAD` alone. The `checkout` and the fast-forward that follow both read
// `refs/remotes/origin/<branch>`, so naming the destination is what keeps them working off this
// repository's own machine. `+` allows a forced update, matching what the
// default refspec does.
async function fetch_branch(branch_name: string): Promise<string> {
	const refspec = `+refs/heads/${branch_name}:refs/remotes/origin/${branch_name}`

	return await git_spawn.read_remote(['fetch', 'origin', refspec])
}

// The fast-forward `gh pr checkout` ran after its fetch, for the case the branch is already local.
// Without it a second `josh sdp <pr>` run works on the commit the first one left behind: the pin
// sync reads a stale `.github/workflows` and either reports "already in sync" or commits onto a base
// that `push` then rejects.
//
// `--ff-only` is the whole point — a branch that has diverged fails loudly rather than growing a
// merge commit nobody asked for, which is the behavior the CLI had.
//
// It moves the working tree, so it runs the `post-merge` hook and takes a suite's budget for it.
async function merge_fast_forward(branch_name: string): Promise<string> {
	return await git_spawn.read(['merge', '--ff-only', `origin/${branch_name}`], SUITE_TIMEOUT_MS)
}

// The same fast-forward for a branch that is *not* checked out, so no file in the working tree moves.
// A plain refspec refuses a non-fast-forward update, and git refuses it
// outright for a branch checked out in any work tree — both are failures, never a rewrite.
async function fast_forward_local(branch_name: string): Promise<string> {
	return await git_spawn.read_remote(['fetch', 'origin', `${branch_name}:${branch_name}`])
}

// The merge `josh main:merge` runs, and the deliberate opposite of the one above: **no `--ff-only`**,
// because the branch it is called on has diverged whenever the command is worth typing at all.
// Naming the strategy here is the whole fix — `git pull` decides it from
// `pull.rebase` / `pull.ff`, and with neither set it decides nothing and aborts.
//
// `with_output` rather than `read`: a merge that conflicts has to put git's own report in front of
// the person, which is what the `git pull` this replaced did.
//
// `message` replaces git's default merge message, which carries no `#N` and is therefore refused
// by the `commit-msg` hook on an issue branch.
//
// The budget is a suite's, not a local git command's: the merge commit runs the `commit-msg` hook,
// which is not git's own work.
async function merge_branch(branch_name: string, message?: string): Promise<void> {
	const message_arguments = message === undefined ? [] : ['-m', message]

	await git_spawn.with_output('merge', [...message_arguments, `origin/${branch_name}`], {
		timeout_ms: SUITE_TIMEOUT_MS,
	})
}

// Both checkouts run the `post-checkout` hook — a `pnpm install` in some consumers — so they take the
// budget of a suite rather than a local git command's, which would end them inside that hook with the
// branch already created.
async function checkout_b(branch_name: string): Promise<string> {
	return await git_spawn.read(['checkout', '-b', branch_name], SUITE_TIMEOUT_MS)
}

async function checkout(branch_name: string): Promise<string> {
	return await git_spawn.read(['checkout', branch_name], SUITE_TIMEOUT_MS)
}

// A commit runs the `pre-commit` and `commit-msg` hooks — a type check among them — so it takes the
// budget of the suite those hooks may run rather than a local git command's.
async function commit(message: string): Promise<void> {
	await git_spawn.with_output('commit', ['-m', message], { timeout_ms: SUITE_TIMEOUT_MS })
}

// **`-d` rather than `-D`, and that is the safety rather than a preference**.
// The one caller is a rollback that removes a branch it created moments earlier, so `-d`'s refusal to
// delete a branch holding an unmerged commit is exactly the net it wants: a rollback can never be the
// thing that destroys a commit.
async function delete_branch(branch_name: string): Promise<void> {
	await git_spawn.read(['branch', '-d', branch_name])
}

// How many commits `tip` holds that `base` does not. **`0` is the answer that distinguishes a flush
// branch carrying the only copy of an appended line from one an aborted flush merely left behind**,
// and the two get opposite advice.
// **Output that is not a count throws rather than parsing to `0`.** `Number('')` is `0`, and `0` is
// the answer that says a branch holds nothing — so a read that came back empty or unparseable would
// report "nothing is stranded" about a branch nobody measured, which is the one wrong answer that
// loses work. `count_merges` guards the same way and falls back to `0` instead, because there a
// missing count means an empty range rather than a claim about somebody's commits.
async function commit_count_beyond(base: string, tip: string): Promise<number> {
	const range = `${base}..${tip}`
	const output = await git_spawn.read(['rev-list', '--count', range])
	const parsed = Number(output)

	if (output.length > 0 && Number.isFinite(parsed)) return parsed

	throw new Error(`\`git rev-list --count ${range}\` printed \`${output}\` rather than a count`)
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

const NO_VERIFY_FLAG = '--no-verify'

// Both pushes go through `git_push_transport` rather than `git_spawn.with_output`, which is
// what gives them a transfer's timeout and an SSH keepalive the local git commands beside them do not
// need.
// The thrown error keeps the same `cause.exit_code` shape, so the 128
// fallback below reads it exactly as it did.
async function push_with_upstream(
	branch_name: string,
	verify_flags: ReadonlyArray<string>,
): Promise<void> {
	await git_push_transport.push([...verify_flags, '--set-upstream', 'origin', branch_name])
}

// **The push budget bounds the transfer alone**. The pre-push hook runs once,
// on a suite's budget of its own, before either push and outside the `try`; both transfers then skip it with `--no-verify`,
// so neither the timeout retry nor the `--set-upstream` fallback repeats it, and a failed hook is not
// mistaken for a missing upstream. A git too old to run the hook ahead leaves it to the push, as before.
async function push(): Promise<void> {
	const verify_flags = (await git_pre_push_hook.run()) ? [NO_VERIFY_FLAG] : []

	try {
		await git_push_transport.push([...verify_flags])
	} catch (error) {
		if (is_upstream_not_set_error(error)) {
			const current_branch = await branch()

			await push_with_upstream(current_branch, verify_flags)

			return
		}

		throw error
	}
}

// **`--ff-only` is named here rather than read out of whoever's git configuration is in force**.
// A bare `git pull` decides its strategy from `pull.rebase` / `pull.ff`,
// and with neither set — the state of a checkout nobody has configured — it decides nothing and
// aborts the moment the two sides have each moved:
//
//     fatal: Need to specify how to reconcile divergent branches
//
// Every caller wants
// the same thing: it is on the default branch, bringing it up to date before doing something else —
// `main-sync.ts` for `josh ms`, `release-cli.ts` / `release-publish.ts` around the release pull
// request, `scripts-ai/prep.ts` before it snapshots the overrides, and `git-branch.ts` →
// `pull_latest` — reached from `git-workflow.ts`, so it runs on every `josh git` /
// `josh pr` started from the default branch, which makes it the hottest of the five rather than a
// dormant one. **None of them is
// asking to absorb divergence**, so `merge_branch`'s reasoning inverts here: a default branch that
// has diverged is a state to fail loudly on rather than to grow a merge commit over. The name says
// which of the two this is, as `merge_fast_forward` does beside `merge_branch`.
async function pull_fast_forward(): Promise<void> {
	await git_spawn.with_output_remote('pull', ['--ff-only'])
}

// Every local branch matching a `git branch --list` pattern, one name per line. The boolean below is
// this same read, expressed on top of it rather than beside it: `run:hold`'s preflight check needs the name
// itself, because the pull request an interrupted run left behind is keyed by its head branch and the
// slug is not derivable from an issue number alone.
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

// Everything `:/` matches is the repository root and everything under it, so this stages exactly what
// the bare `git add -u` it replaced did — from any directory, since `:/` is anchored to the root
// rather than to the process's working directory.
const ALL_PATHS_PATHSPEC = ':/'

function exclude_pathspec(file_path: string): string {
	return `:(exclude,top)${file_path}`
}

// Every tracked modification, minus the paths the caller names. **The
// positive pathspec is not decoration**: a pathspec list made only of exclusions matches nothing at
// all, so `ALL_PATHS_PATHSPEC` is what the exclusions are subtracted from. The one caller is
// `git-staging.ts`, which keeps the observation ledger out of every ordinary commit.
async function add_tracked(excluded_paths: ReadonlyArray<string>): Promise<void> {
	const exclusions = excluded_paths.map((file_path) => exclude_pathspec(file_path))

	await git_spawn.read(['add', '-u', '--', ALL_PATHS_PATHSPEC, ...exclusions])
}

async function add_path(file_path: string): Promise<void> {
	await git_spawn.with_output('add', ['--', file_path])
}

// Main's own line of history. Both reads below restrict themselves to it, and for one reason: a
// child's commits are merged into main rather than being main's, so a walk that follows every parent
// answers about everything ever merged instead of about main.
const FIRST_PARENT_FLAG = '--first-parent'

// The commits that touched `file_path` along `tip`'s own first-parent line, newest first.
// **`--first-parent` is what keeps the answer about main's history rather than about everything ever
// merged into it**: a child's own commits are not main's, and the version question
// is asked of main.
//
// **`tip` is not decoration.** `--first-parent` only reads as "main's line" when the walk starts on
// main; started on a feature branch it walks that branch's commits first, and any merge main took
// after the branch was cut is not an ancestor at all. A caller that is not on main names the ref it
// means — `origin/main`, say — rather than inheriting `HEAD`.
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
// hundred commits and would have inflated a release by a whole minor.
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
	GIT_DIRECTORY_ARGUMENTS,
	branch,
	status,
	repository_root,
	head_commit,
	git_directories,
	diff_cached,
	// The default branch, the change base and every reading against it are `git-diff-reads.ts`'s,
	// re-exported here so no call site, mock or spy moved with them.
	...git_diff_reads,
	fetch_branch,
	merge_fast_forward,
	fast_forward_local,
	merge_branch,
	checkout_b,
	checkout,
	commit,
	commit_count_beyond,
	delete_branch,
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
