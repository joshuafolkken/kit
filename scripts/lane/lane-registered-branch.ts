import { lane_paths } from './lane-paths'
import { lane_registry } from './lane-registry'

async function read(issue: string): Promise<string> {
	const lane = await lane_registry.find_open_lane(issue)

	return lane?.branch ?? lane_paths.lane_branch(issue)
}

const lane_registered_branch = { read }

export { lane_registered_branch }
