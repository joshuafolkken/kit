import {
	CHECK_STATUS_FAIL,
	CHECK_STATUS_MISSING,
	CHECK_STATUS_PASS,
	type PrStateSnapshot,
	type RollupCheck,
} from './git-pr-checks-parse'

// cspell:words coderabbit
const DEFAULT_REQUIRED_CHECKS = ['CodeRabbit', 'SonarQube']
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

function evaluate_pr_state(snapshot: PrStateSnapshot): PrEvaluation {
	const statuses = read_required_statuses(snapshot.rollup)
	const failure = evaluate_failure_state({
		review_decision: snapshot.review_decision,
		statuses,
	})

	if (failure !== undefined) return failure

	if (is_merge_state_clean(snapshot.merge_state_status) && is_every_required_passing(statuses)) {
		return 'success'
	}

	return 'pending'
}

const git_pr_checks_eval = {
	evaluate_pr_state,
	read_required_statuses,
}

export { git_pr_checks_eval, evaluate_pr_state, read_required_statuses, REQUIRED_CHECKS }
export type { PrEvaluation }
