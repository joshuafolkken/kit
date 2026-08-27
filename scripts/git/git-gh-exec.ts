import { execa } from 'execa'
import { check_gh_installed } from './git-gh-check'

const BODY_FILE_FLAG = '--body-file'
const BODY_FROM_STDIN = '-'

function has_stderr_field(error: unknown): error is Error & { stderr: string } {
	return error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
}

// execa attaches the captured output to the error it throws, which is where the status line lands
// when `gh api` exits non-zero — the case the whole probe exists for.
function has_stdout_field(error: unknown): error is Error & { stdout: string } {
	return error instanceof Error && 'stdout' in error && typeof error.stdout === 'string'
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

// The status line `gh api --include` prints before the headers, e.g. `HTTP/2.0 404 Not Found`.
const STATUS_LINE_PATTERN = /^HTTP\/[\d.]+ (?<status>\d{3})\b/u

function parse_status_line(output: string): number | undefined {
	const { status } = STATUS_LINE_PATTERN.exec(output)?.groups ?? {}

	return status === undefined ? undefined : Number(status)
}

// The HTTP status of one `gh api` request, read from the status line rather than from `gh`'s error
// text. A message is prose that can be reworded between releases; the status code is the protocol,
// so a caller distinguishing "there is nothing at that number" (404) from "the read failed" (403,
// 429, 5xx) is matching a contract instead of a string (joshuafolkken/kit#957).
//
// `--silent` drops the response body, so only the headers are parsed; `--include` keeps them even
// when the request failed, and execa carries that output on the error it throws. `undefined` means
// no status was reached at all — gh missing, a dropped connection — which is itself a failed read.
async function exec_gh_api_status(path: string): Promise<number | undefined> {
	try {
		await check_gh_installed()
		const { stdout } = await execa('gh', ['api', '--include', '--silent', path]) // NOSONAR S8705: execa array args (no shell), trusted dev CLI tooling

		return parse_status_line(stdout)
	} catch (error) {
		return has_stdout_field(error) ? parse_status_line(error.stdout) : undefined
	}
}

const git_gh_exec = {
	exec_gh_command,
	exec_gh_command_with_stdin,
	exec_gh_api_status,
	parse_status_line,
}

export { git_gh_exec, has_stderr_field, has_stdout_field }
export { BODY_FILE_FLAG, BODY_FROM_STDIN }
