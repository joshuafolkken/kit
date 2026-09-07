import { poll } from '#scripts/poll'
import { git_gh_pr_snapshot } from './git-gh-pr-snapshot'
import {
	describe_pr_failure,
	evaluate_pr_state,
	is_review_decision_decisive,
	type PrEvaluation,
} from './git-pr-checks-eval'
import { parse_pr_state_snapshot, read_string, type PrStateSnapshot } from './git-pr-checks-parse'
import { package_name_schema } from './schemas'

const SECONDS_TO_MS = 1000
const CHECK_WAIT_INTERVAL_MS = 10_000
// The wait has to outlast what the CI it is watching is allowed to take, or it gives up on a run
// that is still legitimately progressing — which is what 180 seconds did to every consumer whose
// suite includes E2E: `followup` became a command that needed `JOSH_CI_TIMEOUT_SECONDS` set by hand
// on every invocation and, when that was forgotten, exited red beside a CI that was still running.
// The budget is therefore read off the distributed `templates/workflows/ci.yml` rather than picked
// as a round number: its longest chain is `e2e` (25 minutes) behind the `playwright-image` job it
// needs (2), so 27 minutes is the longest run that workflow permits, and five minutes of
// runner-queue headroom goes on top. A unit test walks the `needs` graph of the distributed
// workflows and fails if any declared budget outgrows this value; a job that declares no cap is a
// gap the number cannot promise to cover rather than a reason to inflate it. Waiting longer costs nothing on a fast project: polling returns as
// soon as the checks settle, and a failed check throws immediately rather than waiting out the
// budget. See joshuafolkken/kit#851.
const DEFAULT_TIMEOUT_SECONDS = 1920

// The poll loop sleeps between attempts and not after the last one, so spanning a budget takes one
// more attempt than the budget holds intervals: without the `+ 1` a 60-second setting waited 50.
function compute_max_attempts(timeout_seconds: number, interval_ms: number): number {
	return Math.ceil(timeout_seconds / (interval_ms / SECONDS_TO_MS)) + 1
}

const DEFAULT_MAX_ATTEMPTS = compute_max_attempts(DEFAULT_TIMEOUT_SECONDS, CHECK_WAIT_INTERVAL_MS)

function get_configured_max_attempts(): number {
	const environment_seconds = Number(process.env['JOSH_CI_TIMEOUT_SECONDS'])

	return Number.isFinite(environment_seconds) && environment_seconds > 0
		? compute_max_attempts(environment_seconds, CHECK_WAIT_INTERVAL_MS)
		: DEFAULT_MAX_ATTEMPTS
}

const CHECK_MAX_ATTEMPTS = get_configured_max_attempts()
const DEFAULT_STABLE_READS = 2

// **A read that failed is not a verdict.** The loop reads every ten seconds, so a dropped connection,
// a rate limit or one request over its budget is the kind of failure the *next* poll answers — and
// ending a 32-minute wait on one of them costs the whole run again. Before joshuafolkken/kit#1077
// every one of them rejected straight out of the loop, because the fetch had no `catch` at all.
//
// **The cap is what keeps "ask again" from becoming "wait out the budget in silence".** Three
// consecutive failures and the wait ends carrying the failure that caused it, so an endpoint that has
// stopped answering is reported as itself rather than as a timeout thirty minutes later. The counter
// is *consecutive*: any successful read puts it back to zero, because what it measures is "nobody is
// answering", not "the run has been unlucky".
//
// **The loop's own budget is unchanged**, so nothing here can extend a wait: a fetch that never
// succeeds still runs out of attempts. And a failed read never counts as a passing one — it resets
// the stable-read window, the same direction joshuafolkken/kit#925 / #950 / #973 / #1048 take.
const MAX_CONSECUTIVE_READ_FAILURES = 3

// The wait's own timeout, named so a caller can tell it apart from a failing check. The bounded
// watch in `git-pr-checks-watch.ts` answers `timed_out` for one and rethrows the other, and matching
// on prose is the only distinction the loop offers (joshuafolkken/kit#1028).
const PR_CHECKS_TIMEOUT_MESSAGE = 'Timed out while waiting for PR checks to complete.'

function is_pr_checks_timeout(error: unknown): boolean {
	return error instanceof Error && error.message === PR_CHECKS_TIMEOUT_MESSAGE
}

// Whether this poll has to read the review listing, asked of the snapshot *without* one. It is a
// question about the current poll rather than a cache key: answering `false` skips one request now
// and nothing is carried into the next poll (joshuafolkken/kit#1043).
type ReviewDecisionPredicate = (snapshot: PrStateSnapshot) => boolean

// The conservative answer, and the one every evaluator that does not say gets: read it every poll,
// which is what all of them did before the predicate existed.
const SHOULD_ALWAYS_READ_REVIEW_DECISION: ReviewDecisionPredicate = () => true

type PrStateFetcher = (
	branch_name: string,
	should_read_review_decision: ReviewDecisionPredicate,
) => Promise<PrStateSnapshot>

