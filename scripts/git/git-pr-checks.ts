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

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
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

async function attempt_pr_success_poll(input: {
	options: WaitForPrSuccessOptions
	stable_count: number
	attempt: number
}): Promise<{ snapshot?: PrStateSnapshot; next_stable_count: number }> {
	const evaluator = input.options.evaluator ?? MERGE_GATE_EVALUATOR
	const snapshot = await input.options.fetcher(
		input.options.branch_name,
		evaluator.should_read_review_decision ?? SHOULD_ALWAYS_READ_REVIEW_DECISION,
	)
	const classification = classify_poll_result({
		snapshot,
		stable_count: input.stable_count,
		required_stable_reads: input.options.required_stable_reads,
		evaluator,
	})

	if (classification.is_done) return { snapshot, next_stable_count: 0 }

	if (input.attempt < input.options.max_attempts - 1) {
		await sleep(input.options.interval_ms)
	}

	return { next_stable_count: classification.next_stable_count }
}

async function wait_for_pr_success(options: WaitForPrSuccessOptions): Promise<PrStateSnapshot> {
	let stable_count = 0

	for (let attempt = 0; attempt < options.max_attempts; attempt += 1) {
		console.info(`Checking PR status… (${String(attempt + 1)}/${String(options.max_attempts)})`)
		const result = await attempt_pr_success_poll({ options, stable_count, attempt })

		if (result.snapshot !== undefined) return result.snapshot
		stable_count = result.next_stable_count
	}

	throw new Error(PR_CHECKS_TIMEOUT_MESSAGE)
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
