import { PROCESS_ALIVE } from '#scripts/run/run-liveness'
import { lane_listening_ports } from './lane-listening-ports'
import { lane_process_table } from './lane-process-table'
import type { LaneInfo } from './lane-registry'
import { lane_snapshot_trace } from './lane-snapshot-trace'

interface SeatSnapshot {
	running: ReadonlySet<string>
	ports: ReadonlySet<number>
}

const UNREADABLE =
	'Cannot read lane process ownership or listening ports (process or socket probe failed).'

async function snapshot(issues: ReadonlyArray<string> = []): Promise<SeatSnapshot | undefined> {
	const [ports, rows] = await Promise.all([
		lane_listening_ports.read_ports(),
		lane_process_table.read_table(),
	])
	if (ports === undefined || rows === undefined) return undefined
	const trace = await lane_snapshot_trace.traces_of(issues, rows)

	return { running: new Set(issues.filter((issue) => trace(issue) === PROCESS_ALIVE)), ports }
}

function ports_held(
	lane: Pick<LaneInfo, 'development_port' | 'preview_port'>,
	ports: ReadonlySet<number>,
): boolean {
	return [lane.development_port, lane.preview_port].some(
		(port) => port !== undefined && ports.has(port),
	)
}

function ownership(lane: LaneInfo, reading: SeatSnapshot | undefined): LaneInfo {
	if (lane.is_stranded) return { ...lane, seat_held: false }
	if (reading === undefined) return { ...lane, seat_held: true, seat_problem: UNREADABLE }
	const is_running = reading.running.has(lane.issue)

	return {
		...lane,
		seat_owned: is_running,
		seat_held: is_running || ports_held(lane, reading.ports),
	}
}

function measure(
	lanes: ReadonlyArray<LaneInfo>,
	reading: SeatSnapshot | undefined,
): Array<LaneInfo> {
	return lanes.map((lane) => ownership(lane, reading))
}

const lane_seat_ownership = { measure, ports_held, snapshot, UNREADABLE }

export { lane_seat_ownership }
export type { SeatSnapshot }
