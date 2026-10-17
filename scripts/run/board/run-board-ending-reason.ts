import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'

// Why a child's park or withdraw ended it, in the ending event's own words — the reason its board row
// draws and its park note carries.

const KIND = run_event_stream.EVENT_KIND
// `#<N> parked`, `#<N> parked (<reason>)` and `#<N> waiting on #<M>` lose their leading number, so a
// waiting park does not name its issue twice.
const PARK_PREFIX = /^#\d+ (?:parked\s*)?/u
const PARENTHESES = /^\((?<inner>.*)\)$/u
// `#<N> withdrawn by a person: <reason>` (`lane-withdraw.ts`).
const WITHDRAW_PREFIX = /^#\d+ withdrawn by a person:\s*/u

// `#<N> parked (needs-decision)` reads as the reason `needs-decision`; a bare park has none.
function park_reason(event: RunEvent): string {
	const rest = event.text.replace(PARK_PREFIX, '')

	return PARENTHESES.exec(rest)?.groups?.['inner'] ?? rest
}

// A withdraw's reason after its prefix; a text in any other shape carries none.
function withdraw_reason(event: RunEvent): string {
	const rest = event.text.replace(WITHDRAW_PREFIX, '')

	return rest === event.text ? '' : rest.trim()
}

// The reason an ending event gives, `undefined` for an event that is neither a park nor a withdraw or
// that gives none.
function reason_of(event: RunEvent): string | undefined {
	if (event.kind === KIND.PARK) return park_reason(event) || undefined

	return event.kind === KIND.WITHDRAW ? withdraw_reason(event) || undefined : undefined
}

const run_board_ending_reason = { park_reason, reason_of }

export { run_board_ending_reason }
