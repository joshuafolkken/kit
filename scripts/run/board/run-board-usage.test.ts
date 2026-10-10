import { describe, expect, it } from 'vitest'
import { run_board_usage, type ProcessReading, type UsageMark } from './run-board-usage'

// joshuafolkken/kit#3489: each lane's usage from two process readings — its processes' CPU time
// between them as a share of the whole machine, and the sum of their resident memory.

const { usage_of } = run_board_usage
const SECOND = 1000
const CORES = 4
const TOTAL_BYTES = 1000

type Row = readonly [
	pid: number,
	cpu_ms: number,
	rss_bytes: number,
	lane: string | undefined,
	parent?: number,
	own_only?: true,
]

// A row with a parent is one whose CPU time folds in the children it reaped, unless it is `own_only` —
// its read failed and it keeps `ps`'s own time.
function mark(at_ms: number, rows: ReadonlyArray<Row>): UsageMark {
	const processes = new Map<number, ProcessReading>(
		rows.map(([pid, cpu_ms, rss_bytes]) => [pid, { cpu_ms, rss_bytes }]),
	)
	const lanes = new Map<number, string | undefined>(rows.map((row) => [row[0], row[3]]))
	const parented = rows.filter((row) => row[4] !== undefined)
	const parents = new Map(parented.map((row) => [row[0], row[4] ?? 0]))
	const folded = new Set(parented.filter((row) => row[5] === undefined).map((row) => row[0]))

	return { at_ms, processes, lanes, parents, folded, cores: CORES, total_bytes: TOTAL_BYTES }
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

// joshuafolkken/kit#3529: a process's count folds in the children it reaped, so one born and gone
// between two readings reaches its parent's lane — and one already counted is not counted again.
const PARENT = 10
const CHILD = 11
const GRANDCHILD = 12
const ROOT = 1

describe('run_board_usage.usage_of with reaped children', () => {
	it('counts a child born and gone between two readings in its parent’s lane', () => {
		const before = mark(0, [[PARENT, 1000, 10, '3423', ROOT]])
		// The parent spent 0.4 s itself; a child it reaped spent 2 s.
		const after = mark(SECOND, [[PARENT, 3400, 10, '3423', ROOT]])

		expect(usage_of(before, after).get(3423)?.cpu_percent).toBe(60)
	})

	it('takes a reaped child’s counted time off its parent, so nothing is counted twice', () => {
		const before = mark(0, [
			[PARENT, 1000, 10, '3423', ROOT],
			[CHILD, 1500, 10, '3423', PARENT],
		])
		// The child spent 0.4 s more and was reaped: its 1.9 s landed in the parent's count.
		const after = mark(SECOND, [[PARENT, 2900, 10, '3423', ROOT]])

		expect(usage_of(before, after).get(3423)?.cpu_percent).toBe(10)
	})

	it('takes a gone process’s time off its nearest ancestor still running', () => {
		const before = mark(0, [
			[PARENT, 0, 10, '3423', ROOT],
			[CHILD, 1000, 10, '3423', PARENT],
			[GRANDCHILD, 1000, 10, '3423', CHILD],
		])
		// Both ended and were reaped, each spending 0.2 s more: 2.4 s landed in the parent's count.
		const after = mark(SECOND, [[PARENT, 2400, 10, '3423', ROOT]])

		expect(usage_of(before, after).get(3423)?.cpu_percent).toBe(10)
	})
})

describe('run_board_usage.usage_of where counts do not fold in reaped children', () => {
	it('takes nothing off an ancestor whose own read failed and kept ps’s own time', () => {
		const before = mark(0, [
			[PARENT, 1000, 10, '3423', ROOT],
			[CHILD, 1500, 10, '3423', PARENT],
		])
		// The parent's read failed this time: 1.4 s is its own time, the reaped child's not folded in.
		const after = mark(SECOND, [[PARENT, 1400, 10, '3423', ROOT, true]])

		expect(usage_of(before, after).get(3423)?.cpu_percent).toBe(10)
	})

	it('takes nothing off where the counts do not fold in reaped children', () => {
		const before = mark(0, [
			[PARENT, 1000, 10, '3423'],
			[CHILD, 1500, 10, '3423'],
		])
		const after = mark(SECOND, [[PARENT, 1400, 10, '3423']])

		expect(usage_of(before, after).get(3423)?.cpu_percent).toBe(10)
	})
})
