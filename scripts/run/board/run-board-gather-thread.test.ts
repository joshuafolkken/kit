import { stripVTControlCharacters } from 'node:util'
import { launch_timing } from '#scripts/lane/launch-timing'
import { ts_entry_loader } from '#scripts/run/ts-entry-loader'
import { describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather, type GatherState } from './run-board-gather'
import {
	run_board_gather_thread,
	type FailedPost,
	type GatherPost,
	type GatherWorker,
	type RoundState,
} from './run-board-gather-thread'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#4267: a live board's reads come from a worker thread; a redraw draws the last round
// it handed over, and a worker that dies is said on the board and started again on the next redraw.

const { FIRST_ROUND, LOCAL, START, WORDS, harness, plan_titled, round_ports } = run_board_fixture
const { FRESH_GATHER, read_of } = run_board_gather
const { gather_round, post_of, worker_gatherer, worker_options } = run_board_gather_thread

const WORKER_PHASE = { name: 'machine', ms: 7 }
const { FRESH_STATE, tick } = run_board_tick
const FAILED_MS = START + 1000
const READ: GatherState = { ...FRESH_GATHER, local: LOCAL, read_ms: START }
// READ as the board receives it from a round that posted no data.
const RECEIVED = {
	...read_of(READ),
	data: undefined,
	read_failed_ms: undefined,
	read_error: undefined,
}

const FAILED_READ = new RegExp(String.raw`❗ ${WORDS.read} \d{2}:\d{2}`, 'u')

const worker_spawn = vi.hoisted(() => vi.fn())

vi.mock('node:worker_threads', () => ({ Worker: worker_spawn }))

interface Fake extends GatherWorker {
	emit: (event: string, value?: unknown) => void
}

describe('run_board_gather_thread.worker_options', () => {
	it('adds the loader for a dist-launched parent with no loader flags', () => {
		expect(worker_options([]).execArgv).toStrictEqual([
			ts_entry_loader.IMPORT_FLAG,
			ts_entry_loader.loader_url(),
		])
	})

	it('keeps an existing parent loader without adding it twice', () => {
		const exec_argv = [ts_entry_loader.IMPORT_FLAG, ts_entry_loader.loader_url()]

		expect(worker_options(exec_argv).execArgv).toStrictEqual(exec_argv)
	})
})

function fake_worker(): Fake {
	type Listener = (value: unknown) => void

	const listeners = new Map<string, Listener>()

	return {
		on: (event, listener) => listeners.set(event, listener),
		emit: (event, value) => listeners.get(event)?.(value),
		unref: vi.fn(),
	}
}

// A gatherer over fake workers, each spawned one handed back in `spawned`.
function faked(): { gather: ReturnType<typeof worker_gatherer>; spawned: Array<Fake> } {
	const spawned: Array<Fake> = []
	const spawn = vi.fn(() => {
		const worker = fake_worker()

		spawned.push(worker)

		return worker
	})

	return { gather: worker_gatherer(spawn, () => FAILED_MS), spawned }
}

describe('run_board_gather_thread.worker_gatherer with its default spawn', () => {
	it('passes the parent loader options to the default Worker constructor', async () => {
		const worker = fake_worker()

		worker_spawn.mockImplementationOnce(function create_worker() {
			return worker
		})
		const first = worker_gatherer()('background')

		worker.emit('message', post_of(FRESH_GATHER, READ))
		await first
		expect(worker_spawn).toHaveBeenCalledWith(run_board_gather_thread.WORKER_URL, {
			execArgv: ts_entry_loader.loader_argv(process.execArgv),
			workerData: undefined,
		})
	})
})

