import { error_text } from '#scripts/lib/error-message'
import { git_gh_exec } from './git-gh-exec'

// Whether a failed GitHub read failed on an exhausted rate limit, and when it resets (#6564). While
// the limit is spent, `gh auth status` itself reports the token invalid, so the auth hint sent a lane
// child into an authentication stop. The single classifier `issue:read` (#6614) and `run:merge`
// (#6502) are to share.
//
// The input is text — gh's stderr summary and the response body (`to_gh_error`), headers under
// `--include`, or a stop record — so a reader holding no error object can classify it too.

const FORBIDDEN_STATUS = 403
const TOO_MANY_REQUESTS_STATUS = 429
const RATE_LIMIT_STATUSES: ReadonlySet<number> = new Set([
	FORBIDDEN_STATUS,
	TOO_MANY_REQUESTS_STATUS,
])
const MILLISECONDS_PER_SECOND = 1000
// GitHub's own wording for the primary and the secondary limit, in the body and in gh's summary.
const RATE_LIMIT_MESSAGE = /rate limit (?:already )?exceeded|exceeded a secondary rate limit/iu
const EXHAUSTED_HEADER = /^x-ratelimit-remaining:\s*0\s*$/imu
const RESET_HEADER = /^x-ratelimit-reset:\s*(?<epoch>\d+)\s*$/imu
// gh's summary `(HTTP 403)`, a header status line `HTTP/2.0 403 Forbidden`, or the error document's
// `"status": "403"`.
const STATUS_PATTERNS: ReadonlyArray<RegExp> = [
	/\(HTTP (?<status>\d{3})\)/u,
	/^HTTP\/\S+ (?<status>\d{3})/mu,
	/"status":\s*"?(?<status>\d{3})/u,
]
const AUTH_HINT = 'check `gh auth status` and the network'

function status_of(text: string): number | undefined {
	const status = STATUS_PATTERNS.map((pattern) => pattern.exec(text)?.groups?.['status']).find(
		(found) => found !== undefined,
	)

	return status === undefined ? undefined : Number(status)
}

// A limited status alone is not enough — a 403 is also an org policy or a missing scope — so the
// limit has to be named, by GitHub's message or by a spent `x-ratelimit-remaining`.
function is_exhausted(text: string): boolean {
	if (RATE_LIMIT_MESSAGE.test(text)) return true
	const status = status_of(text)

	return status !== undefined && RATE_LIMIT_STATUSES.has(status) && EXHAUSTED_HEADER.test(text)
}

function epoch_to_date(epoch: string | undefined): Date | undefined {
	const seconds = Number(epoch)
	if (epoch === undefined || !Number.isSafeInteger(seconds) || seconds <= 0) return undefined

	return new Date(seconds * MILLISECONDS_PER_SECOND)
}

// `GET /rate_limit` does not count against the limit it reports. A failed read answers `undefined`.
async function read_reset(): Promise<Date | undefined> {
	try {
		const epoch = await git_gh_exec.exec_gh_api({
			path: 'rate_limit',
			jq_filter: '.resources.core.reset',
			should_retry: false,
		})

		return epoch_to_date(epoch.trim())
	} catch (error) {
		error_text.trace_swallowed('gh_rate_limit.read_reset', error)

		return undefined
	}
}

function exhausted_message(resets_at: Date | undefined): string {
	const when = resets_at === undefined ? 'at an unread time' : `at ${resets_at.toISOString()}`

	return `GitHub rate limit exhausted, resets ${when} — wait for the reset; this is not an authentication failure, so do not refresh gh auth`
}

// The hint beside a failed GitHub read; the reset comes from the response headers when present.
async function failure_hint(text: string): Promise<string> {
	if (!is_exhausted(text)) return AUTH_HINT

	const resets_at =
		epoch_to_date(RESET_HEADER.exec(text)?.groups?.['epoch']) ?? (await read_reset())

	return exhausted_message(resets_at)
}

const gh_rate_limit = { AUTH_HINT, exhausted_message, failure_hint, is_exhausted }

export { gh_rate_limit }
