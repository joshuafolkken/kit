import { agent_exit_record } from '#scripts/agent/agent-exit-record'
import { api_usage_limit } from '#scripts/agent/api-usage-limit'
import { gh_core_rate_limit, type CoreRateLimit } from '#scripts/gh/gh-core-rate-limit'
import { transcript_record } from '#scripts/lib/transcript-record'
import { run_ending } from '#scripts/run/run-ending'
import { time_reported_failure } from '#scripts/time-runtime/time-reported-failure'
import { run_merge_usage_limit } from './run-merge-usage-limit'

// A returned child GitHub stopped rather than its own work — observed on 2026-11-05, when #6465's lane
// reached a green gate and a clean review, then ended on `API rate limit exceeded` (HTTP 403) before
// its CI read and merge, and was parked `run:stalled` against the failure guard (joshuafolkken/kit#6502).
// The same holds for an expired `gh` login. Both are re-dispatchable outages, never failed children.
//
// **The read is mechanical**: a line in `gh`'s own error shape, inside a tool result that ended in
// error among the transcript's last lines — never the child's prose, a file it read or a test's
// output, which can quote the same words. The child's exit record is rarely an error, since it stops
// on its own after `gh` fails, so it is not read; the tail keeps an earlier, recovered failure out. A
// rate limit holds launches until the exhausted resource resets (`gh api rate_limit`), read when the
// child is collected.

const RATE_LIMIT = 'rate-limit'

type GithubStop = typeof RATE_LIMIT | 'auth'

// How many of the transcript's last lines are read — the stop and the turns that reported it.
const TAIL_LINES = 20
// `HTTP 403: API rate limit exceeded` (REST), `GraphQL: API rate limit already exceeded` and the abuse
// limit's `gh: You have exceeded a secondary rate limit`, lower-cased, each a line of its own.
const RATE_LIMIT_PATTERN =
	/^(?:gh|graphql|http 403|http 429): .*(?:api rate limit (?:already )?exceeded|secondary rate limit)/mu
// `HTTP 401: Bad credentials`, and `gh`'s prompts to sign in again.
const AUTH_PATTERN =
	/^http 401: |^(?:try authenticating with|to get started with github cli, please run): +gh auth login/mu

function error_texts(line: string): ReadonlyArray<string> {
	const record = transcript_record.parse(line)

	if (record?.type !== 'user') return []

	return transcript_record
		.blocks_of(record)
		.filter((block) => block.type === transcript_record.TOOL_RESULT_TYPE && block.is_error === true)
		.map((block) => time_reported_failure.result_text(block.content))
}

// The errored tool results among the transcript's last lines, lower-cased.
function tail_errors(log: string): string {
	const lines = log.trimEnd().split('\n').slice(-TAIL_LINES)

	return lines
		.flatMap((line) => error_texts(line))
		.join('\n')
		.toLowerCase()
}

// The stop a transcript ends on, read only when it ends on an exit record — the lane's log is appended
// across launches (`api_auth.is_auth_failed_transcript`).
function stop_of(log: string | undefined): GithubStop | undefined {
	if (log === undefined || !agent_exit_record.ends_on_exit_record(log)) return undefined
	const tail = tail_errors(log)

	if (RATE_LIMIT_PATTERN.test(tail)) return RATE_LIMIT

	return AUTH_PATTERN.test(tail) ? 'auth' : undefined
}

// Off without `--output`, as the outage read is.
function read_stop(output: string | undefined): GithubStop | undefined {
	if (output === undefined) return undefined

	return stop_of(run_ending.read_transcript(output))
}

function is_exhausted(limit: CoreRateLimit | undefined, now_ms: number): boolean {
	return limit?.remaining === 0 && limit.reset_ms > now_ms
}

// When the exhausted resource resets; a secondary limit exhausts none, and an unread limit names no
// time, so either is re-checked `RECHECK_MS` on.
async function reset_ms(now_ms: number): Promise<number> {
	const resources = await gh_core_rate_limit.read_resources()
	const limits = [resources?.core, resources?.graphql]
	const exhausted = limits.find((limit) => is_exhausted(limit, now_ms))

	return exhausted?.reset_ms ?? now_ms + api_usage_limit.RECHECK_MS
}

// Records a rate-limit stop's reset on the usage-limit hold `backlog:drive` launches nothing before.
async function hold(child: string, output: string | undefined): Promise<void> {
	if (read_stop(output) !== RATE_LIMIT) return

	await run_merge_usage_limit.record(child, await reset_ms(Date.now()), 'GitHub rate limit')
}

const run_merge_github_limit = { hold, read_stop, reset_ms, stop_of }

export { run_merge_github_limit }
export type { GithubStop }
