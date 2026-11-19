import { describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather } from './run-board-gather'
import {
	run_board_gather_thread,
	type FailedPost,
	type GatherPost,
	type GatherWorker,
} from './run-board-gather-thread'
import { run_board_state, type DataPost } from './run-board-state'

// joshuafolkken/kit#8159: a worker started again begins from the data the last one handed over, so the
// board keeps its plan rows, thanks and allowances until the new worker's reads land.

const { FIRST_ROUND, LOCAL, START, harness, plan_titled, round_ports } = run_board_fixture
const { first_round, gather_round, worker_gatherer } = run_board_gather_thread
const { FRESH_DATA } = run_board_state
const THANKS = [{ name: 'reviewer', url: undefined }]

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

// A gatherer over fake workers, with the seed each was spawned from.
function faked(): {
	gather: ReturnType<typeof worker_gatherer>
	spawned: Array<Fake>
	seeds: Array<DataPost | undefined>
} {
	const spawned: Array<Fake> = []
	const seeds: Array<DataPost | undefined> = []

	function spawn(seed: DataPost | undefined): Fake {
		const worker = fake_worker()

		spawned.push(worker)
		seeds.push(seed)

		return worker
	}

	return { gather: worker_gatherer(spawn, () => START), spawned, seeds }
}

// The last post of one worker round whose plan read answered, with thanks and a read in flight.
async function planned_post(): Promise<GatherPost> {
	const posts: Array<GatherPost | FailedPost> = []
	const ports = round_ports(harness(LOCAL, [plan_titled('a')]))

	await gather_round(FIRST_ROUND, ports, (value) => {
		posts.push(value)
	})
	const last = posts.at(-1)

	if (last === undefined || 'failed' in last || last.data === undefined) throw new Error('no data')

	return { ...last, data: { ...last.data, thanks: THANKS, in_flight: ['plan_fetch'] } }
}

describe('run_board_gather_thread.worker_gatherer over a worker started again', () => {
	it('spawns the first worker with no seed and the next from the data last handed over', async () => {
		const post = await planned_post()
		const { gather, spawned, seeds } = faked()
		const first = gather('background')

		spawned[0]?.emit('message', post)
		await first
		spawned[0]?.emit('exit', 1)
		await gather('background')

		expect(seeds).toStrictEqual([undefined, post.data])
	})

	it('keeps the last data for a post that carries none', async () => {
		const post = await planned_post()
		const { gather, spawned } = faked()
		const first = gather('background')

		spawned[0]?.emit('message', post)
		await first
		spawned[0]?.emit('message', { ...post, data: undefined })

		await expect(gather('background')).resolves.toMatchObject({ data: post.data })
	})
})

describe('run_board_gather_thread.first_round', () => {
	it('starts from fresh data with no seed or a seed that is not posted data', () => {
		expect(first_round()).toStrictEqual({ gather: run_board_gather.FRESH_GATHER, data: FRESH_DATA })
		expect(first_round({ plan: 'x' }).data).toBe(FRESH_DATA)
	})

	it('keeps the plan and thanks of a seed, with none of its reads held in flight', async () => {
		const { data } = await planned_post()
		const round = first_round(structuredClone(data))

		expect(round.data.plan).toStrictEqual(data?.plan)
		expect(round.data.thanks).toStrictEqual(THANKS)
		expect(round.data.plan_fetch).toBeUndefined()
	})
})
