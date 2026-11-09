import type { CommentRequest } from '#scripts/issue/issue-comment-cli'
import { NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { issue_park } from '#scripts/issue/issue-park'
import { session_cite } from '#scripts/issue/session-cite'
import { run_park } from './run-park'
import { run_park_body } from './run-park-body'
import { run_park_lane } from './run-park-lane'
import { run_park_release } from './run-park-release'

// The park's write, shared by `josh run:park` (`run-park-cli.ts`) and `backlog:drive`'s yield-cap
// park, which imports it here because the CLI module carries a main guard.

const FAILURE_EXIT_CODE = 1

// **A park carries the child's recommendation** (joshuafolkken/kit#6669): a body off the schema is
// refused before any write, naming the missing piece and the schema.
function is_refused(body: string): boolean {
	const problem = run_park_body.problem_of(body)

	if (problem === undefined) return false

	console.error(`Park refused: ${problem}.\n${run_park_body.FORMAT}`)

	return true
}

// The label, the comment and the local record — `true` once the label and the comment are both on.
async function write(request: CommentRequest, directory: string): Promise<boolean> {
	const { issue_number, body } = request
	const lane_body = run_park_lane.with_lane_note(body, directory)
	const applied = await issue_park.apply(issue_number, NEEDS_DECISION_LABEL, lane_body)
	const is_parked = applied.is_labelled && applied.is_commented
	const is_recorded = is_parked && run_park.record(issue_number, directory)

	console.info(
		`park ${session_cite.issue(issue_number)} — label: ${String(applied.is_labelled)} · comment: ${String(applied.is_commented)} · recorded: ${String(is_recorded)}`,
	)

	return is_parked
}

// **A system stop is no question the Issue could answer** (joshuafolkken/kit#6531): `backlog:drive`'s
// yield-cap park skips the answered-question judgment — a failed launch would leave the capped issue
// unlabelled — and, with no agent to read it, the next-step section.
async function system_stop(request: CommentRequest, directory: string): Promise<number> {
	if (is_refused(request.body)) return FAILURE_EXIT_CODE

	const is_parked = await write(request, directory)

	return is_parked ? await run_park_release.release(request.issue_number) : FAILURE_EXIT_CODE
}

const run_park_write = { is_refused, system_stop, write }

export { run_park_write }
