import type { AgentProfile } from '#scripts/agent/agent-role-profile'
import type { CarryRead, RunCarry } from '#scripts/run/carry/run-carry'
import type { EndedRun } from '#scripts/run/carry/run-carry-ended'
import { describe, expect, it, vi } from 'vitest'
import { backlogrun_restart, type RestartPorts } from './backlogrun-restart'
import type { StopReport } from './backlogrun-stop'

// joshuafolkken/kit#4154: `josh backlogrun --restart` replaces the run's processes and keeps its record,
// so the budget, the counters and the named list carry over to the supervisor it starts.

const GIT_DIRECTORY = '/repo/.git'
const OWN_SESSION_PID = 777
const INVOCATION = 'backlogrun #3437 #3438 --only'
const KEPT_LINE = "backlogrun: kept the run's record"
const CARRY: RunCarry = {
	invocation: INVOCATION,
	started_at: '2026-10-12T09:00:00.000Z',
	merged: 1,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}
const CARRIED: CarryRead = { kind: 'carried', carry: CARRY }
const ENDED: EndedRun = {
	invocation: INVOCATION,
	started_at: CARRY.started_at,
	ended_at: '2026-10-12T11:00:00.000Z',
	stopped: 'stopped by a person with `josh backlogrun --stop`',
}
const KEPT: StopReport = {
	supervisor: 4242,
	parent: 42,
	session: undefined,
	record: { kind: 'kept' },
	lanes: ['3437'],
}
const KEPT_LINES = [
	'backlogrun: stopped the supervisor (process 4242)',
	'backlogrun: stopped the parent session (process 42)',
	KEPT_LINE,
	'backlogrun: 1 lane(s) still running, not stopped: #3437 — suspend them in place with `josh lane:pause --all`',
]

const PROFILE: AgentProfile = {
	provider: 'openai',
	role: 'scheduler',
	model: 'gpt-5',
	effort: 'low',
}

interface Stage {
	read?: CarryRead
	ended?: EndedRun
	report?: StopReport
	start_exit?: number
}

function harness(stage: Stage = {}): { ports: RestartPorts; lines: Array<string> } {
	const lines: Array<string> = []
	const ports: RestartPorts = {
		read_carry: vi.fn((): CarryRead => stage.read ?? { kind: 'none' }),
		read_ended: vi.fn(() => stage.ended),
		read_profile: vi.fn(() => PROFILE),
		stop: vi.fn(async () => stage.report ?? KEPT),
		start_supervisor: vi.fn(() => stage.start_exit ?? 0),
		show_board: vi.fn(async () => 0),
		write: (line) => {
			lines.push(line)
		},
	}

	return { ports, lines }
}

describe('backlogrun_restart.restart — a run with a record', () => {
	it('stops the processes, keeps the record, starts the supervisor and shows the board', async () => {
		const { ports, lines } = harness({ read: CARRIED })

		await expect(backlogrun_restart.restart(GIT_DIRECTORY, ports)).resolves.toBe(0)
		expect(ports.stop).toHaveBeenCalledExactlyOnceWith(GIT_DIRECTORY)
		expect(ports.stop).toHaveBeenCalledBefore(vi.mocked(ports.start_supervisor))
		expect(ports.show_board).toHaveBeenCalledOnce()
		expect(lines).toStrictEqual(KEPT_LINES)
	})

	it('starts the supervisor on the profile of the one it stopped, read before the stop', async () => {
		const { ports } = harness({ read: CARRIED })

		await backlogrun_restart.restart(GIT_DIRECTORY, ports)
		expect(ports.read_profile).toHaveBeenCalledBefore(vi.mocked(ports.stop))
		expect(ports.start_supervisor).toHaveBeenCalledExactlyOnceWith(GIT_DIRECTORY, PROFILE)
	})

	it('restarts a standing record whose owner is gone', async () => {
		const standing: StopReport = { ...KEPT, supervisor: undefined, parent: undefined }
		const { ports, lines } = harness({ read: CARRIED, report: standing })

		await expect(backlogrun_restart.restart(GIT_DIRECTORY, ports)).resolves.toBe(0)
		expect(lines[0]).toBe(KEPT_LINE)
		expect(ports.start_supervisor).toHaveBeenCalledOnce()
	})
})

describe('backlogrun_restart.restart — a run it cannot restart', () => {
	it('refuses with the pid where the owner is a session it may not signal', async () => {
		const held: StopReport = { ...KEPT, record: { kind: 'held', owner: OWN_SESSION_PID } }
		const { ports, lines } = harness({ read: CARRIED, report: held })

		await expect(backlogrun_restart.restart(GIT_DIRECTORY, ports)).resolves.toBe(1)
		expect(lines.join('\n')).toContain('process 777 owns the run')
		expect(ports.start_supervisor).not.toHaveBeenCalled()
		expect(ports.show_board).not.toHaveBeenCalled()
	})

	it('exits 1 without a board when the supervisor does not start', async () => {
		const { ports, lines } = harness({ read: CARRIED, start_exit: 1 })

		await expect(backlogrun_restart.restart(GIT_DIRECTORY, ports)).resolves.toBe(1)
		expect(lines.at(-1)).toBe('backlogrun: could not start the supervisor')
		expect(ports.show_board).not.toHaveBeenCalled()
	})
})

describe('backlogrun_restart.restart — no record to restart', () => {
	it('says there is nothing to restart where no run has been here', async () => {
		const { ports, lines } = harness()

		await expect(backlogrun_restart.restart(GIT_DIRECTORY, ports)).resolves.toBe(1)
		expect(lines).toStrictEqual(['backlogrun: nothing to restart'])
		expect(ports.stop).not.toHaveBeenCalled()
	})

	it('names the invocation that starts an ended run again, as the shell takes it', async () => {
		const { ports, lines } = harness({ ended: ENDED })

		await expect(backlogrun_restart.restart(GIT_DIRECTORY, ports)).resolves.toBe(1)
		expect(lines).toStrictEqual([
			'backlogrun: the run has ended; start it again with `pnpm josh backlogrun 3437 3438 --only`',
		])
		expect(ports.stop).not.toHaveBeenCalled()
		expect(ports.start_supervisor).not.toHaveBeenCalled()
	})

	it('refuses a record that cannot be read', async () => {
		const { ports, lines } = harness({ read: { kind: 'unreadable' }, ended: ENDED })

		await expect(backlogrun_restart.restart(GIT_DIRECTORY, ports)).resolves.toBe(1)
		expect(lines).toStrictEqual(["backlogrun: the run's record could not be read"])
		expect(ports.stop).not.toHaveBeenCalled()
	})
})
