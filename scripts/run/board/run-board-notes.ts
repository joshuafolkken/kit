import { NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { run_event_filed, type FiledKind } from '#scripts/run/event/run-event-filed'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'

// The board's findings section (joshuafolkken/kit#3430): what a run filed, what it parked and the
// one-line observations it left, read off the event stream alone. A run started from the command line
// says these in no chat a person reads, so the board is where they surface. Nothing is inferred from a
// conversation log — an event that is not on the stream is not on the board.

type NoteKind = 'filed' | 'park' | 'note'

interface BoardNote {
	kind: NoteKind
	at_ms: number
	// The issue the line is about: the filed Issue, the parked child, or the one a note names.
	issue: string | undefined
	text: string
	// Whose work turned up a filed Issue: the lane child, else the Issue the branch names.
	found_during?: string | undefined
	// A filed Issue's classification, which its line leads with (joshuafolkken/kit#3494).
	filed_kind?: FiledKind | undefined
	// A park waiting on a person's decision, drawn apart from an ordinary park.
	is_decision: boolean
}

const KIND = run_event_stream.EVENT_KIND
const PARKED_PREFIX = /^#\d+ parked\s*/u
const PARENTHESES = /^\((?<inner>.*)\)$/u

function filed_note(event: RunEvent): BoardNote | undefined {
	const filed = run_event_filed.parse(event.text)

	if (filed === undefined) return undefined

	return {
		kind: 'filed',
		at_ms: Date.parse(event.at),
		issue: filed.reference.replace(/^#/u, ''),
		text: filed.title,
		found_during: filed.found_during,
		filed_kind: filed.kind,
		is_decision: false,
	}
}

// `#<N> parked (needs-decision)` reads as the reason `needs-decision`; a bare park has none.
function park_note(event: RunEvent): BoardNote {
	const rest = event.text.replace(PARKED_PREFIX, '')
	const reason = PARENTHESES.exec(rest)?.groups?.['inner'] ?? rest
	const issue = run_event_scope.issue_named(event)
	const is_decision = reason.includes(NEEDS_DECISION_LABEL)

	return { kind: 'park', at_ms: Date.parse(event.at), issue, text: reason, is_decision }
}

function plain_note(event: RunEvent): BoardNote {
	const issue = run_event_scope.issue_named(event)

	return { kind: 'note', at_ms: Date.parse(event.at), issue, text: event.text, is_decision: false }
}

function note_of(event: RunEvent): BoardNote | undefined {
	if (event.kind === KIND.FILED) return filed_note(event)
	if (event.kind === KIND.PARK) return park_note(event)

	return event.kind === KIND.NOTE ? plain_note(event) : undefined
}

// Newest first: the line a person glancing at the board needs is the latest one.
function notes_of(events: ReadonlyArray<RunEvent>): ReadonlyArray<BoardNote> {
	return events.flatMap((event) => note_of(event) ?? []).toReversed()
}

const run_board_notes = { notes_of }

export { run_board_notes }
export type { BoardNote }
