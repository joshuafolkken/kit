import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import type { Carried } from './run-board-display'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather, type GatherState } from './run-board-gather'
import {
	run_board_gather_thread,
	type FailedPost,
	type GatherPost,
	type RoundState,
} from './run-board-gather-thread'
import type { BoardGather } from './run-board-state'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#8160: the worker keeps the board each hand-over assembled over for the next, and
// the board stamps a failed read over the frame the worker last handed over.

const { FIRST_ROUND, LOCAL, START, WORDS, harness, plan_titled, round_ports } = run_board_fixture
const { FRESH_GATHER, read_of } = run_board_gather
const { gather_round, post_of } = run_board_gather_thread
const { FRESH_STATE, tick } = run_board_tick

const SECOND_MS = 1000
const FAILED_MS = START + SECOND_MS
const READ_ERROR = 'usage read failed'
const READ: GatherState = { ...FRESH_GATHER, local: LOCAL, read_ms: START }
const FAILED_READ = new RegExp(String.raw`❗ ${WORDS.read} \d{2}:\d{2}`, 'u')

interface Played {
	carried: Carried | undefined
	next: RoundState
}

// A round from `state` over a planned run: the sound its last hand-over carried, and the state it leaves.
async function played(state: RoundState): Promise<Played> {
	const posts: Array<GatherPost | FailedPost> = []
	const ports = round_ports(harness(LOCAL, [plan_titled('a')]))
	const next = await gather_round(state, ports, (value) => {
		posts.push(value)
	})
	const last = posts.at(-1)

	return {
		carried: last !== undefined && 'display' in last ? last.display?.carried : undefined,
		next,
	}
}

describe('run_board_gather_thread.gather_round, the board carried', () => {
	it('leaves the next round the board its last frame decided its sound over', async () => {
		const { carried, next } = await played(FIRST_ROUND)

		expect(carried?.sound_snapshot).toBeDefined()
		expect(next.board).toMatchObject({ ...carried })
	})
})

// The worker's frame for READ, the board's read of it said failed with READ_ERROR.
function failed_over_frame(): BoardGather {
	const data = { ...FIRST_ROUND.data, ...read_of(READ) }
	const { post } = post_of(FIRST_ROUND.board, READ, data, START)

	return { ...post.read, ...post, read_failed_ms: FAILED_MS, read_error: READ_ERROR }
}

describe('run_board_tick.tick over a failed read after a worker frame', () => {
	it('says the reads failed and why over the frame the worker handed over', async () => {
		const { ports, frames } = harness(undefined, [])
		const failed = failed_over_frame()

		await tick(FRESH_STATE, { ...ports, gather: async () => failed })

		const drawn = stripVTControlCharacters(frames.join('\n'))

		expect(failed.display).toBeDefined()
		expect(drawn).toMatch(FAILED_READ)
		expect(drawn).toContain(READ_ERROR)
	})
})
