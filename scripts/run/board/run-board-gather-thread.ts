import { Worker, type WorkerOptions } from 'node:worker_threads'
import { bundle_flag } from '#scripts/build/bundle-flag'
import { launch_timing, type TimedPhase } from '#scripts/lane/launch-timing'
import { run_board_data } from './run-board-data'
import { run_board_display, type BoardDisplay, type Carried } from './run-board-display'
import { run_board_fetch } from './run-board-fetch'
import {
	run_board_gather,
	type GatherPorts,
	type GatherRead,
	type GatherState,
} from './run-board-gather'
import { run_board_gather_record, type RecordSetup } from './run-board-gather-record'
import { run_board_round_change, type RoundInputs } from './run-board-round-change'
import {
	run_board_state,
	type BoardData,
	type BoardGather,
	type BoardPorts,
	type BoardState,
	type DataPorts,
	type DataPost,
} from './run-board-state'
import { run_board_tick } from './run-board-tick'
import { run_board_timing } from './run-board-timing'
import { run_board_worker_entry, type WorkerLaunch } from './run-board-worker-entry'
import { run_board_worker_limits } from './run-board-worker-limits'

// The live board's side of its worker thread (`run-board-gather-worker.ts`): the worker takes the
// reads off this machine, steps the GitHub, roster and snapshot data over them, and hands each round
// over; a redraw draws the last one it handed, so no read stops the board's spinner. A round that
// throws is handed over as failed, and the worker reads again next round; a worker that dies is said on
// the board, and started again on the next redraw from the data it last handed — there is no other
// place the reads are taken.

const { launch_of } = run_board_worker_entry
const EMPTY_READ = run_board_gather.read_of(run_board_gather.FRESH_GATHER)
const WORKER_PHASE = 'worker: first answer'
const { assemble_display } = run_board_display
const { layout_for } = run_board_tick
const { reason_of } = run_board_fetch

// One round as the worker hands it over: the reads off this machine but the run's own, the GitHub,
// roster and snapshot data folded over them (`run-board-data.ts`), and the frame assembled over the
// run's read (`run-board-display.ts`) — none before a run starts — so the board draws without the
// run's read, whatever its size (joshuafolkken/kit#8160). The phases the worker timed ride along, so
// `run:board --timing` reads them on the board's own thread. A round with no new frame hands over its
// reads alone, with no `display` key: the board keeps drawing the last frame over them
// (joshuafolkken/kit#8330).
interface GatherPost {
	read: GatherRead & { local: undefined }
	display?: BoardDisplay | undefined
	data?: DataPost | undefined
	phases?: ReadonlyArray<TimedPhase> | undefined
}

// What the worker keeps between rounds: its reads off this machine, the data folded over them, and the
// board the last frame was assembled over, which carries the sound it decided and the baseline it
// counted to the next.
interface RoundState {
	gather: GatherState
	data: BoardData
	board: BoardState
	// What the last round's end handed over was assembled from (`run-board-round-change.ts`).
	handed?: RoundInputs | undefined
}

// What a worker is started again from: the data and the carried sound the last one handed over.
interface Seed {
	data: DataPost
	carried: Carried | undefined
}

// What a round reads with, and where it hands its posts.
interface RoundIo {
	ports: GatherPorts & DataPorts
	post: (value: GatherPost | FailedPost) => void
}

type RoundPorts = RoundIo['ports']

// Within a round: the board the last hand-over assembled over, and the data the early hand-overs stepped.
interface RoundKept {
	board: BoardState
	early: Promise<BoardData>
}

// A frame assembled on the worker and the board it leaves for the next.
interface Assembled {
	display: BoardDisplay | undefined
	board: BoardState
}

// One hand-over and the board it leaves for the next.
interface Handed {
	post: GatherPost
	board: BoardState
}

// A round whose reads threw, handed over with why; the worker reads again next round.
interface FailedPost {
	failed: string
}

// The part of a worker the board listens to.
interface GatherWorker {
	on: (event: 'message' | 'error' | 'exit', listener: (value: unknown) => void) => unknown
	unref: () => void
}

// Starts a worker from the data and the carried sound the last one handed over, if any.
type Spawn = (seed: Seed | undefined) => GatherWorker

interface Thread {
	worker: GatherWorker | undefined
	latest: BoardGather | undefined
	waiting: Array<(read: BoardGather) => void>
}

// The frame over `data` on the board the last frame left, as `run-board-tick.ts` assembles one over the
// read it holds; with no run, no frame.
function assembled(board: BoardState, data: BoardData, now_ms: number): Assembled {
	const state: BoardState = { ...run_board_data.view_for(board, data), ...data }
	const { local } = state

	if (local === undefined) return { board: state, display: undefined }

	const display = assemble_display(state, local, now_ms, layout_for(state, local, now_ms))

	return { board: { ...state, ...display.carried }, display }
}

// The reads handed over: the run's read stays on the worker.
function reads_of(read: GatherState): GatherPost['read'] {
	return { ...run_board_gather.read_of(read), local: undefined }
}

