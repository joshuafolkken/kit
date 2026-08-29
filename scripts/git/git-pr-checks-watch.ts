import {
	CHECK_WAIT_INTERVAL_MS,
	compute_max_attempts,
	default_fetch_pr_state,
	DEFAULT_STABLE_READS,
	is_pr_checks_timeout,
	SECONDS_TO_MS,
	wait_for_pr_success,
	type PrStateEvaluator,
} from './git-pr-checks'
import type { PrEvaluation } from './git-pr-checks-eval'
import {
	CHECK_STATUS_FAIL,
	CHECK_STATUS_PENDING,
	type PrStateSnapshot,
} from './git-pr-checks-parse'

// The bounded look at a pull request's checks that `gh pr checks <branch> --watch` used to give.
//
// **`--watch` is a streaming call and REST has no counterpart** — it holds the connection open and
// redraws a table as each check settles, which no sequence of `gh api` requests reproduces
// (joshuafolkken/kit#1022). What it is *used* for does have one: `git-pr-followup.ts` discards its
// result entirely and `git-pr.ts` reads only `timed_out`, so the answer both callers need is "did
// the checks settle within two minutes", which the poll loop in `git-pr-checks.ts` already computes.
// No new loop is written here; this is that loop with a two-minute budget
// (joshuafolkken/kit#1028).
//
// **What is lost is the live table.** `gh` printed each check's name and state as it changed; the
// poll prints `Checking PR status… (n/N)` instead. The trade is accepted because the display was
// never load-bearing — no caller parsed it — and because keeping it would have left the merge gate's
// last GraphQL call in place, which is a 403 in a cloud session.

// The polling budget, unchanged from the `execa` timeout it replaces and still expressed in
// milliseconds because `git-gh-command.test.ts` asserts it in that unit. It bounds the *sleeps*
// rather than the wall clock: each poll's own requests sit on top, so a slow API overruns it
// slightly — which the killed subprocess it replaces did not.
const PR_CHECKS_WATCH_TIMEOUT_MS = 120_000
const WATCH_TIMED_OUT_NOTE = '⏱️ pr checks --watch timed out.'
const NO_CHECKS_MESSAGE = 'gh api reported no checks on the branch'
const CHECKS_FAILED_MESSAGE = 'gh api reported a failing check on the branch'

interface WatchResult {
	timed_out: boolean
}

// **The watch asks a weaker question than the merge gate, and that difference is load-bearing.**
// `evaluate_pr_state` answers `success` only for a pull request that is *mergeable*: `CLEAN` merge
// state, every required check green, no change request standing. `gh pr checks --watch` knew nothing
// about any of that — it waited for the checks and exited non-zero if one failed. Handing the watch
// the merge gate's verdict would break both callers on a repository that requires an approving
// review, where `mergeable_state` is `blocked`: the watch could never succeed, `git-pr.ts` would
// print "CI still running" over a green build, and a standing change request would make
// `pnpm josh git` exit non-zero on something the old watch ignored outright.
//
// **An empty rollup is `pending`, not `failure`** — deliberately, and it is the one place the watch
// answers differently on the first poll than at the end. `git-pr.ts` starts this five seconds after
// opening the pull request, where GitHub routinely has not attached a single check run yet; failing
// there would make `pnpm josh git` exit red on a perfectly healthy run. Whether the branch really
// has no checks is asked once, after the budget runs out — see `pr_checks_watch`.
function evaluate_checks_settled(snapshot: PrStateSnapshot): PrEvaluation {
	if (snapshot.rollup.length === 0) return 'pending'
	if (snapshot.rollup.some((check) => check.status === CHECK_STATUS_PENDING)) return 'pending'

	return snapshot.rollup.some((check) => check.status === CHECK_STATUS_FAIL) ? 'failure' : 'success'
}

function describe_checks_failure(snapshot: PrStateSnapshot): string {
	const failed = snapshot.rollup.filter((check) => check.status === CHECK_STATUS_FAIL)

	return `${CHECKS_FAILED_MESSAGE}: ${failed.map((check) => check.name).join(', ')}`
}

const CHECKS_SETTLED_EVALUATOR: PrStateEvaluator = {
	evaluate: evaluate_checks_settled,
	describe: describe_checks_failure,
}

async function watch_until_settled(branch_name: string): Promise<void> {
	await wait_for_pr_success({
		branch_name,
		fetcher: default_fetch_pr_state,
		interval_ms: CHECK_WAIT_INTERVAL_MS,
		max_attempts: compute_max_attempts(
			PR_CHECKS_WATCH_TIMEOUT_MS / SECONDS_TO_MS,
			CHECK_WAIT_INTERVAL_MS,
		),
		required_stable_reads: DEFAULT_STABLE_READS,
		evaluator: CHECKS_SETTLED_EVALUATOR,
	})
}

// `gh pr checks` exited non-zero for a branch with no checks at all just as it did for a failed one,
// and `git-pr-followup.ts` relies on that to fail rather than spend its whole 32-minute budget on a
// required check that is *missing* rather than pending (joshuafolkken/kit#999). Asking after the
// budget rather than on every poll is what keeps a pull request whose checks have not registered yet
// from failing on the first read: two minutes is the grace, and an empty rollup at the end of them
// is the answer `gh` gave immediately.
async function fail_when_no_checks(branch_name: string): Promise<void> {
	const snapshot = await default_fetch_pr_state(branch_name)
	if (snapshot.rollup.length === 0) throw new Error(NO_CHECKS_MESSAGE)
}

// Running out the budget is the answer `timed_out` carries, exactly as the killed `gh` process was.
// Everything else — a failing check, an unreadable read, a branch with no checks — is rethrown, which
// is what the two callers already handle: `git-pr.ts` shows the pull request URL and gives up on the
// wait, `git-pr-followup.ts` swallows it and falls through to its own poll.
async function pr_checks_watch(branch_name: string): Promise<WatchResult> {
	try {
		await watch_until_settled(branch_name)

		return { timed_out: false }
	} catch (error) {
		if (!is_pr_checks_timeout(error)) throw error
		await fail_when_no_checks(branch_name)
		console.info(WATCH_TIMED_OUT_NOTE)

		return { timed_out: true }
	}
}

const git_pr_checks_watch = { pr_checks_watch }

export {
	git_pr_checks_watch,
	fail_when_no_checks,
	CHECKS_SETTLED_EVALUATOR,
	evaluate_checks_settled,
	describe_checks_failure,
	PR_CHECKS_WATCH_TIMEOUT_MS,
	NO_CHECKS_MESSAGE,
	CHECKS_FAILED_MESSAGE,
}
export type { WatchResult }
