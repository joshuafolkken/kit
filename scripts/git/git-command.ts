import { exec, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { git_utilities } from './constants'

const exec_async = promisify(exec)

async function exec_git_command(command: string): Promise<string> {
	const git_command: string = git_utilities.get_git_command()
	const { stdout } = await exec_async(`${git_command} ${command}`)

	return stdout.trimEnd()
}

function create_spawn_error(command: string, exit_code: number | null): Error {
	const exit_code_string = exit_code === null ? 'unknown' : String(exit_code)
	const error_message = `git ${command} exited with code ${exit_code_string}`
	const error = new Error(error_message)

	error.cause = { exit_code: exit_code_string }

	return error
}

async function exec_git_command_with_output(
	command: string,
	arguments_list: Array<string>,
): Promise<void> {
	const git_command: string = git_utilities.get_git_command_for_spawn()

	await new Promise<void>((resolve, reject) => {
		const child = spawn(git_command, [command, ...arguments_list], {
			stdio: 'inherit',
			shell: false,
		})

		child.on('error', (error) => {
			reject(error)
		})

		child.on('close', (code) => {
			if (code === 0) {
				resolve()
			} else {
				reject(create_spawn_error(command, code))
			}
		})
	})
}

async function branch(): Promise<string> {
	return await exec_git_command('rev-parse --abbrev-ref HEAD')
}

async function status(): Promise<string> {
	return await exec_git_command('status --porcelain')
}

async function diff_cached(file_path: string): Promise<string> {
	return await exec_git_command(`diff --cached ${file_path}`)
}

const REFS_REMOTES_ORIGIN_PREFIX = 'refs/remotes/origin/'
const DEFAULT_BRANCH_FALLBACK = 'main'

async function get_default_branch(): Promise<string> {
	try {
		const output = await exec_git_command('symbolic-ref refs/remotes/origin/HEAD')
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

	return await exec_git_command(`diff ${default_branch} -- ${file_path}`)
}

async function checkout_b(branch_name: string): Promise<string> {
	return await exec_git_command(`checkout -b ${branch_name}`)
}

async function checkout(branch_name: string): Promise<string> {
	return await exec_git_command(`checkout ${branch_name}`)
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
		const output: string = await exec_git_command(`branch --list ${branch_name}`)

		return output.trim().length > 0
	} catch {
		return false
	}
}

async function add_tracked(): Promise<void> {
	await exec_git_command('add -u')
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
