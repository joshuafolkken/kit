import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather, type GatherState } from './run-board-gather'
import { run_board_gather_thread, type GatherWorker } from './run-board-gather-thread'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#4267: a live board's reads come from a worker thread; a redraw draws the last round
// it handed over, and a worker that dies is said on the board and started again on the next redraw.

const { LOCAL, START, WORDS, harness, plan_titled } = run_board_fixture
const { FRESH_GATHER, read_of } = run_board_gather
const { post_of, worker_gatherer } = run_board_gather_thread
const { FRESH_STATE, tick } = run_board_tick
const FAILED_MS = START + 1000
const READ: GatherState = { ...FRESH_GATHER, local: LOCAL, read_ms: START }

const FAILED_READ = new RegExp(String.raw`❗ ${WORDS.read} \d{2}:\d{2}`, 'u')

interface Fake extends GatherWorker {
	emit: (event: string, value?: unknown) => void
}

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

describe('run_board_gather_thread.worker_gatherer', () => {
	it('waits for the worker’s first round, then draws the last one handed over', async () => {
		const { gather, spawned } = faked()
		const first = gather('background')

		spawned[0]?.emit('message', post_of(FRESH_GATHER, READ))

		await expect(first).resolves.toStrictEqual({
			...read_of(READ),
			read_failed_ms: undefined,
			read_error: undefined,
		})
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
