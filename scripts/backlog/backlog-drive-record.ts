import { issue_cite } from '#scripts/issue/issue-cite'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_stalled } from '#scripts/run/park/run-stalled'
import { run_stalled_park } from '#scripts/run/park/run-stalled-park'
import { backlog_arrival_added, type EventReader } from './backlog-arrival-added'
import type { LoopPorts } from './backlog-drive'
import type { DriveLaunch } from './backlog-drive-launch-pass'
import { backlog_yield_cap } from './backlog-yield-cap'

// The run's own record the driver reads: the carry, and the two answers the ask interval takes from the
// run (joshuafolkken/kit#6788) — an issue `run:add` handed it, and a named issue left to dispatch — and
// the yield cap's (joshuafolkken/kit#6799): the stream's yields of an issue, and the park a trip writes;
// and the `run:stalled` park a refused launch writes (joshuafolkken/kit#6878).

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

// The launch's `no-child` event already carries the refusal's detail, so the comment points at the log.
async function stall(issue: string, outcome: DriveLaunch): Promise<void> {
	const comment = [
		`Parked by \`backlog:drive\`: \`lane:launch\` answered \`${outcome}\` for ${issue_cite.plain_for('program', issue)}.`,
		'',
		`Read the lane's log, then ${run_stalled.next_step(issue)}.`,
	].join('\n')

	await run_stalled_park.apply(issue, comment, `launch ${outcome}`)
}

// `read` is the tick's shared stream read (`backlog_arrival_added.tick_reader`), so the two questions
// parse the stream once between them (joshuafolkken/kit#7016).
function record_ports(
	read?: EventReader,
): Pick<LoopPorts, 'added_since' | 'raised_since' | 'named_left' | 'yields' | 'park' | 'stall'> {
	return {
		added_since: async (since_ms) => await backlog_arrival_added.is_added_since(since_ms, read),
		raised_since: async (since_ms) => await backlog_arrival_added.is_raised_since(since_ms, read),
		named_left: is_named_left,
		...backlog_yield_cap.PORTS,
		stall,
	}
}

const backlog_drive_record = { read_record, record_ports }

export { backlog_drive_record }