// One hand-over of `read` and the data stepped over it, its frame assembled at `now_ms`.
function post_of(board: BoardState, read: GatherState, data: BoardData, now_ms: number): Handed {
	const { display, board: next } = assembled(board, data, now_ms)

	return { post: { read: reads_of(read), display, data: run_board_data.posted(data) }, board: next }
}

function is_post(value: unknown): value is GatherPost {
	return typeof value === 'object' && value !== null && 'read' in value
}

function failed_of(error: unknown): FailedPost {
	return { failed: reason_of(error) }
}

// The data stepped over a read at the worker's `background` pace: the GitHub reads it launches are
// folded in on a later step, after they land.
async function step_over(
	data: BoardData,
	read: GatherState,
	ports: RoundPorts,
): Promise<BoardData> {
	return await run_board_data.step(data, run_board_gather.read_of(read), {
		ports,
		now_ms: ports.now(),
		pace: 'background',
	})
}

// The hand-over of `read` and the data stepped over it, the board its frame leaves kept for the next.
function hand_over(kept: RoundKept, read: GatherState, data: BoardData, io: RoundIo): GatherPost {
	const { post, board } = post_of(kept.board, read, data, io.ports.now())

	kept.board = board

	return post
}

// The run's read handed over as soon as it lands, with the data stepped over it, so the board's first
// frame draws the plan the last board kept; a step that throws is said failed, and the round goes on.
async function post_early(
	early: Promise<BoardData>,
	kept: RoundKept,
	read: GatherState,
	io: RoundIo,
): Promise<BoardData> {
	const data = await early

	try {
		const stepped = await step_over(data, read, io.ports)

		io.post(hand_over(kept, read, stepped, io))

		return stepped
	} catch (error) {
		io.post(failed_of(error))

		return data
	}
}

// The round's end — its reads, the data stepped over them and what a frame over them is assembled
// from — handed over with the round's phases: its frame, or its reads alone when the frame would be the
// one `last` handed over.
function end_round(
	last: RoundInputs | undefined,
	kept: RoundKept,
	ended: Pick<RoundState, 'gather' | 'data'> & { handed: RoundInputs },
	io: RoundIo,
): RoundState {
	const post = run_board_round_change.is_unchanged(last, ended.handed, kept.board)
		? { read: reads_of(ended.gather) }
		: hand_over(kept, ended.gather, ended.data, io)

	io.post({ ...post, phases: launch_timing.phases() })

	return { ...ended, board: kept.board }
}

// The run's read is handed over as soon as it lands (joshuafolkken/kit#8134), and the round's end
// hands its frame over again (`end_round`).
async function posted_round(state: RoundState, io: RoundIo): Promise<RoundState> {
	const kept: RoundKept = { board: state.board, early: Promise.resolve(state.data) }
	const next = await run_board_gather.gather(state.gather, io.ports, 'background', (read) => {
		kept.early = post_early(kept.early, kept, read, io)
	})
	const data = await step_over(await kept.early, next, io.ports)
	const handed = run_board_round_change.inputs_of(data, io.ports.now())

	return end_round(state.handed, kept, { gather: next, data, handed }, io)
}

function is_data_post(value: unknown): value is DataPost {
	return typeof value === 'object' && value !== null && 'in_flight' in value
}

function is_seed(value: unknown): value is Seed {
	return typeof value === 'object' && value !== null && 'data' in value && is_data_post(value.data)
}

// A worker's state before its first round: the data and the sound the last worker handed over, when it
// is started again, so the board keeps its plan rows, thanks, allowances and baseline, and sounds no
// cue twice. The reads that worker had in flight died with it, so each is asked again at once.
function first_round(seed?: unknown): RoundState {
	const { FRESH_GATHER } = run_board_gather
	const { FRESH_STATE, FRESH_DATA } = run_board_state

	if (!is_seed(seed)) return { gather: FRESH_GATHER, data: FRESH_DATA, board: FRESH_STATE }

	const data = run_board_data.received(run_board_data.relaunched(seed.data), EMPTY_READ)

	return { gather: FRESH_GATHER, data, board: { ...FRESH_STATE, ...data, ...seed.carried } }
}

// One round on the worker: the reads handed over, or why they threw — the state kept for the next.
async function gather_round(
	state: RoundState,
	ports: RoundPorts,
	post: RoundIo['post'],
): Promise<RoundState> {
	try {
		return await posted_round(state, { ports, post })
	} catch (error) {
		post(failed_of(error))

		return { ...state, handed: undefined }
	}
}

function is_failed(value: unknown): value is FailedPost {
	return typeof value === 'object' && value !== null && 'failed' in value
}

function settle(thread: Thread, read: BoardGather): void {
	thread.latest = read

	for (const resolve of thread.waiting.splice(0)) resolve(read)
}

// A post with no data — none stepped yet this round — keeps the last data handed over.
function data_of(thread: Thread, post: GatherPost): DataPost | undefined {
	return post.data ?? thread.latest?.data
}

// A cue no redraw has sounded yet rides on to the next frame, so the round's end handed over before a
// redraw does not drop the cue its early hand-over decided.
function display_of(thread: Thread, display: BoardDisplay | undefined): BoardDisplay | undefined {
	if (display === undefined) return undefined

	return { ...display, cue: display.cue ?? thread.latest?.display?.cue }
}

