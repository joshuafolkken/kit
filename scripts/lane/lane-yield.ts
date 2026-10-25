import { issue_cite } from '#scripts/issue/issue-cite'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'

// A lane child that gives its lane back (joshuafolkken/kit#4926): `lane:plan` found a running lane that
// planned one of its files first, so instead of polling for the holder to end while its seat stays taken,
// it writes a `withdraw` event naming itself and ends. `run:merge` books it `withdrawn` — neither a merge,
// a failure nor an outage — and closes the lane through `lane:withdraw`'s path, named as this withdrawer.
//
// **Unlike a person's withdrawal, a yield does not take the issue out of the run.** Its plan outlives the
// lane (`lane-close.ts` → `record_end`), so `backlog:next` holds it back on that plan while the holder
// runs and offers it again once the holder's lane ends; `backlog-drive-restore.ts` reads `is_yield` to
// leave it out of the withdrawn and the settled issues.

// The reason `run:merge` closes a yielded lane with.
const YIELD_REASON = 'it gave its lane back to an earlier lane holding one of its planned files'

const YIELD_TEXT = {
	name: 'its own lane:plan',
	cause: '`lane:plan` gave its lane back to an earlier lane holding one of its planned files',
	closed_head: 'Its lane was given back by `pnpm josh lane:plan` after the Issue was closed.',
	open_head:
		'Gave its lane back: `pnpm josh lane:plan` found an earlier lane holding one of its planned files.',
	open_tail:
		'The lane closed before any implementation edit. The Issue stays in the run: it is offered again once the holding lane ends, keeping its place in line.',
} as const

async function record_yield(issue: number, reason: string): Promise<void> {
	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.WITHDRAW,
		`${issue_cite.plain(String(issue))} withdrawn by ${YIELD_TEXT.name}: ${reason}`,
	)
}

// Whether `event` is a lane's yield rather than a withdrawal that takes the issue out of the run.
function is_yield(event: RunEvent): boolean {
	return (
		event.kind === run_event_stream.EVENT_KIND.WITHDRAW &&
		event.text.includes(` withdrawn by ${YIELD_TEXT.name}:`)
	)
}

// Whether the issue's newest launch was settled by its own yield — `run_event_scope.is_withdrawn`, with
// that withdrawal a yield.
function is_yielded(events: ReadonlyArray<RunEvent>, issue: string): boolean {
	const newest = events.findLast(
		(event) =>
			event.kind === run_event_stream.EVENT_KIND.WITHDRAW &&
			run_event_scope.issue_named(event) === issue,
	)

	return run_event_scope.is_withdrawn(events, issue) && newest !== undefined && is_yield(newest)
}

const lane_yield = { YIELD_REASON, YIELD_TEXT, is_yield, is_yielded, record_yield }

export { lane_yield }
