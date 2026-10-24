import { issue_cite } from '#scripts/issue/issue-cite'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'

// A returned child a Claude usage limit stopped (joshuafolkken/kit#4745). Nothing is counted and no park
// label is put on it — the limit is the account's, not the child's — so it is released for the backlog
// to offer again, and the stop is written to the event stream with the time the limit resets.
// `backlog:drive` reads that time back and launches nothing before it. **It is no `OUTAGE`**: the
// per-child cap counts those (`run-merge-cap.ts`), and a wait for a known reset is no outage streak.
// Script-emitted, so English.

const KIND = run_event_stream.EVENT_KIND.USAGE_LIMIT
const RESUMES_AT = /resumes at (\S+)$/u

function stop_text(child: string, reset_ms: number): string {
	return `${issue_cite.plain(child)} usage limit — resumes at ${new Date(reset_ms).toISOString()}`
}

async function record(child: string, reset_ms: number): Promise<void> {
	await run_event_stream_emit.emit(KIND, stop_text(child, reset_ms))
}

// The time a stop's text names, or `undefined` when it does not parse.
function time_of(text: string): number | undefined {
	const parsed = Date.parse(RESUMES_AT.exec(text)?.[1] ?? '')

	return Number.isNaN(parsed) ? undefined : parsed
}

// The reset the newest usage-limit stop names, in epoch milliseconds, or `undefined` when the stream
// holds none — every lane shares the one account, so the newest stop is the limit in force.
function resume_ms(events: ReadonlyArray<RunEvent>): number | undefined {
	const newest = events.findLast((event) => event.kind === KIND)

	return newest === undefined ? undefined : time_of(newest.text)
}

// Whether a usage limit still holds launches at `now_ms` — the production `usage_limited` port.
async function is_held(now_ms: number): Promise<boolean> {
	const reset_ms = resume_ms(await run_event_stream_emit.current_events())

	return reset_ms !== undefined && reset_ms > now_ms
}

const run_merge_usage_limit = { is_held, record, resume_ms }

export { run_merge_usage_limit }
