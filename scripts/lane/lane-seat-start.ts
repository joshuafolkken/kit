import { LANE_SEAT_KEY, PORT_SEED_KEY } from '#ports'
import { lane_environment } from './lane-environment'
import { lane_paths } from './lane-paths'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_seat } from './lane-seat'

function update(lane: LaneInfo, seat: number): LaneInfo {
	const content = lane_registry.read_environment(lane.directory)
	if (content === undefined) throw new Error(`Cannot read lane environment: ${lane.directory}`)
	const updated = lane_environment.lane_file_content(content, seat)
	const ports = lane_environment.read_lane_ports(updated)

	lane_registry.write_environment(lane.directory, updated)

	return {
		...lane,
		seat,
		development_port: ports.development,
		preview_port: ports.preview,
		seat_held: true,
	}
}

async function start<T>(lane: LaneInfo, launch: (seated: LaneInfo) => Promise<T>): Promise<T> {
	const root = lane_paths.lane_root(await lane_registry.main_repository_root())
	const reservation = await lane_seat.reserve(root, lane.issue)
	if (reservation === undefined) throw new Error('No free port seat is available for this lane.')

	try {
		return await launch(update(lane, reservation.seat))
	} finally {
		lane_seat.release(reservation)
	}
}

function environment(lane: LaneInfo): Record<string, string> {
	if (lane.seat === undefined) {
		throw new Error('Cannot launch a lane without an allocated port seat.')
	}

	const content = lane_registry.read_environment(lane.directory)
	if (content === undefined) throw new Error(`Cannot read lane environment: ${lane.directory}`)

	return {
		[LANE_SEAT_KEY]: String(lane.seat),
		[PORT_SEED_KEY]: String(lane_environment.read_root_seed(content)),
	}
}

const lane_seat_start = { environment, start }

export { lane_seat_start }
