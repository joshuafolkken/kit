import type { CarryRead, RunCarry } from '#scripts/run/carry/run-carry'
import type { LaunchResult } from '#scripts/run/detached-launch'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it, vi } from 'vitest'
import { backlogrun_cli, type BacklogrunPorts } from './backlogrun-cli'
import type { StartResult } from './backlogrun-launch'
import { backlogrun_replace, type ReplaceVerdict } from './backlogrun-replace'
import type { StopReport } from './backlogrun-stop'

// joshuafolkken/kit#3437: a run already going is shown, never joined; otherwise one is started and shown.

const GIT_DIRECTORY = '/repo/.git'
const DRAINED_AT = '2026-10-12T10:00:00.000Z'
const CARRY: RunCarry = {
	invocation: 'backlogrun',
	started_at: '2026-10-12T09:00:00.000Z',
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}
const LAUNCHED: StartResult = {
	kind: 'launched',
	launched: { pid: 42, session: 'session-1', log_path: '/state/josh-backlogrun-log.log' },
}
const STOPPED: StopReport = {
	supervisor: 4242,
	parent: undefined,
	session: undefined,
	record: { kind: 'ended' },
	lanes: ['3701'],
}
const BOARD_LINE = 'backlogrun: a run is already going; showing its board.'
const SAME: ReplaceVerdict = { kind: 'same' }
const REPLACE: ReplaceVerdict = { kind: 'replace' }
const REPLACING_LINE = 'backlogrun: replacing the idle run with `backlogrun #3724 --only`'
const STARTED_LINE =
	'backlogrun: started (pid 42, session session-1); log /state/josh-backlogrun-log.log'
const SUPERVISED: LaunchResult = { kind: 'launched', pid: 4343 }
const SUPERVISED_LINE = 'backlogrun: supervisor started (pid 4343)'
const STOPPED_LINES = [
	'backlogrun: stopped the supervisor (process 4242)',
	"backlogrun: ended the run's record",
	'backlogrun: 1 lane(s) still running, not stopped: #3701',
]

function harness(
	is_running: boolean,
	started: StartResult = LAUNCHED,
): { ports: BacklogrunPorts; lines: Array<string> } {
	const lines: Array<string> = []
	const ports: BacklogrunPorts = {
		repository_directory: vi.fn(async () => GIT_DIRECTORY),
		is_running: vi.fn(() => is_running),
		replacement: vi.fn(async () => SAME),
		start: vi.fn(() => started),
		start_supervisor: vi.fn((): LaunchResult => SUPERVISED),
		stop: vi.fn(async () => STOPPED),
		show_board: vi.fn(async () => 0),
		write: (line) => {
			lines.push(line)
		},
	}

	return { ports, lines }
}

describe('backlogrun_cli.run', () => {
	it('shows the board of a run already going and points named issues at run:add', async () => {
		const { ports, lines } = harness(true)

		await expect(backlogrun_cli.run(['#3437', '#3438'], ports)).resolves.toBe(0)
		expect(ports.start).not.toHaveBeenCalled()
		expect(ports.show_board).toHaveBeenCalledOnce()
		expect(lines).toContain('  pnpm josh run:add 3437')
		expect(lines).toContain('  pnpm josh run:add 3438')
	})

	it('starts the run in the main checkout and then shows the board', async () => {
		const { ports, lines } = harness(false)

		await expect(backlogrun_cli.run(['#3437', '--only'], ports)).resolves.toBe(0)
		expect(ports.start).toHaveBeenCalledExactlyOnceWith(
			{ provider: 'anthropic', invocation: 'backlogrun #3437 --only', issues: [3437] },
			{ worktree: '/repo', git_directory: GIT_DIRECTORY },
		)
		expect(lines.join('\n')).toContain('pid 42, session session-1')
		expect(ports.show_board).toHaveBeenCalledOnce()
	})
})

