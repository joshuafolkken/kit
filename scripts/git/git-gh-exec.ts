import { execa, execaSync } from 'execa'
import { check_gh_installed } from './git-gh-check'

const BODY_FROM_STDIN = '-'

// The budget for **one** request through this layer, and the reason nothing here waits forever
// (joshuafolkken/kit#1065). Every GitHub access kit makes funnels through the four entries below, so
// until this existed a single hung `gh` held the caller open with no upper bound — most visibly in
// `josh propagate`, whose runner is single-threaded and processed no further consumer at all.
//
// **It is a request's budget, not a step's.** `STEP_TIMEOUT_MS` (30 minutes, `propagate-steps.ts`)
// covers a consumer's whole unit suite and a `pnpm add`; one REST call has no business borrowing
// that number. The value is read off what the callers actually do instead:
//
// - `CHECK_WAIT_INTERVAL_MS` is 10 seconds — the merge gate's poll cadence. A request still in
//   flight six polls later is not slow, it is stuck.
// - `PR_CHECKS_WATCH_TIMEOUT_MS` is 120 seconds: `followup`'s look-ahead, which bounds its own
//   *sleeps* rather than the wall clock, so each poll's requests sit on top of it. A request allowed
//   to outlast that whole window would make the budget meaningless; half of it keeps one request
//   from dominating the look-ahead.
// - kit's other `gh` spawns already sit at 5 seconds (`repo-setting.ts`) and 20
//   (`propagate-publish.ts`, `epic-cross-repo.ts`). Sixty is deliberately the most generous of them,
//   because this entry also serves `--paginate` requests — several HTTP round trips inside one
//   spawn — which a 5-second budget would break.
//
// The aggregate is not what this bounds and must not be read as one: `followup` makes roughly 573
// requests across a 32-minute wait, and what caps that wait is its own attempt count. All this
// guarantees is that no single request holds it forever.
//
// **What a timed-out read costs its caller is decided by that caller, and two are worth naming.**
// In the merge gate's poll loop (`wait_for_pr_success`) it ends the wait — but so does every other
// failed read there already, since `attempt_pr_success_poll` has no per-attempt catch: a 403, a
// rate limit and a dropped connection all reject out of the loop today. A timeout joins that set
// rather than creating it, the run fails loudly instead of hanging, and re-running `followup`
// resumes the wait. Turning any of them into a retry is a separate judgement
// (joshuafolkken/kit#1065 → "out of scope"). In `followup`'s look-ahead it costs a log line:
// `handle_watch_failure` absorbs the error and falls through to the polling.
//
// **A timed-out *write* is not proof the write did not land.** The request may have reached GitHub
// before the spawn was killed, so a caller that retries one can duplicate it — `josh propagate`'s
// consumer issue is the case, and it reports the step as failed rather than retrying for exactly
// that reason. This is not new with the budget (a dropped connection has always had the property),
// but the budget makes it reachable on a healthy network, so it is written down here.
const GH_REQUEST_TIMEOUT_MS = 60_000

// **The override is a field on the request, not a second argument.** Every other knob on this layer
// — `method`, `body`, `should_paginate`, `should_slurp`, `jq_filter` — is already a field of
// `GhApiRequest`, and a budget is one more property of the request rather than of the call; putting
// it in a positional slot would be the only property of a request described somewhere else, and both
// `exec_gh_api` and `exec_gh_api_sync` would have to thread it separately. None of the ~27 REST call
// sites overrides it today, so a positional argument would buy no ergonomics it could spend.
//
// The two `gh`-command entries take it as a plain forwarded parameter instead: they have no call
// site outside this module — they exist as `exec_gh_api`'s transport — so there is no calling
// convention out there for them to keep consistent with.
function to_timeout_option(timeout_ms?: number): { timeout: number } {
	return { timeout: timeout_ms ?? GH_REQUEST_TIMEOUT_MS }
}

// What a request that ran out of time is labelled with, ahead of whatever gh managed to write.
//
// The distinction is joshuafolkken/kit#1048's, on a new failure: "the server said no" and "nobody
// ever got an answer" are different diagnoses, and a timeout is the second. execa names it on the
// error it throws, and without the prefix a hang that had written a line to stderr first would
// arrive as that line — reported as whatever it happened to say instead of as a timeout.
const GH_REQUEST_TIMEOUT_MESSAGE = 'gh request timed out'

function has_stderr_field(error: unknown): error is Error & { stderr: string } {
	return error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
}

// execa attaches the captured output to the error it throws, which is where the status line lands
// when `gh api` exits non-zero — the case the whole probe exists for.
function has_stdout_field(error: unknown): error is Error & { stdout: string } {
	return error instanceof Error && 'stdout' in error && typeof error.stdout === 'string'
}

// execa marks a spawn it killed on the timeout, which is the only reliable way to tell one from any
// other non-zero exit — gh writes nothing of its own when it is killed.
function has_timed_out_field(error: unknown): error is Error & { timedOut: boolean } {
	return error instanceof Error && 'timedOut' in error && typeof error.timedOut === 'boolean'
}

function to_timeout_prefix(error: unknown): string {
	return has_timed_out_field(error) && error.timedOut ? `${GH_REQUEST_TIMEOUT_MESSAGE}: ` : ''
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
	const detail = stdout.length > 0 ? `${summary}\n${stdout}` : summary

	return new Error(`${to_timeout_prefix(error)}${detail}`, { cause: error })
}

