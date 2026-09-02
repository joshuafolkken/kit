import {
	CHECK_STATUS_FAIL,
	CHECK_STATUS_MISSING,
	CHECK_STATUS_PASS,
	type PrStateSnapshot,
	type RollupCheck,
} from './git-pr-checks-parse'

// cspell:words coderabbit
// Temporary (kit#753): CodeRabbit is excluded from the default required checks so slow or
// rate-limited CodeRabbit reviews never block the merge gate. Re-add it via JOSH_REQUIRED_CHECKS
// to restore the old behavior. Revert once the fresh-context review subagent (kit#752) replaces it.
const DEFAULT_REQUIRED_CHECKS = ['SonarQube']
// The single source of the check name every CodeRabbit exemption is keyed on — the merge gate's
// `is_unstable_only_from_coderabbit`, the look-ahead's `is_awaited_check`, and the fixtures the two
// are tested from. A second literal spelling of it anywhere is how one of them silently stops
// matching after CodeRabbit renames its context (joshuafolkken/kit#1217).
const CODERABBIT_CHECK_NAME = 'CodeRabbit'
const REQUIRED_CHECKS_ENV_VAR = 'JOSH_REQUIRED_CHECKS'

function parse_required_checks(): ReadonlyArray<string> {
	const raw = process.env[REQUIRED_CHECKS_ENV_VAR]

	if (!raw) return DEFAULT_REQUIRED_CHECKS

	return raw
		.split(',')
		.map((check) => check.trim())
		.filter((check) => check.length > 0)
}

const REQUIRED_CHECKS = parse_required_checks()
const MERGE_STATE_CLEAN = 'CLEAN'
const MERGE_STATE_UNSTABLE = 'UNSTABLE'
const REVIEW_CHANGES_REQUESTED = 'CHANGES_REQUESTED'
// GitHub reports a check-suite job as `<App> / <Job>` (e.g. `CodeRabbit / Review`). A required
// check name matches that suite when it is the `<App>` segment, so the required-check list stays the
// bare app name even after the provider renames its job.
const CHECK_SUITE_SEPARATOR = ' / '
const FAILURE_MESSAGE_PREFIX = 'PR checks failed'
const FAILURE_REASON_REVIEW = 'review requested changes'
const FAILURE_REASON_CHECKS = 'failed checks'

type PrEvaluation = 'success' | 'pending' | 'failure'

// A required check matches either its exact context name or a check-suite job nested under it
// (`<required> / <job>`). The separator keeps the prefix anchored, so an unrelated context such as
// `CodeRabbitNightly` does not satisfy a required `CodeRabbit`.
function is_required_match(check_name: string, required_name: string): boolean {
	if (check_name === required_name) return true

	return check_name.startsWith(`${required_name}${CHECK_SUITE_SEPARATOR}`)
}

function find_required_check(
	checks: ReadonlyArray<RollupCheck>,
	required_name: string,
): RollupCheck | undefined {
	return checks.find((check) => is_required_match(check.name, required_name))
}

function read_required_statuses(checks: ReadonlyArray<RollupCheck>): Array<string> {
	return REQUIRED_CHECKS.map(
		(name) => find_required_check(checks, name)?.status ?? CHECK_STATUS_MISSING,
	)
}

function is_review_blocked(review_decision: string | undefined): boolean {
	return review_decision === REVIEW_CHANGES_REQUESTED
}

// A required check whose status is `fail` is by definition a rollup entry that
// `collect_blocking_failures` already names, so the required list needs no condition of its own
// here — see `is_blocking_failure`.
function evaluate_failure_state(input: {
	review_decision: string | undefined
	failed_checks: ReadonlyArray<string>
}): PrEvaluation | undefined {
	if (is_review_blocked(input.review_decision)) return 'failure'
	if (input.failed_checks.length > 0) return 'failure'

	return undefined
}

function is_merge_state_clean(merge_state_status: string | undefined): boolean {
	return merge_state_status === MERGE_STATE_CLEAN
}

function is_every_required_passing(statuses: ReadonlyArray<string>): boolean {
	return statuses.every((status) => status === CHECK_STATUS_PASS)
}

function is_coderabbit_check(check_name: string): boolean {
	return is_required_match(check_name, CODERABBIT_CHECK_NAME)
}

// Temporary (kit#753): a pending or failing CodeRabbit check makes GitHub report UNSTABLE even
// though CodeRabbit is no longer required. Accept that state only when CodeRabbit checks are the
// sole non-passing ones — any other non-passing check keeps the gate strict.
function is_unstable_only_from_coderabbit(snapshot: PrStateSnapshot): boolean {
	if (snapshot.merge_state_status !== MERGE_STATE_UNSTABLE) return false
	const non_passing = snapshot.rollup.filter((check) => check.status !== CHECK_STATUS_PASS)
	if (non_passing.length === 0) return false

	return non_passing.every((check) => is_coderabbit_check(check.name))
}

