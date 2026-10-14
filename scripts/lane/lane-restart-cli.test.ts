import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_dispatch, type DispatchOutcome } from './lane-dispatch'
import { lane_restart, type RestartOutcome } from './lane-restart'
import { lane_restart_cli } from './lane-restart-cli'

// joshuafolkken/kit#3772: `josh lane:restart` keeps `lane:dispatch`'s contract — the fresh child's pid
// is the one token on standard output, and a restart that started no fresh child exits non-zero.

const ISSUE = '3769'
const PID = 4242
const SUCCESS = 0
const FAILURE = 1

const DISPATCHED = { kind: 'dispatched', pid: PID, notes: [] } as unknown as DispatchOutcome
const FAILED = { kind: 'failed', note: 'boom' } as unknown as DispatchOutcome

const restart = vi.spyOn(lane_restart, 'restart')
const warn_of_problem = vi.spyOn(lane_dispatch, 'warn_of_problem')
const info = vi.spyOn(console, 'info')

vi.spyOn(lane_restart, 'describe').mockReturnValue('restart described')
vi.spyOn(console, 'error').mockImplementation(vi.fn())

function restarted(dispatch: DispatchOutcome): RestartOutcome {
	return { kind: 'restarted', dispatch, stash: undefined }
}

beforeEach(() => {
	vi.clearAllMocks()
	warn_of_problem.mockResolvedValue()
	info.mockImplementation(vi.fn())
})

describe('lane_restart_cli.run', () => {
	it('prints the fresh child pid alone on stdout and exits zero', async () => {
		restart.mockResolvedValue(restarted(DISPATCHED))

		expect(await lane_restart_cli.run([ISSUE])).toBe(SUCCESS)
		expect(info.mock.calls).toStrictEqual([[String(PID)]])
		expect(warn_of_problem).not.toHaveBeenCalled()
	})

	it('warns and exits non-zero without a pid when the fresh dispatch failed', async () => {
		restart.mockResolvedValue(restarted(FAILED))

		expect(await lane_restart_cli.run([ISSUE])).toBe(FAILURE)
		expect(warn_of_problem).toHaveBeenCalledWith(FAILED, ISSUE)
		expect(info).not.toHaveBeenCalled()
	})

	it('exits non-zero when no child was running to restart', async () => {
		restart.mockResolvedValue({ kind: 'not-running' })

		expect(await lane_restart_cli.run([ISSUE])).toBe(FAILURE)
		expect(info).not.toHaveBeenCalled()
	})

	it('refuses a missing or malformed issue without restarting anything', async () => {
		expect(await lane_restart_cli.run([])).toBe(FAILURE)
		expect(await lane_restart_cli.run(['abc'])).toBe(FAILURE)
		expect(restart).not.toHaveBeenCalled()
	})
})
