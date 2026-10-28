import { poll } from '#scripts/lib/poll'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { run_ship_probe } from '#scripts/run/ship/run-ship-probe'

const POLL_MS = 250
type ShipEnding = 'none' | 'success' | 'failed' | 'abnormal'
type ShipReading = NonNullable<ReturnType<typeof run_ship_detach.read_result>>

async function current(issue: string): Promise<ShipReading | undefined> {
	const repository = await run_ship_probe.repository_directory()

	return repository === undefined ? undefined : run_ship_detach.read_result(repository, issue)
}

// The ship's ending once it leaves `running`, and `abnormal` once its result is gone.
async function settled(issue: string): Promise<Exclude<ShipEnding, 'none'> | undefined> {
	const read = await current(issue)
	if (read === undefined) return 'abnormal'

	return read.result === 'running' ? undefined : read.result
}

async function wait_for_ship(issue: string, prior_launch: string | undefined): Promise<ShipEnding> {
	const read = await current(issue)
	if (read === undefined || read.launch_id === prior_launch) return 'none'
	if (read.result !== 'running') return read.result

	return await poll.wait_for(async () => await settled(issue), { interval_ms: POLL_MS })
}

const openai_lane_ship = { current, wait_for_ship }

export { openai_lane_ship }
