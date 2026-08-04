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

function evaluate_failure_state(input: {
	review_decision: string | undefined
	statuses: ReadonlyArray<string>
}): PrEvaluation | undefined {
	if (is_review_blocked(input.review_decision)) return 'failure'
	if (input.statuses.includes(CHECK_STATUS_FAIL)) return 'failure'

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

function is_mergeable_state(snapshot: PrStateSnapshot): boolean {
	if (is_merge_state_clean(snapshot.merge_state_status)) return true

	return is_unstable_only_from_coderabbit(snapshot)
}

function evaluate_pr_state(snapshot: PrStateSnapshot): PrEvaluation {
	const statuses = read_required_statuses(snapshot.rollup)
	const failure = evaluate_failure_state({
		review_decision: snapshot.review_decision,
		statuses,
	})

	if (failure !== undefined) return failure

	if (is_mergeable_state(snapshot) && is_every_required_passing(statuses)) {
		return 'success'
	}

	return 'pending'
}

const git_pr_checks_eval = {
	evaluate_pr_state,
	read_required_statuses,
	is_coderabbit_check,
}

export {
	git_pr_checks_eval,
	evaluate_pr_state,
	read_required_statuses,
	is_coderabbit_check,
	REQUIRED_CHECKS,
}
export type { PrEvaluation }
