import { git_followup_cleanup, type CleanupStep } from '../scripts/git/git-followup-cleanup'
import { git_followup_pending } from '../scripts/git/git-followup-pending'
import { git_next_issues } from '../scripts/git/git-next-issues'
import { review_attest } from '../scripts/review/review-attest'
import { review_stamps } from '../scripts/review/review-stamps'
import { run_hold } from '../scripts/run/run-hold'
import { run_progress_clock } from '../scripts/run/run-progress-clock'
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
		/* the record expires on its own, and `pnpm josh run:release --force` clears it early */
	}
}

// joshuafolkken/kit#1821: a `run:progress` watcher outlives the turn that started it and, left alone,
// waits out its whole bound — up to an hour — after the run it was watching has already merged.
// Removing its liveness record here, on the same merge seam that releases the working-tree hold, lets
// the watcher read the record gone on its next tick and stop at once. **Keyed like the hold, on the
// work tree's own git directory** (`worktree_directory` is `directories[0]`), which is exactly the key
// the watcher resolved through `run_progress_read.stamp_target`, so the file removed is the file it
// wrote.
//
// It swallows its own failure like the hold release beside it, and needs no recovery command: the
// record is presence-only and the watcher's own bound ends it regardless, so it must never decide
// whether a merged run reports success.
//
// **A no-op in an `epicrun` / `queue` batch, and deliberately so.** A batch child starts no watcher
// of its own — the batch watcher is the parent's and outlives the child, which is still running the
// rest of the batch — so a child keyed on its own lane worktree finds no record here and removes
// nothing. The parent ends its own watcher on its stop, exactly as it starts it. This ends the
// watcher of a run whose followup merges and which owns one on the same work tree: a standalone
// `fullrun`.
async function end_progress_watcher(should_merge: boolean): Promise<void> {
	if (!should_merge) return

	try {
		const directory = await run_hold.worktree_directory()

		if (directory === undefined) return

		run_progress_clock.end_life(run_progress_clock.life_target_of(directory))
	} catch {
		/* the watcher's own bound ends it, so a record left behind costs at most one idle watcher */
	}
}

// **The steps are independent, and one of them failing must not discard the rest**
// (joshuafolkken/kit#1539). They used to be bare statements, so whichever threw first ended the
// process — and the hold release is the last of them, which is how three merged runs left their
// working tree locked. The order is still the contract: `print_completion` ends with the
// unreleased-merge count, the final console line.
function build_report_steps(
	issue_number: string | undefined,
	should_merge: boolean,
): ReadonlyArray<CleanupStep> {
	return [
		// No `recovery`: the completion output is console text, which nothing re-prints.
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
			// **The forced spelling, because the run that wrote the record is this one and it is
			// ending** (joshuafolkken/kit#1799). A release names the run it belongs to, so a person
			// finishing this step by hand is releasing a record they did not write — the plain form
			// would answer `held` and remove nothing, which is a printed recovery that cannot recover.
			recovery: 'pnpm josh run:release --force',
			run: async () => {
				await release_worktree_hold(should_merge)
			},
		},
		{
			label: 'The progress watcher',
			// No recovery: the record is presence-only and the watcher's own bound ends it regardless,
			// so there is nothing a person types to finish this step by hand.
			recovery: undefined,
			run: async () => {
				await end_progress_watcher(should_merge)
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
	print_completion,
	print_next_issues,
	print_pending_release,
	clear_review_records,
	clear_round_one_snapshot,
	clear_review_target,
	release_worktree_hold,
	end_progress_watcher,
}

export { git_followup_finish }
