import { lane_state, type LaneStateRecord } from '#scripts/lane/lane-state'
import { error_text } from '#scripts/lib/error-message'
import { run_board_lane_time } from '#scripts/run/board/run-board-lane-time'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_event_scope } from './run-event-scope'
import { run_event_stream, type AppendResult, type RunEvent } from './run-event-stream'

// The write side of the run's event stream. It resolves the run's identity and
// appends, and it is where the "reporting must not break the work it reports on" contract is kept: every
// failure — a git call that hangs, a temp directory that cannot be written — is swallowed, so a lane
// child's own work never fails because an append did.
//
// **The key is `run-carry.ts`'s, not `run-progress-clock.ts`'s.** The report clock keys on the work
// tree's own git directory because two lanes are two clocks; this stream is the opposite — the parent
// session, a cut successor and every lane child are one run and append to one stream — so it keys on the
// common git directory the carry record uses, which every lane of one repository shares.

function now_iso(): string {
	return new Date().toISOString()
}

/**
 * The stream's path for the run this checkout belongs to, or `undefined` when there is no git
 * repository to key on — outside one there is no run identity, and no stream.
 */
async function stream_target(): Promise<string | undefined> {
	const repository = await run_carry.repository_directory()

	return repository === undefined ? undefined : run_event_stream.target_of(repository)
}

// The child's lane record; an unreadable one reads as none, so the ending is still written.
async function lane_record(issue: string): Promise<LaneStateRecord | undefined> {
	try {
		return await lane_state.read_state(issue)
	} catch (error) {
		error_text.trace_swallowed('run_event_stream_emit.lane_record', error)

		return undefined
	}
}

async function ending_fields(
	target: string,
	event: Omit<RunEvent, 'pos'>,
): Promise<Pick<RunEvent, 'elapsed_ms'>> {
	const issue = run_event_scope.issue_named(event)

	if (issue === undefined || !run_board_lane_time.OFF_LANE_KINDS.has(event.kind)) return {}

	const elapsed_ms = run_board_lane_time.ending_elapsed({
		events: run_event_stream.read_events(target),
		issue: Number(issue),
		record: await lane_record(issue),
		ended_ms: Date.parse(event.at),
	})

	return elapsed_ms === undefined ? {} : { elapsed_ms }
}

/**
 * Append one event at `at`, an ending with its child's lane time (joshuafolkken/kit#4481). Every writer
 * of an ending — `emit` and `run:event --append` — appends through here, so the time is computed once,
 * as the ending is written, with the board's own count.
 */
async function append_at(
	target: string,
	kind: string,
	text: string,
	at: Date,
): Promise<AppendResult> {
	const event = { kind, text, at: at.toISOString() }

	return run_event_stream.append_event(target, {
		...event,
		...(await ending_fields(target, event)),
	})
}

/**
 * Append one session-facing event, best-effort. A kind outside the enumeration is refused by `append`;
 * every error is swallowed, because the reporting path must never fail the work it reports on.
 * `at` is the caller's instant where another record must carry the same one.
 */
async function emit(kind: string, text: string, at: Date = new Date()): Promise<void> {
	try {
		const target = await stream_target()

		if (target === undefined) return

		await append_at(target, kind, text, at)
	} catch {
		// Reporting is best-effort: a failed append is dropped rather than raised into the caller's work.
	}
}

/**
 * Append one event unless the newest event on the stream already carries this kind — so a marker a loop
 * re-checks every poll is written once per episode rather than once per poll.
 * The drain marker is the caller: `backlog:offer` runs every iteration of a watching loop, and one drain
 * event per drain is what `run:step` reads to fire the retrospective a single time. Best-effort like
 * `emit`: a failed resolve or read is swallowed rather than raised into the loop's work.
 *
 * **Returns whether it appended**, so a caller that pairs the marker with its own once-per-episode side
 * effect — the stall detector sends one notification per stall — fires that
 * effect exactly when the marker was fresh. A skipped duplicate and a swallowed failure both read
 * `false`: neither is a fresh episode.
 */
