import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_stalled, type StallCause } from '#scripts/run/park/run-stalled'
import { run_merge_ship } from './run-merge-ship'

// Why a child the per-child re-dispatch cap stopped is parked (joshuafolkken/kit#4765). The cap turns a
// re-dispatchable ending into `failed`, and the park then named only the ship's stop — never that the cap
// was reached, how often the child was re-dispatched, or why its last relaunch started nothing.

type Events = ReadonlyArray<RunEvent>

const NO_RELAUNCH_FAILURE = 'none was recorded'

function is_own(event: RunEvent, kind: string, child: string): boolean {
	return event.kind === kind && run_event_scope.issue_named(event) === child
}

// Every re-dispatch `child` was counted for, across the run.
function outages(events: Events, child: string): number {
	return events.filter((event) => is_own(event, run_event_stream.EVENT_KIND.OUTAGE, child)).length
}

function last_relaunch_failure(events: Events, child: string): string {
	const kind = run_event_stream.EVENT_KIND.RELAUNCH_FAILED
	const failed = events.findLast((event) => is_own(event, kind, child))

	return failed === undefined ? NO_RELAUNCH_FAILURE : failed.text
}

// The cap's line, put before what the park judged.
function note_of(events: Events, child: string, limit: number): string {
	const count = outages(events, child)
	const failure = last_relaunch_failure(events, child)

	return `it reached the re-dispatch cap (${String(limit)}) after ${String(count)} re-dispatches; the last failed relaunch: ${failure}.`
}

// What a failed child is parked for: the caller's cause, else its ended ship's, else the unfinished
// session — led by the cap's line where the cap stopped its re-dispatch. A caller's cause parked the
// child on its own path, so the cap's line stays off it.
function park_cause(
	child: string,
	cause: StallCause | undefined,
	note: string | undefined,
): StallCause {
	if (cause !== undefined) return cause

	const judged = run_merge_ship.cause(child) ?? run_stalled.SESSION_UNFINISHED

	if (note === undefined) return judged

	return { short: judged.short, why: `${note} ${judged.why}` }
}

const run_merge_cap = { note_of, outages, park_cause }

export { run_merge_cap }
