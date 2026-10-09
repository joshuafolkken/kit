import type { CarryRead } from '#scripts/run/carry/run-carry'
import type { EndedRun } from '#scripts/run/carry/run-carry-ended'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import type { RunEvent } from '#scripts/run/event/run-event-stream'

// Which run `run:board` draws: the running one while its carry record is here,
// else the one `run:carry --end` last ended, kept on screen until the next run begins. Both ends of the
// span come from a record — the carry's start, the ended run's start and end — never from the screen.

// One run to draw. `ended_ms` is set only for a run that has ended.
interface BoardSpan {
	invocation: string
	started_ms: number
	ended_ms: number | undefined
}

const { moment_of } = run_event_scope

function ended_span(ended: EndedRun | undefined): BoardSpan | undefined {
	if (ended === undefined) return undefined

	const started_ms = moment_of(ended.started_at)
	const ended_ms = moment_of(ended.ended_at)

	if (started_ms === undefined || ended_ms === undefined) return undefined

	return { invocation: ended.invocation, started_ms, ended_ms }
}

// The running run wins over the ended one, so a run that begins replaces the finished board at once.
// An expired carry is still the running run's budget spent, not a run that ended, so it draws nothing.
function span_of(read: CarryRead, ended: EndedRun | undefined): BoardSpan | undefined {
	if (read.kind !== 'carried') return read.kind === 'none' ? ended_span(ended) : undefined

	const started_ms = moment_of(read.carry.started_at)

	if (started_ms === undefined) return undefined

	return { invocation: read.carry.invocation, started_ms, ended_ms: undefined }
}

// The session a person resumes a stopped run from: only while the ended run is
// the one drawn, and only when it stopped rather than finished. A run that begins hides it at once.
function resume_of(read: CarryRead, ended: EndedRun | undefined): string | undefined {
	if (read.kind !== 'none' || ended?.stopped === undefined) return undefined

	return ended.session
}

function is_within(event: RunEvent, span: BoardSpan): boolean {
	const at = moment_of(event.at)

	if (at === undefined || at < span.started_ms) return false

	return span.ended_ms === undefined || at <= span.ended_ms
}

// The events inside the span: a later run's events never land on an ended run's board.
function events_of(events: ReadonlyArray<RunEvent>, span: BoardSpan): ReadonlyArray<RunEvent> {
	return events.filter((event) => is_within(event, span))
}

const run_board_span = { events_of, resume_of, span_of }

export { run_board_span }
export type { BoardSpan }
