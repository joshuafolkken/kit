import { stripVTControlCharacters } from 'node:util'
import { serialize } from 'node:v8'
import { launch_timing } from '#scripts/lane/launch-timing'
import { ts_entry_loader } from '#scripts/run/ts-entry-loader'
import { describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather, type GatherState } from './run-board-gather'
import { run_board_gather_record, type RecordSetup } from './run-board-gather-record'
import {
	run_board_gather_thread,
	type FailedPost,
	type GatherPost,
	type GatherWorker,
	type RoundState,
	type WorkerSeed,
} from './run-board-gather-thread'
import type { CueName } from './run-board-sound-cues'
import type { BoardGather } from './run-board-state'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#4267: a live board's reads come from a worker thread; a redraw draws the last round
// it handed over, and a worker that dies is said on the board and started again on the next redraw.

const { FIRST_ROUND, LOCAL, START, WORDS, harness, plan_titled, round_ports, ticks } =
	run_board_fixture
const { FRESH_GATHER, read_of } = run_board_gather
const { gather_round, post_of, worker_gatherer, worker_options } = run_board_gather_thread

const WORKER_PHASE = { name: 'machine', ms: 7 }
const { FRESH_STATE, tick } = run_board_tick
const SECOND_MS = 1000
const FAILED_MS = START + SECOND_MS
const READ: GatherState = { ...FRESH_GATHER, local: LOCAL, read_ms: START }

// What the worker hands over for `read` on a fresh board: its frame assembled, the run's read kept.
function handed(read: GatherState): GatherPost {
	const data = { ...FIRST_ROUND.data, ...read_of(read) }

	return post_of(FIRST_ROUND.board, read, data, START).post
}

const POST = handed(READ)
const FRAME = { header: expect.objectContaining({ layout: expect.anything() }) }

// POST with the frame sounding `cue`.
function cued(cue: CueName | undefined): GatherPost {
	if (POST.display === undefined) throw new Error('no frame')

	return { ...POST, display: { ...POST.display, cue } }
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

// joshuafolkken/kit#8161: the worker is started with what it records its frames with.
describe('run_board_gather_thread.worker_gatherer over spawner', () => {
	it('passes the loader options, the record setup and its link environment to the Worker', async () => {
		const worker = fake_worker()
		const setup: RecordSetup = { theme: 'wargames', is_tty: true, is_linked: true }
		const worker_data: WorkerSeed = { seed: undefined, setup }

		worker_spawn.mockImplementationOnce(function create_worker() {
			return worker
		})
		const first = worker_gatherer(run_board_gather_thread.spawner(setup))('background')

		worker.emit('message', POST)
		await first
		expect(worker_spawn).toHaveBeenCalledWith(run_board_gather_thread.WORKER_URL, {
			...worker_options(process.execArgv),
			env: run_board_gather_record.worker_environment(setup),
			workerData: worker_data,
		})
	})
})

describe('run_board_gather_thread.worker_gatherer', () => {
	it('waits for the worker’s first round, then draws the frame it handed over', async () => {
		const { gather, spawned } = faked()
		const first = gather('background')

		spawned[0]?.emit('message', POST)

		await expect(first).resolves.toMatchObject({ local: undefined, display: FRAME })
		expect(spawned[0]?.unref).toHaveBeenCalledOnce()
	})

	it('keeps the last frame, said failed, when the worker throws, and starts another next redraw', async () => {
		const { gather, spawned } = faked()
		const first = gather('background')

		spawned[0]?.emit('message', POST)
		await first
		spawned[0]?.emit('error', new Error('read failed\n    at stack'))

		await expect(gather('background')).resolves.toMatchObject({
			display: FRAME,
			read_failed_ms: FAILED_MS,
			read_error: 'read failed',
		})
		expect(spawned).toHaveLength(2)
	})
})

// joshuafolkken/kit#8219: the round the last board on this run saved is drawn before the worker posts.
describe('run_board_gather_thread.worker_gatherer with a saved round', () => {
	const SAVED: BoardGather = { ...POST.read, data: POST.data, display: POST.display }

	it('answers the saved round before the worker posts and seeds the worker from its data', async () => {
		const worker = fake_worker()
		const spawn = vi.fn(() => worker)
		const gather = worker_gatherer(
			spawn,
			() => FAILED_MS,
			async () => await SAVED,
		)

		await expect(gather('background')).resolves.toMatchObject({ display: FRAME })
		expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ data: SAVED.data }))
	})

	it('reads the saved round once', async () => {
		const saved = vi.fn(async () => await SAVED)
		const gather = worker_gatherer(
			() => fake_worker(),
			() => FAILED_MS,
			saved,
		)

		await gather('background')
		await gather('background')
		expect(saved).toHaveBeenCalledOnce()
	})
})

