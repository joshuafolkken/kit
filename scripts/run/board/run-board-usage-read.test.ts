import { lane_registry } from '#scripts/lane/lane-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_usage_read, type UsagePorts } from './run-board-usage-read'
import type { RusageReader } from './run-board-usage-rusage'

// joshuafolkken/kit#3489: how the board reads each process and its lane — `ps` every second, the
// working directory only for a process not seen before, and nothing where the platform has no way to it.

const { lane_of, parse_lsof, parse_ps, sample, usage_reader } = run_board_usage_read
const KB = 1024
const ROOT = '/Users/me/Development/.kit-lanes'
const LANE = `${ROOT}/3423`
const PARENT_AND_CHILD = '1 7 0:01 4\n2 1 0:01 4'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_usage_read.parse_ps', () => {
	it('reads every process’s parent, CPU time and resident memory, and skips a line that is not one', () => {
		const output = [
			'  PID PPID TIME RSS',
			'  12 1 1-02:03:04 2048',
			'13 12 12:34.50 100',
			' 14 12 0:00.01 4',
		].join('\n')
		const listings = parse_ps(output)

		expect([...listings.keys()]).toStrictEqual([12, 13, 14])
		expect(listings.get(12)).toStrictEqual({
			parent: 1,
			reading: { cpu_ms: 93_784_000, rss_bytes: 2048 * KB },
		})
		expect(listings.get(13)?.reading.cpu_ms).toBe(754_500)
	})
})

describe('run_board_usage_read.parse_lsof', () => {
	it('reads each process’s working directory from lsof’s fields', () => {
		const output = ['p12', 'fcwd', `n${LANE}/packages/app`, 'p13', 'fcwd', 'n/tmp'].join('\n')

		expect(parse_lsof(output)).toStrictEqual(
			new Map([
				[12, `${LANE}/packages/app`],
				[13, '/tmp'],
			]),
		)
	})
})

describe('run_board_usage_read.lane_of', () => {
	it('finds the lane a directory sits under at any depth, and none outside a lane', () => {
		expect(lane_of(LANE, ROOT)).toBe('3423')
		expect(lane_of(`${LANE}/packages/app/src`, ROOT)).toBe('3423')
		expect(lane_of('/Users/me/Development/kit', ROOT)).toBeUndefined()
	})

	it('finds no lane under another repository’s lanes root of the same number', () => {
		expect(lane_of('/Users/me/Development/.app-kit-lanes/3423/src', ROOT)).toBeUndefined()
	})
})

function ports_of(
	listings: Array<string>,
	directories: ReadonlyMap<number, string>,
	rusage?: RusageReader,
): UsagePorts {
	return {
		list: vi.fn(async () => listings.shift() ?? ''),
		rusage,
		directories: vi.fn(async (_pids: ReadonlyArray<number>) => directories),
		now: () => 0,
		root: ROOT,
	}
}

describe('run_board_usage_read.sample', () => {
	it('looks up only the processes not seen before, and drops one that is gone', async () => {
		const directories = new Map([
			[1, LANE],
			[2, '/tmp'],
			[3, `${LANE}/src`],
		])
		const ports = ports_of(['1 0 0:01 4\n2 0 0:01 4', '1 0 0:02 4\n3 1 0:01 4'], directories)
		const first = await sample(undefined, ports)
		const second = await sample(first, ports)

		expect(ports.directories).toHaveBeenNthCalledWith(1, [1, 2])
		expect(ports.directories).toHaveBeenNthCalledWith(2, [3])
		expect(first.lanes).toStrictEqual(
			new Map([
				[1, '3423'],
				[2, undefined],
			]),
		)
		expect(second.lanes).toStrictEqual(
			new Map([
				[1, '3423'],
				[3, '3423'],
			]),
		)
	})

	it('runs no lookup when every process was seen before', async () => {
		const ports = ports_of(['1 0 0:01 4', '1 0 0:02 4'], new Map([[1, LANE]]))

		await sample(await sample(undefined, ports), ports)

		expect(ports.directories).toHaveBeenCalledTimes(1)
	})
})

// joshuafolkken/kit#3529: a child born and gone between two samples lands in its parent's count.
describe('run_board_usage_read.sample with reaped children', () => {
	it('reads the CPU time with reaped children where it can, and keeps every process’s parent', async () => {
		const rusage = vi.fn((pid: number) => (pid === 1 ? 5000 : undefined))
		const ports = ports_of([PARENT_AND_CHILD], new Map([[1, LANE]]), rusage)
		const mark = await sample(undefined, ports)

		expect(mark.processes.get(1)).toStrictEqual({ cpu_ms: 5000, rss_bytes: 4 * KB })
		expect(mark.processes.get(2)?.cpu_ms).toBe(1000)
		expect(mark.parents).toStrictEqual(
			new Map([
				[1, 7],
				[2, 1],
			]),
		)
		expect(mark.folded).toStrictEqual(new Set([1]))
	})

	it('keeps a process’s last folded reading while its read fails, so its reaped children are not counted twice', async () => {
		// The child's one read holds a minute of its reaped children's time; its next read fails.
		const child_reads = [60_000]
		const rusage = vi.fn((pid: number) => (pid === 2 ? child_reads.shift() : 1000))
		const ports = ports_of([PARENT_AND_CHILD, '1 7 0:01 4\n2 1 0:02 4'], new Map(), rusage)
		const second = await sample(await sample(undefined, ports), ports)

		expect(second.processes.get(2)?.cpu_ms).toBe(60_000)
		expect(second.folded.has(2)).toBe(false)
	})

	it('keeps ps’s own time and no parent where there is no reader', async () => {
		const mark = await sample(undefined, ports_of(['1 7 0:01 4'], new Map([[1, LANE]])))

		expect(mark.processes.get(1)?.cpu_ms).toBe(1000)
		expect(mark.parents.size).toBe(0)
		expect(mark.folded.size).toBe(0)
	})
})

describe('run_board_usage_read.usage_reader', () => {
	it('reads nothing on a platform with no way to a process’s working directory', async () => {
		await expect(usage_reader('win32')(undefined)).resolves.toBeUndefined()
	})

	it('reads nothing on Linux, whose ps counts CPU time in whole seconds', async () => {
		await expect(usage_reader('linux')(undefined)).resolves.toBeUndefined()
	})

	it('resolves the board’s lanes root once, and reads nothing outside a repository', async () => {
		const root = vi
			.spyOn(lane_registry, 'main_repository_root')
			.mockRejectedValue(new Error('none'))
		const read = usage_reader('darwin')

		await expect(read(undefined)).resolves.toBeUndefined()
		await expect(read(undefined)).resolves.toBeUndefined()

		expect(root).toHaveBeenCalledTimes(1)
	})
})
