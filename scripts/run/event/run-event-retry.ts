import { run_event_scope } from './run-event-scope'
import { run_event_stream, type RunEvent } from './run-event-stream'

const RETRY_PREFIX = 'retry #'
// The drive's auto-retry cap per issue and the note its park is restated with on reaching it
// (`backlog-drive-stalled-retry.ts`); here, off the drive's imports, so the board reads the note too.
const RETRY_CAP = 2
const CAP_NOTE = `auto-retry cap ${String(RETRY_CAP)} reached`

function text_of(issue: number): string {
	return `${RETRY_PREFIX}${String(issue)}`
}

function is_retry(event: RunEvent): boolean {
	return event.kind === run_event_stream.EVENT_KIND.ADD && event.text.startsWith(RETRY_PREFIX)
}

// Keep each issue's newest attempt. Other issues and run-wide events retain their history.
function current_attempts(events: ReadonlyArray<RunEvent>): ReadonlyArray<RunEvent> {
	const boundaries = new Map<string | undefined, number>()

	for (const event of events) {
		if (is_retry(event)) boundaries.set(run_event_scope.issue_named(event), event.pos)
	}

	return events.filter(
		(event) => event.pos >= (boundaries.get(run_event_scope.issue_named(event)) ?? 0),
	)
}

// How many times the stream has retried one issue, across every invocation it holds.
function count_of(events: ReadonlyArray<RunEvent>, issue: number): number {
	return events.filter(
		(event) => is_retry(event) && run_event_scope.issue_named(event) === String(issue),
	).length
}

export const run_event_retry = {
	CAP_NOTE,
	RETRY_CAP,
	count_of,
	current_attempts,
	is_retry,
	text_of,
}
