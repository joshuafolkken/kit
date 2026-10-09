import { issue_cite } from '#scripts/issue/issue-cite'
import type { CarryRead } from '#scripts/run/carry/run-carry'
import { run_event_stream, type RunEvent } from './run-event-stream'

// The one place a stream consumer scopes the event stream to a single invocation. The stream is the
// repository's event log, not this run's — it outlives every invocation by design — so a consumer handed
// every event treats a previous invocation's merges, parks and cuts as its own. The carry record's
// `started_at` is the lower bound, filtered by each event's own time, published once so `run:report`, the
// retrospective digest and `run:step` share one time filter rather than each writing it again.
//
// **It never rounds an undetermined scope back to the whole stream.** A scope that cannot be determined — no
// carry record, an unreadable one, or a start time that is not a time — answers `undefined`, and each
// consumer falls to the "could not determine" side rather than showing every invocation's events.

const SINCE_SCOPE = 'since'
const UNKNOWN_SCOPE = 'unknown'

// Which invocation a stream read covers. `since` carries the start time the carry record holds — and because
// that field survives a `--cut` unchanged, the events either side of a cut fall inside one scope without a
// consumer needing to know that cuts exist.
type EventScope = { kind: typeof SINCE_SCOPE; started_at: string } | { kind: typeof UNKNOWN_SCOPE }

const UNKNOWN_EVENT_SCOPE: EventScope = { kind: UNKNOWN_SCOPE }

// A moment on the clock, or nothing when the text is not a time. Both the scope's start and an event's own
// `at` go through it, so neither a corrupt record nor a truncated append is read as a moment.
function moment_of(at: string): number | undefined {
	const parsed = Date.parse(at)

	return Number.isNaN(parsed) ? undefined : parsed
}

// Whether one event belongs to the invocation that began at `floor`. An event whose `at` cannot be read is
// **out**: a consumer must show no line from before the start, and a line with no readable time cannot be
// shown to satisfy that.
function is_within(event: RunEvent, floor: number): boolean {
	const at = moment_of(event.at)

	return at !== undefined && at >= floor
}

// This invocation's events, or `undefined` when the scope could not be determined. The two answers stay
// apart deliberately: an invocation that has done nothing yet is an empty list, an undetermined scope is
// `undefined`, and collapsing them is exactly what would round the unknown back to "render everything".
function scoped_events(
	events: ReadonlyArray<RunEvent>,
	scope: EventScope,
): ReadonlyArray<RunEvent> | undefined {
	if (scope.kind === UNKNOWN_SCOPE) return undefined

	const floor = moment_of(scope.started_at)

	if (floor === undefined) return undefined

	return events.filter((event) => is_within(event, floor))
}

// The scope the run's own carry record implies. A record that reads at all names the invocation's start, and
// **an expired one names it just as well**: expiry is the budget's verdict on a run, not a gap in the record,
// so rounding it to unknown would withhold the scope from exactly the long runs that most need one. Only an
// absent or unreadable record leaves the scope undetermined.
function scope_of(read: CarryRead): EventScope {
	if (read.kind === 'carried' || read.kind === 'expired') {
		return { kind: SINCE_SCOPE, started_at: read.carry.started_at }
	}

	return UNKNOWN_EVENT_SCOPE
}

// The newest event within scope, or `undefined` when the scope could not be determined or nothing falls
// inside it. The "last line" consumers read this rather than the raw newest event, so a stale event a
// previous invocation left on the stream is never read as this run's position.
function last_scoped_event(
	events: ReadonlyArray<RunEvent>,
	scope: EventScope,
): RunEvent | undefined {
	// Trace events (a `josh ship` stage line) are skipped, as `read_last` skips
	// them, so `run:step` reads the run's position rather than an unknown `ship-stage`.
	return scoped_events(events, scope)?.findLast(
		(event) => !run_event_stream.TRACE_KINDS.has(event.kind),
	)
}

// The positions a detached `josh ship` supervisor leaves. Each names its issue
// (`#<N> …`), so they are self-scoping where the carry scope is not: the stream is shared by every lane,
// and another lane's supervisor must never be read as this run's position.
const SHIP_POSITION_KINDS: ReadonlySet<string> = new Set([
	run_event_stream.EVENT_KIND.SHIP_LAUNCH,
	run_event_stream.EVENT_KIND.SHIP_STOP,
])

const KIND = run_event_stream.EVENT_KIND

