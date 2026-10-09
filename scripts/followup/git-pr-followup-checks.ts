import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_helpers } from '#scripts/gh/git-gh-helpers'
import {
	DEFAULT_STABLE_READS,
	git_pr_checks,
	WATCH_CONFIRMED_STABLE_READS,
} from '#scripts/gh/git-pr-checks'
import { is_coderabbit_check } from '#scripts/gh/git-pr-checks-eval'
import { CHECK_STATUS_PASS, type PrStateSnapshot } from '#scripts/gh/git-pr-checks-parse'
import { json_value } from '#scripts/lib/json-value'

// The check wait and the notes read off its snapshot — split out of `git-pr-followup.ts` when it
// reached its line limit. `git-pr-followup` re-exports each name it always
// exported, so the move changed no call site and no suite that imports from it.

// Named so a test can pin the note without restating it.
const WATCH_FAILED_NOTE = 'pr checks --watch failed; falling through to polling'

// The watch is a look ahead, not a gate. It fails when **any** check has failed — CodeRabbit
// included — and letting that escape would end the run before `evaluate_pr_state` could apply the
// CodeRabbit exemption at all, wherever every check finishes inside the two-minute window.
//
// Falling through costs nothing: whether the merge may proceed is decided in one place below, and a
// genuinely failing non-CodeRabbit check still ends the wait on the first poll by the fast-fail
// rather than by that failure.
// The watch fails for two different reasons — "a check failed" and "no checks reported on this
// branch" — and its own error does not say which. The pull request itself can: a failed check leaves
// a rollup, and a branch with no checks leaves it empty. Falling through on the empty case would
// trade a failure reported in seconds for the whole budget spent waiting on a required check that is
// missing rather than pending, so that one is rethrown and the old behavior kept.
//
// **Read from the raw payload, not from `parse_pr_state_snapshot`.** That parser never throws: a
// malformed answer or a schema mismatch degrades to `rollup: []`, which is indistinguishable there
// from a branch that genuinely has no checks. Rethrowing on it would put an unreadable answer back
// on the path this whole change exists to remove. So the question asked here is the narrow one —
// *is this definitely an empty rollup* — and every other outcome falls through.
function reads_as_empty_rollup(raw_json: string): boolean {
	const parsed = json_value.parse_or_undefined(raw_json)

	if (typeof parsed !== 'object' || parsed === null || !('statusCheckRollup' in parsed)) {
		return false
	}

	const { statusCheckRollup: rollup } = parsed

	return Array.isArray(rollup) && rollup.length === 0
}

// The read throws rather than answering `undefined`, so the `catch` is its only failure path.
//
// The **checks** half, not the whole snapshot: the question here is about `statusCheckRollup` alone,
// and reading the review listing to answer it paged a whole conversation for nothing.
async function has_no_checks(branch_name: string): Promise<boolean> {
	try {
		const checks = await git_gh_command.pr_get_checks_snapshot(branch_name)

		return reads_as_empty_rollup(checks.snapshot_json)
	} catch {
		// The read refines the swallow; it is not a gate of its own. An answer it cannot get is not
		// evidence of anything, so prefer falling through — the poll below reads the same state.
		return false
	}
}

async function handle_watch_failure(branch_name: string, error: unknown): Promise<void> {
	if (await has_no_checks(branch_name)) throw error

	// Swallowed, but never silently: the line stays visible even though it decides nothing.
	console.info(`⚠️ ${WATCH_FAILED_NOTE}: ${git_gh_helpers.get_error_message_with_stderr(error)}`)
}

// **Returns whether the watch confirmed completion**: `true` only when
// `pr_checks_watch` saw every check finish, `false` when it timed out with checks still pending or
// fell through to polling on a swallowed failure. `run_checks` reads it to decide how many stable poll
// reads the wait still needs. A timed-out watch (`timed_out: true`) never spanned the pending→settled
// window, so it must keep the full stable-read window rather than claim the confirmation. A rethrown
// failure — the empty-rollup case — never reaches a caller, so it needs no answer here.
async function watch_before_polling(branch_name: string): Promise<boolean> {
	console.info('')
	console.info('📊 Watching PR checks...')

	try {
		const result = await git_gh_command.pr_checks_watch(branch_name)

		return !result.timed_out
	} catch (error) {
		await handle_watch_failure(branch_name, error)

		return false
	}
}

// **A confirmed watch lowers the poll's stable-read requirement to one**. The
// watch is the first confirmation that every check settled, so the poll that follows need only agree
// once rather than twice — which removes the extra interval `followup` spent re-proving a settled run.
// A skipped or fallen-through watch keeps `DEFAULT_STABLE_READS`, and a check that turned red is still
// caught: the poll evaluates the full merge gate and throws on failure before any stable read counts.
async function run_checks(input: {
	branch_name: string
	is_skip_watch: boolean
}): Promise<PrStateSnapshot> {
	const is_watch_confirmed = !input.is_skip_watch && (await watch_before_polling(input.branch_name))
	const stable_reads = is_watch_confirmed ? WATCH_CONFIRMED_STABLE_READS : DEFAULT_STABLE_READS

	return await git_pr_checks.wait_for_pr_success(input.branch_name, stable_reads)
}

// Temporary: record every CodeRabbit check that was not passing when the merge gate
// opened, so a merge shipped without CodeRabbit review stays auditable.
function read_coderabbit_skip_notes(snapshot: PrStateSnapshot): Array<string> {
	return snapshot.rollup
		.filter((check) => is_coderabbit_check(check.name))
		.filter((check) => check.status !== CHECK_STATUS_PASS)
		.map(
			(check) =>
				`CodeRabbit check skipped (kit#753): ${check.name} was ${check.status} at merge time`,
		)
}

// The skip is printed where the run is being watched, not only carried into the Telegram body it
// ends up in. A merge that went ahead while CodeRabbit had not come back is the one thing the
// CodeRabbit exemption trades away, so it must be visible in `followup`'s own output.
function log_skip_notes(notes: ReadonlyArray<string>): void {
	for (const note of notes) {
		console.info(`⏭ ${note}`)
	}
}

const git_pr_followup_checks = {
	run_checks,
	read_coderabbit_skip_notes,
	log_skip_notes,
}

export { git_pr_followup_checks, WATCH_FAILED_NOTE }
