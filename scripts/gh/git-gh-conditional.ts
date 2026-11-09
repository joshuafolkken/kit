import { gh_call_kind } from './gh-call-kind'
import { gh_request_tally } from './gh-request-tally'
import { git_gh_exec, has_stdout_field } from './git-gh-exec'
import { gh_failure } from './git-gh-failure'
import { gh_retry } from './git-gh-retry'

// A `gh api` GET that sends the ETag of the previous answer, so a resource polled every few minutes
// costs nothing when it has not changed: GitHub answers `304 Not Modified` to a matching
// `If-None-Match`, and a conditional request answered 304 does not count against the rate limit.
//
// **`gh` exits non-zero on a 304** (it prints `gh: HTTP 304`), so the "unchanged" answer arrives as
// a thrown failure. The status is read off the `--include` status line the failure still carries in
// its stdout — the same reading `exec_gh_api_status` makes — never off the stderr wording.

const NOT_MODIFIED_STATUS = 304
const OK_STATUS = 200
const INCLUDE_FLAG = '--include'
const HEADER_FLAG = '-H'
const IF_NONE_MATCH = 'If-None-Match: '
const HEADER_BODY_SEPARATOR = /\r?\n\r?\n/u
const ETAG_HEADER = /^etag: *(?<etag>[^\r\n]+)/imu

type ConditionalRead =
	| { kind: 'unchanged' }
	| { kind: 'changed'; etag: string | undefined; body: string }
	// `cause` is gh's own failure where there was one, for a caller that reports it.
	| { kind: 'unreadable'; cause?: unknown }

const UNCHANGED: ConditionalRead = { kind: 'unchanged' }
const UNREADABLE: ConditionalRead = { kind: 'unreadable' }

function to_args(path: string, etag: string | undefined): Array<string> {
	const header = etag === undefined ? [] : [HEADER_FLAG, `${IF_NONE_MATCH}${etag}`]

	return ['api', INCLUDE_FLAG, ...header, path]
}

// The headers and the body of an `--include` answer, split at the first blank line.
function to_changed(output: string): ConditionalRead {
	const [headers = '', ...rest] = output.split(HEADER_BODY_SEPARATOR)
	const etag = ETAG_HEADER.exec(headers)?.groups?.['etag']

	return { kind: 'changed', etag, body: rest.join('\n\n') }
}

function to_read(output: string): ConditionalRead {
	return git_gh_exec.parse_status_line(output) === OK_STATUS ? to_changed(output) : UNREADABLE
}

function failure_status(error: unknown): number | undefined {
	const cause = error instanceof Error ? error.cause : undefined

	return has_stdout_field(cause) ? git_gh_exec.parse_status_line(cause.stdout) : undefined
}

// A 304 is a call the exec layer already counted, and one that cost no REST core quota.
function not_modified(path: string): ConditionalRead {
	gh_request_tally.count_not_modified(gh_call_kind.of_api(path))

	return UNCHANGED
}

function rethrow_failure(error: unknown, path: string): ConditionalRead {
	const status = failure_status(error)
	if (status === NOT_MODIFIED_STATUS) return not_modified(path)
	if (status !== undefined && error instanceof Error) gh_failure.attach(error, { status })
	throw error
}

async function request_conditional(
	path: string,
	etag: string | undefined,
	timeout_ms?: number,
): Promise<ConditionalRead> {
	try {
		return to_read(await git_gh_exec.exec_gh_command(to_args(path, etag), timeout_ms))
	} catch (error) {
		return rethrow_failure(error, path)
	}
}

// A caller's `timeout_ms` bounds the whole read, so its timeout is final rather than retried: three
// attempts and their waits would outlast the per-tool-call hook that bounds it (joshuafolkken/kit#6754).
async function read_conditional(
	path: string,
	etag: string | undefined,
	timeout_ms?: number,
): Promise<ConditionalRead> {
	const retry = timeout_ms === undefined ? gh_retry.with_read_retry : gh_retry.with_retry

	try {
		return await retry(async () => await request_conditional(path, etag, timeout_ms))
	} catch (error) {
		return { kind: 'unreadable', cause: error }
	}
}

const git_gh_conditional = { read_conditional, to_args }

export type { ConditionalRead }
export { git_gh_conditional }
