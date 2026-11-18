import type { TableRead } from '#scripts/lane/lane-process-table'
import { launch_timing } from '#scripts/lane/launch-timing'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_merge_usage_limit } from '#scripts/run/merge/run-merge-usage-limit'
import { run_board_found } from './run-board-found'
import type { LocalRead } from './run-board-read'
import { run_board_single } from './run-board-single'
import { run_board_span, type BoardSpan } from './run-board-span'

// The run's span reads `read_local` takes beside each other (joshuafolkken/kit#7931): its roots and
// its own events, each timed for `run:board --timing`, and the span's own fields.

const { timing } = launch_timing

// The reset a usage limit holds the running run's launches until, read off the events `backlog:drive`
// reads it off (`run_event_stream_emit.current_events`): the carried invocation's, so an ended run's
// stop holds no row the driver would launch — and how many children it stopped.
function usage_reset_here(
	events: ReadonlyArray<RunEvent>,
	carry: RunCarry | undefined,
): Pick<LocalRead, 'usage_reset_ms' | 'usage_parked' | 'usage_cause'> {
	if (carry === undefined) return { usage_reset_ms: undefined }
	const scope = run_event_scope.scope_of({ kind: 'carried', carry })
	const scoped = run_event_scope.scoped_events(events, scope) ?? []
	const now_ms = Date.now()

	return {
		usage_reset_ms: run_merge_usage_limit.held_until(scoped, now_ms),
		usage_parked: run_merge_usage_limit.held_count(scoped, now_ms),
		usage_cause: run_merge_usage_limit.held_cause(scoped, now_ms),
	}
}

// The run's own events, what its done rows say after their time with each open investigation's
// session asked of `table`, and the usage limit its record's invocation is held by.
async function span_events_here(
	events: ReadonlyArray<RunEvent>,
	span: BoardSpan,
	table: TableRead | undefined,
	carry: RunCarry | undefined,
): Promise<
	Pick<LocalRead, 'events' | 'found' | 'usage_reset_ms' | 'usage_parked' | 'usage_cause'>
> {
	const spanned = run_board_single.events_of(span, run_board_span.events_of(events, span))
	// An overrun session outlives the run that launched it, so its notes and filings are read past the
	// run's end too (joshuafolkken/kit#4818); the next run starts a span of its own.
	const since = run_board_span.events_of(events, { ...span, ended_ms: undefined })

	return {
		events: spanned,
		found: run_board_found.found_of(since, await run_board_found.live_in(table)),
		...usage_reset_here(events, carry),
	}
}

type RootFields = Pick<LocalRead, 'root' | 'ended_roots'>
type SpanFields = Pick<
	LocalRead,
	'started_ms' | 'ended_ms' | 'scheduler_provider' | 'run_name' | 'stopped_single'
>

// The span's own fields, with the root checkout's single runs beside it.
function span_fields(span: BoardSpan, root: RootFields): SpanFields & RootFields {
	const run_name = run_board_single.name_of(span.invocation)
	const stopped_single = run_board_single.stopped_of(span)
	const times = {
		...root,
		started_ms: span.started_ms,
		ended_ms: span.ended_ms,
		...(run_name !== undefined && { run_name }),
		...(stopped_single !== undefined && { stopped_single }),
	}

	if (span.scheduler_provider === undefined) return times

	return { ...times, scheduler_provider: span.scheduler_provider === 'openai' ? 'codex' : 'claude' }
}

// The root checkout's single run beside the span, and its runs a merge ended inside it.
async function roots_here(
	span: BoardSpan,
	root: BoardSpan | undefined,
	events: ReadonlyArray<RunEvent>,
): Promise<RootFields> {
	const ended_roots = await run_board_single.ended_here(span)

	return root === undefined
		? { ended_roots }
		: { root: run_board_single.root_of(root, events), ended_roots }
}

const run_board_read_local = {
	read_roots: timing('local: roots', roots_here),
	read_span_events: timing('local: events', span_events_here),
	span_fields,
}

export { run_board_read_local }
export type { RootFields, SpanFields }
