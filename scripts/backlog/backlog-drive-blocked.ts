import { lane_dispatch_dependency } from '#scripts/lane/lane-dispatch-dependency'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import type { OfferRead } from './backlog-drive'
import { backlog_drive_named } from './backlog-drive-named'

// A failed read is left to `lane:dispatch`, which waits on it and retries.
async function has_unfinished(issue: string): Promise<boolean> {
	try {
		const blockers = await lane_dispatch_dependency.unfinished(issue)

		return blockers.length > 0
	} catch {
		return false
	}
}

// Only the issue itself offered to run is read: an epic's children have their own offer, and a declared
// issue keeps its order and is left to `lane:dispatch`.
function is_added_run(carry: RunCarry, issue: string, offered: OfferRead | undefined): boolean {
	if (offered?.verdict !== 'run' || offered.issues[0] !== issue) return false

	return !backlog_drive_named.is_declared(carry, issue)
}

// joshuafolkken/kit#8965: an added issue whose blockers are unfinished waits at the offer, so the named
// offer passes it (`is_passed`) and the added issues behind it fill the free lanes, rather than
// `lane:dispatch` refusing it (exit 75) on every tick. The blockers are read again each tick, so the
// issue is offered again once they close.
async function gate(
	carry: RunCarry,
	issue: string,
	offered: OfferRead | undefined,
): Promise<OfferRead | undefined> {
	if (!is_added_run(carry, issue, offered)) return offered

	return (await has_unfinished(issue)) ? { verdict: 'wait', issues: [], retries: 0 } : offered
}

export const backlog_drive_blocked = { gate }
