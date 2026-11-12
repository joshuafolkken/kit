import { lane_reap } from './lane-reap'
import { lane_reap_settle } from './lane-reap-settle'
import { lane_registry } from './lane-registry'
import { lane_residents } from './lane-residents'

async function stop(issue: string): Promise<void> {
	const lane = await lane_registry.lane_location(issue)
	const reaped = lane_reap.reap_child(lane)

	lane_residents.end_residents(lane, reaped)
	const survivors = await lane_reap_settle.settle(lane)
	if (survivors?.length === 0) return
	const details = lane_reap_settle.survivor_texts(survivors).join(', ')

	throw new Error(`Lane ${issue} port ownership has not settled: ${details}`)
}

const lane_seat_stop = { stop }

export { lane_seat_stop }
