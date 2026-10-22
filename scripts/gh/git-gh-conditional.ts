import { git_gh_exec, has_stdout_field } from './git-gh-exec'

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

async function read_conditional(
	path: string,
	etag: string | undefined,
	timeout_ms?: number,
): Promise<ConditionalRead> {
	try {
		return to_read(await git_gh_exec.exec_gh_command(to_args(path, etag), timeout_ms))
	} catch (error) {
		return failure_status(error) === NOT_MODIFIED_STATUS
			? UNCHANGED
			: { kind: 'unreadable', cause: error }
	}
}

const git_gh_conditional = { read_conditional, to_args }

export type { ConditionalRead }
export { git_gh_conditional }
