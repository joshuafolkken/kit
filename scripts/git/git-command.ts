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
	diff_main,
	get_default_branch,
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
