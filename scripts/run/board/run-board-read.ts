import type { NamedPlan } from '#scripts/backlog/backlog-plan'
import { backlogrun_launch } from '#scripts/backlog/backlogrun-launch'
import { lane_capacity } from '#scripts/lane/lane-capacity'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_carry_ended } from '#scripts/run/carry/run-carry-ended'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_stranded_detect } from '#scripts/run/run-stranded-detect'
import { run_wake } from '#scripts/run/wake/run-wake'
import {
	run_board_operation_read,
	type OperationSources,
	type SessionOperations,
} from './run-board-operation-read'
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
	// The run is carried but nothing drives it — its owner and its supervisor are both gone
	// (`run-stranded.ts`). Drawn as a stopped run, since no one is looking for its next issue.
	is_stranded: boolean
	// The newest operation of each session of the run, read off the end of its log.
	operations?: SessionOperations | undefined
	// How many more lanes the limit allows beside the live ones; `undefined` where the limit could not
	// be read, so nothing is said about it.
	free_lanes?: number | undefined
}

async function free_lanes_of(lanes: ReadonlyArray<LaneInfo>): Promise<number | undefined> {
	const choice = await lane_capacity.lane_limit()

	if (choice.kind !== 'limit') return undefined

	return lane_capacity.free_lanes(choice.limit, lane_registry.live_count(lanes))
}

const NO_SPAN: SpanHere = { span: undefined, resume: undefined, transcript: undefined }

interface SpanHere {
	span: BoardSpan | undefined
	resume: string | undefined
	// The parent session's transcript, where the run's record names one.
	transcript: string | undefined
}

function span_here(repository: string): SpanHere {
	const read = run_carry.read_carry(run_carry.carry_path(repository))
	const ended = run_carry_ended.read_ended(run_carry_ended.ended_path(repository))
	const launch = backlogrun_launch.pending_launch(repository)

	return {
		span: run_board_span.span_of(read, ended, launch),
		resume: run_board_span.resume_of(read, ended, launch),
		transcript: read.kind === 'carried' ? read.carry.owner_transcript : undefined,
	}
}

// Where each session of the run writes what it does: a lane's child to its dispatch log, in the lane's
// own checkout; the parent and a judgment session to theirs, in this one.
function sources_of(
	repository: string,
	lanes: ReadonlyArray<LaneInfo>,
	transcript: string | undefined,
): OperationSources {
	const root = process.cwd()

	return {
		lanes: lanes.map((lane) => ({ issue: lane.issue, log: lane.output, root: lane.directory })),
		owner: { log: transcript, root },
		judgment: { log: run_wake.wake_log_path(repository), root },
	}
}

// `undefined` when no run has started here.
async function read_local(): Promise<LocalRead | undefined> {
	const repository = await run_carry.repository_directory()
	const { span, resume, transcript } = repository === undefined ? NO_SPAN : span_here(repository)

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
		is_stranded: run_stranded_detect.is_stranded_at(repository),
		operations: run_board_operation_read.read(sources_of(repository, lanes, transcript)),
		free_lanes: await free_lanes_of(lanes),
	}
}

const run_board_read = { read_local }

export { run_board_read }
export type { LocalRead }
