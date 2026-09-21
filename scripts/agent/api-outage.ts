import type { ClaudeResultEvent } from './claude-result-event'

// Whether a dispatched lane child's exit record is an API-connection outage rather than a child that
// stopped mid-implementation on its own (joshuafolkken/kit#2240). Measured twice: on 2026-09-15 four
// children ended `The socket connection was closed unexpectedly`, and on 2026-09-21 a child spent all
// ten connection retries on `Unable to connect to API (ConnectionRefused)`. The parent read both as
// ordinary failures — `in-progress` stripped, `needs-decision` applied, counted against the
// consecutive-failure guard — when the child never reached the API at all.
//
// **The read is mechanical, never a similarity judgement.** A terminal `result` event that ends in
// error carries the harness's own error text in `reason`; an outage is that text containing one of a
// fixed set of transport-failure signatures. `is_error` is required — a child that finished a turn
// cleanly is not an outage however its prose reads — so the test is the error flag AND a known marker,
// not the marker alone.

// The transport-failure signatures a `reason` is matched against, lower-cased. Each is a stable
// substring the Anthropic client or the socket layer emits when the API could not be reached — the two
// observed on the issue plus the Node-level spellings the same failures surface as. Retry exhaustion
// needs no marker of its own: the client re-raises the underlying connection error after the last
// attempt, so the exhausted case ends in one of these exactly as a single attempt does.
const OUTAGE_MARKERS: ReadonlyArray<string> = [
	'unable to connect to api',
	'connectionrefused',
	'econnrefused',
	'connection refused',
	'the socket connection was closed',
	'socket hang up',
]

function matched_marker(reason: string): string | undefined {
	const lower = reason.toLowerCase()

	return OUTAGE_MARKERS.find((marker) => lower.includes(marker))
}

// The marker an exit record matched, or `undefined` when it is not an outage. A record that did not
// end in error, or carries no reason text, is never an outage — the marker is read only off an errored
// record's `reason`.
function outage_marker(record: ClaudeResultEvent | undefined): string | undefined {
	if (record === undefined || !record.is_error || record.reason === undefined) return undefined

	return matched_marker(record.reason)
}

function is_outage(record: ClaudeResultEvent | undefined): boolean {
	return outage_marker(record) !== undefined
}

const api_outage = { is_outage, outage_marker }

export { api_outage, OUTAGE_MARKERS }
