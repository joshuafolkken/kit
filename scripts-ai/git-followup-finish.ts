import { git_followup_cleanup, type CleanupStep } from '../scripts/git/git-followup-cleanup'
import { git_followup_pending } from '../scripts/git/git-followup-pending'
import { git_next_issues } from '../scripts/git/git-next-issues'
import { review_attest } from '../scripts/review/review-attest'
import { review_stamps } from '../scripts/review/review-stamps'
import { run_hold } from '../scripts/run/run-hold'
import { time_history } from '../scripts/time/time-history'
import { parse_completed_issue_number } from './followup-issue-number'

// **The count of unreleased merges, not the project version** (joshuafolkken/kit#1486). This line
// used to read the local `package.json` and was read as "the version this run just shipped"; children
// no longer bump, so that number names the *previous* release and the reading is false. The count is
// the one `pnpm josh release` acts on, and it is printed here for the same reason it goes into the
// Telegram: a number that keeps climbing is a release nobody has run.
//
// Printed after the merge, and the count is read from a freshly fetched default branch — so this
// run's own merge is already in it and nothing here says otherwise, unlike the Telegram sent one step
// earlier from a tree the merge had not reached.
async function print_pending_release(): Promise<void> {
	const line = await git_followup_pending.pending_release_line({ is_merge_pending: false })

	if (line !== undefined) console.info(line)
}

// #821: surface what to run next right where the completion is read. Printed before the project
// version line, which stays the final line of the console output by contract.
async function print_next_issues(completed_issue_number: string | undefined): Promise<void> {
	const lines = await git_next_issues.fetch_next_issue_lines(
		parse_completed_issue_number(completed_issue_number),
	)
	for (const line of lines) console.info(line)
}

// The tail printed once the workflow itself has finished. `print_pending_release` stays last by
// contract, so anything added here goes above it.
async function print_completion(
	issue_number: string | undefined,
	should_merge: boolean,
): Promise<void> {
	console.info('')
	console.info('✅ PR followup completed.')
	// Merged runs only, like the epic auto-close: on `--no-merge` the linked issue is still open
	// and still the current task, so a "next" list would hide the one issue that matters.
	if (should_merge) await print_next_issues(issue_number)
	await print_pending_release()
}

// A **merged** run ends here, and the round-1 review snapshot's lifetime is one run
// (joshuafolkken/kit#1441). `--no-merge` is not the end of one — the pull request is still open and
// the issue is still the current task, the same line `print_next_issues` and the epic auto-close
// already draw — and clearing there would be the unsafe direction: the next round-1 brief would find
// no record and write a fresh one against the already-fixed tree, which is the arm-A skip over
// unreviewed fix code the record exists to prevent.
function clear_round_one_snapshot(should_merge: boolean): void {
	if (should_merge) review_stamps.clear_round_one()
}

// Cleared beside the round-1 snapshot, and for the same reason: the contract's lifetime is one run,
// and a record left behind is the one the next run's check would read.
async function clear_review_target(should_merge: boolean): Promise<void> {
	if (!should_merge) return

	try {
		await review_attest.clear_here()
	} catch {
		/* a fresh `josh review:brief` replaces the record the next run reads */
	}
}

// The two review records are one step of the tail: both are cleared by a merged run and neither is
// worth reporting on its own.
async function clear_review_records(should_merge: boolean): Promise<void> {
	clear_round_one_snapshot(should_merge)
	await clear_review_target(should_merge)
}

// joshuafolkken/kit#1471: the run report only ever appeared when a person typed `diag`, so a run
// nobody asked about left no record — and a measurement that is not continuous cannot say whether
// the last change made anything faster. Every `fullrun`, and every child of an `epicrun` or a
// `queue`, ends here, so emitting it from this one seam covers all of them without a second hook.
//
// **Gated on `should_merge`, like the epic auto-close and the round-1 snapshot clear above.** A
// `--no-merge` run has not finished: the pull request is still open and its CI wait is not over, so
// a record written there would compare a part of a run against whole ones.
//
// **Printed above `print_completion`**, because `print_pending_release` stays the final line of the
// console output by contract.
async function record_run_report(
	issue_number: string | undefined,
	should_merge: boolean,
): Promise<void> {
	if (!should_merge) return

	const completed = parse_completed_issue_number(issue_number)
	if (completed === undefined) return

	const lines = await time_history.record_run(completed, process.cwd())
	for (const line of lines) console.info(line)
}

