import { lane_registry } from '#scripts/lane/lane-registry'
import { lane_withdraw_closed } from '#scripts/lane/lane-withdraw-closed'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'

// The lane of a child `run:merge` booked `withdrawn` (joshuafolkken/kit#4916). A person's
// `lane:withdraw` already stopped the child, closed its lane and put itself on the stream, so nothing is
// left to do. A child whose issue closed without a merge had no such withdrawal: its lane is still open,
// so it is withdrawn here through the `run:wake` sweep's guarded path — kept where its branch has
// commits on no remote, else stopped, its work stashed, the lane closed and the withdrawal put on the
// stream — and never booked as a merge. A withdrawal that could not read the child stopped and closed
// nothing, so it asks for a retry rather than leak the lane.

const UNMERGED_REASON = 'its issue was closed without a merged pull request'

interface Collected {
	// The withdrawal's note, or `undefined` where a withdrawal is on the stream or no lane is open.
	note: string | undefined
	is_retry: boolean
}

const NOTHING_LEFT: Collected = { note: undefined, is_retry: false }

/** Withdraw `#<child>`'s open lane unless a withdrawal is already on the stream. */
async function collect(child: string): Promise<Collected> {
	const events = await run_event_stream_emit.current_events()

	if (run_event_scope.is_withdrawn(events, child)) return NOTHING_LEFT
	const lane = await lane_registry.find_open_lane(child)

	if (lane === undefined) return NOTHING_LEFT

	return await lane_withdraw_closed.withdraw_lane(lane, UNMERGED_REASON, 'merge')
}

const run_merge_withdrawn = { UNMERGED_REASON, collect }

export { run_merge_withdrawn }
