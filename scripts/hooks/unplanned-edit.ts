import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { lane_child_marker, type MarkerSource } from '#scripts/lane/lane-child-marker'
import { lane_plan } from '#scripts/lane/lane-plan'
import { run_review_unplanned } from '#scripts/run/review/run-review-unplanned'
import { run_ship_planned } from '#scripts/run/ship/run-ship-planned'

// **A lane child's first edit of a file its `lane:plan` record never listed asks `lane:plan` at once**
// (joshuafolkken/kit#7640): `run:review`'s open was the first to ask (joshuafolkken/kit#6142), so a
// lane ran its tests and chain before a `yield` stashed the work (joshuafolkken/kit#7618). The same
// check runs here, from the edit hook; a clear one widens the record, so the next edit of the file is
// planned and asks nothing. A clash, oversize or unread answer widens nothing, so each asked file is
// also noted in the lane's scratch and not asked again. `run:review`'s open and the ship's
// `unplanned` preflight still check. A Codex lane child goes without it: its PostToolUse adapter
// (`codex-hook-adapter.ts`) runs the formatters alone, not `format-edited-file.ts`'s hook.

interface Lane {
	issue: number
	claims: ReadonlyArray<string>
}

// The dispatched lane child this session is, with its recorded claims; `undefined` for any other session.
function lane_of(directory: string, source: MarkerSource): Lane | undefined {
	if (!lane_child_marker.is_child_of(directory, source)) return undefined
	const issue = Number(lane_child_marker.marked_issue(source))
	const claims = lane_plan.read(issue, directory)?.paths

	return claims === undefined ? undefined : { issue, claims }
}

function asked_path(issue: number, directory: string): string {
	return path.join(directory, '.josh', 'tmp', `unplanned-edit-${String(issue)}.txt`)
}

function was_asked(relative: string, issue: number, directory: string): boolean {
	try {
		return readFileSync(asked_path(issue, directory), 'utf8').split('\n').includes(relative)
	} catch {
		return false
	}
}

function note_asked(relative: string, issue: number, directory: string): void {
	const file = asked_path(issue, directory)

	mkdirSync(path.dirname(file), { recursive: true })
	appendFileSync(file, `${relative}\n`)
}

// A file outside the lane's tree (a scratch file, a memory note) is no branch change to plan.
function unasked_issue(file: string, directory: string, source: MarkerSource): number | undefined {
	const lane = lane_of(directory, source)
	const relative = path.relative(directory, file)

	if (
		lane === undefined ||
		relative.startsWith('..') ||
		run_ship_planned.unplanned_of(lane.claims, [relative]).length === 0 ||
		was_asked(relative, lane.issue, directory)
	) {
		return undefined
	}

	note_asked(relative, lane.issue, directory)

	return lane.issue
}

async function ask(directory: string): Promise<string | undefined> {
	const lines: Array<string> = []
	const refused = await run_review_unplanned.refusal_to(directory, (line) => {
		lines.push(line)
	})

	return refused ?? lines[0]
}

// The holder's `wait` / `yield` text, or the widening's line, for the edit hook's context; `undefined`
// for any edit of a planned or already-asked file, a non-code file, or outside a dispatched lane
// child. A failed ask is `undefined` too: it must not cost the hook its lint and spelling context,
// and `run:review`'s open asks again.
async function notice(
	file: string | undefined,
	directory: string,
	source: MarkerSource,
): Promise<string | undefined> {
	if (file === undefined || unasked_issue(file, directory, source) === undefined) return undefined

	try {
		return await ask(directory)
	} catch {
		return undefined
	}
}

const unplanned_edit = { notice }

export { unplanned_edit }
