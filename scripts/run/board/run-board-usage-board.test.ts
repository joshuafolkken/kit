import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather } from './run-board-gather'
import type { UsageMark } from './run-board-usage'
import { run_board_usage_board } from './run-board-usage-board'

// joshuafolkken/kit#4171: one reading draws both each lane's cells and the 💻 section's groups.

const { board_usage_of, read_usages } = run_board_usage_board
const { LOCAL, harness } = run_board_fixture
const { FRESH_GATHER } = run_board_gather
const SUPERVISOR = 10
const CHILD = 20
const LEFT = 30
const LANE = 3423
const CLOSED_LANE = 9
const SECOND_MS = 1000
const CORES = 4
const TOTAL_BYTES = 2000

function mark(at_ms: number, cpu_ms: number): UsageMark {
	const reading = { cpu_ms, memory_bytes: 100, compressed_bytes: 10 }

	return {
		at_ms,
		processes: new Map([SUPERVISOR, CHILD, LEFT].map((pid) => [pid, reading])),
		lanes: new Map([
			[CHILD, String(LANE)],
			[LEFT, String(CLOSED_LANE)],
		]),
		names: new Map([
			[SUPERVISOR, 'node'],
			[CHILD, 'claude'],
			[LEFT, 'vitest'],
		]),
		parents: new Map(),
		folded: new Set(),
		cores: CORES,
		total_bytes: TOTAL_BYTES,
	}
}

const LOCAL_READ = { ...LOCAL, lanes: [String(LANE)], roots: { supervisor: SUPERVISOR } }

describe('run_board_usage_board.board_usage_of', () => {
	it('draws each open lane its figure and the scale of the newer reading', () => {
		const usage = board_usage_of(mark(0, 0), mark(SECOND_MS, SECOND_MS / 2), LOCAL_READ)

		expect(usage.lanes.get(LANE)).toStrictEqual({
			cpu_cores: 0.5,
			memory_bytes: 100,
			compressed_bytes: 10,
		})
		expect(usage.scale).toStrictEqual({ cores: CORES, total_bytes: TOTAL_BYTES })
	})

	it("puts the supervisor's process under the backlogrun and a closed lane's under leftover", () => {
		const { processes } = board_usage_of(mark(0, 0), mark(SECOND_MS, 0), LOCAL_READ)

		expect(processes.backlogrun.supervisor.memory_bytes).toBe(100)
		expect(processes.leftover.entries.map((entry) => entry.name)).toStrictEqual([
			`vitest #${String(CLOSED_LANE)}`,
		])
	})

	it('draws no CPU from a first reading', () => {
		const usage = board_usage_of(undefined, mark(SECOND_MS, 0), undefined)

		expect(usage.lanes.get(LANE)?.cpu_cores).toBeUndefined()
	})
})

describe('run_board_usage_board.read_usages', () => {
	it('keeps the last reading, and with it a paused lane, when a reading fails', async () => {
		const { gathering, read_usage, read_table } = harness(LOCAL, [])
		const last = { ...mark(0, 0), paused: new Map([[String(LANE), 0]]) }

		read_usage.mockResolvedValueOnce(undefined)

		const read = await read_usages({ ...FRESH_GATHER, usage: last }, gathering, read_table)

		expect(read).toStrictEqual({ usage: last, usages: undefined })
	})
})
