import { lane_withdraw } from '#scripts/lane/lane-withdraw'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'

// The lane of a child `run:merge` booked `withdrawn` (joshuafolkken/kit#4916). A person's
// `lane:withdraw` already stopped the child, closed its lane and put itself on the stream, so nothing is
// left to do. A child whose issue closed without a merge had no such withdrawal: its lane is still open,
// so it is withdrawn here through `lane:withdraw`'s own path — stopped, its work stashed, the lane
// closed and the withdrawal put on the stream — and never booked as a merge. A withdrawal that could not
// read the child's state stopped and closed nothing, so it asks for a retry rather than leak the lane.

const UNMERGED_REASON = 'its issue was closed without a merged pull request'

interface Collected {
	// The `lane:withdraw` note, or `undefined` where a person had already withdrawn the child.
	note: string | undefined
	is_retry: boolean
}

/** Withdraw `#<child>`'s lane unless a withdrawal is already on the stream. */
async function collect(child: string): Promise<Collected> {
	const events = await run_event_stream_emit.current_events()

	if (run_event_scope.is_withdrawn(events, child)) return { note: undefined, is_retry: false }
	const outcome = await lane_withdraw.withdraw(child, UNMERGED_REASON, 'merge')

	return { note: lane_withdraw.describe(outcome, child), is_retry: outcome.kind === 'unreadable' }
}

const run_merge_withdrawn = { UNMERGED_REASON, collect }

export { run_merge_withdrawn }