// The parent's record of the batch around a child — its dispatch, park and split, the retrospective
// whose summary may name an issue it filed, and the strand whose text carries the whole invocation
// (`backlogrun #<N1> #<N2> …`). Each can name the child, yet none is a position the child itself is at,
// so a lane child never reads one as its own.
const BATCH_RECORD_KINDS: ReadonlySet<string> = new Set([
	KIND.CHILD_LAUNCH,
	KIND.PARK,
	KIND.SPLIT,
	KIND.RETROSPECTIVE,
	KIND.STRANDED,
])

const ISSUE_REFERENCE = /#(\d+)/u

function is_foreign_ship_event(event: RunEvent, issue: string): boolean {
	return (
		SHIP_POSITION_KINDS.has(event.kind) && !event.text.startsWith(`${issue_cite.plain(issue)} `)
	)
}

function is_own_ship_event(event: RunEvent, issue: string): boolean {
	return SHIP_POSITION_KINDS.has(event.kind) && !is_foreign_ship_event(event, issue)
}

// The issue an event's text names, the way every reader here — and `run:board` — keys an event to a child.
function issue_named(event: RunEvent): string | undefined {
	return ISSUE_REFERENCE.exec(event.text)?.[1]
}

// **A lane child's position is read only from events that name its own issue.** The parent and every
// lane append to one stream under one carry scope, so anything else on it is another run's: another
// lane's merge, the parent's stall (which names no issue) or another lane's cut would misdirect the
// child. The child's own merge and
// outage stay, so the parent-only stop in `run-step.ts` still holds; the parent keeps reading everything.
function names_issue(event: RunEvent, issue: string): boolean {
	return issue_named(event) === issue
}

function is_lane_position(event: RunEvent, issue: string): boolean {
	return !BATCH_RECORD_KINDS.has(event.kind) && names_issue(event, issue)
}

// A lane child's attempt begins at its own newest launch. A child re-dispatched after an outage — or
// relaunched after a cut, whose resume `run:cut --resume` answers at the entry — shares the scope with
// its previous attempt, and that attempt's outage would otherwise stop the new one at its entry `run:step`.
function since_own_launch(events: ReadonlyArray<RunEvent>, issue: string): ReadonlyArray<RunEvent> {
	const launch = events.findLastIndex(
		(event) => event.kind === KIND.CHILD_LAUNCH && names_issue(event, issue),
	)

	return events.slice(launch + 1)
}

function is_foreign_event(event: RunEvent, issue: string, is_lane_child: boolean): boolean {
	if (is_lane_child) return !is_lane_position(event, issue)

	return is_foreign_ship_event(event, issue)
}

// The newest position for one issue's run: the scoped last event with other issues' ship positions left
// out — and, for a lane child, every event not naming its issue — and, where no scope applies, as in
// an interactive `fullrun` with no carry record, the issue's own newest ship position, which its issue
// number already scopes. A determined scope with nothing in it yet reads nothing: an earlier invocation's
// stop for the same issue is not this invocation's position.
function last_issue_event(
	events: ReadonlyArray<RunEvent>,
	scope: EventScope,
	issue: string,
	is_lane_child: boolean,
): RunEvent | undefined {
	const attempt = is_lane_child ? since_own_launch(events, issue) : events
	const own = attempt.filter((event) => !is_foreign_event(event, issue, is_lane_child))

	if (scope.kind === SINCE_SCOPE) return last_scoped_event(own, scope)

	return own.findLast((event) => is_own_ship_event(event, issue))
}

// A child's launch and the endings `run:merge` settles it with — the ones `run:board` stops drawing it
// running on. A park or a split already ran `run:merge`, so a child closed after one owes nothing.
const LAUNCH_OR_SETTLE_KINDS: ReadonlySet<string> = new Set([
	KIND.CHILD_LAUNCH,
	KIND.MERGE,
	KIND.PARK,
	KIND.SPLIT,
])

// Whether this invocation's newest launch of the issue has not yet been settled.
// `run:merge` is the merge event's one writer, so a child that closed without it stays running on
// `run:board`; `run:step` reads this to point the parent at the merge. An undetermined scope owes nothing.
function is_merge_owed(events: ReadonlyArray<RunEvent>, scope: EventScope, issue: string): boolean {
	const newest = (scoped_events(events, scope) ?? []).findLast(
		(event) => LAUNCH_OR_SETTLE_KINDS.has(event.kind) && names_issue(event, issue),
	)

	return newest?.kind === KIND.CHILD_LAUNCH
}

const run_event_scope = {
	UNKNOWN_EVENT_SCOPE,
	is_merge_owed,
	issue_named,
	last_issue_event,
	last_scoped_event,
	moment_of,
	scope_of,
	scoped_events,
	since_own_launch,
}

export type { EventScope }
export { run_event_scope }
