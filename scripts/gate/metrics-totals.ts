import { buffered_process, type BufferedProcessResult } from '#scripts/lib/buffered-process'
import { release_approval_prune } from '#scripts/release/release-approval-prune'
import { gate_tree, type GateTree } from './gate-tree'
import { project_checks } from './project-checks'

// kit's metrics ratchet totals (`josh metrics --totals-only`), brought forward from the detached
// `josh ship`'s pre-detach checks to the implementation loop: a feature grows a total almost every
// time, and a growth first met at the pre-detach stop costs a ship re-run beside the
// `josh metrics --accept` (joshuafolkken/kit#4594). `josh lint:related` reports it as a notice, never a
// failure, so a total that grows again within the loop does not demand an accept per edit;
// `josh run:review`'s open is the stop, the pre-detach check its backstop (`totals_check`). A
// consumer's kit has no `josh metrics`, so it runs in kit alone.

const METRICS_TOTALS_COMMAND: ReadonlyArray<string> = ['josh', 'metrics', '--totals-only']
// The form ship runs before the detach and before each scoped pair: it also re-records a growth the
// branch's approval names (joshuafolkken/kit#4716).
const METRICS_RERECORD_COMMAND: ReadonlyArray<string> = [...METRICS_TOTALS_COMMAND, '--rerecord']
// Neutral on the cause: a growth and a run that never finished both stop the pre-detach check.
const NOTICE_HEADING =
	'⚠ josh metrics --totals-only did not pass — settle it before `josh run:review`, whose open stops on it (a total the branch approval names is re-recorded there):'
const REVIEW_REFUSAL_HEADING =
	'run:review refused: josh metrics --totals-only did not pass — bring the totals back down, or record the reason they grew in the rerun: `pnpm josh run:chain <N> --from run:review --accept-metrics "<why>"`:'
// `josh metrics --accept --reason`, run as is, so the open's record is the command's own.
const ACCEPT_COMMAND: ReadonlyArray<string> = ['josh', 'metrics', '--accept', '--reason']
const ACCEPT_REFUSAL_HEADING =
	'run:review refused: --accept-metrics could not record the growth — `josh metrics --accept` answered:'
const ACCEPT_UNUSED_NOTE =
	'run:review: --accept-metrics unused — no metrics total grew, so nothing was recorded'

async function growth_notice(directory: string): Promise<string | undefined> {
	if (!project_checks.is_kit_repository(directory)) return undefined

	const result = await buffered_process.run_buffered_process(METRICS_TOTALS_COMMAND, {
		cwd: directory,
	})

	if (!buffered_process.is_process_failed(result)) return undefined

	return `${NOTICE_HEADING}\n${result.output.trim()}`
}

// The totals' stop, one judgment for the two places that stop on it: `josh run:review`'s open, right
// after the implementation and before the review's brief, and the ship's pre-detach, kept as the
// backstop (joshuafolkken/kit#6023). The re-record form, so a growth the branch's approval already
// names passes both. `undefined` outside kit.
async function totals_check(directory: string): Promise<BufferedProcessResult | undefined> {
	if (!project_checks.is_kit_repository(directory)) return undefined

	return await buffered_process.run_buffered_process(METRICS_RERECORD_COMMAND, { cwd: directory })
}

function last_line(output: string): string {
	return output.trim().split('\n').at(-1) ?? ''
}

// Records the growth with `josh metrics --accept --reason` and goes on; its output when it fails.
async function accept_refusal(directory: string, reason: string): Promise<string | undefined> {
	const result = await buffered_process.run_buffered_process([...ACCEPT_COMMAND, reason], {
		cwd: directory,
	})

	if (buffered_process.is_process_failed(result)) {
		return `${ACCEPT_REFUSAL_HEADING}\n${result.output.trim()}`
	}

	console.info(last_line(result.output))

	return undefined
}

// A grown total: recorded under `accept_reason` when given, else refused with the totals' own output.
async function grown_refusal(
	directory: string,
	result: BufferedProcessResult,
	accept_reason: string | undefined,
): Promise<string | undefined> {
	if (accept_reason !== undefined) return await accept_refusal(directory, accept_reason)

	return `${REVIEW_REFUSAL_HEADING}\n${result.output.trim()}`
}

// `josh run:review`'s refusal for a growth no approval names: the totals' own output, which ends in
// the `josh metrics --accept` command that settles it. With `accept_reason` (`--accept-metrics`) the
// growth is recorded instead; a reason given where no total grew records nothing and says so
// (joshuafolkken/kit#7599).
async function totals_refusal(
	directory: string,
	accept_reason?: string,
): Promise<string | undefined> {
	const result = await totals_check(directory)

	if (result !== undefined && buffered_process.is_process_failed(result)) {
		return await grown_refusal(directory, result, accept_reason)
	}

	if (result !== undefined && accept_reason !== undefined) console.info(ACCEPT_UNUSED_NOTE)

	return undefined
}

function carries_approval(files: Readonly<Record<string, string>>): boolean {
	return Object.keys(files).some((file) => release_approval_prune.is_approval(file))
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
	ACCEPT_REFUSAL_HEADING,
	ACCEPT_UNUSED_NOTE,
	METRICS_RERECORD_COMMAND,
	METRICS_TOTALS_COMMAND,
	NOTICE_HEADING,
	REVIEW_REFUSAL_HEADING,
	growth_notice,
	rerecord,
	// Finish the existing approval writer before fixing the tree any verification will read.
	async rerecorded_tree(
		read: () => Promise<GateTree> = gate_tree.read_gate_tree,
		directory: string = process.cwd(),
	): Promise<GateTree> {
		const tree = await read()
		const is_rerecorded = await metrics_totals.rerecord(directory, tree.files)

		return is_rerecorded ? await read() : tree
	},
	totals_check,
	totals_refusal,
}

export { metrics_totals }
