import { lane_registry } from '#scripts/lane/lane-registry'
import { run_cut } from '#scripts/run/cut/run-cut'
import { run_cut_adoption } from '#scripts/run/cut/run-cut-adoption'

// Only called after the worker has stopped; every terminal collection releases the same owner.
async function release(child: string): Promise<void> {
	const lane = await lane_registry.find_open_lane(child)
	if (lane === undefined) return
	const carried = run_cut.lane_cut_sync(lane.directory)
	if (carried === undefined) return

	run_cut_adoption.release(carried.target, carried.cut, child)
}

const run_merge_cut_release = { release }

export { run_merge_cut_release }
