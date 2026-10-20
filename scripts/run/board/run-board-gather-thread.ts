import { isDeepStrictEqual } from 'node:util'
import { Worker } from 'node:worker_threads'
import {
	run_board_gather,
	type Gatherer,
	type GatherRead,
	type GatherState,
} from './run-board-gather'
import type { LocalRead } from './run-board-read'

// The live board's side of its worker thread (`run-board-gather-worker.ts`): the worker takes the
// reads off this machine and hands each round over; a redraw draws the last one it handed, so no read
// stops the board's spinner. A worker that dies is said on the board, and started again on the next
// redraw — there is no other place the reads are taken.

const WORKER_URL = new URL('run-board-gather-worker.ts', import.meta.url)
const EMPTY_READ = run_board_gather.read_of(run_board_gather.FRESH_GATHER)

// The run's read as the worker hands it over. A stream read again unchanged is not handed over — the
// board keeps its own array, so the folds it keyed on that array are not folded again.
interface LocalPost {
	value: LocalRead | undefined
	is_same_events?: boolean | undefined
}

// One round as the worker hands it over: the run's read only when it was read again, so the board
// does not copy the whole stream every second.
interface GatherPost {
	read: Omit<GatherRead, 'local'>
	local?: LocalPost | undefined
}

// The part of a worker the board listens to.
interface GatherWorker {
	on: (event: 'message' | 'error' | 'exit', listener: (value: unknown) => void) => unknown
	unref: () => void
}

type Spawn = () => GatherWorker

interface Thread {
	worker: GatherWorker | undefined
	latest: GatherRead | undefined
	waiting: Array<(read: GatherRead) => void>
}

function local_post(before: LocalRead | undefined, after: LocalRead | undefined): LocalPost {
	if (before === undefined || after === undefined) return { value: after }
	if (!isDeepStrictEqual(before.events, after.events)) return { value: after }

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

function settle(thread: Thread, read: GatherRead): void {
	thread.latest = read

	for (const resolve of thread.waiting.splice(0)) resolve(read)
}

function local_of(thread: Thread, post: LocalPost): LocalRead | undefined {
	const { value, is_same_events } = post
	const kept = thread.latest?.local

	if (is_same_events !== true || value === undefined || kept === undefined) return value

	return { ...value, events: kept.events }
}

function receive(thread: Thread, post: GatherPost): void {
	const local = post.local === undefined ? thread.latest?.local : local_of(thread, post.local)

	settle(thread, { ...post.read, local, read_failed_ms: undefined })
}

// A worker that threw or exited keeps the last round on screen, said failed until the next answers.
function fail(thread: Thread, worker: GatherWorker, now: () => number): void {
	if (thread.worker !== worker) return

	thread.worker = undefined
	settle(thread, { ...(thread.latest ?? EMPTY_READ), read_failed_ms: now() })
}

function start(thread: Thread, spawn: Spawn, now: () => number): GatherWorker {
	const worker = spawn()

	worker.on('message', (value) => {
		if (is_post(value)) receive(thread, value)
	})
	worker.on('error', () => {
		fail(thread, worker, now)
	})
	worker.on('exit', () => {
		fail(thread, worker, now)
	})
	// The board's own loop keeps the process; the worker never holds it open past the board.
	worker.unref()

	return worker
}

async function latest_of(thread: Thread): Promise<GatherRead> {
	if (thread.latest !== undefined) return thread.latest

	return await new Promise((resolve) => {
		thread.waiting.push(resolve)
	})
}

function spawn_worker(): GatherWorker {
	return new Worker(WORKER_URL)
}

// The first redraw waits for the worker's first round; every later one draws the last round handed.
function worker_gatherer(spawn: Spawn = spawn_worker, now: () => number = Date.now): Gatherer {
	const thread: Thread = { worker: undefined, latest: undefined, waiting: [] }

	return async () => {
		thread.worker ??= start(thread, spawn, now)

		return await latest_of(thread)
	}
}

const run_board_gather_thread = { WORKER_URL, post_of, worker_gatherer }

export { run_board_gather_thread }
export type { GatherPost, GatherWorker }