describe('run_board_gather_thread.worker_gatherer', () => {
	it('waits for the worker’s first round, then draws the last one handed over', async () => {
		const { gather, spawned } = faked()
		const first = gather('background')

		spawned[0]?.emit('message', post_of(FRESH_GATHER, READ))

		await expect(first).resolves.toStrictEqual(RECEIVED)
		expect(spawned[0]?.unref).toHaveBeenCalledOnce()
	})

	it('keeps the last run read when a round hands over no new one', async () => {
		const { gather, spawned } = faked()
		const first = gather('background')

		spawned[0]?.emit('message', post_of(FRESH_GATHER, READ))
		await first
		spawned[0]?.emit('message', post_of(READ, { ...READ, budget_waits: [] }))

		expect(post_of(READ, READ).local).toBeUndefined()
		await expect(gather('background')).resolves.toMatchObject({ local: LOCAL })
	})

	it('keeps the last round, said failed, when the worker throws, and starts another next redraw', async () => {
		const { gather, spawned } = faked()
		const first = gather('background')

		spawned[0]?.emit('message', post_of(FRESH_GATHER, READ))
		await first
		spawned[0]?.emit('error', new Error('read failed\n    at stack'))

		await expect(gather('background')).resolves.toMatchObject({
			local: LOCAL,
			read_failed_ms: FAILED_MS,
			read_error: 'read failed',
		})
		expect(spawned).toHaveLength(2)
	})
})

describe('run_board_gather_thread.worker_gatherer before a first round', () => {
	it('answers a redraw waiting on a worker that exits before its first round', async () => {
		const { gather, spawned } = faked()
		const first = gather('background')

		spawned[0]?.emit('exit', 1)

		await expect(first).resolves.toMatchObject({
			local: undefined,
			read_failed_ms: FAILED_MS,
			read_error: 'exit 1',
		})
	})
})

// The same stream as the worker reads it again: an equal array, cloned across the thread.
const EVENTS = [{ pos: 0, at: new Date(START).toISOString(), kind: 'setup', text: 'go' }]
const STREAM: GatherState = { ...READ, local: { ...LOCAL, events: EVENTS } }
const AGAIN: GatherState = {
	...STREAM,
	local: { ...LOCAL, events: [...EVENTS] },
	read_ms: FAILED_MS,
}
const GROWN: GatherState = { ...AGAIN, local: { ...LOCAL, events: [...EVENTS, ...EVENTS] } }

describe('run_board_gather_thread.worker_gatherer over a stream read again', () => {
	it('keeps its own stream array when the worker reads the same stream again', async () => {
		const { gather, spawned } = faked()
		const first = gather('background')

		spawned[0]?.emit('message', structuredClone(post_of(FRESH_GATHER, STREAM)))
		const { local } = await first

		spawned[0]?.emit('message', structuredClone(post_of(STREAM, AGAIN)))
		const again = await gather('background')

		expect(again.local?.events).toBe(local?.events)
		expect(again.read_ms).toBe(FAILED_MS)
	})

	it('takes a stream read again with more events', async () => {
		const { gather, spawned } = faked()
		const first = gather('background')

		spawned[0]?.emit('message', structuredClone(post_of(FRESH_GATHER, STREAM)))
		await first
		spawned[0]?.emit('message', structuredClone(post_of(STREAM, GROWN)))

		await expect(gather('background')).resolves.toMatchObject({ local: GROWN.local })
	})
})

// joshuafolkken/kit#8135: a reread is told apart by its length and its last event, not a whole walk.
const RETOLD = { pos: 0, at: new Date(START).toISOString(), kind: 'setup', text: 'went' }
const SAME_COUNT: GatherState = { ...AGAIN, local: { ...LOCAL, events: [RETOLD] } }

describe('run_board_gather_thread.post_of over a stream read again', () => {
	it('hands over a stream of the same length whose last event differs', () => {
		expect(post_of(STREAM, SAME_COUNT).local).toStrictEqual({ value: SAME_COUNT.local })
	})

	it('says an equal stream read afresh past a line without its newline is the same', () => {
		expect(post_of(STREAM, AGAIN).local?.is_same_events).toBe(true)
	})

	it('says the same stream array read again is the same', () => {
		expect(post_of(STREAM, { ...STREAM, read_ms: FAILED_MS }).local?.is_same_events).toBe(true)
	})

	it('hands over a longer stream that ends on the same event', () => {
		const LONGER: GatherState = { ...AGAIN, local: { ...LOCAL, events: [RETOLD, ...EVENTS] } }

		expect(post_of(STREAM, LONGER).local).toStrictEqual({ value: LONGER.local })
	})
})

