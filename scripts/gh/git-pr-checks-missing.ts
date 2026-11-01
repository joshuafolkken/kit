import { CHECK_STATUS_PENDING, type PrStateSnapshot, type RollupCheck } from './git-pr-checks-parse'

// **A context the base branch requires that has no check-run once every other check has settled**
// (joshuafolkken/kit#5774). GitHub holds such a pull request `BLOCKED` forever while every check it
// does show is green, so the wait read it as `pending` and ran its whole 32-minute budget out into a
// timeout that named nothing — a partial rerun had dropped the required `Checks` job from its run's
// latest attempt. Naming it ends the wait once the gap has outlasted a grace window.
//
// **The required list is the base branch's rules** (`git-gh-branch-rules.ts`), the list GitHub blocks
// the merge on. With no rule known nothing is missing, so an unreadable ruleset keeps the wait exactly
// as it was. A `CLEAN` pull request has met its requirements whatever the rollup shows, and a rollup
// with a check still pending may yet register the missing one, so neither is a failure.
//
// **A gap on one read is not yet a missing context.** GitHub creates a `needs:`-gated job's check-run
// only once its prerequisites finish (`Checks`, `E2E`), and an outside app's check (`SonarCloud Code
// Analysis`) can trail the job that triggered it — so a healthy run shows every check settled with a
// required one absent for a few seconds. The gap therefore has to hold for `MISSING_GRACE_MS` on the
// same head before it is named. What is remembered can only delay a failure, never produce a success,
// and a read where the context is present or a check is pending again forgets it.
const MISSING_GRACE_MS = 120_000

// GitHub reports a check-suite job as `<App> / <Job>` (e.g. `CodeRabbit / Review`). A required
// check name matches that suite when it is the `<App>` segment, so the required-check list stays the
// bare app name even after the provider renames its job.
const CHECK_SUITE_SEPARATOR = ' / '
const MERGE_STATE_CLEAN = 'CLEAN'

// A required check matches either its exact context name or a check-suite job nested under it
// (`<required> / <job>`). The separator keeps the prefix anchored, so an unrelated context such as
// `CodeRabbitNightly` does not satisfy a required `CodeRabbit`.
function is_required_match(check_name: string, required_name: string): boolean {
	if (check_name === required_name) return true

	return check_name.startsWith(`${required_name}${CHECK_SUITE_SEPARATOR}`)
}

function is_settled(rollup: ReadonlyArray<RollupCheck>): boolean {
	return rollup.length > 0 && rollup.every((check) => check.status !== CHECK_STATUS_PENDING)
}

// When each head's context was first read settled and absent, keyed `<head sha> <context>`.
const first_absent_at = new Map<string, number>()

function forget_missing_contexts(): void {
	first_absent_at.clear()
}

function absence_key(snapshot: PrStateSnapshot, context: string): string {
	return `${snapshot.head_sha ?? ''} ${context}`
}

function has_outlasted_grace(key: string, now: number): boolean {
	const first = first_absent_at.get(key)
	if (first !== undefined) return now - first >= MISSING_GRACE_MS
	first_absent_at.set(key, now)

	return false
}

function absent_from(
	rollup: ReadonlyArray<RollupCheck>,
	required: ReadonlyArray<string>,
): Array<string> {
	return required.filter((context) =>
		rollup.every((check) => !is_required_match(check.name, context)),
	)
}

function collect_absent_contexts(snapshot: PrStateSnapshot): Array<string> {
	if (snapshot.merge_state_status === MERGE_STATE_CLEAN || !is_settled(snapshot.rollup)) return []

	return absent_from(snapshot.rollup, snapshot.required_contexts ?? [])
}

function forget_present_contexts(snapshot: PrStateSnapshot, absent: ReadonlyArray<string>): void {
	const present = (snapshot.required_contexts ?? []).filter((context) => !absent.includes(context))
	for (const context of present) first_absent_at.delete(absence_key(snapshot, context))
}

function collect_missing_contexts(snapshot: PrStateSnapshot): Array<string> {
	const absent = collect_absent_contexts(snapshot)

	forget_present_contexts(snapshot, absent)
	const now = Date.now()

	return absent.filter((context) => has_outlasted_grace(absence_key(snapshot, context), now))
}

function describe_missing_context(context: string): string {
	return `required context ${context} has no check-run`
}

// **Why a wait that ran out of budget was still waiting** (joshuafolkken/kit#5780): the required checks
// and the base branch's required contexts the last read showed no check-run for — or, with none
// absent, the merge state GitHub held the pull request in. Read without the grace window, since the
// wait is already over. A `josh ship` park carries the line as its cause, so `run:board` shows it.
const BLOCKED_LEAD = 'BLOCKED: '
const MERGE_STATE_LEAD = 'mergeStateStatus: '

function blocked_cause(
	snapshot: PrStateSnapshot,
	required_checks: ReadonlyArray<string>,
): string | undefined {
	const required = [...new Set([...required_checks, ...(snapshot.required_contexts ?? [])])]
	const absent = absent_from(snapshot.rollup, required)
	if (absent.length > 0) return `${BLOCKED_LEAD}${absent.join(', ')} missing`
	if (snapshot.merge_state_status === undefined) return undefined

	return `${MERGE_STATE_LEAD}${snapshot.merge_state_status}`
}

function is_blocked_cause(message: string): boolean {
	return message.startsWith(BLOCKED_LEAD) || message.startsWith(MERGE_STATE_LEAD)
}

export {
	blocked_cause,
	collect_missing_contexts,
	describe_missing_context,
	forget_missing_contexts,
	is_blocked_cause,
	is_required_match,
	MISSING_GRACE_MS,
}
