import { backlog_drive_memory } from '#scripts/backlog/backlog-drive-memory'
import type { NamedPlan } from '#scripts/backlog/backlog-plan'
import { backlog_ready } from '#scripts/backlog/backlog-ready'
import { lane_held_stats } from '#scripts/lane/lane-held-stats'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import type { TableRead } from '#scripts/lane/lane-process-table'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_state, type LaneStateRecord } from '#scripts/lane/lane-state'
import { stamped_memo } from '#scripts/lib/stamped-memo'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_tail } from '#scripts/run/event/run-event-tail'
import { run_merge_usage_limit } from '#scripts/run/merge/run-merge-usage-limit'
import { run_wake } from '#scripts/run/wake/run-wake'
import { run_board_found, type FoundOf } from './run-board-found'
import { run_board_lane_result } from './run-board-lane-result'
import { run_board_lane_state, type BoardLanes } from './run-board-lane-state'
import {
	run_board_operation_read,
	type OperationSources,
	type SessionOperations,
} from './run-board-operation-read'
import type { ProcessRoots } from './run-board-process-groups'
import type { QuotaProvider } from './run-board-quota-read'
import { run_board_scope } from './run-board-scope'
import { run_board_single, type EndedRoot, type RootRun } from './run-board-single'
import { run_board_span, type BoardSpan } from './run-board-span'
import { run_board_span_read } from './run-board-span-read'
import { run_board_throughput, type ThroughputRow } from './run-board-throughput'
import { run_board_usual, type UsualTimes } from './run-board-usual'

// What `run:board` reads locally each tick: the run's span and scope, its events and its open lanes.
// The run is the running one, or the one that last ended until the next run begins.
interface LocalRead {
	scheduler_provider?: QuotaProvider | undefined
	started_ms: number
	// Set only once the run has ended; the board then draws its end-of-run screen.
	ended_ms: number | undefined
	// The single run's name the header draws; `undefined` for a `backlogrun` (`run-board-single.ts`).
	run_name?: string | undefined
	// The root checkout's single run beside a carried run, drawn above its lanes.
	root?: RootRun | undefined
	// The root checkout's single runs a merge ended inside the run, drawn in `✅ done`.
	ended_roots?: ReadonlyArray<EndedRoot> | undefined
	// What the run was asked to do, from its invocation.
	scope: NamedPlan
	events: ReadonlyArray<RunEvent>
	// The 📈 throughput rows, read off the whole stream, every run's, before it is narrowed to this run;
	// derived here so the redraw thread is never handed the stream itself.
	throughput?: ReadonlyArray<ThroughputRow> | undefined
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
	// The carry's session owner is still running, apart from the supervisor's own driver.
	is_session_active?: boolean | undefined
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
	// The same snapshot's occupied identities, so row selection can use the heading's exact lanes.
	occupied_lanes?: ReadonlyArray<string> | undefined
	// How long each phase usually takes, from the repository's lane ledger.
	usual?: UsualTimes | undefined
	// The reset a Claude usage limit holds the running run's launches until (`run-merge-usage-limit.ts`);
	// `undefined` once it has passed, where none was recorded, or where no run is carried.
	usage_reset_ms?: number | undefined
	// How many children that limit stopped and still holds (joshuafolkken/kit#5395).
	usage_parked?: number | undefined
	// The driver holds its offered issue until the machine has memory for one more lane — the ledger's
	// open hold is `backlog-drive-memory.ts`'s.
	is_memory_held?: boolean | undefined
	// The ledger's open hold the driver launches nothing under, in its own words; `undefined` once it
	// is released (joshuafolkken/kit#6538).
	launch_hold?: string | undefined
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
// earlier run's lane launched before the span began. A closed lane's record is read too, for its end.
function sorted_here(
	lanes: ReadonlyArray<LaneInfo>,
	records: ReadonlyArray<LaneStateRecord>,
	events: ReadonlyArray<RunEvent>,
	started_ms: number,
): BoardLanes {
	return run_board_lane_state.lanes_of({
		events,
		lanes: lanes.map((lane) => lane.issue),
		records: new Map(records.map((record) => [record.issue, record])),
		started_ms,
		results: run_board_lane_result.results_of(lanes),
	})
}

// The lanes not yet ended and the processes their closes could not end, off their records — once a
// retried close ends the lane, its survivors are gone.
function unfinished_here(
	records: ReadonlyArray<LaneStateRecord>,
): Pick<LocalRead, 'closing' | 'stuck'> {
	const unfinished = records.filter((record) => record.state !== 'ended')

	return {
		closing: new Set(unfinished.map(({ issue }) => issue)),
		stuck: new Map(
			unfinished.flatMap(({ stuck = [] }) => stuck.map(({ pid, reason }) => [pid, reason])),
		),
	}
}

// Every lane record, read once for the lanes' states and the closes still unfinished.
async function lanes_here(
	lanes: ReadonlyArray<LaneInfo>,
	repository: string,
	events: ReadonlyArray<RunEvent>,
	started_ms: number,
): Promise<Pick<LocalRead, 'lane_states' | 'closing' | 'stuck'>> {
	const records = await lane_state.read_records(repository)

	return {
		lane_states: sorted_here(lanes, records, events, started_ms),
		...unfinished_here(records),
	}
}

type LaneRoomRead = Pick<
	LocalRead,
	| 'free_lanes'
	| 'lane_limit'
	| 'occupied_count'
	| 'occupied_lanes'
	| 'earlier_occupied'
	| 'idle_lanes'
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
		occupied_lanes: occupied,
		earlier_occupied: run_board_lane_state.earlier_occupied(occupied, sorted),
		idle_lanes: room.idle,
	}
}