// A post with no frame keeps the last one, drawn over the post's reads.
function receive(thread: Thread, post: GatherPost): void {
	const { phases = [] } = post

	for (const phase of phases) launch_timing.mark(phase.name, phase.ms)
	const data = data_of(thread, post)
	const display = 'display' in post ? display_of(thread, post.display) : thread.latest?.display

	settle(thread, { ...post.read, data, display, read_failed_ms: undefined, read_error: undefined })
}

// A frame's cue is sounded once: the redraw that takes it leaves the frame without it.
function take_cue(thread: Thread): void {
	const { latest } = thread

	if (latest?.display?.cue === undefined) return

	thread.latest = { ...latest, display: { ...latest.display, cue: undefined } }
}

// What a worker started again starts from: the data and the sound the last one handed over.
function seed_of(latest: BoardGather | undefined): Seed | undefined {
	const data = latest?.data

	return data === undefined ? undefined : { data, carried: latest?.display?.carried }
}

// A failed read keeps the last round on screen, said failed since its first failure and why until the
// next answers, so the board can say how stale it has gone (joshuafolkken/kit#8475).
function said_failed(thread: Thread, reason: string, now: () => number): void {
	const read_failed_ms = thread.latest?.read_failed_ms ?? now()

	settle(thread, { ...(thread.latest ?? EMPTY_READ), read_failed_ms, read_error: reason })
}

// A worker that threw or exited is started again on the next redraw.
function fail(thread: Thread, worker: GatherWorker, reason: string, now: () => number): void {
	if (thread.worker !== worker) return

	thread.worker = undefined
	said_failed(thread, reason, now)
}

// The first answer is timed from the spawn: the worker's start, its module load and its first read
// handed over — the early lane read when it lands first, else the round's end.
function listen(thread: Thread, worker: GatherWorker, now: () => number): void {
	const spawned_ms = now()

	worker.on('message', (value) => {
		launch_timing.mark(WORKER_PHASE, now() - spawned_ms)
		if (is_post(value)) run_board_timing.received(receive, thread, value)
		else if (is_failed(value)) said_failed(thread, value.failed, now)
	})
	worker.on('error', (error) => {
		fail(thread, worker, reason_of(error), now)
	})
	worker.on('exit', (code) => {
		fail(thread, worker, `exit ${String(code)}`, now)
	})
}

function start(thread: Thread, spawn: Spawn, now: () => number): GatherWorker {
	const worker = spawn(seed_of(thread.latest))

	listen(thread, worker, now)
	// The board's own loop keeps the process; the worker never holds it open past the board.
	worker.unref()

	return worker
}

async function latest_of(thread: Thread): Promise<BoardGather> {
	if (thread.latest !== undefined) return thread.latest

	return await new Promise((resolve) => {
		thread.waiting.push(resolve)
	})
}

function worker_options(launch: WorkerLaunch): WorkerOptions {
	return { execArgv: launch.exec_argv, resourceLimits: run_board_worker_limits.WORKER_LIMITS }
}

// What a worker is started with: the data and the carried sound the last one handed over, and what it
// records its frames with.
interface WorkerSeed {
	seed: Seed | undefined
	setup: RecordSetup
}

// Starts each worker with the board's record setup (`run-board-gather-record.ts`).
function spawner(setup: RecordSetup): Spawn {
	return (seed) => {
		const worker_data: WorkerSeed = { seed, setup }
		const launch = launch_of(bundle_flag.is_bundled(), process.execArgv)

		return new Worker(launch.url, {
			...worker_options(launch),
			env: run_board_gather_record.worker_environment(setup),
			workerData: worker_data,
		})
	}
}

// The last round a board on this run handed over (`run-board-saved-state.ts`), none on another run.
type SavedRead = () => Promise<BoardGather | undefined>

function keep(thread: Thread, read: BoardGather | undefined): void {
	thread.latest ??= read
}

// The first redraw draws the round the last board on this run saved, and the worker starts from its
// data (joshuafolkken/kit#8219); with none saved, the first redraw waits for the worker's first round.
// Every later redraw draws the last round handed.
function worker_gatherer(
	spawn: Spawn,
	now: () => number = Date.now,
	saved?: SavedRead,
): BoardPorts['gather'] {
	const thread: Thread = { worker: undefined, latest: undefined, waiting: [] }
	let unread = saved

	return async () => {
		const first = unread

		unread = undefined
		// Read before the first worker starts, so the worker starts from its data; with none there is no
		// wait, so the worker is started at once.
		if (first !== undefined) keep(thread, await first())
		thread.worker ??= start(thread, spawn, now)
		const read = await latest_of(thread)

		take_cue(thread)

		return read
	}
}

const run_board_gather_thread = {
	first_round,
	gather_round,
	post_of,
	spawner,
	worker_gatherer,
	worker_options,
}

export { run_board_gather_thread }
export type {
	FailedPost,
	GatherPost,
	GatherWorker,
	Handed,
	RoundState,
	SavedRead,
	Seed,
	WorkerSeed,
}
