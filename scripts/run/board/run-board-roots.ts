import { process_identity } from '#scripts/josh/process-identity'
import { lane_process_table, type TableRead } from '#scripts/lane/lane-process-table'
import type { CarryRead } from '#scripts/run/carry/run-carry'
import { run_wake } from '#scripts/run/wake/run-wake'
import type { ProcessRoots } from './run-board-process-groups'

// The run's own processes the 💻 section names: the supervisor from its wake stamp and the parent
// session from the run's record. A pid whose start no longer matches is another process now, so it is
// dropped; one recorded without a start is kept.

type SameProcess = (pid: number | undefined, start: string | undefined) => boolean | undefined

function root_of(
	pid: number | undefined,
	start: string | undefined,
	is_same: SameProcess,
): number | undefined {
	return is_same(pid, start) === false ? undefined : pid
}

function supervisor_of(repository: string, is_same: SameProcess): number | undefined {
	const wake = run_wake.read_wake(run_wake.wake_path(repository))

	return wake === undefined ? undefined : root_of(wake.pid, wake.process_start, is_same)
}

function parent_of(read: CarryRead, is_same: SameProcess): number | undefined {
	if (read.kind !== 'carried') return undefined

	return root_of(read.carry.owner_pid, read.carry.owner_start, is_same)
}

function roots_of(
	repository: string,
	read: CarryRead,
	is_same: SameProcess = process_identity.is_same_process,
): ProcessRoots {
	return { supervisor: supervisor_of(repository, is_same), parent: parent_of(read, is_same) }
}

// `is_same_process` with each start time answered from the redraw's own `ps` snapshot, so the board's
// read runs no `ps` of its own per pid (joshuafolkken/kit#4263). Without a snapshot no start is known,
// and a recorded start reads as "cannot tell".
async function same_in(table: TableRead | undefined): Promise<SameProcess> {
	const rows = table === undefined ? undefined : await table()
	const read = lane_process_table.start_reader(rows ?? [])

	return (pid, start) => process_identity.is_same_process(pid, start, read)
}

const run_board_roots = { roots_of, same_in }

export { run_board_roots }
export type { SameProcess }