function is_required_check(check_name: string): boolean {
	return REQUIRED_CHECKS.some((required) => is_required_match(check_name, required))
}

// A failing job outside the required list used to decide nothing: GitHub reports the pull request as
// UNSTABLE rather than failed, so `evaluate_pr_state` answered `pending` and the wait ran out its
// whole 32-minute budget before ending in a timeout that never named the cause
// (joshuafolkken/kit#990). Any failed check therefore ends the wait now — except CodeRabbit's, which
// kit#753 keeps non-blocking end to end, unless a project has put it back on the required list via
// `JOSH_REQUIRED_CHECKS`. This only makes the gate report sooner: nothing here can produce
// `success`, so no failing check gains a path to a merge. What counts as failed is whatever the
// parser records as `fail` — `cancelled` and `timed_out` among them — which is the rule the required
// list has always followed; the cost is that a job cancelled and re-run by hand is no longer picked
// up by a wait already in progress, and `followup` has to be run again.
function is_blocking_failure(check: RollupCheck): boolean {
	if (check.status !== CHECK_STATUS_FAIL) return false

	return !is_coderabbit_check(check.name) || is_required_check(check.name)
}

function collect_blocking_failures(snapshot: PrStateSnapshot): Array<string> {
	return snapshot.rollup.filter((check) => is_blocking_failure(check)).map((check) => check.name)
}

function is_mergeable_state(snapshot: PrStateSnapshot): boolean {
	if (is_merge_state_clean(snapshot.merge_state_status)) return true

	return is_unstable_only_from_coderabbit(snapshot)
}

// The wait's own error text: naming the checks that failed is what turns a red `followup` into
// something actionable without opening the pull request (joshuafolkken/kit#990).
function collect_failure_reasons(snapshot: PrStateSnapshot): Array<string> {
	const reasons: Array<string> = []
	if (is_review_blocked(snapshot.review_decision)) reasons.push(FAILURE_REASON_REVIEW)
	const failed = collect_blocking_failures(snapshot)
	if (failed.length > 0) reasons.push(`${FAILURE_REASON_CHECKS}: ${failed.join(', ')}`)

	return reasons
}

function describe_pr_failure(snapshot: PrStateSnapshot): string {
	const reasons = collect_failure_reasons(snapshot)
	if (reasons.length === 0) return `${FAILURE_MESSAGE_PREFIX}.`

	return `${FAILURE_MESSAGE_PREFIX} (${reasons.join('; ')}).`
}

function evaluate_pr_state(snapshot: PrStateSnapshot): PrEvaluation {
	const statuses = read_required_statuses(snapshot.rollup)
	const failure = evaluate_failure_state({
		review_decision: snapshot.review_decision,
		failed_checks: collect_blocking_failures(snapshot),
	})

	if (failure !== undefined) return failure

	if (is_mergeable_state(snapshot) && is_every_required_passing(statuses)) {
		return 'success'
	}

	return 'pending'
}

// **When the review listing can still change what this poll concludes.**
//
// `evaluate_pr_state` reads `review_decision` in exactly one place — `is_review_blocked`, which
// produces `failure`. So a poll that answers `pending` without one answers `pending` or `failure`
// with it, and neither merges: the read buys nothing on that poll. A poll that answers `success` or
// `failure` without one is a poll that ends the wait, and both need it — `success` because a standing
// change request must demote it, `failure` because `describe_pr_failure` names the reasons and
// dropping "review requested changes" from a message that also lists failed checks loses half the
// diagnosis (joshuafolkken/kit#1043).
//
// **This is a freshness rule, not a cache.** Nothing is remembered between polls, which is the one
// shape that would be wrong here — a stale non-blocking decision is exactly the direction that ships
// a merge past a change request. The poll that concludes a merge always carries a review decision
// read in that same poll.
//
// **What it costs, stated rather than glossed.** A change request standing on a pull request whose
// checks never settle used to end the wait on the first poll with `review requested changes`; it now
// runs the budget out and ends with the wait's own timeout, which names no cause. That run was red
// either way — the trade only ever moves a red result later, never a green one earlier — but the
// diagnosis is genuinely worse in that one case.
function is_review_decision_decisive(snapshot: PrStateSnapshot): boolean {
	return evaluate_pr_state(snapshot) !== 'pending'
}

const git_pr_checks_eval = {
	evaluate_pr_state,
	is_review_decision_decisive,
	read_required_statuses,
	is_coderabbit_check,
	collect_blocking_failures,
	describe_pr_failure,
}

export {
	git_pr_checks_eval,
	evaluate_pr_state,
	is_review_decision_decisive,
	read_required_statuses,
	is_coderabbit_check,
	collect_blocking_failures,
	describe_pr_failure,
	REQUIRED_CHECKS,
	CODERABBIT_CHECK_NAME,
	is_required_check,
}
export type { PrEvaluation }
