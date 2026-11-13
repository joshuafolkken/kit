import { spawnSync } from 'node:child_process'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { PROCESS_ALIVE, PROCESS_NONE, PROCESS_UNKNOWN } from '#scripts/run/run-liveness'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_await } from './lane-await'
import { lane_process_table } from './lane-process-table'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))

// joshuafolkken/kit#3400. Only pgrep's own "no match" exit is `none`: a probe that failed or hit its
// timeout never looked, so `run:liveness` must not book it as no process.

const ISSUE = '3400'
const PGREP_ERROR = 2
// eslint-disable-next-line unicorn/no-null -- spawnSync reports a probe killed by its timeout as null
const KILLED: number | null = null

function arrange_pgrep(status: number | null): void {
	vi.mocked(spawnSync).mockReturnValue({
		output: [],
		pid: 0,
		signal: 'SIGTERM',
		status,
		stderr: '',
		stdout: '',
	})
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(undefined)
})

describe('process_trace_default', () => {
	it.each([
		[0, PROCESS_ALIVE],
		[1, PROCESS_NONE],
		[PGREP_ERROR, PROCESS_UNKNOWN],
		[KILLED, PROCESS_UNKNOWN],
	])('answers pgrep status %s as %s', (status, trace) => {
		arrange_pgrep(status)

		expect(lane_await.process_trace_default(ISSUE)).toBe(trace)
	})

	it('answers a running detached ship as alive even when pgrep could not look', () => {
		arrange_pgrep(KILLED)
		vi.spyOn(git_common_directory, 'repository').mockReturnValue(process.cwd())
		vi.spyOn(run_ship_detach, 'read_result').mockReturnValue({
			launch_id: 'active',
			result: 'running',
		})

		expect(lane_await.process_trace_default(ISSUE)).toBe(PROCESS_ALIVE)
	})

	// joshuafolkken/kit#3799 — a pgrep that is not installed never looked, and says so by name.
	it('refuses a pgrep that is not installed, naming it', () => {
		vi.mocked(spawnSync).mockReturnValue({
			error: Object.assign(new Error('spawnSync pgrep ENOENT'), { code: 'ENOENT' }),
			output: [],
			pid: 0,
			signal: KILLED,
			status: KILLED,
			stderr: '',
			stdout: '',
		})

		expect(() => lane_await.process_trace_default(ISSUE)).toThrow('`pgrep` is not installed')
	})
})

const OTHER_PID = 7477
const PARENT_PID = 7478

function process_row(pid: number, parent: number, command = 'node'): string {
	return `${String(pid)} ${String(parent)} 00:00 0 S Fri Nov 13 00:00:00 2026 ${command}`
}

describe('other_process_trace for repair entry', () => {
	it('excludes the requesting worker above the CLI process', async () => {
		vi.spyOn(lane_process_table, 'read_table').mockResolvedValue(
			lane_process_table.parse(
				[
					process_row(process.pid, PARENT_PID),
					process_row(PARENT_PID, 1, `agent fullrun #${ISSUE}`),
				].join('\n'),
			),
		)

		expect(await lane_await.other_process_trace(ISSUE)).toBe(PROCESS_NONE)
	})

	it.each(['agent fullrun', 'agent the reviewer of lane', 'josh ship title'])(
		'preserves another matching owner: %s',
		async (command) => {
			vi.spyOn(lane_process_table, 'read_table').mockResolvedValue(
				lane_process_table.parse(
					[
						process_row(process.pid, 1, `agent fullrun #${ISSUE}`),
						process_row(OTHER_PID, 1, `${command} #${ISSUE}`),
					].join('\n'),
				),
			)

			expect(await lane_await.other_process_trace(ISSUE)).toBe(PROCESS_ALIVE)
		},
	)

	it.each([undefined, []])('refuses unreadable or incomplete process rows (%s)', async (rows) => {
		vi.spyOn(lane_process_table, 'read_table').mockResolvedValue(rows)

		expect(await lane_await.other_process_trace(ISSUE)).toBe(PROCESS_UNKNOWN)
	})
})
