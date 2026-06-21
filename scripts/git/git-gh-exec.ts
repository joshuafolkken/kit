import { execa } from 'execa'
import { check_gh_installed } from './git-gh-check'

const BODY_FILE_FLAG = '--body-file'
const BODY_FROM_STDIN = '-'

function has_stderr_field(error: unknown): error is Error & { stderr: string } {
	return error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
}

// Surface the gh CLI's stderr as the thrown message when present (matching the
// previous spawn behavior), otherwise fall back to execa's own message.
function to_gh_error(error: unknown): Error {
	const stderr = has_stderr_field(error) ? error.stderr.trim() : ''

	if (stderr.length > 0) return new Error(stderr, { cause: error })

	const message = error instanceof Error ? error.message : String(error)

	return new Error(message, { cause: error })
}

async function exec_gh_command(arguments_: Array<string>): Promise<string> {
	await check_gh_installed()

	try {
		const { stdout } = await execa('gh', arguments_) // NOSONAR S8705: execa array args (no shell), trusted dev CLI tooling

		return stdout.trimEnd()
	} catch (error) {
		throw to_gh_error(error)
	}
}

async function exec_gh_command_with_stdin(input: {
	args: Array<string>
	stdin_body: string
}): Promise<string> {
	await check_gh_installed()

	try {
		const { stdout } = await execa('gh', input.args, { input: input.stdin_body }) // NOSONAR S8705: execa array args (no shell), trusted dev CLI tooling

		return stdout.trimEnd()
	} catch (error) {
		throw to_gh_error(error)
	}
}

const git_gh_exec = {
	exec_gh_command,
	exec_gh_command_with_stdin,
}

export { git_gh_exec, has_stderr_field, BODY_FILE_FLAG, BODY_FROM_STDIN }