// The repository's lane ledger, read once for the usual times and the driver's open hold.
function ledger_here(
	repository: string,
): Pick<LocalRead, 'usual' | 'is_memory_held' | 'launch_hold'> {
	const entries = lane_ledger.read_entries(lane_ledger.target_of(repository))
	const now_ms = Date.now()
	const launch_hold = lane_held_stats.open_reason(entries, now_ms)

	return {
		usual: run_board_usual.usual_of(entries, now_ms),
		is_memory_held: launch_hold === backlog_drive_memory.HOLD_REASON,
		launch_hold,
	}
}

// The reset a usage limit holds the running run's launches until, read off the events `backlog:drive`
// reads it off (`run_event_stream_emit.current_events`): the carried invocation's, so an ended run's
// stop holds no row the driver would launch — and how many children it stopped.
function usage_reset_here(
	events: ReadonlyArray<RunEvent>,
	carry: RunCarry | undefined,
): Pick<LocalRead, 'usage_reset_ms' | 'usage_parked'> {
	if (carry === undefined) return { usage_reset_ms: undefined }
	const scope = run_event_scope.scope_of({ kind: 'carried', carry })
	const scoped = run_event_scope.scoped_events(events, scope) ?? []
	const now_ms = Date.now()

	return {
		usage_reset_ms: run_merge_usage_limit.held_until(scoped, now_ms),
		usage_parked: run_merge_usage_limit.held_count(scoped, now_ms),
	}
}

// The run's own events, what its done rows say after their time with each open investigation's
// session asked of `table`, and the usage limit its record's invocation is held by.
async function span_events_here(
	events: ReadonlyArray<RunEvent>,
	span: BoardSpan,
	table: TableRead | undefined,
	carry: RunCarry | undefined,
): Promise<Pick<LocalRead, 'events' | 'found' | 'usage_reset_ms' | 'usage_parked'>> {
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

// The span's own fields, with the root checkout's single runs beside it.
function span_fields(
	span: BoardSpan,
	root: RootFields,
): Pick<LocalRead, 'started_ms' | 'ended_ms' | 'scheduler_provider' | 'run_name'> & RootFields {
	const run_name = run_board_single.name_of(span.invocation)
	const times = {
		...root,
		started_ms: span.started_ms,
		ended_ms: span.ended_ms,
		...(run_name !== undefined && { run_name }),
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

// `undefined` when no run has started here. The lane count reads `table`, the redraw's process
// snapshot, so it agrees with the usage columns.
async function read_local(table?: TableRead): Promise<LocalRead | undefined> {
	const repository = await run_carry.repository_directory()
	const { span, root, resume, transcript, roots, carry, is_stranded, is_session_active } =
		await run_board_span_read.span_here(repository, table)

	if (repository === undefined || span === undefined) return undefined

	const events = run_event_tail.read_events(run_event_stream.target_of(repository))
	const lanes = await lane_registry.list_lanes(await main_root())
	const lane_read = await lanes_here(lanes, repository, events, span.started_ms)

	return {
		...span_fields(span, await roots_here(span, root, events)),
		scope: run_board_scope.scope_of(span.invocation, carry?.added),
		...(await span_events_here(events, span, table, carry)),
		throughput: run_board_throughput.rows_of(events, Date.now()),
		lanes: lanes.map((lane) => lane.issue),
		...lane_read,
		resume,
		roots,
		carry,
		is_stranded,
		is_session_active,
		operations: run_board_operation_read.read(sources_of(repository, lanes, transcript)),
		...(await lane_room_of(lanes, lane_read.lane_states, table)),
		...ledger_here(repository),
	}
}

const run_board_read = { read_local }

export { run_board_read }
export type { LocalRead }
