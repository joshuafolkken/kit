import { buffered_process } from '#scripts/lib/buffered-process'
import { release_approval_prune } from '#scripts/release/release-approval-prune'
import { project_checks } from './project-checks'

// kit's metrics ratchet totals (`josh metrics --totals-only`), brought forward from the detached
// `josh ship`'s pre-detach checks to the implementation loop: a feature grows a total almost every
// time, and a growth first met at the pre-detach stop costs a ship re-run beside the
// `josh metrics --accept` (joshuafolkken/kit#4594). `josh lint:related` reports it as a notice, never a
// failure, so a total that grows again within the loop does not demand an accept per edit; the
// pre-detach check stays the stop. A consumer's kit has no `josh metrics`, so it runs in kit alone.

const METRICS_TOTALS_COMMAND: ReadonlyArray<string> = ['josh', 'metrics', '--totals-only']
// The form ship runs before the detach and before each scoped pair: it also re-records a growth the
// branch's approval names (joshuafolkken/kit#4716).
const METRICS_RERECORD_COMMAND: ReadonlyArray<string> = [...METRICS_TOTALS_COMMAND, '--rerecord']
const APPROVAL_PREFIX = `${release_approval_prune.APPROVAL_DIRECTORY}/`
// Neutral on the cause: a growth and a run that never finished both stop the pre-detach check.
const NOTICE_HEADING =
	'⚠ josh metrics --totals-only did not pass — settle it before `josh ship`, or the pre-detach check stops the ship (a total the branch approval names is re-recorded there):'

async function growth_notice(directory: string): Promise<string | undefined> {
	if (!project_checks.is_kit_repository(directory)) return undefined

	const result = await buffered_process.run_buffered_process(METRICS_TOTALS_COMMAND, {
		cwd: directory,
	})

	if (!buffered_process.is_process_failed(result)) return undefined

	return `${NOTICE_HEADING}\n${result.output.trim()}`
}

function carries_approval(files: Readonly<Record<string, string>>): boolean {
	return Object.keys(files).some((file) => file.startsWith(APPROVAL_PREFIX))
}

// Re-records the branch's approval before a scoped pair reads the tree, so a review fix that grows a
// named total again does not stop the gate after it (joshuafolkken/kit#4716). It runs only where the
// changed tree carries an approval, and answers whether it ran; its verdict is left to the gate's own
// metrics step.
async function rerecord(
	directory: string,
	files: Readonly<Record<string, string>>,
): Promise<boolean> {
	if (!project_checks.is_kit_repository(directory) || !carries_approval(files)) return false

	await buffered_process.run_buffered_process(METRICS_RERECORD_COMMAND, { cwd: directory })

	return true
}

const metrics_totals = {
	METRICS_RERECORD_COMMAND,
	METRICS_TOTALS_COMMAND,
	NOTICE_HEADING,
	growth_notice,
	rerecord,
}

export { metrics_totals }
