import { CHECK_STATUS_PENDING, type PrStateSnapshot, type RollupCheck } from './git-pr-checks-parse'

// **A context the base branch requires that has no check-run once every other check has settled**
// (joshuafolkken/kit#5774). GitHub holds such a pull request `BLOCKED` forever while every check it
// does show is green, so the wait read it as `pending` and ran its whole 32-minute budget out into a
// timeout that named nothing — a partial rerun had dropped the required `Checks` job from its run's
// latest attempt. Naming it ends the wait on the poll that sees it.
//
// **The required list is the base branch's rules** (`git-gh-branch-rules.ts`), the list GitHub blocks
// the merge on. With no rule known nothing is missing, so an unreadable ruleset keeps the wait exactly
// as it was. A `CLEAN` pull request has met its requirements whatever the rollup shows, and a rollup
// with a check still pending may yet register the missing one, so neither is a failure.

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

function collect_missing_contexts(snapshot: PrStateSnapshot): Array<string> {
	if (snapshot.merge_state_status === MERGE_STATE_CLEAN || !is_settled(snapshot.rollup)) return []

	return (snapshot.required_contexts ?? []).filter((context) =>
		snapshot.rollup.every((check) => !is_required_match(check.name, context)),
	)
}

function describe_missing_context(context: string): string {
	return `required context ${context} has no check-run`
}

export { collect_missing_contexts, describe_missing_context, is_required_match }
