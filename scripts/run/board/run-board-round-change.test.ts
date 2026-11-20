import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import {
	run_board_gather_thread,
	type FailedPost,
	type GatherPost,
	type GatherWorker,
} from './run-board-gather-thread'
import type { MachineGauges } from './run-board-machine'
import { run_board_round_change } from './run-board-round-change'
import type { Pending } from './run-board-sound-repeat'
import type { BoardData, BoardGather, BoardState } from './run-board-state'

// joshuafolkken/kit#8330: a worker round whose data is the last hand-over's is not assembled or posted.

const { FIRST_ROUND, LOCAL, START, harness, round_ports } = run_board_fixture
const { inputs_of, is_unchanged } = run_board_round_change
const { gather_round, worker_gatherer } = run_board_gather_thread

const GAUGES: MachineGauges = {
	cpu_percent: 20,
	memory_percent: 37,
	swap_mb_per_s: 0,
	memory_pressure: undefined,
}
const MOVED_GAUGES: MachineGauges = { ...GAUGES, cpu_percent: 21 }
const DATA: BoardData = { ...FIRST_ROUND.data, local: LOCAL, read_ms: START, gauges: GAUGES }
const BOARD: BoardState = FIRST_ROUND.board
const LAST = inputs_of(DATA, START)
const SECOND_MS = 1000
const PENDING: Pending = {
	cause: { cue: 'human', word: 'human', issue: 1 },
	since_ms: START,
	is_replayed: false,
}

function unchanged_with(data: BoardData, now_ms = START + SECOND_MS): boolean {
	return is_unchanged(LAST, inputs_of(data, now_ms), BOARD)
}

describe('run_board_round_change.is_unchanged', () => {
	it('is unchanged for the same data a second later, its read time aside', () => {
		expect(unchanged_with({ ...DATA, read_ms: START + SECOND_MS })).toBe(true)
	})

	it('is unchanged when the GitHub data is rebuilt with the same values', () => {
		expect(unchanged_with({ ...DATA, closed_asked: new Set(DATA.closed_asked) })).toBe(true)
	})

	it('changes when the run is read anew', () => {
		expect(unchanged_with({ ...DATA, local: { ...LOCAL } })).toBe(false)
	})

	it('is unchanged when only a machine gauge moves, drawn by the board itself', () => {
		expect(unchanged_with({ ...DATA, gauges: MOVED_GAUGES })).toBe(true)
	})

	it('changes when the GitHub data moves', () => {
		expect(unchanged_with({ ...DATA, fetched_ms: START })).toBe(false)
	})

	it('changes when a new minute starts', () => {
		expect(unchanged_with(DATA, START + MS_PER_MINUTE)).toBe(false)
	})

	it('changes with no last hand-over', () => {
		expect(is_unchanged(undefined, LAST, BOARD)).toBe(false)
	})

	it('changes while a sound waits to be replayed, and not once it was', () => {
		const pending = { ...BOARD, sound_pending: PENDING }
		const replayed = { ...BOARD, sound_pending: { ...PENDING, is_replayed: true } }

		expect(is_unchanged(LAST, LAST, pending)).toBe(false)
		expect(is_unchanged(LAST, LAST, replayed)).toBe(true)
	})
})

const HELD: BoardData = { ...DATA, local: { ...LOCAL, is_memory_held: true } }

// Whether a round a second later, its gauges `gauges`, is unchanged on a run held for memory.
function held_unchanged_with(gauges: MachineGauges): boolean {
	const next = inputs_of({ ...HELD, gauges }, START + SECOND_MS)

	return is_unchanged(inputs_of(HELD, START), next, BOARD)
}

describe('run_board_round_change.is_unchanged, a run held for memory', () => {
	it('changes when a machine gauge moves, said on its waiting rows', () => {
		expect(held_unchanged_with({ ...GAUGES })).toBe(true)
		expect(held_unchanged_with(MOVED_GAUGES)).toBe(false)
	})
})

type Posted = GatherPost | FailedPost

// A post port that keeps each post in `posts`.
function into(posts: Array<Posted>): (value: Posted) => void {
	return (value) => {
		posts.push(value)
	}
}

// Two rounds over the same reads, each round's posts kept.
async function two_rounds(): Promise<Array<Array<Posted>>> {
	const ports = round_ports(harness(LOCAL, []))
	const first: Array<Posted> = []
	const second: Array<Posted> = []
	const state = await gather_round(FIRST_ROUND, ports, into(first))

	await gather_round(state, ports, into(second))

	return [first, second]
}

describe('run_board_gather_thread.gather_round, an unchanged round', () => {
	it('hands its reads over alone, no frame, when its data is the last round’s', async () => {
		const [first = [], second = []] = await two_rounds()

		expect(first.some((post) => 'display' in post)).toBe(true)
		expect(second).toStrictEqual([{ read: expect.anything(), phases: expect.anything() }])
	})

	it('hands its frame over in the round its data changes', async () => {
		const ports = round_ports(harness(LOCAL, []))
		const state = await gather_round(FIRST_ROUND, ports, into([]))
		const posts: Array<Posted> = []
		const moved = { ...state, handed: inputs_of({ ...state.data, local: { ...LOCAL } }, START) }

		await gather_round(moved, ports, into(posts))

		expect(posts).toEqual([expect.objectContaining({ display: expect.anything() })])
	})
})

// The read a redraw draws after a worker hands `framed` over and then `alone`.
async function drawn_after(framed: GatherPost, alone: GatherPost): Promise<BoardGather> {
	const listeners = new Map<string, (value: unknown) => void>()
	const worker: GatherWorker = {
		on: (event, listener) => listeners.set(event, listener),
		unref: () => undefined,
	}
	const gather = worker_gatherer(() => worker)
	const first = gather('background')

	listeners.get('message')?.(framed)
	await first
	listeners.get('message')?.(alone)

	return await gather('background')
}

function is_framed(post: Posted): post is GatherPost {
	return 'display' in post
}

describe('run_board_gather_thread.worker_gatherer, a post with the reads alone', () => {
	it('keeps the last frame and data, drawn over the new reads', async () => {
		const posts: Array<Posted> = []

		await gather_round(FIRST_ROUND, round_ports(harness(LOCAL, [])), into(posts))
		const framed = posts.findLast((post) => is_framed(post))

		if (framed === undefined || !is_framed(framed)) throw new Error('no frame')
		const read_ms = START + SECOND_MS
		const drawn = await drawn_after(framed, { read: { ...framed.read, read_ms } })

		expect(drawn).toMatchObject({ read_ms, data: framed.data, display: framed.display })
	})
})
