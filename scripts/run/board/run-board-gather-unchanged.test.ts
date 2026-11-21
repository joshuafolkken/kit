import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather, type GatherState } from './run-board-gather'
import type { LocalRead } from './run-board-read'
import { run_board_round_change } from './run-board-round-change'

const { FIRST_ROUND, LOCAL, START, harness } = run_board_fixture
const { FRESH_GATHER, LOCAL_READ_MS, gather } = run_board_gather
const { inputs_of, is_unchanged } = run_board_round_change
const IDLE: LocalRead = { ...LOCAL, idle_lanes: ['1'] }

async function reread(next: LocalRead | undefined): Promise<[GatherState, GatherState]> {
	const board = harness(structuredClone(IDLE), [])
	const first = await gather(FRESH_GATHER, board.gathering, 'background')

	board.clock.now_ms += LOCAL_READ_MS
	board.read_local.mockResolvedValue(next)

	return [first, await gather(first, board.gathering, 'background')]
}

describe('run_board_gather unchanged reads', () => {
	it('retains equal reads and idle timestamps (ac-2a2c296b)', async () => {
		const [first, next] = await reread(structuredClone(IDLE))

		expect(next.local).toBe(first.local)
		expect(next.idle_since).toBe(first.idle_since)
		expect(next.read_ms).toBe(START + LOCAL_READ_MS)
		expect(next.idle_since.get('1')).toBe(START)
	})

	it('updates changed local values without replacing unchanged idle times (ac-58afd41a)', async () => {
		const changed = { ...IDLE, is_memory_held: true }
		const [first, next] = await reread(changed)

		expect(next.local).toBe(changed)
		expect(next.local).not.toBe(first.local)
		expect(next.idle_since).toBe(first.idle_since)
	})
})

describe('run_board_gather changed idle reads', () => {
	it('updates idle membership and preserves the existing lane timestamp', async () => {
		const [first, next] = await reread({ ...IDLE, idle_lanes: ['1', '2'] })

		expect(next.idle_since).not.toBe(first.idle_since)
		expect(next.idle_since).toEqual(
			new Map([
				['1', START],
				['2', START + LOCAL_READ_MS],
			]),
		)
	})

	it('clears a disappeared local read and its idle lanes', async () => {
		const [first, next] = await reread(undefined)

		expect(next.local).toBeUndefined()
		expect(next.idle_since).not.toBe(first.idle_since)
		expect(next.idle_since.size).toBe(0)
	})

	it('marks a static reread unchanged for the worker handover (ac-ef151b41)', async () => {
		const [first, next] = await reread(structuredClone(IDLE))
		const before = inputs_of({ ...FIRST_ROUND.data, ...first }, START)
		const after = inputs_of({ ...FIRST_ROUND.data, ...next }, START + LOCAL_READ_MS)

		expect(is_unchanged(before, after, FIRST_ROUND.board)).toBe(true)
	})
})
