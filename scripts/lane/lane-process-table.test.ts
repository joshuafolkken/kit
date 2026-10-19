import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_process_table } from './lane-process-table'
import { lane_reap } from './lane-reap'

// joshuafolkken/kit#4241: one asynchronous `ps` answers every probe a lane's tree and states need.

const run_ps = vi.hoisted(() => vi.fn<() => Promise<{ stdout: string }>>())

vi.mock('execa', () => ({ execa: run_ps }))

const LANE_PATTERN = 'fullrun #4241$'
const LISTING = [
	'    1     0 Ss   /sbin/launchd',
	'  500     1 S    claude -p fullrun #4241',
	'  501   500 TN   node  gate  --fast',
	'  502   500 Z    <defunct>',
	'not a process row',
	'  503   x   S    broken parent',
	'  504   1   S',
	'',
].join('\n')

const LAUNCHD = 1
const LANE = 500
const GATE = 501
const ZOMBIE = 502
const UNLISTED = 999

afterEach(() => {
	vi.clearAllMocks()
})

describe('lane_process_table.parse', () => {
	it('reads each row, keeping a command with spaces and dropping a broken line', () => {
		expect(lane_process_table.parse(LISTING)).toEqual([
			{ pid: LAUNCHD, parent: 0, stat: 'Ss', command: '/sbin/launchd' },
			{ pid: LANE, parent: LAUNCHD, stat: 'S', command: 'claude -p fullrun #4241' },
			{ pid: GATE, parent: LANE, stat: 'TN', command: 'node gate --fast' },
			{ pid: ZOMBIE, parent: LANE, stat: 'Z', command: '<defunct>' },
		])
	})
})

describe('lane_process_table.probes_of', () => {
	const probes = lane_process_table.probes_of(lane_process_table.parse(LISTING))

	it('matches the full command line by pattern, as `pgrep -f` does', () => {
		expect(probes.matching(LANE_PATTERN)).toEqual([LANE])
		expect(probes.matching('fullrun #424$')).toEqual([])
	})

	it('answers children and parents from the snapshot', () => {
		expect(probes.children_of(LANE)).toEqual([GATE, ZOMBIE])
		expect(probes.parent_of(GATE)).toBe(LANE)
		expect(probes.parent_of(UNLISTED)).toBeUndefined()
	})

	it('answers the states of the listed pids, leaving an unlisted one out', () => {
		expect(probes.states_of([GATE, UNLISTED, ZOMBIE])).toEqual(['TN', 'Z'])
	})
})

describe('lane_process_table.read', () => {
	it('runs one `ps` over every process and answers from its listing', async () => {
		run_ps.mockResolvedValueOnce({ stdout: LISTING })

		const probes = await lane_process_table.read()

		expect(probes?.matching(LANE_PATTERN)).toEqual([LANE])
		expect(run_ps).toHaveBeenCalledTimes(1)
		expect(run_ps).toHaveBeenCalledWith(
			lane_reap.PS_COMMAND,
			lane_process_table.PS_ARGUMENTS,
			expect.any(Object),
		)
	})

	it('answers undefined when `ps` fails', async () => {
		run_ps.mockRejectedValueOnce(new Error('ps failed'))

		await expect(lane_process_table.read()).resolves.toBeUndefined()
	})

	it('refuses a missing `ps` by name rather than reading it as no process', async () => {
		run_ps.mockRejectedValueOnce(
			Object.assign(new Error('spawn /bin/ps ENOENT'), { code: 'ENOENT' }),
		)

		await expect(lane_process_table.read()).rejects.toThrow(/`ps` is not installed/u)
	})
})
