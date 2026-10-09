import { spawnSync } from 'node:child_process'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { PROCESS_ALIVE, PROCESS_NONE, PROCESS_UNKNOWN } from '#scripts/run/run-liveness'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_await } from './lane-await'

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
})
