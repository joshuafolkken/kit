import { setTimeout as sleep } from 'node:timers/promises'
import { poll } from '#scripts/lib/poll'
import type { ShipRecord } from './run-ship-detach'

const RECORD_POLL_MS = 25
const RECORD_WAIT_ATTEMPTS = 200

function is_pending(record: ShipRecord | undefined): boolean {
	return record !== undefined && record.pid === undefined
}

async function ready_record(read: () => ShipRecord | undefined): Promise<ShipRecord | undefined> {
	const ready = await poll.poll_for(
		() => {
			const record = read()

			return is_pending(record) ? undefined : { record }
		},
		{ attempts: RECORD_WAIT_ATTEMPTS, interval_ms: RECORD_POLL_MS, sleeper: sleep },
	)
	if (ready !== undefined) return ready.record
	await sleep(RECORD_POLL_MS)
	read()

	return undefined
}

const run_ship_record_wait = { ready_record }

export { run_ship_record_wait }
