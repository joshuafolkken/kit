import { exec, spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { promisify } from 'node:util'

const exec_async = promisify(exec)

const BODY_FILE_FLAG = '--body-file'
const BODY_FROM_STDIN = '-'

interface GhSpawnResult {
	stdout: string
	stderr: string
	exit_code: number | null
}

function build_error_message(error: unknown): string {
	const exec_error = error as { stderr?: string; stdout?: string; message?: string }
	const error_message = exec_error.message ?? String(error)
	const stderr = exec_error.stderr ?? ''

	return stderr.length > 0 ? `${error_message}\n${stderr}` : error_message
}

async function exec_gh_command(command: string): Promise<string> {
	try {
		const { stdout } = await exec_async(`gh ${command}`)

		return stdout.trimEnd()
	} catch (error) {
		throw new Error(build_error_message(error), { cause: error })
	}
}

function parse_buffer_to_string(chunk: string | Buffer): string {
	return typeof chunk === 'string' ? chunk : chunk.toString('utf8')
}

function resolve_exit_code(code: number | null): string {
	return code === null ? 'unknown' : String(code)
}

function create_gh_spawn(
	arguments_: Array<string>,
): ChildProcessByStdio<Writable, Readable, Readable> {
	// eslint-disable-next-line sonarjs/no-os-command-from-path -- gh is a well-known CLI tool and safe to execute
	return spawn('gh', arguments_, {
		stdio: ['pipe', 'pipe', 'pipe'],
		shell: false,
	})
}

async function collect_gh_spawn_result(
	child: ReturnType<typeof create_gh_spawn>,
): Promise<GhSpawnResult> {
	return await new Promise<GhSpawnResult>((resolve, reject) => {
		let stdout = ''
		let stderr = ''

		child.stdout.on('data', (chunk: string | Buffer) => {
			stdout += parse_buffer_to_string(chunk)
		})

		child.stderr.on('data', (chunk: string | Buffer) => {
			stderr += parse_buffer_to_string(chunk)
		})
		child.on('error', (error) => {
			reject(new Error(build_error_message(error), { cause: error }))
		})
		child.on('close', (code) => {
			resolve({ stdout, stderr, exit_code: code })
		})
	})
}

async function run_gh_with_stdin(input: {
	args: Array<string>
	stdin_body: string
}): Promise<GhSpawnResult> {
	const child = create_gh_spawn(input.args)
	const result_promise = collect_gh_spawn_result(child)

	child.stdin.write(input.stdin_body)
	child.stdin.end()

	return await result_promise
}

async function exec_gh_command_with_stdin(input: {
	args: Array<string>
	stdin_body: string
}): Promise<string> {
	const result = await run_gh_with_stdin(input)
	if (result.exit_code === 0) return result.stdout.trimEnd()
	const stderr = result.stderr.trim()
	if (stderr.length > 0) throw new Error(stderr)
	const exit_code = resolve_exit_code(result.exit_code)

	throw new Error(`gh command failed: ${exit_code}`)
}

const git_gh_exec = {
	exec_gh_command,
	exec_gh_command_with_stdin,
}

export { git_gh_exec, BODY_FILE_FLAG, BODY_FROM_STDIN }
export type { GhSpawnResult }
