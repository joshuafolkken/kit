import { setTimeout as delay } from 'node:timers/promises'
import { get_exit_code, has_timed_out } from '#scripts/git/git-execa-error'
import { error_text } from '#scripts/lib/error-message'
import { gh_failure } from './git-gh-failure'

// One REST request asked again, a bounded number of times, when GitHub failed it transiently
// (joshuafolkken/kit#4717). A single 502 on `review:record --comment` used to stop a whole ship stage
// and cost a relaunched session that changed nothing; the same request seconds later succeeds.
//
// **Transient is a 5xx or a request that got no answer at all** — a dropped connection writes no
// error document, so its status is `undefined`. A 4xx is the request's own fault and answers the same
// the next time. Three failures without a status are still not retried: a timeout (it has already
// spent a minute, and a write it killed may have landed — `GH_REQUEST_TIMEOUT_MS`'s note), an error
// `to_gh_error` never built (gh missing, a refused body), which no wait can change, and one that wrote
// a body anyway — a GraphQL `errors` document is served with a 200, so it names no status and is
// still GitHub's answer.
//
// **A retried write can land twice** when the first attempt reached GitHub before it failed. The
// writes on this path tolerate it: a duplicate pull request is refused with the 422 the creator reads
// (`handle_pr_create_error`), a repeated merge is read back by `has_merge_landed`, and at worst a
// review-round comment is posted twice — cheaper than the stopped stage it replaces. Issue creation
// has no such guard — a second issue opens and nothing reads the first back — so
// `issue_create_request` opts out with `should_retry: false`.

const FIRST_RETRY_DELAY_MS = 2000
const SECOND_RETRY_DELAY_MS = 5000
const RETRY_DELAYS_MS = [FIRST_RETRY_DELAY_MS, SECOND_RETRY_DELAY_MS]
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1
const SERVER_ERROR_FLOOR = 500
// gh's own exit code for "authentication required" (`gh auth login`, no `GH_TOKEN`). It writes no
// error document either, so without this it would read as a request that got no answer — and no
// wait logs anyone in.
const GH_AUTH_REQUIRED_EXIT_CODE = 4

// gh's own summary line for a failed request, e.g. `gh: Server Error (HTTP 502)`. It is the only
// place the status is written when the body is an HTML error page rather than GitHub's JSON document.
const SUMMARY_STATUS_PATTERN = /\(HTTP (?<status>\d{3})\)/u

interface RetryHooks {
	wait: (milliseconds: number) => Promise<void>
	note: (text: string) => void
}

const DEFAULT_HOOKS: RetryHooks = {
	wait: async (milliseconds) => {
		await delay(milliseconds)
	},
	note: (text) => {
		process.stderr.write(`${text}\n`)
	},
}

function summary_status(error: Error): number | undefined {
	const { status } = SUMMARY_STATUS_PATTERN.exec(error.message)?.groups ?? {}

	return status === undefined ? undefined : Number(status)
}

// Whether the failed spawn wrote a response body: a request that got no answer at all wrote none.
function has_answer(spawn_error: unknown): boolean {
	if (!(spawn_error instanceof Error) || !('stdout' in spawn_error)) return false

	return typeof spawn_error.stdout === 'string' && spawn_error.stdout.trim().length > 0
}

function is_transient_status(status: number | undefined, spawn_error: unknown): boolean {
	if (status === undefined) return !has_answer(spawn_error)

	return status >= SERVER_ERROR_FLOOR
}

// A spawn no wait can change: one it killed on its budget, or one gh refused before asking.
function is_final_spawn(spawn_error: unknown): boolean {
	return has_timed_out(spawn_error) || get_exit_code(spawn_error) === GH_AUTH_REQUIRED_EXIT_CODE
}

function is_transient(error: unknown): boolean {
	const failure = gh_failure.failure_of(error)

	if (failure === undefined || !(error instanceof Error)) return false

	const status = failure.status ?? summary_status(error)

	return !is_final_spawn(error.cause) && is_transient_status(status, error.cause)
}

function first_line(error: unknown): string {
	return error_text.message_of(error).split('\n', 1)[0] ?? ''
}

function retry_note(error: unknown, attempt: number, wait_ms: number): string {
	const ordinal = `${String(attempt)}/${String(MAX_ATTEMPTS)}`

	return `gh: request failed transiently (attempt ${ordinal}: ${first_line(error)}) — retrying in ${String(wait_ms)} ms`
}

// The wait before asking again, or `undefined` when this failure is final — not transient, or the
// last attempt spent.
function retry_delay(error: unknown, attempt: number): number | undefined {
	return is_transient(error) ? RETRY_DELAYS_MS[attempt - 1] : undefined
}

async function with_retry<T>(
	request: () => Promise<T>,
	hooks: RetryHooks = DEFAULT_HOOKS,
	attempt = 1,
): Promise<T> {
	try {
		return await request()
	} catch (error) {
		const wait_ms = retry_delay(error, attempt)

		if (wait_ms === undefined) throw error

		hooks.note(retry_note(error, attempt, wait_ms))
		await hooks.wait(wait_ms)

		return await with_retry(request, hooks, attempt + 1)
	}
}

const gh_retry = { MAX_ATTEMPTS, RETRY_DELAYS_MS, is_transient, with_retry }

export type { RetryHooks }
export { gh_retry }
