import { execa } from 'execa'
import { check_gh_installed } from './git-gh-check'

const BODY_FROM_STDIN = '-'

function has_stderr_field(error: unknown): error is Error & { stderr: string } {
	return error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
}

// execa attaches the captured output to the error it throws, which is where the status line lands
// when `gh api` exits non-zero — the case the whole probe exists for.
function has_stdout_field(error: unknown): error is Error & { stdout: string } {
	return error instanceof Error && 'stdout' in error && typeof error.stdout === 'string'
}

function to_error_message(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

// Surface the gh CLI's stderr as the thrown message when present (matching the previous spawn
// behavior), otherwise fall back to execa's own message — **and append what gh wrote to stdout**.
//
// The append is not cosmetic. `gh api` splits a failed request across both streams: stderr carries
// one summary line (`gh: Validation Failed (HTTP 422)`) and **stdout carries the JSON error body**,
// which is the only place the reason is written. Every caller here is now a REST request, so
// dropping stdout dropped the diagnosis from every REST failure — and `handle_pr_create_error`
// reads the reason: a duplicate pull request is `A pull request already exists for <owner>:<branch>.`
// inside that body, and matching it against stderr alone answers no (measured on
// joshuafolkken/kit#1029).
function to_gh_error(error: unknown): Error {
	const stderr = has_stderr_field(error) ? error.stderr.trim() : ''
	const stdout = has_stdout_field(error) ? error.stdout.trim() : ''
	const summary = stderr.length > 0 ? stderr : to_error_message(error)
	const message = stdout.length > 0 ? `${summary}\n${stdout}` : summary

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

const METHOD_FLAG = '--method'
const INPUT_FLAG = '--input'
const PAGINATE_FLAG = '--paginate'
const SLURP_FLAG = '--slurp'
const JQ_FLAG = '--jq'

// One REST request through `gh api`. `path` is the only required field: a read names nothing else,
// because `gh api` sends GET when neither `--method` nor a request body is given. **A `body` alone
// is not a read** — gh promotes a request carrying `--input` to POST — so a caller that means to
// send a body under another verb has to say `method` as well.
//
// `body` is handed to gh on stdin (`--input -`) rather than as a file or as repeated `-f key=value`
// pairs — a JSON body then needs no temporary file and no per-field escaping. `jq_filter` unwraps
// one value out of the response, so a caller wanting a single field gets the value rather than an
// object to parse.
//
// `should_slurp` goes with `should_paginate`, and **which endpoints need it is the whole point**:
// gh merges the pages of an endpoint that answers a bare JSON *array* into one array, so a paged
// comment listing arrives already parseable and must NOT slurp — `--slurp` would wrap it as
// `[[…],[…]]`, which every array schema then rejects. An endpoint answering an *object* is the case
// this field exists for: `--paginate` alone emits one document per page, so a two-page response
// arrives as `{…}{…}`, which `JSON.parse` rejects, and `--slurp` wraps those pages in one outer
// array instead. It is a separate field rather than implied by `should_paginate` for that reason,
// and because gh refuses it alongside `--jq` (joshuafolkken/kit#1027).
interface GhApiRequest {
	path: string
	method?: string
	body?: string
	should_paginate?: boolean
	should_slurp?: boolean
	jq_filter?: string
}

function optional_flag(flag: string, value?: string): Array<string> {
	return value === undefined ? [] : [flag, value]
}

function to_gh_api_args(request: GhApiRequest): Array<string> {
	const body_args = request.body === undefined ? [] : [INPUT_FLAG, BODY_FROM_STDIN]
	const paginate_args = request.should_paginate === true ? [PAGINATE_FLAG] : []
	const slurp_args = request.should_slurp === true ? [SLURP_FLAG] : []

	return [
		'api',
		request.path,
		...optional_flag(METHOD_FLAG, request.method),
		...body_args,
		...paginate_args,
		...slurp_args,
		...optional_flag(JQ_FLAG, request.jq_filter),
	]
}

// The response body of one `gh api` request, as text. Every REST caller that can await one goes
// through it, so the verb, the body and the paging stop being spelled out per call site
// (joshuafolkken/kit#1023). The synchronous readers that cannot — `gh-spawn.ts`, `epic-cross-repo.ts`
// — still share its path builder.
//
// Failure handling funnels through `to_gh_error` on both paths below, so a failed request throws
// with gh's stderr summary *and* the JSON error body it wrote to stdout.
async function exec_gh_api(request: GhApiRequest): Promise<string> {
	const args = to_gh_api_args(request)

	if (request.body === undefined) return await exec_gh_command(args)

	return await exec_gh_command_with_stdin({ args, stdin_body: request.body })
}

const git_gh_exec = {
	exec_gh_command,
	exec_gh_command_with_stdin,
	exec_gh_api,
	exec_gh_api_status,
	parse_status_line,
}

export type { GhApiRequest }
export { git_gh_exec, has_stderr_field, has_stdout_field }
export { BODY_FROM_STDIN }