// What the loop asks of each snapshot, and what it says when the answer is `failure`.
//
// The loop used to hard-code the merge gate's own verdict, which is the strictest question anyone
// asks of a pull request: mergeable *and* every required check green *and* no change request
// standing. `gh pr checks --watch` asked a much weaker one — have the checks finished? — and the
// conversion in joshuafolkken/kit#1028 gave the watch the strict verdict by accident: on a repository
// whose `mergeable_state` is `blocked`, the watch could never succeed, and a standing change request
// made it *throw* out of `pnpm josh git`. Naming the question is what keeps the two apart.
//
// **`should_read_review_decision` is part of the same question.** An evaluator that never reads
// `review_decision` must not make the fetcher pay for it, and one that does must get a value read in
// the poll it decides on. Omitting it reads the listing on every poll, so a new evaluator is never
// silently cheaper than it is correct.
interface PrStateEvaluator {
	evaluate: (snapshot: PrStateSnapshot) => PrEvaluation
	describe: (snapshot: PrStateSnapshot) => string
	should_read_review_decision?: ReviewDecisionPredicate
}

// The merge gate's verdict, and the default: an omitted `evaluator` leaves every existing caller
// exactly where it was.
const MERGE_GATE_EVALUATOR: PrStateEvaluator = {
	evaluate: evaluate_pr_state,
	describe: describe_pr_failure,
	should_read_review_decision: is_review_decision_decisive,
}

interface WaitForPrSuccessOptions {
	branch_name: string
	fetcher: PrStateFetcher
	interval_ms: number
	max_attempts: number
	required_stable_reads: number
	evaluator?: PrStateEvaluator
}

function parse_repo_name_from_package(package_json_content: string): string {
	const result = package_name_schema.safeParse(JSON.parse(package_json_content))

	if (!result.success) {
		throw new Error('package.json name field is missing or not a non-empty string')
	}

	return result.data.name
}

function advance_stable_count(previous: number, state: PrEvaluation): number {
	return state === 'success' ? previous + 1 : 0
}

function classify_poll_result(input: {
	snapshot: PrStateSnapshot
	stable_count: number
	required_stable_reads: number
	evaluator: PrStateEvaluator
}): { is_done: boolean; next_stable_count: number } {
	const state = input.evaluator.evaluate(input.snapshot)

	if (state === 'failure') throw new Error(input.evaluator.describe(input.snapshot))

	const next_stable_count = advance_stable_count(input.stable_count, state)

	return {
		is_done: next_stable_count >= input.required_stable_reads,
		next_stable_count,
	}
}

interface PollAttempt {
	options: WaitForPrSuccessOptions
	stable_count: number
	failure_count: number
	attempt: number
}

interface PollAttemptResult {
	snapshot?: PrStateSnapshot
	next_stable_count: number
	next_failure_count: number
	// What this poll could not be read with, carried so that a wait ending on an unreadable poll can
	// report *that* rather than the timeout. Absent on every poll that was read.
	read_failure?: unknown
}

// The two things one poll can come back with, kept apart so that only the *read* is retried. The
// throw `classify_poll_result` raises on a `failure` verdict is an answer — the checks are red — and
// retrying it would undo the fast fail joshuafolkken/kit#990 added.
type SnapshotRead =
	{ kind: 'read'; snapshot: PrStateSnapshot } | { kind: 'unreadable'; cause: unknown }

async function read_pr_state(
	input: PollAttempt,
	evaluator: PrStateEvaluator,
): Promise<SnapshotRead> {
	try {
		const snapshot = await input.options.fetcher(
			input.options.branch_name,
			evaluator.should_read_review_decision ?? SHOULD_ALWAYS_READ_REVIEW_DECISION,
		)

		return { kind: 'read', snapshot }
	} catch (error) {
		return { kind: 'unreadable', cause: error }
	}
}

// The loop sleeps between attempts and not after the last one, so a poll that is about to be the
// final one returns immediately and lets the caller run out of attempts.
async function sleep_before_next_attempt(input: PollAttempt): Promise<void> {
	if (input.attempt < input.options.max_attempts - 1) {
		await poll.sleep(input.options.interval_ms)
	}
}

// The unreadable branch: count it, give up at the cap with the failure that caused it, and otherwise
// wait out the interval exactly as a pending poll does — without the sleep a broken endpoint would be
// spun on rather than re-read.
async function retry_after_unreadable(
	input: PollAttempt,
	cause: unknown,
): Promise<PollAttemptResult> {
	const next_failure_count = input.failure_count + 1
	if (next_failure_count >= MAX_CONSECUTIVE_READ_FAILURES) throw cause

	// The reason goes in the line. Where the next read succeeds nothing else ever reports these, and
	// an operator cannot tell a rate limit from expired auth from a dropped connection without it.
	console.warn(
		`Could not read the PR state (${String(next_failure_count)}/${String(MAX_CONSECUTIVE_READ_FAILURES)}); asking again on the next poll: ${String(cause)}`,
	)
	await sleep_before_next_attempt(input)

	return { next_stable_count: 0, next_failure_count, read_failure: cause }
}

