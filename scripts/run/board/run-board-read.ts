import { backlog_drive_memory } from '#scripts/backlog/backlog-drive-memory'
import type { NamedPlan } from '#scripts/backlog/backlog-plan'
import { backlog_ready } from '#scripts/backlog/backlog-ready'
import { backlogrun_launch } from '#scripts/backlog/backlogrun-launch'
import { lane_held_stats } from '#scripts/lane/lane-held-stats'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import type { TableRead } from '#scripts/lane/lane-process-table'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_state } from '#scripts/lane/lane-state'
import { stamped_memo } from '#scripts/lib/stamped-memo'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_carry_ended } from '#scripts/run/carry/run-carry-ended'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_stranded_detect } from '#scripts/run/run-stranded-detect'
import { run_wake } from '#scripts/run/wake/run-wake'
import { run_board_found, type FoundOf } from './run-board-found'
import { run_board_lane_state, type BoardLanes } from './run-board-lane-state'
import {
	run_board_operation_read,
	type OperationSources,
	type SessionOperations,
} from './run-board-operation-read'
import type { ProcessRoots } from './run-board-process-groups'
import { run_board_roots } from './run-board-roots'
import { run_board_scope } from './run-board-scope'
import { run_board_span, type BoardSpan } from './run-board-span'
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
	// The open lanes as their lane state records sort them — this run's, an earlier run's and the ones
	// with no record — with what each is doing (`run-board-lane-state.ts`).
	lane_states: BoardLanes
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
	// The earlier run's lanes that still hold a place under the limit — counted in `occupied_count`, so
	// the lanes section draws them beside this run's own.
	earlier_occupied?: ReadonlyArray<string> | undefined
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
	// The processes a lane's close could not end, by pid, each with why (`lane-reap-settle.ts`).
	stuck?: ReadonlyMap<number, string> | undefined
	// The issues whose lane record is not ended — a close the supervisor still retries.
	closing?: ReadonlySet<string> | undefined
	// The run's record, whose declared order holds a queued row (`backlog-drive-named.ts`).
	carry?: RunCarry | undefined
	// What each done row says after its time, its sessions probed once a read against `table`
	// (`run-board-found.ts`), never per redraw.
	found?: FoundOf | undefined
}

const NO_SPAN: SpanHere = {
	span: undefined,
	resume: undefined,
	transcript: undefined,
	roots: {},
	carry: undefined,
	is_stranded: false,
}

interface SpanHere {
	span: BoardSpan | undefined
	resume: string | undefined
	// The parent session's transcript, where the run's record names one.
	transcript: string | undefined
	roots: ProcessRoots
	carry: RunCarry | undefined
	is_stranded: boolean
}

// The main work tree, resolved once: it does not move while the board is open, and resolving it runs a
// `git` subprocess the redraw would wait on (joshuafolkken/kit#4263). A failed resolve is forgotten,
// so a `git` that timed out once is asked again on the next redraw rather than failing every one.
const main_roots = stamped_memo.create<Promise<string>>()

async function main_root(): Promise<string> {
	try {
		return await main_roots.of(
			process.cwd(),
			stamped_memo.NO_STAMP,
			async () => await lane_registry.main_repository_root(),
		)
	} catch (error) {
		main_roots.keep(new Set())
		throw error
	}
}

