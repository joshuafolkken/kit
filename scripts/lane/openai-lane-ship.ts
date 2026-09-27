import { setTimeout as sleep } from 'node:timers/promises'
import { run_ship_detach } from '#scripts/run/run-ship-detach'
import { run_ship_probe } from '#scripts/run/run-ship-probe'

const POLL_MS = 250
type ShipEnding = 'none' | 'success' | 'failed' | 'abnormal'
type ShipReading = NonNullable<ReturnType<typeof run_ship_detach.read_result>>

async function current(issue: string): Promise<ShipReading | undefined> {
	const repository = await run_ship_probe.repository_directory()

	return repository === undefined ? undefined : run_ship_detach.read_result(repository, issue)
}

async function wait_for_ship(issue: string, prior_launch: string | undefined): Promise<ShipEnding> {
	let read = await current(issue)
	if (read === undefined || read.launch_id === prior_launch) return 'none'

	while (read.result === 'running') {
		await sleep(POLL_MS)
		read = await current(issue)
		if (read === undefined) return 'abnormal'
	}

	return read.result
}

const openai_lane_ship = { current, wait_for_ship }

export { openai_lane_ship }
