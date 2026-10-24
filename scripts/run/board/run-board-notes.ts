import { issue_cite } from '#scripts/issue/issue-cite'
import { run_event_filed, type FiledKind } from '#scripts/run/event/run-event-filed'
import { run_event_overrun } from '#scripts/run/event/run-event-overrun'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_board_ending_reason } from './run-board-ending-reason'
import { run_board_layout } from './run-board-layout'

// The board's findings section: what a run filed, what it parked and the
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
	// A filed Issue's classification, which its line leads with.
	filed_kind?: FiledKind | undefined
}

const KIND = run_event_stream.EVENT_KIND

// Only the run's own filings (joshuafolkken/kit#4099): a session outside the run writes to the same
// stream, and what it filed is drawn as any other plan row.
function filed_note(event: RunEvent): BoardNote | undefined {
	const filed = run_event_filed.parse(event.text)

	if (filed?.is_run !== true) return undefined

	return {
		kind: 'filed',
		at_ms: Date.parse(event.at),
		issue: filed.reference.replace(/^#/u, ''),
		text: filed.title,
		found_during: filed.found_during,
		filed_kind: filed.kind,
	}
}

// The board's titles by issue number: the plan's listing with its closed children's.
type Titles = ReadonlyMap<number, string>

// The parked issue's title with its reason after it; before the plan is read there is no title, and
// the reason alone is drawn.
function park_text(title: string | undefined, reason: string): string {
	if (title === undefined) return reason

	return reason === '' ? title : `${title} (${reason})`
}

// A park waiting on a person's decision is no finding (joshuafolkken/kit#4099): while the child stays
// parked its row is in the 🙋 decision section, and once it resumes the decision is made.
function park_note(event: RunEvent, titles: Titles): BoardNote | undefined {
	const reason = run_board_ending_reason.park_reason(event)

	if (run_board_layout.is_decision(reason)) return undefined

	const issue = run_event_scope.issue_named(event)
	const title = issue === undefined ? undefined : titles.get(Number(issue))

	return { kind: 'park', at_ms: Date.parse(event.at), issue, text: park_text(title, reason) }
}

// The line already leads with the number a note names, so a text that opens with it does not say it
// again (joshuafolkken/kit#4097).
function note_body(text: string, issue: string | undefined): string {
	if (issue === undefined) return text

	const lead = `${issue_cite.plain(issue)} `

	return text.startsWith(lead) ? text.slice(lead.length) : text
}

function plain_note(event: RunEvent): BoardNote {
	const issue = run_event_scope.issue_named(event)
	const text = note_body(event.text, issue)

	return { kind: 'note', at_ms: Date.parse(event.at), issue, text }
}

// An overrun note is no finding (joshuafolkken/kit#4818): the merged row says it after its time.
function is_finding(event: RunEvent): boolean {
	return event.kind === KIND.NOTE && run_event_overrun.parse(event.text) === undefined
}

function note_of(event: RunEvent, titles: Titles): BoardNote | undefined {
	if (event.kind === KIND.FILED) return filed_note(event)
	if (event.kind === KIND.PARK) return park_note(event, titles)

	return is_finding(event) ? plain_note(event) : undefined
}

// A park is said only of a child the board still holds parked, so one a person released or closed
// is not (joshuafolkken/kit#4127).
function is_listed(note: BoardNote, listed: ReadonlySet<number> | undefined): boolean {
	return listed === undefined || note.kind !== 'park' || listed.has(Number(note.issue))
}

// Newest first: the line a person glancing at the board needs is the latest one. `listed` holds the
// parked children whose park the section says (`run_board_layout.listed_parks`); without it, every
// park is said.
function notes_of(
	events: ReadonlyArray<RunEvent>,
	titles: Titles,
	listed?: ReadonlySet<number>,
): ReadonlyArray<BoardNote> {
	return events
		.flatMap((event) => note_of(event, titles) ?? [])
		.filter((note) => is_listed(note, listed))
		.toReversed()
}

// The issues the run filed in this repository — the rows that lead their title with ✚.
function filed_numbers(notes: ReadonlyArray<BoardNote>): ReadonlySet<number> {
	const filed = notes.filter((note) => note.kind === 'filed').map((note) => Number(note.issue))

	return new Set(filed.filter((number) => Number.isSafeInteger(number)))
}

const run_board_notes = { filed_numbers, notes_of }

export { run_board_notes }
export type { BoardNote, Titles }
