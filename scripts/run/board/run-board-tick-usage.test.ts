import type { ProcessTable } from '#scripts/lane/lane-process-table'
import { describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather } from './run-board-gather'
import type { BoardState } from './run-board-state'
import { run_board_tick } from './run-board-tick'
import type { UsageMark } from './run-board-usage'
import { run_board_usage_board } from './run-board-usage-board'

// joshuafolkken/kit#3489: each lane's usage is read on the machine's second against the last reading,
// for a chat as for a screen. joshuafolkken/kit#4171: a frame drawn once reads twice, a second apart.

const { LOCAL, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const { MACHINE_SAMPLE_MS } = run_board_gather
const { PRIME_MS } = run_board_usage_board
const LANE = 3423
const HALF_CORE = 0.5

function reading(at_ms: number, cpu_ms: number): UsageMark {
	return {
		at_ms,
		processes: new Map([[1, { cpu_ms, memory_bytes: 100, compressed_bytes: 0 }]]),
		lanes: new Map([[1, String(LANE)]]),
		names: new Map([[1, 'node']]),
		parents: new Map(),
		folded: new Set(),
		cores: 1,
		total_bytes: 1000,
	}
}

function lane_cores(state: BoardState): number | undefined {
	return state.usages?.lanes.get(LANE)?.cpu_cores
}

describe('run_board_tick.tick usage', () => {
	it('reads the lanes’ usage each second against the last reading', async () => {
		const { ports, read_usage, clock } = harness(LOCAL, [plan_titled('a')])
		const first = reading(0, 0)

		read_usage.mockResolvedValueOnce(first).mockResolvedValueOnce(reading(MACHINE_SAMPLE_MS, 500))
		const state = await tick(FRESH_STATE, ports)

		clock.now_ms += MACHINE_SAMPLE_MS
		const next = await tick(state, ports)

		expect(read_usage.mock.calls.map(([before]) => before)).toStrictEqual([undefined, first])
		expect(lane_cores(state)).toBeUndefined()
		expect(lane_cores(next)).toBe(HALF_CORE)
		expect(next.usages?.scale).toStrictEqual({ cores: 1, total_bytes: 1000 })
	})

	it('reads the usage for a chat, which draws the column a screen does', async () => {
		const { ports, read_usage } = harness(LOCAL, [plan_titled('a')])

		read_usage.mockResolvedValueOnce(reading(0, 0))
		const state = await tick(FRESH_STATE, { ...ports, form: 'chat' })

		expect(read_usage).toHaveBeenCalledOnce()
		expect(state.usages?.processes).toBeDefined()
	})

	it('reads twice a second apart for a frame off a terminal, so its CPU is drawn', async () => {
		const { ports, read_usage, gathering } = harness(LOCAL, [plan_titled('a')])
		const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue()
		const first = reading(0, 0)

		Object.assign(gathering, { is_live: false, sleep })
		read_usage.mockResolvedValueOnce(first).mockResolvedValueOnce(reading(PRIME_MS, 500))
		const state = await tick(FRESH_STATE, { ...ports, is_tty: false })

		expect(read_usage.mock.calls.map(([before]) => before)).toStrictEqual([undefined, first])
		expect(sleep).toHaveBeenCalledWith(PRIME_MS)
		expect(lane_cores(state)).toBe(HALF_CORE)
	})
})

const ROW = {
	pid: 1,
	parent: 0,
	time: '0:01',
	rss_kb: 4,
	stat: 'S',
	start: 'Tue Oct 20 08:39:04 2026',
	command: 'node',
}
const TABLE: ProcessTable = [ROW]

// joshuafolkken/kit#4246: the lane count and the usage columns read one `ps` snapshot per redraw.
describe('run_board_tick.tick process snapshot', () => {
	it('reads one snapshot and hands it to both the lane read and the sample', async () => {
		const { ports, read_table, read_local, read_usage } = harness(LOCAL, [plan_titled('a')])
		const seen: Array<ProcessTable | undefined> = []

		read_table.mockResolvedValue(TABLE)
		read_local.mockImplementation(async (table) => {
			seen.push(await table())

			return LOCAL
		})
		read_usage.mockImplementation(async (_before, table) => {
			seen.push(await table())

			return reading(0, 0)
		})
		await tick(FRESH_STATE, ports)

		expect(read_table).toHaveBeenCalledOnce()
		expect(seen).toStrictEqual([TABLE, TABLE])
	})
})

// A snapshot taken before a wait is not read after it.
describe('run_board_tick.tick process snapshot after a wait', () => {
	it('reads a snapshot of its own after the idle confirmation wait, for the lanes and the sample', async () => {
		const { ports, read_table, read_local, read_usage, gathering } = harness(LOCAL, [
			plan_titled('a'),
		])
		const later: ProcessTable = [{ ...ROW, stat: 'T' }]
		const seen: Array<ProcessTable | undefined> = []

		gathering.sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue()
		read_table.mockResolvedValueOnce(TABLE).mockResolvedValueOnce(later)
		read_local.mockImplementation(async (table) => {
			seen.push(await table())

			return { ...LOCAL, idle_lanes: [String(LANE)] }
		})
		read_usage.mockImplementation(async (_before, table) => {
			seen.push(await table())

			return reading(0, 0)
		})
		await tick(FRESH_STATE, ports)

		expect(read_table).toHaveBeenCalledTimes(2)
		expect(seen).toStrictEqual([TABLE, later, later])
	})

	it('reads its own snapshot for each reading of a frame off a terminal', async () => {
		const { ports, read_table, read_usage, gathering } = harness(LOCAL, [plan_titled('a')])
		const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue()
		const tables: Array<unknown> = []

		Object.assign(gathering, { is_live: false, sleep })
		read_table.mockResolvedValue(TABLE)
		read_usage.mockImplementation(async (_before, table) => {
			tables.push(table)

			return reading(0, 0)
		})
		await tick(FRESH_STATE, { ...ports, is_tty: false })

		expect(tables).toStrictEqual([read_table, read_table])
	})
})
