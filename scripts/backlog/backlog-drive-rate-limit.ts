import { gh_core_rate_limit, type CoreRateLimit } from '#scripts/gh/gh-core-rate-limit'
import type { DriveState, OfferRead } from './backlog-drive'

// joshuafolkken/kit#6563: an offer spent while GitHub's core REST allowance is nearly dry fails every
// `issue:read` / `backlog:next` read until the window refills, and the failed reads stop lanes. Below
// this floor the loop waits for the reset instead — 2% of the 5000/h allowance is left to the
// children already running. `GET /rate_limit` itself does not count against the allowance.
const REMAINING_FLOOR = 100

const WAIT_VERDICT = 'wait'

type CoreReader = () => Promise<CoreRateLimit | undefined>

// The `wait` read that stands in for an offer until the allowance refills, or `undefined` to offer as
// usual — the allowance is above the floor, or it could not be read, which never stops the offer.
async function held(
	state: DriveState,
	read_core: CoreReader = gh_core_rate_limit.read_core,
): Promise<OfferRead | undefined> {
	const core = await read_core()

	if (core === undefined || core.remaining >= REMAINING_FLOOR) return undefined

	return { verdict: WAIT_VERDICT, issues: [], retries: state.retries, not_before_ms: core.reset_ms }
}

const backlog_drive_rate_limit = { REMAINING_FLOOR, held }

export { backlog_drive_rate_limit }