async function emit_once(kind: string, text: string): Promise<boolean> {
	try {
		const target = await stream_target()

		if (target === undefined || run_event_stream.read_last(target)?.kind === kind) return false

		return run_event_stream.append(target, kind, text, now_iso()).appended
	} catch (error) {
		// Best-effort: a failed append is dropped rather than raised into the loop's work.
		error_text.trace_swallowed('run_event_stream_emit.emit_once', error)

		return false
	}
}

// The events of the invocation now running: the stream outlives every invocation, so a marker a previous
// run left — a stall that ended with no dispatch after it — must not hold back this run's first one. An
// undetermined scope (no carry record) keeps the whole stream, the side that under-notifies rather than
// re-sends.
function invocation_events(repository: string, target: string): ReadonlyArray<RunEvent> {
	const events = run_event_stream.read_events(target)
	const scope = run_event_scope.scope_of(run_carry.read_carry(run_carry.carry_path(repository)))

	return run_event_scope.scoped_events(events, scope) ?? events
}

/**
 * Append one event unless this kind is already on the stream since the newest `reset_kind` — the
 * episode marker for a condition that holds across other events. `emit_once`'s newest-event test would
 * re-fire each time a parallel lane appended a merge or a park; this ends the episode only at
 * `reset_kind`. The text is composed only once the episode is new, so a caller polled every pass whose
 * text costs a network read pays it once. Returns the appended text, or `undefined` when nothing was.
 */
async function emit_once_since_with(
	kind: string,
	reset_kind: string,
	compose: () => Promise<string>,
): Promise<string | undefined> {
	try {
		const repository = await run_carry.repository_directory()

		if (repository === undefined) return undefined

		const target = run_event_stream.target_of(repository)

		if (run_event_stream.has_since(invocation_events(repository, target), kind, reset_kind)) {
			return undefined
		}

		const text = await compose()

		return run_event_stream.append(target, kind, text, now_iso()).appended ? text : undefined
	} catch (error) {
		// Best-effort: a failed append is dropped rather than raised into the caller's work.
		error_text.trace_swallowed('run_event_stream_emit.emit_once_since', error)

		return undefined
	}
}

// `emit_once_since_with` for a text already in hand. Returns whether it appended, as `emit_once` does.
async function emit_once_since(kind: string, text: string, reset_kind: string): Promise<boolean> {
	const appended = await emit_once_since_with(kind, reset_kind, async () => text)

	return appended !== undefined
}

// One progress heartbeat line onto the stream, so a relay reaches it across a cut.
async function emit_heartbeat(line: string): Promise<void> {
	await emit(run_event_stream.EVENT_KIND.HEARTBEAT, line)
}

// The events of the invocation now running, for a reader restoring the run from its stream
// (`backlog:drive`). Fail-quiet like the writers: no repository, an unreadable stream or an
// undetermined scope is an empty invocation.
async function current_events(): Promise<ReadonlyArray<RunEvent>> {
	try {
		const repository = await run_carry.repository_directory()

		if (repository === undefined) return []

		const read = run_carry.read_carry(run_carry.carry_path(repository))
		const scope = run_event_scope.scope_of(read)
		const events = run_event_stream.read_events(run_event_stream.target_of(repository))

		return run_event_scope.scoped_events(events, scope) ?? []
	} catch {
		return []
	}
}

// The invocation's events for a writer deciding whether a marker is already there: unlike
// `current_events`, an undetermined scope keeps the whole stream, so a run with no carry record skips a
// marker it already wrote rather than writing it twice.
async function invocation_or_all_events(): Promise<ReadonlyArray<RunEvent>> {
	try {
		const repository = await run_carry.repository_directory()

		return repository === undefined
			? []
			: invocation_events(repository, run_event_stream.target_of(repository))
	} catch {
		return []
	}
}

// Every event on the stream, across invocations, for a reader that scopes by the event's own text
// rather than by the carry record (`issue:file`'s fold). Fail-quiet like `current_events`.
async function all_events(): Promise<ReadonlyArray<RunEvent>> {
	try {
		const target = await stream_target()

		return target === undefined ? [] : run_event_stream.read_events(target)
	} catch {
		return []
	}
}

const run_event_stream_emit = {
	all_events,
	append_at,
	current_events,
	emit,
	emit_heartbeat,
	emit_once,
	emit_once_since,
	emit_once_since_with,
	invocation_or_all_events,
	stream_target,
}

export { run_event_stream_emit }
