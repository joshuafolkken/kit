import { describe, expect, it, vi } from 'vitest'
import { run_board_data } from './run-board-data'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather, type GatherRead } from './run-board-gather'
import { run_board_gather_thread, type GatherPost } from './run-board-gather-thread'
import type { BoardPlan } from './run-board-layout'
import type { Snapshot } from './run-board-snapshot'
import { run_board_state, type BoardData, type DataPorts } from './run-board-state'
import type { Thanks } from './run-board-thanks-csv'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#8159: a live board's worker steps the GitHub, roster and snapshot data beside
// its reads off this machine and posts it; the board's redraw draws what was posted, reading nothing.

const { FIRST_ROUND, LOCAL, START, harness, plan_titled, round_ports } = run_board_fixture
const { FRESH_DATA, FRESH_STATE, FRESH_VIEW } = run_board_state
const { posted, received, step, view_for } = run_board_data
const READ: GatherRead = {
	...run_board_gather.read_of(run_board_gather.FRESH_GATHER),
	local: LOCAL,
}
const PLAN = plan_titled('a')
const NEXT_RUN_MS = START + 60_000
const NEXT_READ: GatherRead = { ...READ, local: { ...LOCAL, started_ms: NEXT_RUN_MS } }
const KEPT: Snapshot = {
	run_started_ms: NEXT_RUN_MS,
	titles: new Map([[1, 'kept']]),
	labels: new Map(),
	closed: new Map(),
}

function never(): never {
	throw new Error('read on the board’s thread')
}

// Ports whose every read throws, so a test sees none is taken.
const UNREAD: Required<DataPorts> = {
	read_plan: never,
	read_closed: never,
	read_thanks: never,
	read_rate_limit: never,
	read_issue_count: never,
	snapshot: { load: never, save: never },
}

// The harness's GitHub reads, answering the plan read with `plans` in turn.
function ports_with(plans: Array<BoardPlan | undefined> = [PLAN]): DataPorts {
	const { read_plan, read_closed } = harness(LOCAL, plans)

	return { read_plan, read_closed }
}

async function settled(data: BoardData, read: GatherRead, ports: DataPorts): Promise<BoardData> {
	return await step(data, read, { ports, now_ms: START, pace: 'settled' })
}

describe('run_board_data.step', () => {
	it('reads nothing from GitHub with no run', async () => {
		const ports = ports_with()
		const read = { ...READ, local: undefined }

		await expect(settled(FRESH_DATA, read, ports)).resolves.toMatchObject({ plan: undefined })
		expect(ports.read_plan).not.toHaveBeenCalled()
	})

	it('reads the plan of the run on screen', async () => {
		const data = await settled(FRESH_DATA, READ, ports_with())

		expect(data).toMatchObject({ plan: PLAN, run_started_ms: START })
	})

	it('keeps the plan it read on the same run', async () => {
		const first = await settled(FRESH_DATA, READ, ports_with())
		const again = await step(first, READ, { ports: UNREAD, now_ms: START, pace: 'background' })

		expect(again.plan).toBe(first.plan)
	})

	it('starts a different run from what the last board on it kept', async () => {
		const first = await settled(FRESH_DATA, READ, ports_with())
		const ports = { ...ports_with([]), snapshot: { load: () => KEPT, save: vi.fn() } }
		const next = await settled(first, NEXT_READ, ports)

		expect(next).toMatchObject({ plan: undefined, run_started_ms: NEXT_RUN_MS })
		expect(next.known.titles.get(1)).toBe('kept')
	})
})

describe('run_board_data.posted and received', () => {
	it('carries the data across the thread, each read in flight named', async () => {
		const launched = await step(FRESH_DATA, READ, {
			ports: { ...ports_with(), read_plan: async () => await new Promise(vi.fn()) },
			now_ms: START,
			pace: 'background',
		})
		const back = received(structuredClone(posted(launched)), READ)

		expect(back.plan_fetch).toBeDefined()
		expect(back.closed_fetch).toBeUndefined()
		expect(back.run_started_ms).toBe(START)
	})

	it('names no read in flight once the plan landed', async () => {
		const data = await settled(FRESH_DATA, READ, ports_with())

		expect(posted(data).in_flight).toStrictEqual([])
		expect(received(posted(data), READ).plan).toBe(data.plan)
	})
})

describe('run_board_data.view_for', () => {
	it('keeps the frame of the same run', () => {
		const state = { ...FRESH_STATE, run_started_ms: START, spots: [] }

		expect(view_for(state, { ...FRESH_DATA, run_started_ms: START })).toBe(state)
	})

	it('drops the frame of a different run', () => {
		const state = { ...FRESH_STATE, run_started_ms: START }

		expect(view_for(state, { ...FRESH_DATA, run_started_ms: NEXT_RUN_MS })).toBe(FRESH_VIEW)
	})
})

const read_thanks = vi.fn(async (): Promise<Thanks> => [])

// The last post of two worker rounds over the harness's reads and a roster read.
async function worker_post(): Promise<GatherPost> {
	const ports = { ...round_ports(harness(LOCAL, [PLAN])), read_thanks }
	const posts: Array<unknown> = []
	const round = await run_board_gather_thread.gather_round(FIRST_ROUND, ports, (value) => {
		posts.push(value)
	})

	await run_board_gather_thread.gather_round(round, ports, (value) => {
		posts.push(value)
	})

	return posts.at(-1) as GatherPost
}

describe('run_board_tick.tick over the data a worker posted', () => {
	it('draws the plan and roster the worker read without reading on the board’s thread', async () => {
		const post = await worker_post()
		const { ports } = harness(LOCAL, [])
		const gathered = { ...post.read, local: LOCAL, data: post.data }

		const next = await run_board_tick.tick(FRESH_STATE, {
			...ports,
			...UNREAD,
			gather: async () => gathered,
		})

		expect(read_thanks).toHaveBeenCalledOnce()
		expect(post.data).toMatchObject({ plan: PLAN, thanks: [] })
		expect(next).toMatchObject({ plan: PLAN, thanks: [] })
	})
})
