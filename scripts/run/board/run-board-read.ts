import type { NamedPlan } from '#scripts/backlog/backlog-plan'
import { lane_registry } from '#scripts/lane/lane-registry'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_carry_ended } from '#scripts/run/carry/run-carry-ended'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_board_scope } from './run-board-scope'
import { run_board_span, type BoardSpan } from './run-board-span'

// What `run:board` reads locally each tick: the run's span and scope, its events and its open lanes.
// The run is the running one, or the one that last ended until the next run begins.
interface LocalRead {
	started_ms: number
	// Set only once the run has ended; the board then draws its end-of-run screen.
	ended_ms: number | undefined
	// What the run was asked to do, from its invocation.
	scope: NamedPlan
	events: ReadonlyArray<RunEvent>
	lanes: ReadonlyArray<string>
	// The session a stopped run is resumed from; `undefined` otherwise.
	resume: string | undefined
}

interface SpanHere {
	span: BoardSpan | undefined
	resume: string | undefined
}

function span_here(repository: string): SpanHere {
	const read = run_carry.read_carry(run_carry.carry_path(repository))
	const ended = run_carry_ended.read_ended(run_carry_ended.ended_path(repository))

	return {
		span: run_board_span.span_of(read, ended),
		resume: run_board_span.resume_of(read, ended),
	}
}

// `undefined` when no run has started here.
async function read_local(): Promise<LocalRead | undefined> {
	const repository = await run_carry.repository_directory()
	const { span, resume } =
		repository === undefined ? { span: undefined, resume: undefined } : span_here(repository)

	if (repository === undefined || span === undefined) return undefined

	const events = run_event_stream.read_events(run_event_stream.target_of(repository))
	const lanes = await lane_registry.list_lanes()

	return {
		started_ms: span.started_ms,
		ended_ms: span.ended_ms,
		scope: run_board_scope.scope_of(span.invocation),
		events: run_board_span.events_of(events, span),
		lanes: lanes.map((lane) => lane.issue),
		resume,
	}
}

const run_board_read = { read_local }

export { run_board_read }
export type { LocalRead }
