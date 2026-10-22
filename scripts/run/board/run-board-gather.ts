import type { BudgetWait } from '#scripts/gate/core-wait'
import type { MachineSample } from '#scripts/gate/machine-capacity'
import { lane_await } from '#scripts/lane/lane-await'
import { lane_process_table, type TableRead } from '#scripts/lane/lane-process-table'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import type { BoardUsage } from './run-board-header'
import { run_board_idle, type IdleSince } from './run-board-idle'
import { run_board_machine, type MachineGauges, type MachineMark } from './run-board-machine'
import type { LocalRead } from './run-board-read'
import { run_board_state, type Pace } from './run-board-state'
import type { UsageMark } from './run-board-usage'
import { run_board_usage_board } from './run-board-usage-board'

// What `run:board` reads off this machine: the run's own stream and lanes, the process table and the
// machine's gauges. A live board reads them on a worker thread (`run-board-gather-worker.ts`), so no
// read stops the spinner; a single frame has no spinner to stop and reads them where it draws. **Two
// speeds**: the run's own stream and lanes are re-read no more often than `LOCAL_READ_MS`, because each
// read parses the whole stream and asks git twice, and a board left open all night would otherwise grow
// heavier as the run grew longer; the machine is sampled once a second — one `sysctl` takes a few
// milliseconds, and its gauges are the differences between consecutive samples.

const MACHINE_SAMPLE_MS = MS_PER_SECOND
const LOCAL_READ_SECONDS = 5
const LOCAL_READ_MS = LOCAL_READ_SECONDS * MS_PER_SECOND
const { is_due } = run_board_state

interface GatherPorts {
	// Every process on the machine, one `ps` (`lane-process-table.ts`); a read takes it at most once
	// and hands it to both readers below, so the lane count and the usage columns read one instant.
	read_table: TableRead
	// `undefined` when no run has started here.
	read_local: (table: TableRead) => Promise<LocalRead | undefined>
	read_machine: () => Promise<MachineSample>
	// The claims waiting in the core budget, read on the machine's second; none where it is not given.
	read_waits?: (() => Array<BudgetWait>) | undefined
	// Every process and its lane, the last reading's lanes reused (`run-board-usage-read.ts`).
	read_usage: (before: UsageMark | undefined, table: TableRead) => Promise<UsageMark | undefined>
	// Whether the reads go on — a live board — so a usage reading has the last one to compare against.
	is_live: boolean
	now: () => number
	sleep: (ms: number) => Promise<void>
}

// What a frame draws from the reads, as a worker hands it over.
interface GatherRead {
	// The last local read, drawn until the next is due; `undefined` when no run had started.
	local: LocalRead | undefined
	read_ms: number | undefined
	// When each lane the reads found idle was first read so (`run-board-idle.ts`).
	idle_since: IdleSince
	gauges: MachineGauges | undefined
	// Each lane's and each process group's usage, `undefined` where none could be read.
	usages: BoardUsage | undefined
	budget_waits: ReadonlyArray<BudgetWait>
	// When the reads last failed; `undefined` once a read has answered since.
	read_failed_ms?: number | undefined
	// Why they failed, the first line of the error; cleared with `read_failed_ms`.
	read_error?: string | undefined
}

interface GatherState extends GatherRead {
	// The last machine sample, which the next one is compared against.
	machine: MachineMark | undefined
	// The read the last sample was taken on, which the next sample is due a second after.
	sampled_ms: number | undefined
	// The last process reading, which the next one is compared against.
	usage: UsageMark | undefined
}

// The reads a frame draws from, taken as it asks.
type Gatherer = (pace: Pace) => Promise<GatherRead>

const FRESH_GATHER: GatherState = {
	local: undefined,
	read_ms: undefined,
	idle_since: run_board_idle.NO_IDLE,
	gauges: undefined,
	usages: undefined,
	budget_waits: [],
	machine: undefined,
	sampled_ms: undefined,
	usage: undefined,
}