async function exec_gh_command(arguments_: Array<string>, timeout_ms?: number): Promise<string> {
	await check_gh_installed()

	try {
		const { stdout } = await execa('gh', arguments_, to_timeout_option(timeout_ms)) // NOSONAR S8705: execa array args (no shell), trusted dev CLI tooling

		return stdout.trimEnd()
	} catch (error) {
		throw to_gh_error(error)
	}
}

async function exec_gh_command_with_stdin(input: {
	args: Array<string>
	stdin_body: string
	// `number | undefined` rather than plain optional: `exec_gh_api` forwards its own optional field,
	// which `exactOptionalPropertyTypes` will not narrow for it.
	timeout_ms?: number | undefined
}): Promise<string> {
	await check_gh_installed()

	// Built ahead of the call so the spawn itself stays on one line: `// NOSONAR` suppresses the rule
	// only on the line it sits on, and a wrapped call moves that line away from the reported one.
	const options = { input: input.stdin_body, ...to_timeout_option(input.timeout_ms) }

	try {
		const { stdout } = await execa('gh', input.args, options) // NOSONAR S8705: execa array args (no shell), trusted dev CLI tooling

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
//
// **The fifth spawn in this file, and guarded like the other four** (joshuafolkken/kit#1065). It is
// not one of the entries joshuafolkken/kit#1065 enumerated, and that is exactly why it is included:
// leaving one unbounded `gh` spawn beside four bounded ones is the inconsistency that Issue argues
// against, in the same file. Its contract is unchanged — a timeout reaches the `catch` and answers
// `undefined`, which already means "no status was reached", which its one caller already reads as a
// failed read rather than as a 404.
async function exec_gh_api_status(path: string, timeout_ms?: number): Promise<number | undefined> {
	// Hoisted so the spawn below fits on one line, which `// NOSONAR` requires — it suppresses only
	// the line it sits on. The **argument list** stays an inline literal for the opposite reason:
	// `gh-subcommand-guard.ts` resolves the subcommand from it, and hoisting that into a `const`
	// makes the scan report `<dynamic>` instead of `api`, leaving a future edit to
	// `['issue', 'view', …]` uncaught (joshuafolkken/kit#1063).
	const options = to_timeout_option(timeout_ms)

	try {
		await check_gh_installed()
		const { stdout } = await execa('gh', ['api', '--include', '--silent', path], options) // NOSONAR S8705: execa array args (no shell), trusted dev CLI tooling

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
	// The budget for this one request, overriding `GH_REQUEST_TIMEOUT_MS`. A field rather than a
	// second argument for the reason recorded beside that constant (joshuafolkken/kit#1065).
	timeout_ms?: number
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

	if (request.body === undefined) return await exec_gh_command(args, request.timeout_ms)

	return await exec_gh_command_with_stdin({
		args,
		stdin_body: request.body,
		timeout_ms: request.timeout_ms,
	})
}

// The synchronous twin of `exec_gh_api`, for a caller that cannot await. `josh propagate` runs each
// consumer's steps as a sequential chain of `execaSync` spawns with inherited stdio, and that shape
// reaches from `open_issue` up through `RunStep`, `run_target` and `run_targets` — so the issue it
// opens in the consumer is created here rather than by turning the whole runner asynchronous for
// one request (joshuafolkken/kit#1042).
//
// It is the **write** side's synchronous entry, and the only one so far. The synchronous *readers*
// named above `exec_gh_api` — `gh-spawn.ts`, `epic-cross-repo.ts`, `repo-setting.ts`,
// `propagate-publish.ts`, `version-remote.ts` — each spell their own `['api', path, '--jq', …]` out
// and share only the path builder; a read has no body and no verb to get wrong, which is why they
// were left as they are rather than migrated here in passing.
//
// **It is the same layer, not a second one.** The argument builder and the error translation are
// shared with the asynchronous path above, so `--input -` for the body, `--jq` for the unwrap, and
// the failure text that carries the JSON reason REST writes to stdout are each defined once.
//
// The body travels over stdin here too: `execaSync` accepts `input`, so multi-line markdown depends
// on no shell quoting — the same property `exec_gh_command_with_stdin` gives the asynchronous path.
//
// `check_gh_installed` is the one thing it cannot share, because it awaits. A missing gh surfaces as
// the spawn's own failure and is reported like any other, which is what the direct spawn this
// replaced already did.
function exec_gh_api_sync(request: GhApiRequest): string {
	const body_option = request.body === undefined ? {} : { input: request.body }
	const options = { ...body_option, ...to_timeout_option(request.timeout_ms) }

	try {
		const { stdout } = execaSync('gh', to_gh_api_args(request), options) // NOSONAR S8705: execa array args (no shell), trusted dev CLI tooling

		return stdout.trimEnd()
	} catch (error) {
		throw to_gh_error(error)
	}
}

const git_gh_exec = {
	exec_gh_command,
	exec_gh_command_with_stdin,
	exec_gh_api,
	exec_gh_api_sync,
	exec_gh_api_status,
	parse_status_line,
}

export type { GhApiRequest }
export { git_gh_exec, has_stderr_field, has_stdout_field }
export { BODY_FROM_STDIN, GH_REQUEST_TIMEOUT_MESSAGE, GH_REQUEST_TIMEOUT_MS }
