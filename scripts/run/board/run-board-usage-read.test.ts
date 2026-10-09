import { lane_registry } from '#scripts/lane/lane-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_usage_read, type UsagePorts } from './run-board-usage-read'

// joshuafolkken/kit#3489: how the board reads each process and its lane — `ps` every second, the
// working directory only for a process not seen before, and nothing where the platform has no way to it.

const { lane_of, parse_lsof, parse_ps, sample, usage_reader } = run_board_usage_read
const KB = 1024
const ROOT = '/Users/me/Development/.kit-lanes'
const LANE = `${ROOT}/3423`

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_usage_read.parse_ps', () => {
	it('reads every process’s CPU time and resident memory, and skips a line that is not one', () => {
		const output = [
			'  PID TIME RSS',
			'  12 1-02:03:04 2048',
			'13 12:34.50 100',
			' 14 0:00.01 4',
		].join('\n')
		const readings = parse_ps(output)

		expect([...readings.keys()]).toStrictEqual([12, 13, 14])
		expect(readings.get(12)).toStrictEqual({ cpu_ms: 93_784_000, rss_bytes: 2048 * KB })
		expect(readings.get(13)?.cpu_ms).toBe(754_500)
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

function ports_of(listings: Array<string>, directories: ReadonlyMap<number, string>): UsagePorts {
	return {
		list: vi.fn(async () => listings.shift() ?? ''),
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
		const ports = ports_of(['1 0:01 4\n2 0:01 4', '1 0:02 4\n3 0:01 4'], directories)
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
		const ports = ports_of(['1 0:01 4', '1 0:02 4'], new Map([[1, LANE]]))

		await sample(await sample(undefined, ports), ports)

		expect(ports.directories).toHaveBeenCalledTimes(1)
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
