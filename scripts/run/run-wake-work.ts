import { backlog_stalled } from '#scripts/backlog/backlog-stalled'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_capacity } from '#scripts/lane/lane-capacity'
import { lane_registry } from '#scripts/lane/lane-registry'
import { run_carry, type CarryRead } from './run-carry'
import { run_invocation } from './run-invocation'

// Whether a session the supervisor is about to wake would find anything to do (joshuafolkken/kit#2417).
//
// **This is what stops the whiff at its source.** The wake decision read the carry record alone, so a
// session was launched whether or not there was work, and a woken session that found the backlog empty
// or every lane taken ended without touching anything — a full agent session, preamble and all, bought
// to learn one boolean. Asked here, in the supervisor's own process, the same boolean costs a
// `git worktree list` and at most one `backlog:next`, and no session at all.
//
// **Cheap first, as the stall detector reads it.** The named issues left on the carry record need no
// I/O; the free-lane count is local; `backlog:next` is the one network read, and it is made only where
// a lane is free for its answer to go into. Both counts are read with the stall detector's primitives
// (`lane_capacity`, `lane_registry`, `count_ready_tokens`), so "a free lane and a ready issue" means one
// thing in both places.
//
// **`undefined` is "cannot tell", and the caller wakes on it.** A failed read is not an empty pool: read
// as one, an outage would defer every launch until the idle ceiling, stalling a run that had work. That
// is why neither of the stall detector's readers is reused whole — it reads an unreadable lane limit
// and a failed `backlog:next` as zero, the safe direction for a stall report and the wrong one here —
// and why a read that throws (a `git worktree list` caught mid-prune) is caught rather than ending the
// supervisor.

const NO_FREE = 0
const NO_READY = 0
const SUCCESS_EXIT_CODE = 0

interface WorkPorts {
	// The free-lane count, or `undefined` where the lane limit could not be read.
	free_lane_count: () => Promise<number | undefined>
	// The runnable count, or `undefined` where `backlog:next` could not answer.
	ready_count: () => Promise<number | undefined>
}

async function real_ready_count(): Promise<number | undefined> {
	const result = await josh_command.josh_run(['backlog:next'], true)

	if (result.code !== SUCCESS_EXIT_CODE) return undefined

	return backlog_stalled.count_ready_tokens(result.out)
}

async function real_free_lane_count(): Promise<number | undefined> {
	const limit = lane_capacity.lane_limit()

	if (limit.kind !== 'limit') return undefined

	const lanes = await lane_registry.list_lanes()
	const live = lanes.filter((lane) => !lane.is_stranded).length

	return lane_capacity.free_lanes(limit.limit, live)
}

const DEFAULT_WORK_PORTS: WorkPorts = {
	free_lane_count: real_free_lane_count,
	ready_count: real_ready_count,
}

// **Work the record answers without a read.** Named issues still to run are work by definition, and a
// `--only` run whose named list is done is work of a different kind: the session is needed to finish
// the run, and there is no pool it could be waiting on — deferring it would only delay the report.
function is_owed_by_record(read: CarryRead): boolean {
	if (read.kind !== 'carried') return true

	const remaining = run_carry.remaining_of(read.carry)

	if (remaining !== undefined && remaining.length > NO_READY) return true

	return run_invocation.has_only(read.carry.invocation)
}

async function read_pool(ports: WorkPorts): Promise<boolean | undefined> {
	const free = await ports.free_lane_count()

	if (free === undefined) return undefined
	if (free <= NO_FREE) return false

	const ready = await ports.ready_count()

	return ready === undefined ? undefined : ready > NO_READY
}

async function has_work(
	read: CarryRead,
	ports: WorkPorts = DEFAULT_WORK_PORTS,
): Promise<boolean | undefined> {
	if (is_owed_by_record(read)) return true

	try {
		return await read_pool(ports)
	} catch {
		return undefined
	}
}

const run_wake_work = { DEFAULT_WORK_PORTS, has_work }

export type { WorkPorts }
export { run_wake_work }
