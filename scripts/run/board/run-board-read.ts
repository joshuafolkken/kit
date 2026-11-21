import { backlog_drive_memory } from '#scripts/backlog/backlog-drive-memory'
import type { NamedPlan } from '#scripts/backlog/backlog-plan'
import { backlog_ready } from '#scripts/backlog/backlog-ready'
import { lane_capacity, type LaneAnswer } from '#scripts/lane/lane-capacity'
import { lane_held_stats } from '#scripts/lane/lane-held-stats'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import type { TableRead } from '#scripts/lane/lane-process-table'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import type { LaneStateRecord } from '#scripts/lane/lane-state'
import { launch_timing } from '#scripts/lane/launch-timing'
import { stamped_memo } from '#scripts/lib/stamped-memo'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_tail } from '#scripts/run/event/run-event-tail'
import type { HoldCause } from '#scripts/run/merge/run-merge-usage-limit'
import { run_wake } from '#scripts/run/wake/run-wake'
import { run_board_events_memo } from './run-board-events-memo'
import type { FoundOf } from './run-board-found'
import { run_board_lane_result } from './run-board-lane-result'
import { run_board_lane_state, type BoardLanes } from './run-board-lane-state'
import { run_board_lane_totals, type LaneTotals } from './run-board-lane-totals'
import { run_board_ledger_window } from './run-board-ledger-window'
import type { SessionOperations } from './run-board-operation-read'
import type { ProcessRoots } from './run-board-process-groups'
import type { QuotaProvider } from './run-board-quota-read'
import { run_board_read_local } from './run-board-read-local'
import { run_board_records } from './run-board-records'
import { run_board_run_fields, type RunSpan } from './run-board-run-fields'
import type { EndedRoot, RootRun } from './run-board-single'
import { run_board_span_read } from './run-board-span-read'
import type { ThroughputRow } from './run-board-throughput'
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
	// The kit version the run's supervisor recorded as it started (`run-wake.ts`); `undefined` where no
	// supervisor runs or an older one recorded none.
	kit_version?: string | undefined
	// The root checkout's single run beside a carried run, drawn above its lanes.
	root?: RootRun | undefined
	// The root checkout's single runs a merge ended inside the run, drawn in `✅ done`.
	ended_roots?: ReadonlyArray<EndedRoot> | undefined
	// The board's own single run, where a stop ended it (joshuafolkken/kit#7710).
	stopped_single?: EndedRoot | undefined
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
	lane_capacity?: LaneAnswer | undefined
	// The same snapshot's occupied identities, so row selection can use the heading's exact lanes.
	occupied_lanes?: ReadonlyArray<string> | undefined
	// How long each phase usually takes, from the repository's lane ledger.
	usual?: UsualTimes | undefined
	// How long lanes took from dispatch to merge, from the same ledger.
	lane_totals?: LaneTotals | undefined
	// The reset a Claude usage limit holds the running run's launches until (`run-merge-usage-limit.ts`);
	// `undefined` once it has passed, where none was recorded, or where no run is carried.
	usage_reset_ms?: number | undefined
	// How many children that limit stopped and still holds (joshuafolkken/kit#5395).
	usage_parked?: number | undefined
	// What the hold resuming last is for — an authentication failure or a limit (joshuafolkken/kit#8012).
	usage_cause?: HoldCause | undefined
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
const { timing } = launch_timing

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
function lanes_here(
	lanes: ReadonlyArray<LaneInfo>,
	repository: string,
	events: ReadonlyArray<RunEvent>,
	started_ms: number,
): Pick<LocalRead, 'lane_states' | 'closing' | 'stuck'> {
	const records = run_board_records.read_records(repository)

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
	| 'lane_capacity'
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
		lane_capacity:
			count === undefined
				? undefined
				: lane_capacity.lane_answer(count.limit, occupied.length, room.use.seated),
		occupied_lanes: occupied,
		earlier_occupied: run_board_lane_state.earlier_occupied(occupied, sorted),
		idle_lanes: room.idle,
	}
}

