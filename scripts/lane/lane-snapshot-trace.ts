import {
	PROCESS_ALIVE,
	PROCESS_NONE,
	PROCESS_UNKNOWN,
	type ProcessTrace,
} from '#scripts/run/run-liveness'
import { lane_child_invocation } from './lane-child-invocation'
import { lane_handoff } from './lane-handoff'
import type { PausedProbes } from './lane-paused'
import { lane_process_table, type ProcessTable } from './lane-process-table'

// `lane_await.process_trace_default` answered for many lanes from one process snapshot
// (joshuafolkken/kit#4245). That probe starts a synchronous `pgrep` per lane and reads the ship record's
// start time through another `ps`, so a reader asking about every lane each few seconds — `run:board`,
// the backlogrun drive — blocked its event loop for as long as the lanes took between them.
//
// **The answers are the probe's own.** A command line matching the lane's pattern, or a detached ship
// still running for it, is `alive`; a snapshot that matched neither is `none`; a snapshot that could not
// be read is `unknown`, as an unanswered `pgrep` is. The ship record is read only for a lane no process
// matched, which is the only lane its answer can change.

type TraceRead = (issue: string) => ProcessTrace

function is_matched(probes: PausedProbes, issue: string): boolean {
	return probes.matching(lane_child_invocation.process_pattern(issue)).length > 0
}

/** Each of `issues` traced from `rows`, the snapshot `undefined` where it could not be read. */
async function traces_of(
	issues: ReadonlyArray<string>,
	rows: ProcessTable | undefined,
): Promise<TraceRead> {
	if (rows === undefined) return () => PROCESS_UNKNOWN

	const probes = lane_process_table.probes_of(rows)
	const unmatched = issues.filter((issue) => !is_matched(probes, issue))
	const is_shipping =
		unmatched.length === 0
			? (): boolean => false
			: await lane_handoff.ship_reader(lane_process_table.start_reader(rows))
	const idle = new Set(unmatched.filter((issue) => !is_shipping(issue)))

	return (issue) => (idle.has(issue) ? PROCESS_NONE : PROCESS_ALIVE)
}

const lane_snapshot_trace = { traces_of }

export { lane_snapshot_trace }
export type { TraceRead }