describe('run_board_gather_thread phases', () => {
	it("marks the worker's first answer and the phases its round carried on the board's thread", async () => {
		launch_timing.clear()
		const { gather, spawned } = faked()
		const first = gather('background')

		spawned[0]?.emit('message', { ...post_of(FRESH_GATHER, READ), phases: [WORKER_PHASE] })
		await first

		expect(launch_timing.phases()).toStrictEqual([
			{ name: 'worker: first answer', ms: 0 },
			WORKER_PHASE,
		])
	})

	it('hands the phases the worker timed over with its round', async () => {
		launch_timing.clear()
		launch_timing.mark(WORKER_PHASE.name, WORKER_PHASE.ms)
		const posts: Array<unknown> = []

		await gather_round(FIRST_ROUND, round_ports(harness(LOCAL, [])), (value) => {
			posts.push(value)
		})

		expect(posts.at(-1)).toHaveProperty('phases', expect.arrayContaining([WORKER_PHASE]))
	})
})

interface HeldRound {
	posts: Array<GatherPost | FailedPost>
	release: () => void
	round: Promise<RoundState>
}

// A round whose usages hold until `release`, each post kept in `posts`.
function held_round(): HeldRound {
	const gate: { release: () => void } = { release: vi.fn() }
	const held = new Promise<undefined>((resolve) => {
		gate.release = () => {
			resolve(undefined)
		}
	})
	const ports = { ...round_ports(harness(LOCAL, [])), read_usage: async () => await held }
	const posts: Array<GatherPost | FailedPost> = []
	const round = gather_round(FIRST_ROUND, ports, (value) => {
		posts.push(value)
	})

	return { posts, release: () => gate.release(), round }
}

// joshuafolkken/kit#8134: the run's read is handed over as it lands, not after the round's usages.
describe('run_board_gather_thread.gather_round, the run read handed early', () => {
	it('hands the run read over before the usages answer', async () => {
		const { posts, release, round } = held_round()

		await vi.waitFor(() => {
			expect(posts).toHaveLength(1)
		})
		expect(posts[0]).toMatchObject({ local: { value: LOCAL } })
		expect(posts[0]).not.toHaveProperty('phases')
		release()
		await round
	})

	it('hands the round’s end over without the run read or the phases twice', async () => {
		launch_timing.clear()
		const { posts, release, round } = held_round()

		release()
		await round

		expect(posts).toHaveLength(2)
		expect(posts[1]).toMatchObject({ local: undefined })
		expect(posts.filter((post) => 'phases' in post)).toHaveLength(1)
	})

	it('keeps the run read handed early once the round’s end arrives', async () => {
		const { posts, release, round } = held_round()
		const { gather, spawned } = faked()
		const first = gather('background')

		release()
		await round
		for (const post of posts) spawned[0]?.emit('message', post)
		await first

		await expect(gather('background')).resolves.toMatchObject({ local: LOCAL })
	})
})

describe('run_board_tick.tick over failed reads', () => {
	it('says the reads failed beside no run', async () => {
		const { ports, frames } = harness(undefined, [])
		const failed = { ...read_of(FRESH_GATHER), read_failed_ms: FAILED_MS }

		await tick(FRESH_STATE, { ...ports, gather: async () => failed })

		expect(stripVTControlCharacters(frames.join('\n'))).toMatch(FAILED_READ)
	})

	it('says the reads failed over the last run read', async () => {
		const { ports, frames } = harness(LOCAL, [plan_titled('a')])
		const failed = { ...read_of(READ), read_failed_ms: FAILED_MS }

		await tick(FRESH_STATE, { ...ports, gather: async () => failed })

		expect(stripVTControlCharacters(frames.join('\n'))).toMatch(FAILED_READ)
	})
})