// The repository's lane ledger, read once — its recent window (joshuafolkken/kit#7932) — for the usual
// times, the lane totals and the driver's open hold — the usual times net of the host's stops on
// `events` (joshuafolkken/kit#7905).
function ledger_here(
	repository: string,
	events: ReadonlyArray<RunEvent>,
): Pick<LocalRead, 'usual' | 'lane_totals' | 'is_memory_held' | 'launch_hold'> {
	const now_ms = Date.now()
	const entries = run_board_ledger_window.entries_of(lane_ledger.target_of(repository), now_ms)
	const launch_hold = lane_held_stats.open_reason(entries, now_ms)

	return {
		usual: run_board_usual.usual_of(entries, now_ms, run_board_events_memo.host_gaps(events)),
		lane_totals: run_board_lane_totals.totals_of(entries, now_ms),
		is_memory_held: launch_hold === backlog_drive_memory.HOLD_REASON,
		launch_hold,
	}
}

// The repository's own records: its lane ledger, and the kit version its supervisor recorded.
function records_here(
	repository: string,
	events: ReadonlyArray<RunEvent>,
): ReturnType<typeof ledger_here> & Pick<LocalRead, 'kit_version'> {
	return {
		...ledger_here(repository, events),
		kit_version: run_wake.read_wake(run_wake.wake_path(repository))?.kit_version,
	}
}

async function main_lanes(): Promise<Array<LaneInfo>> {
	return await lane_registry.list_lanes(await main_root())
}

// Each read `read_local` awaits, timed for `run:board --timing`; a module's read is looked up at the
// call, so a test's spy on it is the one called.
const read_repository = timing(
	'local: repository',
	async () => await run_carry.repository_directory(),
)
const read_span = timing(
	'local: span',
	async (repository: string | undefined, table?: TableRead) =>
		await run_board_span_read.span_here(repository, table),
)
const read_lanes = timing('local: lanes', main_lanes)
const read_room = timing('local: room', lane_room_of)
const read_records = timing(
	'local: ledger',
	async (repository: string, events: ReadonlyArray<RunEvent>) => records_here(repository, events),
)
const { read_roots, read_span_events, span_fields } = run_board_read_local

// The run's reads past its span. The roots, the run's events and the lane room read none of each
// other's results, so their subprocesses run together; the synchronous ledger read runs while they
// are in flight (joshuafolkken/kit#7931).
async function run_read(
	repository: string,
	read: RunSpan,
	lanes: ReadonlyArray<LaneInfo>,
	table: TableRead | undefined,
): Promise<LocalRead> {
	const { span, root, carry } = read
	const events = run_event_tail.read_events(run_event_stream.target_of(repository))
	const lane_read = lanes_here(lanes, repository, events, span.started_ms)
	const [root_fields, span_events, room, records] = await Promise.all([
		read_roots(span, root, events),
		read_span_events(events, span, table, carry),
		read_room(lanes, lane_read.lane_states, table),
		read_records(repository, events),
	])
	const fields = run_board_run_fields.fields_of(repository, read, lanes, events)

	return {
		...span_fields(span, root_fields),
		...fields,
		...span_events,
		...lane_read,
		...room,
		...records,
	}
}

// The lanes, or why they could not be read: a read with no run never uses them, so their failure is
// thrown only where a run reads them.
async function lanes_or_failure(): Promise<Array<LaneInfo> | Error> {
	try {
		return await read_lanes()
	} catch (error) {
		return error instanceof Error ? error : new Error(String(error))
	}
}

// `undefined` when no run has started here. The lane count reads `table`, the redraw's process
// snapshot, so it agrees with the usage columns. The lanes are read beside the span.
async function read_local(table?: TableRead): Promise<LocalRead | undefined> {
	const repository = await read_repository()
	const [read, lanes] = await Promise.all([read_span(repository, table), lanes_or_failure()])

	if (repository === undefined || read.span === undefined) return undefined
	if (lanes instanceof Error) throw lanes

	return await run_read(repository, { ...read, span: read.span }, lanes, table)
}

const run_board_read = { read_local }

export { run_board_read }
export type { LocalRead }
