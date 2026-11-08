import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { backlog_arrival_added } from './backlog-arrival-added'
import type { LoopPorts } from './backlog-drive'

// The run's own record the driver reads: the carry, and the two answers the ask interval takes from the
// run (joshuafolkken/kit#6788) — an issue `run:add` handed it, and a named issue left to dispatch.

async function read_record(): Promise<RunCarry | undefined> {
	const target = await run_carry.repository_directory()

	if (target === undefined) return undefined

	const read = run_carry.read_carry(run_carry.carry_path(target))

	return read.kind === 'carried' ? read.carry : undefined
}

async function is_named_left(): Promise<boolean> {
	const remaining = run_carry.remaining_of(await read_record()) ?? []

	return remaining.length > 0
}

function record_ports(): Pick<LoopPorts, 'added_since' | 'named_left'> {
	return {
		added_since: async (since_ms) => await backlog_arrival_added.is_added_since(since_ms),
		named_left: is_named_left,
	}
}

const backlog_drive_record = { read_record, record_ports }

export { backlog_drive_record }
