import type { AgentProvider } from '#scripts/agent/agent-provider'
import type { PendingLaunch } from '#scripts/backlog/backlogrun-launch'
import type { CarryRead } from '#scripts/run/carry/run-carry'
import type { EndedRun } from '#scripts/run/carry/run-carry-ended'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import type { RunEvent } from '#scripts/run/event/run-event-stream'

// Which run `run:board` draws: the running one while its carry record is here,
// else the one `run:carry --end` last ended, kept on screen until the next run begins. Both ends of the
// span come from a record — the carry's start, the ended run's start and end — never from the screen.

// One run to draw. `ended_ms` is set only for a run that has ended.
interface BoardSpan {
	scheduler_provider?: AgentProvider | undefined
	invocation: string
	started_ms: number
	ended_ms: number | undefined
}

const { moment_of } = run_event_scope

function provider_of(
	record: Pick<BoardSpan, 'scheduler_provider'>,
): Pick<BoardSpan, 'scheduler_provider'> {
	return record.scheduler_provider === undefined
		? {}
		: { scheduler_provider: record.scheduler_provider }
}

function ended_span(ended: EndedRun | undefined): BoardSpan | undefined {
	if (ended === undefined) return undefined

	const started_ms = moment_of(ended.started_at)
	const ended_ms = moment_of(ended.ended_at)

	if (started_ms === undefined || ended_ms === undefined) return undefined

	return { invocation: ended.invocation, started_ms, ended_ms, ...provider_of(ended) }
}

// A run `josh backlogrun` launched and its parent has not claimed yet: it has no carry record, so the
// launch record is the only one that says a run is here and since when.
function launch_span(launch: PendingLaunch | undefined): BoardSpan | undefined {
	const started_ms = launch === undefined ? undefined : moment_of(launch.started_at)

	if (launch === undefined || started_ms === undefined) return undefined

	return { invocation: launch.invocation, started_ms, ended_ms: undefined, ...provider_of(launch) }
}

// With no carry record: the run on its way, else the one that last ended. **A launch older than that
// end is the ended run's own** — its parent outlives `run:carry --end` for a moment — so it never
// redraws a finished run as one starting.
function idle_span(
	ended: EndedRun | undefined,
	launch: PendingLaunch | undefined,
): BoardSpan | undefined {
	const last = ended_span(ended)
	const coming = launch_span(launch)

	if (coming === undefined) return last

	return (last?.ended_ms ?? 0) >= coming.started_ms ? last : coming
}

// The running run wins over the ended one, so a run that begins replaces the finished board at once.
// **The launch's start is the carry's**: `run:carry --begin` inherits it for the parent the launch
// started, so the clock does not restart when the record appears.
function span_of(
	read: CarryRead,
	ended: EndedRun | undefined,
	launch?: PendingLaunch,
): BoardSpan | undefined {
	if (read.kind !== 'carried') return read.kind === 'none' ? idle_span(ended, launch) : undefined

	const started_ms = moment_of(read.carry.started_at)

	if (started_ms === undefined) return undefined

	return {
		invocation: read.carry.invocation,
		started_ms,
		ended_ms: undefined,
		...provider_of(read.carry),
	}
}

// Whether the span drawn with no carry record is the ended run's, rather than a launch's.
function is_ended_drawn(ended: EndedRun | undefined, launch: PendingLaunch | undefined): boolean {
	return idle_span(ended, launch)?.ended_ms !== undefined
}

// The session a person resumes a stopped run from: only while the ended run is
// the one drawn, and only when it stopped rather than finished. A run that begins — or is on its way —
// hides it at once.
function resume_of(
	read: CarryRead,
	ended: EndedRun | undefined,
	launch?: PendingLaunch,
): string | undefined {
	if (read.kind !== 'none' || !is_ended_drawn(ended, launch)) return undefined

	return ended?.stopped === undefined ? undefined : ended.session
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
