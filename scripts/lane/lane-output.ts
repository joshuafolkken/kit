import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { ENV_FILE_NAME } from '#ports'
import { run_liveness } from '#scripts/run/run-liveness'
import { lane_environment } from './lane-environment'
import { lane_registry, type LaneInfo } from './lane-registry'

// Where the delegated unit running a lane's child writes, recorded in the lane and read back from
// anywhere (joshuafolkken/kit#1713).
//
// **This is the one fact about an in-flight lane that only the dispatching session held.** The
// harness names a unit's output file after that session's own id and the unit's, and neither is
// written anywhere on disk — so a session that did not open the lane could not poll its child, and
// a hand-off had to drain the pool first: no new lane opened until every in-flight one had finished.
// Recorded here, `pnpm josh run:liveness <N> --output "$(pnpm josh lane:output <N>)"` works from a
// session that has never seen the child, and the drain goes away.
//
// **Nothing here writes a `.env` that was not already there.** A lane whose file cannot be read is
// refused rather than replaced: the same file carries the lane's port seat, and a fresh one holding
// only this record would put the lane back on the main work tree's ports.

type Refusal =
	{ kind: 'no-lane' } | { kind: 'invalid'; reason: string } | { kind: 'unreadable'; lane: LaneInfo }

type RecordOutcome = Refusal | { kind: 'recorded'; lane: LaneInfo; output: string }

type ReadOutcome =
	| { kind: 'no-lane' }
	| { kind: 'none'; lane: LaneInfo }
	| { kind: 'read'; lane: LaneInfo; output: string }

const NO_OUTPUT = 'This lane records no output path yet.'
// A quote would end the quoted assignment the record is written as, and a newline would split it
// into two lines — either way the file would say something other than what was handed in.
const FORBIDDEN_CHARACTERS = /["\n\r]/u

/**
 * Why this path cannot be recorded, or `undefined` when it can.
 *
 * **A path `run:liveness` could not read is refused here rather than there.** That command answers
 * `undetermined` for one — an answer meaning "could not read" — so a lane recorded with it would
 * poll as indeterminate for ever instead of the record being reported wrong. **The test is
 * `run_liveness.to_safe_path` itself, never a second copy of its rules**: absolute, normalized, and
 * confined to the home and temp directories, in both spellings of each. Restating half of that here
 * is exactly how the two would come to disagree.
 */
function invalid_reason(output: string): string | undefined {
	if (FORBIDDEN_CHARACTERS.test(output)) return 'the path cannot hold a quote or a line break'

	return run_liveness.to_safe_path(output) === undefined
		? 'the path has to be one `run:liveness` can read: absolute, and under the home or temp directory'
		: undefined
}

async function find_lane(issue: string): Promise<LaneInfo | undefined> {
	return lane_registry.find_lane(await lane_registry.list_lanes(), issue)
}

/** Record where this lane's unit writes, leaving everything else in its `.env` untouched. */
async function record_output(issue: string, output: string): Promise<RecordOutcome> {
	const reason = invalid_reason(output)

	if (reason !== undefined) return { kind: 'invalid', reason }

	const lane = await find_lane(issue)

	if (lane === undefined) return { kind: 'no-lane' }

	const content = lane_registry.read_environment(lane.directory)

	if (content === undefined) return { kind: 'unreadable', lane }

	writeFileSync(
		path.join(lane.directory, ENV_FILE_NAME),
		lane_environment.with_lane_output(content, output),
	)

	return { kind: 'recorded', lane, output }
}

/**
 * The path this lane records, read through the registry every other lane reading goes through.
 *
 * The session asking is never assumed to be the one that opened the lane — that is the whole point:
 * the answer comes from the lane's own `.env`, so it is the same answer in every session.
 */
async function read_output(issue: string): Promise<ReadOutcome> {
	const lane = await find_lane(issue)

	if (lane === undefined) return { kind: 'no-lane' }

	const { output } = lane

	if (output === undefined) return { kind: 'none', lane }

	return { kind: 'read', lane, output }
}

function describe_refusal(refusal: Refusal, issue: string): string {
	if (refusal.kind === 'invalid') {
		return `That output path cannot be recorded: ${refusal.reason}. \`pnpm josh run:liveness\` reads only an absolute path, so a record it cannot use would be worse than none.`
	}

	if (refusal.kind === 'unreadable') {
		return `The lane for #${issue} has a ${ENV_FILE_NAME} that cannot be read at ${refusal.lane.directory}. Fix it and run this again — writing a new one would drop the lane's port seat with it.`
	}

	return `No lane is open for #${issue}. Run \`pnpm josh lane:list\` to see what is open.`
}

const lane_output = {
	NO_OUTPUT,
	describe_refusal,
	invalid_reason,
	read_output,
	record_output,
}

export type { ReadOutcome, RecordOutcome, Refusal }
export { lane_output }
