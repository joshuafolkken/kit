import { agent_exit_record } from './agent-exit-record'
import type { ClaudeResultEvent } from './claude-result-event'

// Whether a Claude session's exit record is an authentication failure — measured on 2026-10-19, when
// an expired OAuth session ended three lane children with `Failed to authenticate: OAuth session
// expired and could not be refreshed` and the parent parked each as a child that stopped on its own
// (joshuafolkken/kit#4216).
//
// **Kept apart from `api-outage.ts`**: an outage clears on its own, so its child is re-dispatched; an
// authentication failure lasts until a person runs `/login`, so every dispatch fails the same way and
// the run has to stop instead. The read is the same mechanical one — the error flag AND a fixed
// marker in the harness's own `reason`, never the marker alone.

// Matched against `reason`, which carries the record's `result` text — the observed record's
// `error: 'authentication_failed'` code is not decoded, so it is no marker here.
const AUTH_MARKERS: ReadonlyArray<string> = ['failed to authenticate']

// The fixed sentence a stop caused by an authentication failure carries, so the tooling that reads a
// stop back (`run-ship-stop-cause.ts`) tells it from a review finding by this text, not by guessing.
const AUTH_FAILURE_NOTE = 'the session could not authenticate — a person has to run /login'

function is_auth_failure(record: ClaudeResultEvent | undefined): boolean {
	if (record === undefined || !record.is_error || record.reason === undefined) return false

	const lower = record.reason.toLowerCase()

	return AUTH_MARKERS.some((marker) => lower.includes(marker))
}

// The same read over a whole stream-json transcript, such as a reviewer's log: its last exit record.
// The log is appended across launches, so it is read only when it ends on an exit record: a later
// session that died before writing its own leaves an earlier session's record behind it — not read.
function is_auth_failed_transcript(transcript: string | undefined): boolean {
	if (transcript === undefined || !agent_exit_record.ends_on_exit_record(transcript)) return false

	return is_auth_failure(agent_exit_record.read_exit_record(transcript))
}

const api_auth = { AUTH_FAILURE_NOTE, is_auth_failed_transcript, is_auth_failure }

export { api_auth }
