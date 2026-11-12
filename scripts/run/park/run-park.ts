import { backlog_budget } from '#scripts/backlog/backlog-budget'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { stamp_file } from '#scripts/josh/stamp-file'
import { stamp_record, type StampRecordSpec } from '#scripts/josh/stamp-record'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// The local record of a lane child's park — the half of `run:park` a `PreToolUse` guard can read.
//
// A synchronous guard cannot read the GitHub park label, so `run:park` records the completed comment
// and label locally for `lane-park` to recognize a parked child (joshuafolkken/kit#4132).
//
// **Keyed to the repository and the issue, not the work tree.** The child parks from its lane, and the
// parent clears the park from the main checkout once a person has decided; both resolve the same
// common git directory, so `run:park --clear` removes the record wherever it runs.
//
// **Bounded like the cut record, and taken back by the next dispatch.** The guard asks within the run
// that parked, seconds after the park; a label a person removed by hand, without `--clear`, must not
// leave the guard silent on that issue's next dispatch, so `lane:dispatch` clears the record before it
// starts the child, and a record past the lane child's idle bound reads as no park.

const PARK_PREFIX = 'josh-run-park-'
const PARK_MAX_AGE_MS = backlog_budget.DEFAULT_IDLE_MS

const run_park_schema = z.object({
	issue: z.string(),
	parked_at: z.string(),
})

type RunPark = z.infer<typeof run_park_schema>

function parse_park(raw: string): RunPark | undefined {
	return json_value.parse_with(raw, run_park_schema)
}

function parked_at_of(park: RunPark): string {
	return park.parked_at
}

const PARK_SPEC: StampRecordSpec<RunPark> = {
	parse: parse_park,
	timestamp_of: parked_at_of,
	max_age_ms: PARK_MAX_AGE_MS,
}

function park_path(repository: string, issue: string): string {
	return stamp_file.stamp_path(`${PARK_PREFIX}${issue}-`, repository)
}

// **The directory is injectable so a test never writes the live record** — the same reason
// `run_cut.carried_cut_sync` takes one.
function record(issue: string, directory: string, now: Date = new Date()): boolean {
	const repository = git_common_directory.repository(directory)

	if (repository === undefined) return false

	stamp_file.replace_stamp(park_path(repository, issue), { issue, parked_at: now.toISOString() })

	return true
}

function clear(issue: string, directory: string): void {
	const repository = git_common_directory.repository(directory)

	if (repository !== undefined) stamp_file.remove_stamp(park_path(repository, issue))
}

// **A fault reads as "not parked"**, the direction `carried_cut_sync` takes: the guard then speaks once,
// which a child answers by reissuing, rather than falling silent on a run that never parked.
function is_parked_sync(issue: string, directory: string, now: Date = new Date()): boolean {
	const repository = git_common_directory.repository(directory)

	if (repository === undefined) return false

	const read = stamp_record.classify(
		stamp_file.read_stamp_text(park_path(repository, issue)),
		PARK_SPEC,
		now,
	)

	return read.kind === 'carried' && read.record.issue === issue
}

const run_park = { PARK_MAX_AGE_MS, clear, is_parked_sync, record }

export { run_park }
