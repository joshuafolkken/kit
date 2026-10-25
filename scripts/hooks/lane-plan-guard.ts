import { lane_child_marker, type MarkerSource } from '#scripts/lane/lane-child-marker'
import { lane_plan } from '#scripts/lane/lane-plan'
import { step_zero_notice } from './step-zero-notice'

// A dispatched lane child's first implementation edit is refused until `josh lane:plan` has recorded
// the files its work summary changes and cleared them (joshuafolkken/kit#4864). The record is what holds a later lane
// back from those files, so it has to exist before the code does; a document asking for it would be
// read after the edit it governs.
//
// **A dispatched lane child only**, the trust condition `lane-phase.ts` applies: a person's session, or
// one carrying a mark leaked from a parent, runs no lanes beside it to wait on.

const COMMAND_DOC = '`docs/josh-commands-run.md` → "`josh lane:plan`"'
const WHY = 'it waits while a running lane that planned one of them first holds it'

function reason_text(issue: string): string {
	const command = `\`pnpm josh lane:plan ${issue} <path>...\``

	return `⛔ lane plan: run ${command} naming every file the work summary changes, again until it prints \`clear\`, before the first implementation edit — ${WHY} (${COMMAND_DOC}).`
}

// The issue of the dispatched lane child making this runtime edit, or `undefined` for any other call.
function lane_child_edit(
	raw_payload: string,
	directory: string,
	source: MarkerSource,
): string | undefined {
	if (!lane_child_marker.is_child_of(directory, source)) return undefined

	return step_zero_notice.is_runtime_edit(raw_payload, directory)
		? lane_child_marker.marked_issue(source)
		: undefined
}

function reason(
	raw_payload: string,
	directory: string = process.cwd(),
	source: MarkerSource = process.env,
): string | undefined {
	const issue = lane_child_edit(raw_payload, directory, source)

	if (issue === undefined) return undefined

	return lane_plan.is_uncleared(Number(issue), directory) ? reason_text(issue) : undefined
}

const lane_plan_guard = { reason }

export { lane_plan_guard }
