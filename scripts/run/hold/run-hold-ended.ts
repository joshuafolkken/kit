import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import type { HoldRead } from './run-hold'

// The runs whose hold a merge released here. A single `fullrun` or `halfrun` in the root checkout has
// no record but its hold (`run-board-single.ts`), and the release removes it, so without this
// `run:board` would lose the run the moment it merged; this keeps when each began and ended for the
// board's `✅ done` (joshuafolkken/kit#7525). The newest few only: the board reads the ones that ended
// inside the run on screen.

const ENDED_PREFIX = 'josh-run-hold-ended-'
const KEPT_RUNS = 20

const ended_hold_schema = z.object({
	issue: z.string(),
	is_fullrun: z.boolean().optional(),
	taken_at: z.string(),
	ended_at: z.string(),
})

type EndedHold = z.infer<typeof ended_hold_schema>

// Keyed like the hold, on the work tree's own git directory.
function ended_path(git_directory: string): string {
	return stamp_file.stamp_path(ENDED_PREFIX, git_directory)
}

// None where no run has ended here, or the record does not read.
function read_ended(target: string): ReadonlyArray<EndedHold> {
	const raw = stamp_file.read_stamp_text(target)

	return raw === undefined ? [] : (json_value.parse_with(raw, z.array(ended_hold_schema)) ?? [])
}

// Records the hold a merge is about to release; a read with no live hold names no run.
function record_ended(target: string, read: HoldRead, now: Date = new Date()): void {
	if (read.kind !== 'held') return

	const { issue, is_fullrun, taken_at } = read.hold
	const ended: EndedHold = { issue, taken_at, ended_at: now.toISOString() }

	if (is_fullrun === true) ended.is_fullrun = true
	stamp_file.replace_stamp(target, [...read_ended(target), ended].slice(-KEPT_RUNS))
}

const run_hold_ended = { KEPT_RUNS, ended_path, read_ended, record_ended }

export { run_hold_ended }
export type { EndedHold }
