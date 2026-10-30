import { run_event_scope } from './run-event-scope'
import { run_event_stream, type RunEvent } from './run-event-stream'

const RETRY_PREFIX = 'retry #'

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

export const run_event_retry = { current_attempts, is_retry, text_of }
