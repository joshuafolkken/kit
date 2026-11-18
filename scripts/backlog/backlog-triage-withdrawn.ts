import { lane_yield } from '#scripts/lane/lane-yield'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'

// Whether a person withdrew the issue's lane (`lane:withdraw`) and nobody launched it again: a yield's
// withdrawal requeues the lane, so it does not count (`lane-yield.ts`).
function is_withdrawn(events: ReadonlyArray<RunEvent>, issue: string): boolean {
	return run_event_scope.is_withdrawn(events, issue) && !lane_yield.is_yielded(events, issue)
}

// The same, read from this run's events: an adopt after the withdrawal neither requeues nor re-parks
// the lane (joshuafolkken/kit#7983).
async function read_is_withdrawn(issue: string): Promise<boolean> {
	return is_withdrawn(await run_event_stream_emit.current_events(), issue)
}

const backlog_triage_withdrawn = { is_withdrawn, read_is_withdrawn }

export { backlog_triage_withdrawn }
