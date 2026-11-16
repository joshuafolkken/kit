import path from 'node:path'
import { lane_child_marker, type MarkerSource } from '#scripts/lane/lane-child-marker'
import { lane_plan } from '#scripts/lane/lane-plan'
import { run_review_unplanned } from '#scripts/run/review/run-review-unplanned'
import { run_ship_planned } from '#scripts/run/ship/run-ship-planned'

// **A lane child's first edit of a file its `lane:plan` record never listed asks `lane:plan` at once**
// (joshuafolkken/kit#7640): `run:review`'s open was the first to ask (joshuafolkken/kit#6142), so a
// lane ran its tests and chain before a `yield` stashed the work (joshuafolkken/kit#7618). The same
// check runs here, from the edit hook; a clear one widens the record, so the next edit of the file is
// planned and asks nothing. `run:review`'s open and the ship's `unplanned` preflight still check.

// The recorded claims of the dispatched lane child this session is, `undefined` for any other session.
function lane_claims(directory: string, source: MarkerSource): ReadonlyArray<string> | undefined {
	if (!lane_child_marker.is_child_of(directory, source)) return undefined
	const issue = lane_child_marker.marked_issue(source)

	return issue === undefined ? undefined : lane_plan.read(Number(issue), directory)?.paths
}

// A file outside the lane's tree (a scratch file, a memory note) is no branch change to plan.
function is_unplanned(file: string, directory: string, source: MarkerSource): boolean {
	const claims = lane_claims(directory, source)
	const relative = path.relative(directory, file)

	if (claims === undefined || relative.startsWith('..')) return false

	return run_ship_planned.unplanned_of(claims, [relative]).length > 0
}

// The holder's `wait` / `yield` text, or the widening's line, for the edit hook's context; `undefined`
// for any edit of a planned file, a non-code file, or outside a dispatched lane child.
async function notice(
	file: string | undefined,
	directory: string,
	source: MarkerSource,
): Promise<string | undefined> {
	if (file === undefined || !is_unplanned(file, directory, source)) return undefined
	const lines: Array<string> = []
	const refused = await run_review_unplanned.refusal_to(directory, (line) => {
		lines.push(line)
	})

	return refused ?? lines[0]
}

const unplanned_edit = { notice }

export { unplanned_edit }