// What the loop throws when it runs out of attempts. A wait whose **last** poll could not be read
// ends on that failure rather than on the timeout: reporting expired auth or a rate limit as "the
// checks are still running" is exactly the misread this file refuses everywhere else, and
// `is_pr_checks_timeout` would otherwise let `git-pr-checks-watch.ts` answer `timed_out` for it.
function to_exhaustion_error(last_read_failure: unknown): unknown {
	return last_read_failure ?? new Error(PR_CHECKS_TIMEOUT_MESSAGE)
}

async function attempt_pr_success_poll(input: PollAttempt): Promise<PollAttemptResult> {
	const evaluator = input.options.evaluator ?? MERGE_GATE_EVALUATOR
	const read = await read_pr_state(input, evaluator)
	if (read.kind === 'unreadable') return await retry_after_unreadable(input, read.cause)

	const classification = classify_poll_result({
		snapshot: read.snapshot,
		stable_count: input.stable_count,
		required_stable_reads: input.options.required_stable_reads,
		evaluator,
	})

	if (classification.is_done) {
		return { snapshot: read.snapshot, next_stable_count: 0, next_failure_count: 0 }
	}

	await sleep_before_next_attempt(input)

	return { next_stable_count: classification.next_stable_count, next_failure_count: 0 }
}

async function wait_for_pr_success(options: WaitForPrSuccessOptions): Promise<PrStateSnapshot> {
	// The whole carry-over of one poll into the next, in one value: the stable-read window, the
	// consecutive-failure count, and what the last poll could not be read with.
	let carried: PollAttemptResult = { next_stable_count: 0, next_failure_count: 0 }

	for (let attempt = 0; attempt < options.max_attempts; attempt += 1) {
		console.info(`Checking PR status… (${String(attempt + 1)}/${String(options.max_attempts)})`)
		carried = await attempt_pr_success_poll({
			options,
			stable_count: carried.next_stable_count,
			failure_count: carried.next_failure_count,
			attempt,
		})

		if (carried.snapshot !== undefined) return carried.snapshot
	}

	throw to_exhaustion_error(carried.read_failure)
}

// The snapshot module rather than `git-gh-command`, which is deliberate: `git-gh-command` also
// exposes the watch, and the watch now polls through this file (joshuafolkken/kit#1028). Naming the
// one read it actually needs keeps that from closing into an import cycle.
//
// **Three requests, and a fourth only where it can change the answer.** The pull request detail and
// the two commit listings are read every poll because `mergeable_state` and the rollup both move
// while CI runs; the review listing is read when the predicate says this poll's verdict turns on it.
// A `followup` that waits out its whole 32-minute budget went from about 800 requests to about 600
// (joshuafolkken/kit#1043).
async function default_fetch_pr_state(
	branch_name: string,
	should_read_review_decision: ReviewDecisionPredicate = SHOULD_ALWAYS_READ_REVIEW_DECISION,
): Promise<PrStateSnapshot> {
	const checks = await git_gh_pr_snapshot.pr_get_checks_snapshot(branch_name)
	const snapshot = parse_pr_state_snapshot(checks.snapshot_json)

	if (!should_read_review_decision(snapshot)) return snapshot

	const decision = await git_gh_pr_snapshot.pr_get_review_decision(checks.pr_number)

	return { ...snapshot, review_decision: read_string(decision) }
}

async function wait_for_pr_success_default(branch_name: string): Promise<PrStateSnapshot> {
	return await wait_for_pr_success({
		branch_name,
		fetcher: default_fetch_pr_state,
		interval_ms: CHECK_WAIT_INTERVAL_MS,
		max_attempts: CHECK_MAX_ATTEMPTS,
		required_stable_reads: DEFAULT_STABLE_READS,
	})
}

const git_pr_checks = {
	wait_for_pr_success: wait_for_pr_success_default,
}

export {
	git_pr_checks,
	parse_repo_name_from_package,
	wait_for_pr_success,
	compute_max_attempts,
	get_configured_max_attempts,
	DEFAULT_STABLE_READS,
	DEFAULT_MAX_ATTEMPTS,
	MAX_CONSECUTIVE_READ_FAILURES,
	DEFAULT_TIMEOUT_SECONDS,
	CHECK_WAIT_INTERVAL_MS,
	PR_CHECKS_TIMEOUT_MESSAGE,
	SECONDS_TO_MS,
	is_pr_checks_timeout,
	default_fetch_pr_state,
	MERGE_GATE_EVALUATOR,
	SHOULD_ALWAYS_READ_REVIEW_DECISION,
}
export type { PrStateFetcher, PrStateEvaluator, ReviewDecisionPredicate }
export {
	collect_blocking_failures,
	describe_pr_failure,
	evaluate_pr_state,
} from './git-pr-checks-eval'
export type { PrEvaluation } from './git-pr-checks-eval'
export { parse_pr_state_snapshot } from './git-pr-checks-parse'
export type { RollupCheck, PrStateSnapshot } from './git-pr-checks-parse'
