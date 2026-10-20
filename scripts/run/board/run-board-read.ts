import { backlog_drive_memory } from '#scripts/backlog/backlog-drive-memory'
import type { NamedPlan } from '#scripts/backlog/backlog-plan'
import { backlog_ready } from '#scripts/backlog/backlog-ready'
import { backlogrun_launch } from '#scripts/backlog/backlogrun-launch'
import { lane_held_stats } from '#scripts/lane/lane-held-stats'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import type { TableRead } from '#scripts/lane/lane-process-table'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_carry_ended } from '#scripts/run/carry/run-carry-ended'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_stranded_detect } from '#scripts/run/run-stranded-detect'
import { run_wake } from '#scripts/run/wake/run-wake'
import {
	run_board_operation_read,
	type OperationSources,
	type SessionOperations,
} from './run-board-operation-read'
import type { ProcessRoots } from './run-board-process-groups'
import { run_board_roots } from './run-board-roots'
import { run_board_scope } from './run-board-scope'
import { run_board_span, type BoardSpan } from './run-board-span'
import { run_board_status, type ItemStatus } from './run-board-status'
import { run_board_usual, type UsualTimes } from './run-board-usual'

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
	// The open lanes no child is working in at this read (`lane-spent.ts`); one is drawn stopped once it
	// has stayed so (`run-board-idle.ts`).
	idle_lanes?: ReadonlyArray<string> | undefined
	// The open lanes that last took a child before the run started — an earlier run's, until this run
	// dispatches into one again.
	earlier_lanes?: ReadonlyArray<string> | undefined
	// The earlier run's lanes that still hold a place under the limit — counted in `occupied_count`, so
	// the lanes section draws them beside this run's own.
	earlier_occupied?: ReadonlyArray<string> | undefined
	// What each earlier run's lane is doing, folded from the whole stream since its newest launch
	// (`run_board_status.earlier_of`) — the span's events alone hold none of its launch.
	earlier_statuses?: ReadonlyMap<number, ItemStatus> | undefined
	// How many more lanes the limit allows beside the live ones, as `lane:limit` counts them;
	// `undefined` where the limit could not be read, so nothing is said about it.
	free_lanes?: number | undefined
	// The lane limit those free lanes are counted under; `undefined` where it could not be read.
	lane_limit?: number | undefined
	// How many lanes hold a place under the limit (`backlog-occupied.ts`), counted beside a row that
	// waits for a free lane.
	occupied_count?: number | undefined
	// How long each phase usually takes, from the repository's lane ledger.
	usual?: UsualTimes | undefined
	// The driver holds its offered issue until the machine has memory for one more lane — the ledger's
	// open hold is `backlog-drive-memory.ts`'s.
	is_memory_held?: boolean | undefined
	// The run's supervisor and parent session, named in the 💻 section (`run-board-roots.ts`).
	roots?: ProcessRoots | undefined
	// The run's record, whose declared order holds a queued row (`backlog-drive-named.ts`).
	carry?: RunCarry | undefined
}

const NO_SPAN: SpanHere = {
	span: undefined,
	resume: undefined,
	transcript: undefined,
	roots: {},
	carry: undefined,
}

interface SpanHere {
	span: BoardSpan | undefined
	resume: string | undefined
	// The parent session's transcript, where the run's record names one.
	transcript: string | undefined
	roots: ProcessRoots
	carry: RunCarry | undefined
}

function span_here(repository: string): SpanHere {
	const read = run_carry.read_carry(run_carry.carry_path(repository))
	const ended = run_carry_ended.read_ended(run_carry_ended.ended_path(repository))
	const launch = backlogrun_launch.pending_launch(repository)

	return {
		span: run_board_span.span_of(read, ended, launch),
		resume: run_board_span.resume_of(read, ended, launch),
		transcript: read.kind === 'carried' ? read.carry.owner_transcript : undefined,
		roots: run_board_roots.roots_of(repository, read),
		carry: read.kind === 'carried' ? read.carry : undefined,
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

// joshuafolkken/kit#3969: a lane whose last dispatch is unknown is not called earlier.
function earlier_lanes(lanes: ReadonlyArray<LaneInfo>, started_ms: number): Array<string> {
	return lanes
		.filter((lane) => lane.dispatched_ms !== undefined && lane.dispatched_ms < started_ms)
		.map((lane) => lane.issue)
}

type LaneRoomRead = Pick<
	LocalRead,
	'free_lanes' | 'lane_limit' | 'occupied_count' | 'earlier_occupied' | 'idle_lanes'
>

// The lanes against the limit, read once so the free count, the lanes it counts, the earlier run's
// among them and the idle ones agree.
async function lane_room_of(
	lanes: ReadonlyArray<LaneInfo>,
	earlier: ReadonlyArray<string>,
	table: TableRead | undefined,
): Promise<LaneRoomRead> {
	const room = await backlog_ready.lane_room(lanes, table)
	const count = await backlog_ready.count_in(room)
	const occupied = room.occupied.map((lane) => lane.issue)

	return {
		free_lanes: count?.free,
		lane_limit: count?.limit,
		occupied_count: occupied.length,
		earlier_occupied: occupied.filter((issue) => earlier.includes(issue)),
		idle_lanes: room.idle,
	}
}

// The repository's lane ledger, read once for the usual times and the driver's open hold.
function ledger_here(repository: string): Pick<LocalRead, 'usual' | 'is_memory_held'> {
	const entries = lane_ledger.read_entries(lane_ledger.target_of(repository))

	return {
		usual: run_board_usual.usual_of(entries),
		is_memory_held:
			lane_held_stats.open_reason(entries, Date.now()) === backlog_drive_memory.HOLD_REASON,
	}
}

// `undefined` when no run has started here. The lane count reads `table`, the redraw's process
// snapshot, so it agrees with the usage columns' paused lanes.
async function read_local(table?: TableRead): Promise<LocalRead | undefined> {
	const repository = await run_carry.repository_directory()
	const { span, resume, transcript, roots, carry } =
		repository === undefined ? NO_SPAN : span_here(repository)

	if (repository === undefined || span === undefined) return undefined

	const events = run_event_stream.read_events(run_event_stream.target_of(repository))
	const lanes = await lane_registry.list_lanes()
	const earlier = earlier_lanes(lanes, span.started_ms)

	return {
		started_ms: span.started_ms,
		ended_ms: span.ended_ms,
		scope: run_board_scope.scope_of(span.invocation),
		events: run_board_span.events_of(events, span),
		lanes: lanes.map((lane) => lane.issue),
		resume,
		roots,
		carry,
		is_stranded: run_stranded_detect.is_stranded_at(repository),
		operations: run_board_operation_read.read(sources_of(repository, lanes, transcript)),
		earlier_lanes: earlier,
		earlier_statuses: run_board_status.earlier_of(events, earlier),
		...(await lane_room_of(lanes, earlier, table)),
		...ledger_here(repository),
	}
}

const run_board_read = { read_local }

export { run_board_read }
export type { LocalRead }
