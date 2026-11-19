import { isDeepStrictEqual } from 'node:util'
import { Worker, type WorkerOptions } from 'node:worker_threads'
import { launch_timing, type TimedPhase } from '#scripts/lane/launch-timing'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { ts_entry_loader } from '#scripts/run/ts-entry-loader'
import { run_board_data } from './run-board-data'
import {
	run_board_gather,
	type GatherPorts,
	type GatherRead,
	type GatherState,
} from './run-board-gather'
import type { LocalRead } from './run-board-read'
import type { BoardData, BoardGather, BoardPorts, DataPorts, DataPost } from './run-board-state'

// The live board's side of its worker thread (`run-board-gather-worker.ts`): the worker takes the
// reads off this machine and hands each round over; a redraw draws the last one it handed, so no read
// stops the board's spinner. A round that throws is handed over as failed, and the worker reads again
// next round; a worker that dies is said on the board, and started again on the next redraw — there is
// no other place the reads are taken.

const WORKER_URL = new URL('run-board-gather-worker.ts', import.meta.url)
const EMPTY_READ = run_board_gather.read_of(run_board_gather.FRESH_GATHER)
const WORKER_PHASE = 'worker: first answer'

// The run's read as the worker hands it over. A stream read again unchanged is not handed over — the
// board keeps its own array, so the folds it keyed on that array are not folded again.
interface LocalPost {
	value: LocalRead | undefined
	is_same_events?: boolean | undefined
}

// One round as the worker hands it over: the run's read only when it was read again, so the board
// does not copy the whole stream every second, and the GitHub, roster and snapshot data folded over
// it (`run-board-data.ts`). The phases the worker timed ride along, so `run:board --timing` reads them
// on the board's own thread.
interface GatherPost {
	read: Omit<GatherRead, 'local'>
	local?: LocalPost | undefined
	data?: DataPost | undefined
	phases?: ReadonlyArray<TimedPhase> | undefined
}

// What the worker keeps between rounds: its reads off this machine and the data folded over them.
interface RoundState {
	gather: GatherState
	data: BoardData
}

// What a round reads with, and where it hands its posts.
interface RoundIo {
	ports: GatherPorts & DataPorts
	post: (value: GatherPost | FailedPost) => void
}

type RoundPorts = RoundIo['ports']

// Within a round: the read last handed over, and the data the early hand-overs stepped.
interface RoundKept {
	before: GatherState
	early: Promise<BoardData>
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

type Spawn = () => GatherWorker

interface Thread {
	worker: GatherWorker | undefined
	latest: BoardGather | undefined
	waiting: Array<(read: BoardGather) => void>
}

// joshuafolkken/kit#8135: the stream is read by its appended tail, so a reread holds the events it
// held — the same array, or (past a line without its newline) an equal one; its length and its last
// event say which, without walking the whole stream.
function is_reread_alike(before: ReadonlyArray<RunEvent>, after: ReadonlyArray<RunEvent>): boolean {
	if (before === after) return true
	if (before.length !== after.length) return false

	return isDeepStrictEqual(before.at(-1), after.at(-1))
}

function local_post(before: LocalRead | undefined, after: LocalRead | undefined): LocalPost {
	if (before === undefined || after === undefined) return { value: after }
	if (!is_reread_alike(before.events, after.events)) return { value: after }

	return { value: { ...after, events: [] }, is_same_events: true }
}

function post_of(before: GatherState, after: GatherState): GatherPost {
	const { local, ...read } = run_board_gather.read_of(after)
	const is_reread = after.read_ms !== before.read_ms

	return { read, local: is_reread ? local_post(before.local, local) : undefined }
}

function is_post(value: unknown): value is GatherPost {
	return typeof value === 'object' && value !== null && 'read' in value
}

// What a failure is said as: the first line of its message.
function reason_of(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error)

	return message.split('\n', 1)[0] ?? ''
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

// The run's read handed over as soon as it lands, with the data stepped over it, so the board's first
// frame draws the plan the last board kept; a step that throws is said failed, and the round goes on.
async function post_early(
	early: Promise<BoardData>,
	before: GatherState,
	read: GatherState,
	io: RoundIo,
): Promise<BoardData> {
	const data = await early

	try {
		const stepped = await step_over(data, read, io.ports)

		io.post({ ...post_of(before, read), data: run_board_data.posted(stepped) })

		return stepped
	} catch (error) {
		io.post(failed_of(error))

		return data
	}
}

// The run's read is handed over as soon as it lands (joshuafolkken/kit#8134); the round's end hands
// the rest over against it, so neither the run's read nor the phases go twice.
async function posted_round(state: RoundState, io: RoundIo): Promise<RoundState> {
	const kept: RoundKept = { before: state.gather, early: Promise.resolve(state.data) }
	const next = await run_board_gather.gather(state.gather, io.ports, 'background', (read) => {
		kept.early = post_early(kept.early, kept.before, read, io)
		kept.before = read
	})
	const data = await step_over(await kept.early, next, io.ports)
	const phases = launch_timing.phases()

	io.post({ ...post_of(kept.before, next), data: run_board_data.posted(data), phases })

	return { gather: next, data }
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

		return state
	}
}

function is_failed(value: unknown): value is FailedPost {
	return typeof value === 'object' && value !== null && 'failed' in value
}

function settle(thread: Thread, read: BoardGather): void {
	thread.latest = read

	for (const resolve of thread.waiting.splice(0)) resolve(read)
}

function local_of(thread: Thread, post: LocalPost): LocalRead | undefined {
	const { value, is_same_events } = post
	const kept = thread.latest?.local

	if (is_same_events !== true || value === undefined || kept === undefined) return value

	return { ...value, events: kept.events }
}

// A post with no data — none stepped yet this round — keeps the last data handed over.
function data_of(thread: Thread, post: GatherPost): DataPost | undefined {
	return post.data ?? thread.latest?.data
}

function receive(thread: Thread, post: GatherPost): void {
	const { phases = [] } = post

	for (const phase of phases) launch_timing.mark(phase.name, phase.ms)
	const local = post.local === undefined ? thread.latest?.local : local_of(thread, post.local)
	const data = data_of(thread, post)

	settle(thread, { ...post.read, local, data, read_failed_ms: undefined, read_error: undefined })
}

// A failed read keeps the last round on screen, said failed and why until the next answers.
function said_failed(thread: Thread, reason: string, now: () => number): void {
	settle(thread, { ...(thread.latest ?? EMPTY_READ), read_failed_ms: now(), read_error: reason })
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
		if (is_post(value)) receive(thread, value)
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
	const worker = spawn()

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

function worker_options(exec_argv: ReadonlyArray<string>): WorkerOptions {
	return { execArgv: ts_entry_loader.loader_argv(exec_argv) }
}

function spawn_worker(): GatherWorker {
	return new Worker(WORKER_URL, worker_options(process.execArgv))
}

// The first redraw waits for the worker's first round; every later one draws the last round handed.
function worker_gatherer(
	spawn: Spawn = spawn_worker,
	now: () => number = Date.now,
): BoardPorts['gather'] {
	const thread: Thread = { worker: undefined, latest: undefined, waiting: [] }

	return async () => {
		thread.worker ??= start(thread, spawn, now)

		return await latest_of(thread)
	}
}

const run_board_gather_thread = {
	WORKER_URL,
	gather_round,
	post_of,
	worker_gatherer,
	worker_options,
}

export { run_board_gather_thread }
export type { FailedPost, GatherPost, GatherWorker, RoundState }
