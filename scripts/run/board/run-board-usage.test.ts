import { describe, expect, it } from 'vitest'
import { run_board_usage, type ProcessReading, type UsageMark } from './run-board-usage'

// joshuafolkken/kit#3489: each lane's usage from two process readings — its processes' CPU time
// between them as a share of the whole machine, and the sum of their resident memory.

const { usage_of } = run_board_usage
const SECOND = 1000
const CORES = 4
const TOTAL_BYTES = 1000

type Row = readonly [pid: number, cpu_ms: number, rss_bytes: number, lane: string | undefined]

function mark(at_ms: number, rows: ReadonlyArray<Row>): UsageMark {
	const processes = new Map<number, ProcessReading>(
		rows.map(([pid, cpu_ms, rss_bytes]) => [pid, { cpu_ms, rss_bytes }]),
	)
	const lanes = new Map<number, string | undefined>(rows.map((row) => [row[0], row[3]]))

	return { at_ms, processes, lanes, cores: CORES, total_bytes: TOTAL_BYTES }
}

const FIRST = mark(0, [
	[1, 1000, 100, '3423'],
	[2, 0, 50, '3423'],
	[3, 0, 200, '3433'],
	[4, 9000, 400, undefined],
])

describe('run_board_usage.usage_of', () => {
	it('sums each lane’s memory and draws no CPU on the first reading', () => {
		const usages = usage_of(undefined, FIRST)

		expect([...usages.keys()]).toStrictEqual([3423, 3433])
		expect(usages.get(3423)).toStrictEqual({
			cpu_percent: undefined,
			memory_bytes: 150,
			memory_percent: 15,
		})
	})

	it('takes each lane’s CPU from the time its processes spent since the last reading', () => {
		const after = mark(SECOND, [
			[1, 3000, 100, '3423'],
			[2, 0, 50, '3423'],
			[3, 400, 200, '3433'],
			[5, 1000, 10, '3423'],
			[4, 12_000, 400, undefined],
		])
		const usages = usage_of(FIRST, after)

		// 2 s of the old process and 1 s of the new one, over 1 s of 4 cores.
		expect(usages.get(3423)?.cpu_percent).toBe(75)
		expect(usages.get(3433)?.cpu_percent).toBe(10)
		expect(usages.get(3423)?.memory_bytes).toBe(160)
	})

	it('reads a process number reused with less CPU time as none spent', () => {
		const after = mark(SECOND, [[1, 10, 100, '3423']])

		expect(usage_of(FIRST, after).get(3423)?.cpu_percent).toBe(0)
	})
})