// joshuafolkken/kit#3804: the parent's Bash tool passes no token on, so the supervisor is started here.
describe('backlogrun_cli.run starting the supervisor', () => {
	it('starts the supervisor from this process once the parent is launched', async () => {
		const { ports, lines } = harness(false)

		await expect(backlogrun_cli.run(['3804'], ports)).resolves.toBe(0)
		expect(ports.start_supervisor).toHaveBeenCalledExactlyOnceWith(GIT_DIRECTORY, 'anthropic')
		expect(ports.start).toHaveBeenCalledBefore(vi.mocked(ports.start_supervisor))
		expect(lines).toStrictEqual([STARTED_LINE, SUPERVISED_LINE])
	})

	it('says a supervisor that did not start and still shows the board', async () => {
		const { ports, lines } = harness(false)
		const failed: LaunchResult = { kind: 'failed', note: 'claude is not on PATH' }
		const unsupervised = { ...ports, start_supervisor: vi.fn(() => failed) }

		await expect(backlogrun_cli.run(['3804'], unsupervised)).resolves.toBe(0)
		expect(lines[1]).toBe('backlogrun: could not start the supervisor: claude is not on PATH')
		expect(ports.show_board).toHaveBeenCalledOnce()
	})

	it('starts no supervisor when the parent could not be launched', async () => {
		const { ports } = harness(false, { kind: 'failed', note: 'no agent' })

		await expect(backlogrun_cli.run(['3804'], ports)).resolves.toBe(1)
		expect(ports.start_supervisor).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#3729: an idle run is stopped and the typed invocation started in its place.
describe('backlogrun_cli.run replacing an idle run', () => {
	it('stops the idle run, starts the typed one and says both before the board', async () => {
		const { ports, lines } = harness(true)
		const idle = { ...ports, replacement: vi.fn(async () => REPLACE) }

		await expect(backlogrun_cli.run(['3724', '--only'], idle)).resolves.toBe(0)
		expect(idle.replacement).toHaveBeenCalledExactlyOnceWith(
			'backlogrun #3724 --only',
			GIT_DIRECTORY,
		)
		expect(ports.stop).toHaveBeenCalledExactlyOnceWith(GIT_DIRECTORY)
		expect(lines).toStrictEqual([REPLACING_LINE, ...STOPPED_LINES, STARTED_LINE, SUPERVISED_LINE])
		expect(ports.show_board).toHaveBeenCalledOnce()
	})
})

// joshuafolkken/kit#3733: a lane a past run left behind — open on disk, nobody in it — kept a watching
// run from being replaced. The verdict here is the real one, read over a watching run's record.
describe('backlogrun_cli.run beside a leftover lane', () => {
	const WATCHING = {
		read_carry: (): CarryRead => ({ kind: 'carried', carry: CARRY }),
		events: (): Array<RunEvent> => [{ pos: 1, at: DRAINED_AT, kind: 'drain', text: 'drained' }],
		is_retrospective_owed: (): boolean => false,
	}

	function beside(in_use: ReadonlyArray<string>): BacklogrunPorts['replacement'] {
		const replace_ports = {
			...WATCHING,
			pending_invocation: (): undefined => undefined,
			lanes: async () => ({ working: [...in_use], unread: [] }),
		}

		return async (invocation, git_directory) =>
			await backlogrun_replace.decide(invocation, git_directory, replace_ports)
	}

	it('stops the watching run and starts the typed one when no child is in the lane', async () => {
		const { ports, lines } = harness(true)
		const idle = { ...ports, replacement: beside([]) }

		await expect(backlogrun_cli.run(['3724', '--only'], idle)).resolves.toBe(0)
		expect(ports.stop).toHaveBeenCalledBefore(vi.mocked(ports.start))
		expect(lines).toStrictEqual([REPLACING_LINE, ...STOPPED_LINES, STARTED_LINE, SUPERVISED_LINE])
	})

	it('keeps the run and names the lane a child is working in, above the board', async () => {
		const { ports, lines } = harness(true)
		const busy = { ...ports, replacement: beside(['3701']) }

		await expect(backlogrun_cli.run(['3724', '--only'], busy)).resolves.toBe(0)
		expect(ports.stop).not.toHaveBeenCalled()
		expect(lines[0]).toBe(
			'backlogrun: not replacing the run — a child is still working in the lane for #3701 (`pnpm josh lane:close <N>` discards a lane)',
		)
		expect(ports.show_board).toHaveBeenCalledOnce()
	})
})

describe('backlogrun_cli.run keeping a run', () => {
	it('stops nothing and only shows the board when the run is not replaceable', async () => {
		const { ports, lines } = harness(true)

		await expect(backlogrun_cli.run(['3724'], ports)).resolves.toBe(0)
		expect(ports.stop).not.toHaveBeenCalled()
		expect(ports.start).not.toHaveBeenCalled()
		expect(lines).toContain('  pnpm josh run:add 3724')
		expect(ports.show_board).toHaveBeenCalledOnce()
	})
})

// joshuafolkken/kit#3733: a kept run looked the same whichever condition kept it.
describe('backlogrun_cli.run saying why a run is kept', () => {
	it.each([
		'the run still owes its retrospective',
		'the run is not watching: it is still starting or has a child at work',
		"the run's record could not be read",
		'the run is still starting: it has not written its record yet',
	])('says why it did not replace the run before the board: %s', async (reason) => {
		const { ports, lines } = harness(true)
		const kept = {
			...ports,
			replacement: async (): Promise<ReplaceVerdict> => ({ kind: 'keep', reason }),
		}

		await expect(backlogrun_cli.run(['3724'], kept)).resolves.toBe(0)
		expect(lines[0]).toBe(`backlogrun: not replacing the run — ${reason}`)
		expect(lines[1]).toBe(BOARD_LINE)
	})

	it('adds no reason when the board is reopened with the same invocation', async () => {
		const { ports, lines } = harness(true)

		await expect(backlogrun_cli.run([], ports)).resolves.toBe(0)
		expect(lines).toStrictEqual([BOARD_LINE])
	})
})

describe('backlogrun_cli.run replacing nothing', () => {
	it('starts nothing and exits 1 when the owner cannot be stopped', async () => {
		const { ports, lines } = harness(true)
		const held: StopReport = { ...STOPPED, record: { kind: 'held', owner: 777 } }
		const kept = { ...ports, replacement: async () => REPLACE, stop: async () => held }

		await expect(backlogrun_cli.run(['3724'], kept)).resolves.toBe(1)
		expect(lines.join('\n')).toContain('process 777 owns the run')
		expect(ports.start).not.toHaveBeenCalled()
		expect(ports.show_board).not.toHaveBeenCalled()
	})

	it('never asks whether to replace when no run is going', async () => {
		const { ports } = harness(false)

		await expect(backlogrun_cli.run(['3724'], ports)).resolves.toBe(0)
		expect(ports.replacement).not.toHaveBeenCalled()
		expect(ports.stop).not.toHaveBeenCalled()
	})
})

describe('backlogrun_cli.run refusal', () => {
	it('exits 1 without a board when the agent cannot start', async () => {
		const { ports, lines } = harness(false, { kind: 'failed', note: 'no claude' })

		await expect(backlogrun_cli.run([], ports)).resolves.toBe(1)
		expect(lines).toStrictEqual(['backlogrun: could not start: no claude'])
		expect(ports.show_board).not.toHaveBeenCalled()
	})

	it('refuses bad arguments with the usage before reading anything', async () => {
		const { ports, lines } = harness(false)

		await expect(backlogrun_cli.run(['--agent', 'gemini'], ports)).resolves.toBe(1)
		expect(lines[0]).toMatch(/^Usage: josh backlogrun \[<n>\.\.\.\] /u)
		expect(ports.repository_directory).not.toHaveBeenCalled()
	})

	it('exits 1 outside a git repository', async () => {
		const { ports } = harness(false)
		const outside = { ...ports, repository_directory: async () => undefined }

		await expect(backlogrun_cli.run([], outside)).resolves.toBe(1)
		expect(ports.start).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#3708: `--stop` stops the run in this repository; it starts nothing and draws no board.
describe('backlogrun_cli.run --stop', () => {
	it('stops the run and says what it stopped, with no start and no board', async () => {
		const { ports, lines } = harness(true)

		await expect(backlogrun_cli.run(['--stop'], ports)).resolves.toBe(0)
		expect(ports.stop).toHaveBeenCalledExactlyOnceWith(GIT_DIRECTORY)
		expect(lines).toStrictEqual(STOPPED_LINES)
		expect(ports.start).not.toHaveBeenCalled()
		expect(ports.show_board).not.toHaveBeenCalled()
	})

	it('exits 1 when the run is left with an owner it did not start', async () => {
		const { ports } = harness(true)
		const held: StopReport = { ...STOPPED, record: { kind: 'held', owner: 777 } }
		const kept = { ...ports, stop: async () => held }

		await expect(backlogrun_cli.run(['--stop'], kept)).resolves.toBe(1)
	})

	it('stops nothing and prints the usage when --stop is given with anything else', async () => {
		const { ports, lines } = harness(true)

		await expect(backlogrun_cli.run(['--stop', '#3437'], ports)).resolves.toBe(1)
		expect(lines).toStrictEqual([expect.stringMatching(/^Usage: josh backlogrun .* \| --stop$/u)])
		expect(ports.stop).not.toHaveBeenCalled()
	})
})
