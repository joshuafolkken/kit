import { process_identity } from '#scripts/josh/process-identity'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_process_table, type ProcessRow } from './lane-process-table'
import { lane_reap } from './lane-reap'

// joshuafolkken/kit#4241: one asynchronous `ps` answers every probe a lane's tree and states need.
// joshuafolkken/kit#4246: the same rows carry the usage columns' time and resident set, and a redraw
// reads them once for both.

const run_ps = vi.hoisted(() => vi.fn<() => Promise<{ stdout: string }>>())

vi.mock('execa', () => ({ execa: run_ps }))

const LANE_PATTERN = 'fullrun #4241$'
const START = 'Tue Oct 20 08:39:04 2026'
const EARLY_START = 'Tue Sep  8 08:39:04 2026'
const LISTING = [
	`    1     0 1-02:03:04  2048 Ss   ${EARLY_START} /sbin/launchd`,
	`  500     1   0:01.50   100 S    ${START} claude -p fullrun #4241`,
	`  501   500   0:00.01     4 TN   ${START} node  gate  --fast`,
	`  502   500   0:00.00     0 Z    ${START} <defunct>`,
	'not a process row',
	`  503   x     0:00.00     4 S    ${START} broken parent`,
	`  505   1     0:00.00     x S    ${START} broken resident set`,
	`  504   1     0:00.00     4 S    ${START}`,
	'',
].join('\n')

const LAUNCHD = 1
const LANE = 500
const GATE = 501
const ZOMBIE = 502
const UNLISTED = 999

function row(
	pid: number,
	parent: number,
	rest: Omit<ProcessRow, 'pid' | 'parent' | 'start'>,
	start = START,
): ProcessRow {
	return { pid, parent, start, ...rest }
}

afterEach(() => {
	vi.restoreAllMocks()
	vi.clearAllMocks()
})

describe('lane_process_table.parse', () => {
	it('reads each row with its time, resident set and start, keeping a command with spaces and dropping a broken line', () => {
		expect(lane_process_table.parse(LISTING)).toEqual([
			row(
				LAUNCHD,
				0,
				{ time: '1-02:03:04', rss_kb: 2048, stat: 'Ss', command: '/sbin/launchd' },
				EARLY_START,
			),
			row(LANE, LAUNCHD, {
				time: '0:01.50',
				rss_kb: 100,
				stat: 'S',
				command: 'claude -p fullrun #4241',
			}),
			row(GATE, LANE, { time: '0:00.01', rss_kb: 4, stat: 'TN', command: 'node gate --fast' }),
			row(ZOMBIE, LANE, { time: '0:00.00', rss_kb: 0, stat: 'Z', command: '<defunct>' }),
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
		expect(probes.children_of(GATE)).toEqual([])
		expect(probes.parent_of(GATE)).toBe(LANE)
		expect(probes.parent_of(UNLISTED)).toBeUndefined()
	})

	it('answers the states of the listed pids, leaving an unlisted one out', () => {
		expect(probes.states_of([GATE, UNLISTED, ZOMBIE])).toEqual(['TN', 'Z'])
	})

	it('answers children from an index built once, not a scan of every row per call', () => {
		const rows = lane_process_table.parse(LISTING)
		const filter = vi.spyOn(rows, 'filter')
		const indexed = lane_process_table.probes_of(rows)

		expect(indexed.children_of(LANE)).toEqual([GATE, ZOMBIE])
		expect(indexed.children_of(LAUNCHD)).toEqual([LANE])
		expect(filter).not.toHaveBeenCalled()
	})
})

describe('lane_process_table.read_table', () => {
	it('runs one `ps` over every process and answers its rows', async () => {
		run_ps.mockResolvedValueOnce({ stdout: LISTING })

		const table = await lane_process_table.read_table()

		expect(table?.map((listed) => listed.pid)).toEqual([LAUNCHD, LANE, GATE, ZOMBIE])
		expect(run_ps).toHaveBeenCalledTimes(1)
		expect(run_ps).toHaveBeenCalledWith(
			lane_reap.PS_COMMAND,
			lane_process_table.PS_ARGUMENTS,
			expect.any(Object),
		)
	})

	it('answers undefined when `ps` fails', async () => {
		run_ps.mockRejectedValueOnce(new Error('ps failed'))

		await expect(lane_process_table.read_table()).resolves.toBeUndefined()
	})

	it('refuses a missing `ps` by name rather than reading it as no process', async () => {
		run_ps.mockRejectedValueOnce(
			Object.assign(new Error('spawn /bin/ps ENOENT'), { code: 'ENOENT' }),
		)

		await expect(lane_process_table.read_table()).rejects.toThrow(/`ps` is not installed/u)
	})
})

describe('lane_process_table.probes_from', () => {
	it('answers the probes of the snapshot read', async () => {
		const probes = await lane_process_table.probes_from(async () =>
			lane_process_table.parse(LISTING),
		)

		expect(probes?.matching(LANE_PATTERN)).toEqual([LANE])
	})

	it('answers undefined where the snapshot could not be read', async () => {
		await expect(lane_process_table.probes_from(async () => undefined)).resolves.toBeUndefined()
	})
})

// joshuafolkken/kit#4245: a ship record's start time is compared against these rows, not another `ps`.
describe('lane_process_table.start_reader', () => {
	it('answers a listed process’s start as `ps -o lstart=` prints it, the day’s padding kept', () => {
		vi.spyOn(process_identity.START_PROBES, 'read_proc_start').mockReturnValue(undefined)
		const own_ps = vi.spyOn(process_identity.START_PROBES, 'read_ps_start')
		const read = lane_process_table.start_reader(lane_process_table.parse(LISTING))

		expect(read(LAUNCHD)).toBe(EARLY_START)
		expect(read(LANE)).toBe(START)
		expect(read(UNLISTED)).toBeUndefined()
		expect(own_ps).not.toHaveBeenCalled()
	})

	it('answers `/proc` first, as `process_identity.read_start` does', () => {
		vi.spyOn(process_identity.START_PROBES, 'read_proc_start').mockReturnValue('proc:42')
		const read = lane_process_table.start_reader(lane_process_table.parse(LISTING))

		expect(read(LANE)).toBe('proc:42')
	})
})

describe('lane_process_table.shared', () => {
	it('reads once however many callers ask, each answered the same snapshot', async () => {
		const table = lane_process_table.parse(LISTING)
		const read = vi.fn(async () => table)
		const shared = lane_process_table.shared(read)

		const answers = await Promise.all([shared(), shared()])

		expect(await shared()).toBe(table)
		expect(answers).toStrictEqual([table, table])
		expect(read).toHaveBeenCalledTimes(1)
	})

	it('reads nothing until asked', () => {
		const read = vi.fn(async () => undefined)

		lane_process_table.shared(read)

		expect(read).not.toHaveBeenCalled()
	})
})
