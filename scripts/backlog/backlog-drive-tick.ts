import { lane_await } from '#scripts/lane/lane-await'
import { lane_process_table, type TableRead } from '#scripts/lane/lane-process-table'
import { lane_snapshot_trace } from '#scripts/lane/lane-snapshot-trace'
import { PROCESS_ALIVE } from '#scripts/run/run-liveness'
import { backlog_arrival_added, type EventReader } from './backlog-arrival-added'

// What one `backlog:drive` tick reads once and shares (joshuafolkken/kit#7016): the process table every
// in-flight child's liveness is answered from, rather than a synchronous `pgrep` per child, and the
// event stream both the addition and the raise question parse.
//
// An issue the tick's snapshot does not cover — adopted after it was taken — or a table that could not
// be read asks the per-issue probe, so the answers stay `lane_await.is_process_running_default`'s.

type RunningCheck = (issue: string) => boolean

interface Liveness {
	is_running: RunningCheck
	take: (issues: ReadonlyArray<string>) => Promise<void>
}

// A covered issue's liveness, `undefined` for one the snapshot does not cover.
type Snapshot = (issue: string) => boolean | undefined

async function snapshot_of(
	issues: ReadonlyArray<string>,
	table: TableRead,
): Promise<Snapshot | undefined> {
	if (issues.length === 0) return undefined

	const rows = await table()

	if (rows === undefined) return undefined

	const trace = await lane_snapshot_trace.traces_of(issues, rows)
	const covered = new Set(issues)

	return (issue) => (covered.has(issue) ? trace(issue) === PROCESS_ALIVE : undefined)
}

function liveness(
	table: TableRead = lane_process_table.read_table,
	is_probed_running: RunningCheck = lane_await.is_process_running_default,
): Liveness {
	const current: { snapshot: Snapshot | undefined } = { snapshot: undefined }

	return {
		is_running: (issue) => current.snapshot?.(issue) ?? is_probed_running(issue),
		take: async (issues) => {
			current.snapshot = await snapshot_of(issues, table)
		},
	}
}

interface TickShare {
	is_running: RunningCheck
	read: EventReader
	begin_tick: (in_flight: ReadonlyArray<string>) => Promise<void>
}

function tick_share(
	lanes: Liveness = liveness(),
	stream = backlog_arrival_added.tick_reader(),
): TickShare {
	return {
		is_running: lanes.is_running,
		read: stream.read,
		begin_tick: async (in_flight) => {
			stream.begin_tick()
			await lanes.take(in_flight)
		},
	}
}

const backlog_drive_tick = { liveness, tick_share }

export { backlog_drive_tick }
export type { Liveness, RunningCheck, TickShare }
