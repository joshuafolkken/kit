import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_helpers } from '#scripts/gh/git-gh-helpers'
import {
	DEFAULT_STABLE_READS,
	git_pr_checks,
	WATCH_CONFIRMED_STABLE_READS,
	type SnapshotObserver,
} from '#scripts/gh/git-pr-checks'
import {
	FAILURE_MESSAGE_PREFIX,
	is_coderabbit_check,
	PrConflictError,
} from '#scripts/gh/git-pr-checks-eval'
import { CHECK_STATUS_PASS, type PrStateSnapshot } from '#scripts/gh/git-pr-checks-parse'
import { issue_watch_gate } from '#scripts/issue/issue-watch-gate'
import { json_value } from '#scripts/lib/json-value'
import { followup_job_rerun } from './followup-job-rerun'

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

// **Returns whether the watch observed the checks**: `true` when `pr_checks_watch` returned — every
// check finished, or the budget ran out with one still pending — and `false` when it fell through to
// polling on a swallowed failure. `run_checks` reads it to decide how many stable poll reads the wait
// still needs. **A timed-out watch counts too** (#5080): it read the checks for two minutes without
// two settled reads in a row, so the checks were registered and not yet settled while it watched, and
// the poll's first settled read closes that pending→settled window — the window the second stable read
// exists for. Holding it to two cost ten seconds on every lane whose CI outlasts the two-minute
// budget. A rethrown failure — the empty-rollup case — never reaches a caller, so it needs no answer
// here.
async function watch_before_polling(
	branch_name: string,
	observe: SnapshotObserver | undefined,
): Promise<boolean> {
	console.info('')
	console.info('📊 Watching PR checks...')

	try {
		await git_gh_command.pr_checks_watch(branch_name, observe)

		return true
	} catch (error) {
		await handle_watch_failure(branch_name, error)

		return false
	}
}

// **A returned watch lowers the poll's stable-read requirement to one**. The
// watch saw every check settle or saw them pending, so the poll that follows need only agree once
// rather than twice — which removes the extra interval `followup` spent re-proving a settled run.
// A skipped or fallen-through watch keeps `DEFAULT_STABLE_READS`, and a check that turned red is still
// caught: the poll evaluates the full merge gate and throws on failure before any stable read counts.
// `observe` is shown each poll's snapshot, the watch's included — the run's `pr-checks` line
// (joshuafolkken/kit#3770). `reran` collects the jobs the rerun below restarted, for the completion
// notification's check report (joshuafolkken/kit#5545).
interface RunChecksInput {
	branch_name: string
	is_skip_watch: boolean
	observe?: SnapshotObserver
	reran?: Array<string>
}

async function wait_for_checks(input: RunChecksInput): Promise<PrStateSnapshot> {
	const is_watch_returned =
		!input.is_skip_watch && (await watch_before_polling(input.branch_name, input.observe))
	const stable_reads = is_watch_returned ? WATCH_CONFIRMED_STABLE_READS : DEFAULT_STABLE_READS

	return await git_pr_checks.wait_for_pr_success(
		input.branch_name,
		stable_reads,
		issue_watch_gate.assert_read_here,
		input.observe,
	)
}

// A merge conflict is not a check, so no rerun can clear it.
function is_checks_failure(error: unknown): boolean {
	if (error instanceof PrConflictError) return false

	return error instanceof Error && error.message.startsWith(FAILURE_MESSAGE_PREFIX)
}

// **A job the runner stopped after every step passed, or one red only on tests outside the change, is
// rerun once and the wait judged again** (`followup-job-rerun.ts`). The second wait has no rerun of its own, so a job that stops the same way
// twice — or any other failure — ends the run as before.
async function rejudge_after_rerun(
	input: RunChecksInput,
	error: unknown,
): Promise<PrStateSnapshot> {
	if (!is_checks_failure(error)) throw error
	const rerun = await followup_job_rerun.rerun_failed_jobs(input.branch_name)
	if (rerun.length === 0) throw error
	input.reran?.push(...rerun)

	return await wait_for_checks(input)
}

async function run_checks(input: RunChecksInput): Promise<PrStateSnapshot> {
	try {
		return await wait_for_checks(input)
	} catch (error) {
		return await rejudge_after_rerun(input, error)
	}
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
