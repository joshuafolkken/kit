import { lane_hand_back_hold } from './lane-hand-back-hold'
import { lane_held_stats } from './lane-held-stats'
import { lane_ledger } from './lane-ledger'
import { lane_ledger_write } from './lane-ledger-write'

// The hold a lane freed with no backlog driver running writes, from the mark a driver left when it handed
// back a full pool (`lane-hand-back-hold.ts`, joshuafolkken/kit#7121). A detached `josh ship` frees its
// lane once its merge wait starts (`run-ship-steps.ts`) and calls this: the mark's reason becomes a `held` line, which `lane:stats` and `run:board` read
// as any driver's hold, and the next driver's first ledger line ends it.
//
// **No mark, no hold**: a running driver clears the mark on every line it writes, so a full pool under
// a running driver is still not counted as held. A hold already open is left to stand rather than split.
//
// The reason carries `driverless:` before the mark's: a driver's own `hand-back:` hold answers an offer,
// this one answers none, and `lane-gap-stats.ts` must not end a park at it.
//
// Best-effort like every ledger write: a failure records nothing rather than failing the ship.

const DRIVERLESS_PREFIX = 'driverless:'

function is_driverless(reason: string): boolean {
	return reason.startsWith(DRIVERLESS_PREFIX)
}

function is_closed(ledger: string, now_ms: number): boolean {
	return lane_held_stats.open_reason(lane_ledger.read_entries(ledger), now_ms) === undefined
}

async function hold(ledger: string, now_ms: number): Promise<void> {
	const reason = lane_hand_back_hold.take(ledger)

	if (reason !== undefined && is_closed(ledger, now_ms)) {
		await lane_ledger_write.record_held({ reason: `${DRIVERLESS_PREFIX}${reason}` }, ledger)
	}
}

// `ledger` defaults to this repository's — `undefined` outside one or in a test, where nothing is written.
async function record(ledger?: string, now_ms: number = Date.now()): Promise<void> {
	try {
		const resolved = ledger ?? (await lane_ledger.target())

		if (resolved !== undefined) await hold(resolved, now_ms)
	} catch {
		// Best-effort: the free lane stays unrecorded, as before the mark existed.
	}
}

const lane_hand_back_held = { DRIVERLESS_PREFIX, is_driverless, record }

export { lane_hand_back_held }