// Every process the run's record names is asked of `table`, the redraw's own `ps` snapshot — only once
// a run is found, so a repository with no run waits on no `ps`.
async function span_here(repository: string, table: TableRead | undefined): Promise<SpanHere> {
	const read = run_carry.read_carry(run_carry.carry_path(repository))
	const ended = run_carry_ended.read_ended(run_carry_ended.ended_path(repository))
	const launch = backlogrun_launch.pending_launch(repository)
	const span = run_board_span.span_of(read, ended, launch)

	if (span === undefined) return NO_SPAN

	const same_process = await run_board_roots.same_in(table)
	const stranded_ports = run_stranded_detect.ports_with(same_process)

	return {
		span,
		resume: run_board_span.resume_of(read, ended, launch),
		transcript: read.kind === 'carried' ? read.carry.owner_transcript : undefined,
		roots: run_board_roots.roots_of(repository, read, same_process),
		carry: read.kind === 'carried' ? read.carry : undefined,
		is_stranded: run_stranded_detect.is_stranded_at(repository, stranded_ports),
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

// The open lanes sorted by their records, each folded from the whole stream, not the run's span: an
// earlier run's lane launched before the span began.
async function lanes_here(
	lanes: ReadonlyArray<LaneInfo>,
	repository: string,
	events: ReadonlyArray<RunEvent>,
	started_ms: number,
): Promise<BoardLanes> {
	const issues = lanes.map((lane) => lane.issue)
	const records = await lane_state.read_states(issues, repository)

	return run_board_lane_state.lanes_of({ events, lanes: issues, records, started_ms })
}

// The lanes not yet ended and the processes their closes could not end, off their records — once a
// retried close ends the lane, its survivors are gone.
async function unfinished_here(repository: string): Promise<Pick<LocalRead, 'closing' | 'stuck'>> {
	const records = await lane_state.read_records(repository)
	const unfinished = records.filter((record) => record.state !== 'ended')

	return {
		closing: new Set(unfinished.map(({ issue }) => issue)),
		stuck: new Map(
			unfinished.flatMap(({ stuck = [] }) => stuck.map(({ pid, reason }) => [pid, reason])),
		),
	}
}

type LaneRoomRead = Pick<
	LocalRead,
	'free_lanes' | 'lane_limit' | 'occupied_count' | 'earlier_occupied' | 'idle_lanes'
>

// The lanes against the limit, read once so the free count, the lanes it counts, the earlier run's
// among them and the idle ones agree.
async function lane_room_of(
	lanes: ReadonlyArray<LaneInfo>,
	sorted: BoardLanes,
	table: TableRead | undefined,
): Promise<LaneRoomRead> {
	const room = await backlog_ready.lane_room(lanes, table)
	const count = await backlog_ready.count_in(room)
	const occupied = room.occupied.map((lane) => lane.issue)

	return {
		free_lanes: count?.free,
		lane_limit: count?.limit,
		occupied_count: occupied.length,
		earlier_occupied: run_board_lane_state.earlier_occupied(occupied, sorted),
		idle_lanes: room.idle,
	}
}

// The repository's lane ledger, read once for the usual times and the driver's open hold.
function ledger_here(repository: string): Pick<LocalRead, 'usual' | 'is_memory_held'> {
	const entries = lane_ledger.read_entries(lane_ledger.target_of(repository))
	const now_ms = Date.now()

	return {
		usual: run_board_usual.usual_of(entries, now_ms),
		is_memory_held:
			lane_held_stats.open_reason(entries, now_ms) === backlog_drive_memory.HOLD_REASON,
	}
}

// The run's own events, and what its done rows say after their time with each open investigation's
// session asked of `table`.
async function span_events_here(
	events: ReadonlyArray<RunEvent>,
	span: BoardSpan,
	table: TableRead | undefined,
): Promise<Pick<LocalRead, 'events' | 'found'>> {
	const spanned = run_board_span.events_of(events, span)
	// An overrun session outlives the run that launched it, so its notes and filings are read past the
	// run's end too (joshuafolkken/kit#4818); the next run starts a span of its own.
	const since = run_board_span.events_of(events, { ...span, ended_ms: undefined })

	return {
		events: spanned,
		found: run_board_found.found_of(since, await run_board_found.live_in(table)),
	}
}

// `undefined` when no run has started here. The lane count reads `table`, the redraw's process
// snapshot, so it agrees with the usage columns.
async function read_local(table?: TableRead): Promise<LocalRead | undefined> {
	const repository = await run_carry.repository_directory()
	const { span, resume, transcript, roots, carry, is_stranded } =
		repository === undefined ? NO_SPAN : await span_here(repository, table)

	if (repository === undefined || span === undefined) return undefined

	const events = run_event_stream.read_events(run_event_stream.target_of(repository))
	const lanes = await lane_registry.list_lanes(await main_root())
	const lane_states = await lanes_here(lanes, repository, events, span.started_ms)

	return {
		started_ms: span.started_ms,
		ended_ms: span.ended_ms,
		scope: run_board_scope.scope_of(span.invocation),
		...(await span_events_here(events, span, table)),
		lanes: lanes.map((lane) => lane.issue),
		lane_states,
		resume,
		roots,
		...(await unfinished_here(repository)),
		carry,
		is_stranded,
		operations: run_board_operation_read.read(sources_of(repository, lanes, transcript)),
		...(await lane_room_of(lanes, lane_states, table)),
		...ledger_here(repository),
	}
}

const run_board_read = { read_local }

export { run_board_read }
export type { LocalRead }
