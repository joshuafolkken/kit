import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { detached_launch } from '#scripts/run/detached-launch'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive_unit } from './backlog-drive-unit'

const CWD = '/repo'
const GIT_DIRECTORY = '/repo/.git'
const LOG = `${GIT_DIRECTORY}/unit.log`
const BRIEF = 'the brief'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('backlog_drive_unit.log_path', () => {
	it('names the unit and the moment in the log file', () => {
		const path = backlog_drive_unit.log_path(GIT_DIRECTORY, 'split-7182', 1)

		expect(path).toContain('-split-7182-1.log')
	})
})

describe('backlog_drive_unit.request_of', () => {
	it('builds the scheduler child at the cwd with the given log', () => {
		vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
		const request = backlog_drive_unit.request_of(BRIEF, { environment: {}, cwd: CWD }, LOG)

		expect(request?.cwd).toBe(CWD)
		expect(request?.log_path).toBe(LOG)
		expect(JSON.stringify(request?.argv)).toContain(BRIEF)
	})

	it('answers undefined for a provider the environment refuses', () => {
		const environment = { JOSH_AGENT_PROVIDER: 'no-such-provider' }

		expect(backlog_drive_unit.request_of(BRIEF, { environment, cwd: CWD }, LOG)).toBeUndefined()
	})
})

describe('backlog_drive_unit.launch_attached', () => {
	it('waits on the unit through the attached launcher', async () => {
		const result = { kind: 'completed', pid: 1, exit_code: 0 } as const
		const launch = vi.spyOn(detached_launch, 'launch_attached').mockResolvedValue(result)
		const request = { argv: { command: 'claude', args: [] }, cwd: CWD, log_path: LOG }

		await expect(backlog_drive_unit.launch_attached(request)).resolves.toBe(result)
		expect(launch).toHaveBeenCalledWith(request, expect.any(Function))
	})
})