// joshuafolkken/kit#1091: the working-tree hold a typed entry point claims before it starts is
// released here, on the one seam every `fullrun` — and every child of an `epicrun` or a `queue` —
// passes through, so a finished run never leaves the next one locked out. **Gated on `should_merge`
// like the epic auto-close and the round-1 snapshot clear**: a `--no-merge` run has not finished, and
// its tree is still the one nobody else may start in.
//
// It swallows its own failure for the same reason the gate's in-flight marker does: the record must
// never decide whether a merged run reports success. A record that survives anyway expires on its own
// eight hours later, which is what covers an abnormally ended run.
async function release_worktree_hold(should_merge: boolean): Promise<void> {
	if (!should_merge) return

	try {
		const directory = await run_hold.worktree_directory()

		if (directory !== undefined) run_hold.release_hold(run_hold.hold_path(directory))
	} catch {
		/* the record expires on its own, and `pnpm josh run:release` clears it early */
	}
}

// **The steps are independent, and one of them failing must not discard the rest**
// (joshuafolkken/kit#1539). They used to be four bare statements, so whichever threw first ended the
// process — and the hold release is the last of them, which is how three merged runs left their
// working tree locked. The order is still the contract: `print_completion` ends with the
// unreleased-merge count, the final console line.
function build_report_steps(
	issue_number: string | undefined,
	should_merge: boolean,
): ReadonlyArray<CleanupStep> {
	return [
		// No `recovery` for either: `time_history.record_run` is called from this file alone and
		// `pnpm josh time` only *reads* what it wrote, so a missing record cannot be restored by hand;
		// the completion output is console text, which nothing re-prints.
		{
			label: 'The run report',
			recovery: undefined,
			run: async () => {
				await record_run_report(issue_number, should_merge)
			},
		},
		{
			label: 'The completion output',
			recovery: undefined,
			run: async () => {
				await print_completion(issue_number, should_merge)
			},
		},
	]
}

function build_record_steps(should_merge: boolean): ReadonlyArray<CleanupStep> {
	return [
		{
			label: 'The review records',
			recovery: undefined,
			run: async () => {
				await clear_review_records(should_merge)
			},
		},
		{
			label: 'The working-tree hold release',
			recovery: 'pnpm josh run:release',
			run: async () => {
				await release_worktree_hold(should_merge)
			},
		},
	]
}

function build_finish_steps(
	issue_number: string | undefined,
	should_merge: boolean,
): ReadonlyArray<CleanupStep> {
	return [...build_report_steps(issue_number, should_merge), ...build_record_steps(should_merge)]
}

// The tail every invocation shares. Answers whether all of it completed, so a caller could report a
// partial tail; nothing acts on it yet, because a merged run has already succeeded and a cleanup that
// failed is reported where it failed.
//
// **Guarded only on a merged run**, the same gate the wrapup applies and from the same definition: a
// `--no-merge` run has merged nothing, so a failure in its tail is a failure of the run and still
// ends it.
async function finish(issue_number: string | undefined, should_merge: boolean): Promise<boolean> {
	return await git_followup_cleanup.run_guarded_steps(
		should_merge,
		build_finish_steps(issue_number, should_merge),
	)
}

const git_followup_finish = {
	finish,
	build_finish_steps,
	record_run_report,
	print_completion,
	print_next_issues,
	print_pending_release,
	clear_review_records,
	clear_round_one_snapshot,
	clear_review_target,
	release_worktree_hold,
}

export { git_followup_finish }
