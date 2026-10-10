import { describe, expect, it, vi } from 'vitest'
import { backlogrun_cli, type BacklogrunPorts } from './backlogrun-cli'
import type { StartResult } from './backlogrun-launch'

// joshuafolkken/kit#3437: a run already going is shown, never joined; otherwise one is started and shown.

const GIT_DIRECTORY = '/repo/.git'
const LAUNCHED: StartResult = {
	kind: 'launched',
	launched: { pid: 42, session: 'session-1', log_path: '/state/josh-backlogrun-log.log' },
}

function harness(
	is_running: boolean,
	started: StartResult = LAUNCHED,
): { ports: BacklogrunPorts; lines: Array<string> } {
	const lines: Array<string> = []
	const ports: BacklogrunPorts = {
		repository_directory: vi.fn(async () => GIT_DIRECTORY),
		is_running: vi.fn(() => is_running),
		start: vi.fn(() => started),
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
		expect(lines[0]).toMatch(/^Usage: josh backlogrun/u)
		expect(ports.repository_directory).not.toHaveBeenCalled()
	})

	it('exits 1 outside a git repository', async () => {
		const { ports } = harness(false)
		const outside = { ...ports, repository_directory: async () => undefined }

		await expect(backlogrun_cli.run([], outside)).resolves.toBe(1)
		expect(ports.start).not.toHaveBeenCalled()
	})
})
