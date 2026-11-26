import { lane_dispatch_dependency } from '#scripts/lane/lane-dispatch-dependency'
import type { OfferRead } from './backlog-drive'

// A failed read is left to `lane:dispatch`, which waits on it and retries.
async function has_unfinished(issue: string): Promise<boolean> {
	try {
		const blockers = await lane_dispatch_dependency.unfinished(issue)

		return blockers.length > 0
	} catch {
		return false
	}
}

// Only the issue itself offered to run is read: an epic's children have their own offer.
function is_issue_run(issue: string, offered: OfferRead | undefined): boolean {
	return offered?.verdict === 'run' && offered.issues.includes(issue)
}

// joshuafolkken/kit#8965, joshuafolkken/kit#8953: every named issue whose blockers are unfinished waits
// at the offer, declared or put in by `run:add`, so the named offer passes it (`is_passed`) and the
// issues behind it fill the free lanes, rather than `lane:dispatch` refusing it (exit 75) on every tick.
// The blockers are read again each tick, so the issue is offered again once they close.
async function gate(issue: string, offered: OfferRead | undefined): Promise<OfferRead | undefined> {
	if (!is_issue_run(issue, offered)) return offered

	return (await has_unfinished(issue)) ? { verdict: 'wait', issues: [], retries: 0 } : offered
}

export const backlog_drive_blocked = { gate }
