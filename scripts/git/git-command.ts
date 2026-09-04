import { execa } from 'execa'
import { git_utilities } from './constants'
import { create_spawn_error, get_exit_code } from './git-execa-error'
import { git_push_transport } from './git-push-transport'

async function exec_git_command_read(arguments_: Array<string>): Promise<string> {
	const git_cmd = git_utilities.get_git_command_for_spawn()
	// execa runs the binary directly with an argument array and no `shell` option, so CLI
	// args cannot break out of a shell sandbox; the git command and args are internally
	// controlled, never untrusted input. tssecurity:S8705 is a false positive here.
	const { stdout } = await execa(git_cmd, arguments_) // NOSONAR

	return stdout.trimEnd()
}

async function exec_git_command_with_output(
	command: string,
	arguments_list: Array<string>,
): Promise<void> {
	const git_command_bin = git_utilities.get_git_command_for_spawn()

	try {
		// execa runs the binary directly with an argument array and no `shell` option, so CLI
		// args cannot break out of a shell sandbox; the git command and args are internally
		// controlled, never untrusted input. tssecurity:S8705 is a false positive here.
		await execa(git_command_bin, [command, ...arguments_list], { stdio: 'inherit' }) // NOSONAR
	} catch (error) {
		throw create_spawn_error(command, get_exit_code(error))
	}
}

async function branch(): Promise<string> {
	return await exec_git_command_read(['rev-parse', '--abbrev-ref', 'HEAD'])
}

async function status(): Promise<string> {
	return await exec_git_command_read(['status', '--porcelain'])
}

// The absolute path every other git command's output is relative to. Asking git rather than reading
// `process.cwd()` is the whole point: run from a subdirectory, joining a repository-relative path
// onto the working directory resolves to nothing, and a digest map built that way collapses to
// "every file absent" — which compares *equal* to another such map (joshuafolkken/kit#1241).
async function repository_root(): Promise<string> {
	return await exec_git_command_read(['rev-parse', '--show-toplevel'])
}

// Both git directories this checkout has, absolute, one per line. In the main work tree they are the
// same path; in a linked work tree the first is `<repo>/.git/worktrees/<name>` and the second is
// `<repo>/.git`, and the commit-message file lives under the first. Asking git rather than assuming
// a directory named `.git` is what makes a bare repository and a `--separate-git-dir` clone answer
// correctly too (joshuafolkken/kit#1106).
async function git_directories(): Promise<Array<string>> {
	const output = await exec_git_command_read([
		'rev-parse',
		'--absolute-git-dir',
		'--path-format=absolute',
		'--git-common-dir',
	])

	return output.split('\n').filter((line) => line !== '')
}

async function diff_cached(file_path: string): Promise<string> {
	return await exec_git_command_read(['diff', '--cached', file_path])
}

const REFS_REMOTES_ORIGIN_PREFIX = 'refs/remotes/origin/'
const NAME_ONLY_FLAG = '--name-only'
const DEFAULT_BRANCH_FALLBACK = 'main'

async function get_default_branch(): Promise<string> {
	try {
		const output = await exec_git_command_read(['symbolic-ref', 'refs/remotes/origin/HEAD'])
		const trimmed = output.trim()

		if (trimmed.startsWith(REFS_REMOTES_ORIGIN_PREFIX)) {
			return trimmed.slice(REFS_REMOTES_ORIGIN_PREFIX.length)
		}
	} catch {
		// fall through to default
	}

	return DEFAULT_BRANCH_FALLBACK
}

async function diff_main(file_path: string): Promise<string> {
	const default_branch = await get_default_branch()

	return await exec_git_command_read(['diff', default_branch, '--', file_path])
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

// The commit the default branch points at. Every "changed" reading below is a diff against that
// branch, so a set of changed paths — or a map of their digests — means nothing without it: fetch an
// advanced default branch and rebase onto it, and each digest can stay identical while the rest of
// the tree is replaced by code no check has read (joshuafolkken/kit#1328).
async function default_branch_commit(): Promise<string> {
	return await exec_git_command_read(['rev-parse', await get_default_branch()])
}

async function diff_main_names(): Promise<string> {
	const default_branch = await get_default_branch()

	return await exec_git_command_read([
		...NO_PATH_QUOTING,
		'diff',
		NAME_ONLY_FLAG,
		NO_RELATIVE_PATHS,
		default_branch,
		'--',
	])
}

async function diff_cached_names(): Promise<string> {
	return await exec_git_command_read([
		...NO_PATH_QUOTING,
		'diff',
		'--cached',
		NAME_ONLY_FLAG,
		NO_RELATIVE_PATHS,
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
	return await exec_git_command_read([
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

	return await exec_git_command_read(['fetch', 'origin', refspec])
}

// The fast-forward `gh pr checkout` ran after its fetch, for the case the branch is already local.
// Without it a second `josh sdp <pr>` run works on the commit the first one left behind: the pin
// sync reads a stale `.github/workflows` and either reports "already in sync" or commits onto a base
// that `push` then rejects (joshuafolkken/kit#1029).
//
// `--ff-only` is the whole point — a branch that has diverged fails loudly rather than growing a
// merge commit nobody asked for, which is the behavior the CLI had.
async function merge_fast_forward(branch_name: string): Promise<string> {
	return await exec_git_command_read(['merge', '--ff-only', `origin/${branch_name}`])
}

async function checkout_b(branch_name: string): Promise<string> {
	return await exec_git_command_read(['checkout', '-b', branch_name])
}

async function checkout(branch_name: string): Promise<string> {
	return await exec_git_command_read(['checkout', branch_name])
}

async function commit(message: string): Promise<void> {
	await exec_git_command_with_output('commit', ['-m', message])
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

// Both pushes go through `git_push_transport` rather than `exec_git_command_with_output`, which is
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

async function pull(): Promise<void> {
	await exec_git_command_with_output('pull', [])
}

async function branch_exists(branch_name: string): Promise<boolean> {
	try {
		const output: string = await exec_git_command_read(['branch', '--list', branch_name])

		return output.trim().length > 0
	} catch {
		return false
	}
}

async function add_tracked(): Promise<void> {
	await exec_git_command_read(['add', '-u'])
}

async function add_path(file_path: string): Promise<void> {
	await exec_git_command_with_output('add', ['--', file_path])
}

const git_command = {
	branch,
	status,
	repository_root,
	git_directories,
	diff_cached,
	diff_cached_names,
	diff_main,
	default_branch_commit,
	diff_main_names,
	untracked_names,
	get_default_branch,
	fetch_branch,
	merge_fast_forward,
	checkout_b,
	checkout,
	commit,
	push,
	pull,
	branch_exists,
	add_tracked,
	add_path,
	is_upstream_not_set_error,
}

export { git_command }
