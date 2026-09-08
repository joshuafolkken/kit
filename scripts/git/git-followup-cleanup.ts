import { git_gh_helpers } from './git-gh-helpers'

// joshuafolkken/kit#1539: everything a run does after its merge is cleanup, and a merge cannot be
// taken back. Those steps used to be plain sequential statements, so whichever of them threw first
// discarded every one after it — and the working-tree hold release is the last of them. Three runs
// (joshuafolkken/kit#1197, #1537, #1319) ended that way: merged, the issue closed, and the hold left
// behind for the next run to trip over.
//
// **A step is run on its own, and its failure never reaches the next one.** The whole point is that
// the steps are independent: the completion comment has nothing to do with the hold release, and
// letting one decide the other is wrong whatever made it fail — this Issue's own defect, a Telegram
// rate limit, or a Bad Gateway from GitHub.
//
// **Reported, never swallowed.** A cleanup that failed invisibly is a run that lies about what it
// did, so the failure is printed where the run is being watched, with the command that finishes the
// step by hand.
// `recovery` carries a command that genuinely finishes the step, and is **`undefined` where no such
// command exists** — the epic auto-close and the run report have no CLI entry point of their own, and
// naming a command that only *reports* would send the reader somewhere that cannot fix anything. It
// is stated rather than omitted so that every step answers the question one way or the other.
interface CleanupStep {
	label: string
	recovery: string | undefined
	run: () => Promise<void>
}

function report_failure(step: CleanupStep, error: unknown): void {
	console.warn('')
	console.warn(
		`⚠️  ${step.label} failed after the merge: ${git_gh_helpers.get_error_message_with_stderr(error)}`,
	)

	if (step.recovery !== undefined) console.warn(`   Recovery: ${step.recovery}`)
	console.warn('')
}

// Answers whether the step completed, so a caller can report what is left rather than having to
// catch anything itself.
async function run_step(step: CleanupStep): Promise<boolean> {
	try {
		await step.run()

		return true
	} catch (error) {
		report_failure(step, error)

		return false
	}
}

// **The guard is what a merge earned, and nothing else.** Before the merge nothing irreversible has
// happened and re-running `pnpm josh followup` is the whole recovery, so a failure there still ends
// the run — swallowing it would hide a real failure behind a report saying the merge had landed. One
// definition, so the two callers of this module cannot disagree about when a step is guarded.
async function run_guarded_step(is_guarded: boolean, step: CleanupStep): Promise<boolean> {
	if (!is_guarded) {
		await step.run()

		return true
	}

	return await run_step(step)
}

// Every step runs, in order, however many of them fail. The answer is whether all of them completed.
async function run_guarded_steps(
	is_guarded: boolean,
	steps: ReadonlyArray<CleanupStep>,
): Promise<boolean> {
	let is_complete = true

	for (const step of steps) {
		const is_done = await run_guarded_step(is_guarded, step)

		if (!is_done) is_complete = false
	}

	return is_complete
}

const git_followup_cleanup = {
	run_step,
	run_guarded_step,
	run_guarded_steps,
}

export { git_followup_cleanup }
export type { CleanupStep }
