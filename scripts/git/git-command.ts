import { execa } from 'execa'
import { git_utilities } from './constants'
import { get_exit_code } from './git-execa-error'

async function exec_git_command_read(arguments_: Array<string>): Promise<string> {
	const git_cmd = git_utilities.get_git_command_for_spawn()
	// execa runs the binary directly with an argument array and no `shell` option, so CLI
	// args cannot break out of a shell sandbox; the git command and args are internally
	// controlled, never untrusted input. tssecurity:S8705 is a false positive here.
	const { stdout } = await execa(git_cmd, arguments_) // NOSONAR

	return stdout.trimEnd()
}

function create_spawn_error(command: string, exit_code: number | undefined): Error {
	const exit_code_string = exit_code === undefined ? 'unknown' : String(exit_code)
	const error_message = `git ${command} exited with code ${exit_code_string}`

	return new Error(error_message, { cause: { exit_code: exit_code_string } })
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

async function diff_main_names(): Promise<string> {
	const default_branch = await get_default_branch()

	return await exec_git_command_read([
		...NO_PATH_QUOTING,
		'diff',
		NAME_ONLY_FLAG,
		default_branch,
		'--',
	])
}

async function diff_cached_names(): Promise<string> {
	return await exec_git_command_read([...NO_PATH_QUOTING, 'diff', '--cached', NAME_ONLY_FLAG])
}

// Files git is not tracking yet. `git diff` never lists them, so a classifier built on the diff
// alone sees a change that adds a whole new module as an empty one — which is how a run adding new
// code could have been handed a reduced review level (joshuafolkken/kit#966).
async function untracked_names(): Promise<string> {
	return await exec_git_command_read([
		...NO_PATH_QUOTING,
		'ls-files',
		'--others',
		'--exclude-standard',
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

async function push_with_upstream(branch_name: string): Promise<void> {
	await exec_git_command_with_output('push', ['--set-upstream', 'origin', branch_name])
}

async function push(): Promise<void> {
	try {
		await exec_git_command_with_output('push', [])
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
	diff_cached,
	diff_cached_names,
	diff_main,
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