const FEW_EVENTS = 10
const MANY_EVENTS = 15_000

// READ over a stream of `count` events that draw no row of their own.
function streamed(count: number): GatherState {
	return { ...READ, local: { ...LOCAL, events: ticks(count) } }
}

// joshuafolkken/kit#8160: the run's read stays on the worker; the board receives only the frame.
describe('run_board_gather_thread.post_of', () => {
	it('hands the frame over without the run read or its events', () => {
		expect(POST).toMatchObject({ read: { local: undefined }, display: FRAME })
		expect(JSON.stringify(POST)).not.toContain('"events"')
	})

	it('hands over the same size for 10 events as for 15,000 drawing the same rows', () => {
		const sizes = [FEW_EVENTS, MANY_EVENTS].map(
			(count) => serialize(handed(streamed(count))).length,
		)

		expect(sizes[1]).toBe(sizes[0])
	})

	it('hands no frame over before a run starts', () => {
		expect(handed(FRESH_GATHER).display).toBeUndefined()
	})
})

describe('run_board_gather_thread.worker_gatherer, the frame’s cue', () => {
	it('sounds a frame’s cue on one redraw only', async () => {
		const { gather, spawned } = faked()
		const first = gather('background')

		spawned[0]?.emit('message', cued('launch'))

		await expect(first).resolves.toMatchObject({ display: { cue: 'launch' } })
		await expect(gather('background')).resolves.toMatchObject({ display: { cue: undefined } })
	})

	it('keeps a cue no redraw has sounded when the round’s end hands over none', async () => {
		const { gather, spawned } = faked()
		const first = gather('background')

		spawned[0]?.emit('message', cued(undefined))
		await first
		spawned[0]?.emit('message', cued('launch'))
		spawned[0]?.emit('message', cued(undefined))

		await expect(gather('background')).resolves.toMatchObject({ display: { cue: 'launch' } })
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

describe('run_board_gather_thread phases', () => {
	it("marks the worker's first answer and the phases its round carried on the board's thread", async () => {
		launch_timing.clear()
		const { gather, spawned } = faked()
		const first = gather('background')

		spawned[0]?.emit('message', { ...POST, phases: [WORKER_PHASE] })
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
	it('hands the run read’s frame over before the usages answer', async () => {
		const { posts, release, round } = held_round()

		await vi.waitFor(() => {
			expect(posts).toHaveLength(1)
		})
		expect(posts[0]).toMatchObject({ read: { local: undefined }, display: FRAME })
		expect(posts[0]).not.toHaveProperty('phases')
		release()
		await round
	})

	it('hands the round’s end over with its frame, the phases once', async () => {
		launch_timing.clear()
		const { posts, release, round } = held_round()

		release()
		await round

		expect(posts).toHaveLength(2)
		expect(posts[1]).toMatchObject({ read: { local: undefined }, display: FRAME })
		expect(posts.filter((post) => 'phases' in post)).toHaveLength(1)
	})

	it('draws the round’s frame once the round’s end arrives', async () => {
		const { posts, release, round } = held_round()
		const { gather, spawned } = faked()
		const first = gather('background')

		release()
		await round
		for (const post of posts) spawned[0]?.emit('message', post)
		await first

		await expect(gather('background')).resolves.toMatchObject({ local: undefined, display: FRAME })
	})
})

// The board's read of POST, handed over again on each redraw with no new frame.
async function handed_again(): Promise<BoardGather> {
	return await { ...POST.read, ...POST }
}

// joshuafolkken/kit#8160: the board draws the frame the worker handed over, its clock its own.
describe('run_board_tick.tick over a frame the worker handed over', () => {
	it('moves the elapsed time and the spinner each redraw with no new frame handed over', async () => {
		const { ports, frames, clock } = harness(undefined, [])
		const live = { ...ports, gather: handed_again }
		const drawn = await tick(FRESH_STATE, live)

		clock.now_ms += SECOND_MS
		await tick(drawn, live)

		expect(frames).toHaveLength(2)
		expect(frames[1]).not.toBe(frames[0])
	})

	it('draws the handed frame, not the no-run frame its own empty read would', async () => {
		const empty = harness(undefined, [])
		const { ports, frames } = harness(undefined, [])

		await tick(FRESH_STATE, empty.ports)
		await tick(FRESH_STATE, { ...ports, gather: handed_again })

		expect(frames[0]).not.toBe(empty.frames[0])
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
