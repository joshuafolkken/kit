import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { error_text } from '#scripts/lib/error-message'
import { run_ship_planned, type Unplanned } from '#scripts/run/ship/run-ship-planned'

// **`check:related` prints the ship's `unplanned` answer ahead of the ship** (joshuafolkken/kit#5203):
// asked only by the ship's preflight, a lane learned of a code file its `lane:plan` record never listed
// after the review and its fixes, and spent the re-plan and a second ship on it. The judgment is the
// preflight's own (`run-ship-planned.ts`); this run never stops on it — the preflight still does. Each
// notice printed is recorded, so `lane:stats` tells a preflight `unplanned` stop that came after one apart.

// A git read that fails here prints nothing rather than the run's verdict lost — the preflight still
// asks it, and reports an unreadable read as its own precondition.
async function read_unplanned(): Promise<Unplanned | undefined> {
	try {
		return await run_ship_planned.unplanned()
	} catch (error) {
		error_text.trace_swallowed('check_related_unplanned.notice', error)

		return undefined
	}
}

async function notice(): Promise<string | undefined> {
	const found = await read_unplanned()

	if (found === undefined) return undefined
	await lane_ledger_write.record_unplanned_notice({ issue: found.issue, files: [...found.files] })

	return found.text
}

const check_related_unplanned = { notice }

export { check_related_unplanned }