// The process snapshot and the pace the reads are taken at, shared by the reads.
interface Snapshot {
	pace: Pace
	table: TableRead
}

interface SnapshotAt extends Snapshot {
	now_ms: number
}

async function read_at(
	state: GatherState,
	ports: GatherPorts,
	at: SnapshotAt,
): Promise<GatherState> {
	const local = await ports.read_local(at.table)
	const idle_since = run_board_idle.since_of(state.idle_since, local?.idle_lanes ?? [], at.now_ms)

	return { ...state, local, read_ms: at.now_ms, idle_since }
}

// A single frame has no earlier read to confirm an idle lane against (`run-board-idle.ts`).
function is_unconfirmed(before: GatherState, read: GatherState, pace: Pace): boolean {
	return pace === 'settled' && before.read_ms === undefined && read.idle_since.size > 0
}

// The reads over a snapshot taken now.
function fresh_snapshot(ports: GatherPorts, pace: Pace): Snapshot {
	return { pace, table: lane_process_table.shared(ports.read_table) }
}

// The lane read and the reads after it share one snapshot; a confirmation taken after the wait reads
// a snapshot of its own and hands it on, so no lane is counted from the state before the wait.
async function reread(
	state: GatherState,
	ports: GatherPorts,
	snapshot: Snapshot,
): Promise<{ read: GatherState; snapshot: Snapshot }> {
	const now_ms = ports.now()

	if (!is_due(state.read_ms, LOCAL_READ_MS, now_ms)) return { read: state, snapshot }

	const read = await read_at(state, ports, { now_ms, ...snapshot })

	if (!is_unconfirmed(state, read, snapshot.pace)) return { read, snapshot }

	await ports.sleep(lane_await.RECONFIRM_MS)

	const later = fresh_snapshot(ports, snapshot.pace)

	return { read: await read_at(read, ports, { now_ms: ports.now(), ...later }), snapshot: later }
}

// The sample is timed when it is taken, not when the reads began: it is due by the reads' clock, so a
// sample taken a few milliseconds in does not slip to the read after the second.
async function resample(
	state: GatherState,
	ports: GatherPorts,
	at: SnapshotAt,
): Promise<GatherState> {
	if (!is_due(state.sampled_ms, MACHINE_SAMPLE_MS, at.now_ms)) return state

	const at_ms = ports.now()
	const machine = { sample: await ports.read_machine(), at_ms }
	const gauges = run_board_machine.gauges_of(state.machine, machine)
	const budget_waits = ports.read_waits?.() ?? []
	const usages = await run_board_usage_board.read_usages(state, ports, at.table)

	return { ...state, ...usages, machine, gauges, budget_waits, sampled_ms: at.now_ms }
}

// One round of the reads. The process snapshot is read once, by whichever of the lane read and the
// sample asks first.
async function gather(state: GatherState, ports: GatherPorts, pace: Pace): Promise<GatherState> {
	const { read, snapshot } = await reread(state, ports, fresh_snapshot(ports, pace))

	return await resample(read, ports, { now_ms: ports.now(), ...snapshot })
}

// What a frame draws, without the marks the next reads compare against.
function read_of(state: GatherState): GatherRead {
	const { local, read_ms, idle_since, gauges, usages, budget_waits } = state
	const { read_failed_ms, read_error } = state

	return { local, read_ms, idle_since, gauges, usages, budget_waits, read_failed_ms, read_error }
}

// A single frame's reads, taken afresh each time it is drawn.
function frame_gatherer(ports: GatherPorts): Gatherer {
	return async (pace) => read_of(await gather(FRESH_GATHER, ports, pace))
}

const run_board_gather = {
	FRESH_GATHER,
	LOCAL_READ_MS,
	MACHINE_SAMPLE_MS,
	frame_gatherer,
	gather,
	read_of,
}

export { run_board_gather }
export type { GatherPorts, GatherRead, GatherState, Gatherer }
