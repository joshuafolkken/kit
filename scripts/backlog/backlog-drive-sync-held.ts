import { run_merge_sync_held } from '#scripts/run/merge/run-merge-sync-held'
import { run_merge_usage_limit } from '#scripts/run/merge/run-merge-usage-limit'
import type { DrivePorts, DriveState, PassResult } from './backlog-drive'
import { backlog_hold_codes } from './backlog-hold-codes'

// The launch holds an offered `run` waits out before memory is read: a Claude usage limit, and a
// `main:sync` a dirty primary checkout refused (joshuafolkken/kit#9034). Either records its hold reason
// and polls on — the driver stays up, so no session is woken — while offers and collection go on.

interface LaunchHoldPorts {
	// Whether a Claude usage limit that stopped a child has yet to reset — `run_merge_usage_limit.is_held`
	// in production (joshuafolkken/kit#4745).
	usage_limited: () => Promise<boolean>
	// Whether a merge's `main:sync` a person's uncommitted work refused still holds launches —
	// `run_merge_sync_held.is_held` in production, which clears the hold once it is over.
	sync_held: () => Promise<boolean>
}

async function held_reason(ports: LaunchHoldPorts): Promise<string | undefined> {
	if (await ports.usage_limited()) return backlog_hold_codes.USAGE_LIMIT_REASON
	if (await ports.sync_held()) return backlog_hold_codes.MAIN_DIRTY_REASON

	return undefined
}

// The held pass, or `undefined` when no launch hold is in force.
async function launch_held(
	state: DriveState,
	ports: LaunchHoldPorts & Pick<DrivePorts, 'hold'>,
): Promise<PassResult | undefined> {
	const reason = await held_reason(ports)

	if (reason === undefined) return undefined

	await ports.hold(reason)

	return { kind: 'continue', state }
}

// The production launch-hold ports `backlog:drive` runs on.
function production_ports(): LaunchHoldPorts {
	return {
		usage_limited: async () => await run_merge_usage_limit.is_held(Date.now()),
		sync_held: run_merge_sync_held.is_held,
	}
}

const backlog_drive_sync_held = { launch_held, production_ports }

export { backlog_drive_sync_held }
export type { LaunchHoldPorts }
