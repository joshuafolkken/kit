import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import type { LaunchRequest } from '#scripts/run/detached-launch'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_handoff_cli, type HandoffPorts } from './run-handoff-cli'

// joshuafolkken/kit#5352: `josh run:handoff` waits for a kickoff, detaches a run and hands backlogrun on.

const BRIEF_FILE = 'brief.md'
const BRIEF_FLAG = '--brief-file'
const ISSUE_URL = 'https://github.com/joshuafolkken/kit/issues/5400'
const FINAL = JSON.stringify({ type: 'result', result: `Filed ${ISSUE_URL}` })
const CLAUDE_SESSION = { CLAUDE_CODE_SESSION_ID: 'session', HOME: '/home' }
const PID = 42
const BRIEF_TEXT = 'Agreed brief'

interface Fake {
	ports: HandoffPorts
	lines: Array<string>
	requests: Array<LaunchRequest>
	backlogrun: ReturnType<typeof vi.fn>
}

function fake(overrides: Partial<HandoffPorts> = {}): Fake {
	const lines: Array<string> = []
	const requests: Array<LaunchRequest> = []
	const backlogrun = vi.fn(async () => 0)
	const ports: HandoffPorts = {
		environment: CLAUDE_SESSION,
		cwd: '/repo',
		now: () => 1,
		repository_directory: async () => '/repo/.git',
		tree_hold: async () => ({ kind: 'free' }),
		read_text: (target) => (target === BRIEF_FILE ? BRIEF_TEXT : FINAL),
		launch: (request) => {
			requests.push(request)

			return { kind: 'launched', pid: PID }
		},
		launch_attached: async (request) => {
			requests.push(request)

			return { kind: 'completed', pid: PID, exit_code: 0 }
		},
		backlogrun,
		write: (line) => {
			lines.push(line)
		},
		...overrides,
	}

	return { ports, lines, requests, backlogrun }
}

const NO_REPOSITORY: string | undefined = undefined
// The one refusal reached after the start line and the log path are printed.
const FAILED_START = 'a failed start'
const HELD = { issue: '12', taken_at: '2026-11-01T00:00:00.000Z', pid: PID }
const REFUSALS: ReadonlyArray<{
	why: string
	argv: ReadonlyArray<string>
	overrides: Partial<HandoffPorts>
}> = [
	{ why: 'a missing brief flag', argv: ['kickoff', 'new'], overrides: {} },
	{
		why: 'an unreadable brief',
		argv: ['kickoff', 'new', BRIEF_FLAG, BRIEF_FILE],
		overrides: { read_text: () => undefined },
	},
	{
		why: 'no git repository',
		argv: ['prrun', '#3', BRIEF_FLAG, BRIEF_FILE],
		overrides: { repository_directory: async () => NO_REPOSITORY },
	},
	{
		why: FAILED_START,
		argv: ['halfrun', '#3', BRIEF_FLAG, BRIEF_FILE],
		overrides: { launch: () => ({ kind: 'failed', note: 'spawn' }) },
	},
	{
		why: 'a working tree another run holds',
		argv: ['fullrun', '13', BRIEF_FLAG, BRIEF_FILE],
		overrides: { tree_hold: async () => ({ kind: 'held', hold: HELD }) },
	},
	{
		why: 'an unreadable working-tree hold',
		argv: ['fullrun', '13', BRIEF_FLAG, BRIEF_FILE],
		overrides: { tree_hold: async () => ({ kind: 'unreadable' }) },
	},
]

beforeEach(() => {
	vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_handoff_cli.run', () => {
	it('waits for kickoff and prints its final message and the URLs it created', async () => {
		const { ports, lines, requests } = fake()
		const code = await run_handoff_cli.run(['kickoff', 'new', BRIEF_FLAG, BRIEF_FILE], ports)

		expect(code).toBe(0)
		expect(requests[0]?.argv.command).toBe('claude')
		expect(lines).toEqual(expect.arrayContaining([`created: ${ISSUE_URL}`, 'exit: 0']))
	})

	it('fails a kickoff whose child exits non-zero and says it left no final message', async () => {
		const { ports, lines } = fake({
			read_text: (target) => (target === BRIEF_FILE ? BRIEF_TEXT : ''),
			launch_attached: async () => ({ kind: 'completed', pid: PID, exit_code: 1 }),
		})
		const code = await run_handoff_cli.run(['kickoff', 'new', BRIEF_FLAG, BRIEF_FILE], ports)

		expect(code).toBe(1)
		expect(lines).toEqual(expect.arrayContaining(['final message: none — read the log', 'exit: 1']))
	})

	it('starts fullrun in the background and points at a one-shot run:progress', async () => {
		const { ports, lines, requests } = fake()
		const code = await run_handoff_cli.run(['fullrun', '12', BRIEF_FLAG, BRIEF_FILE], ports)

		expect(code).toBe(0)
		expect(requests[0]?.profile).toMatchObject({ role: 'worker' })
		expect(lines.at(-1)).toContain('pnpm josh run:progress --once')
	})

	it('starts a run whose own issue holds the tree, as run:entry adopts it', async () => {
		const { ports, requests } = fake({ tree_hold: async () => ({ kind: 'held', hold: HELD }) })
		const code = await run_handoff_cli.run(['fullrun', '12', BRIEF_FLAG, BRIEF_FILE], ports)

		expect(code).toBe(0)
		expect(requests).toHaveLength(1)
	})
})

describe('run_handoff_cli.run backlogrun', () => {
	it('hands backlogrun on with the main session provider as --agent', async () => {
		const { ports, backlogrun } = fake({ environment: { CODEX_THREAD_ID: 'thread' } })

		await run_handoff_cli.run(['backlogrun', '#7', '--only'], ports)

		expect(backlogrun).toHaveBeenCalledWith(['#7', '--only', '--agent', 'codex'])
	})

	it.each(['--stop', '--restart'])(
		'hands backlogrun %s on alone, as it must stand',
		async (flag) => {
			const { ports, backlogrun } = fake()

			await run_handoff_cli.run(['backlogrun', flag], ports)

			expect(backlogrun).toHaveBeenCalledWith([flag])
		},
	)

	it('keeps an --agent the person typed', async () => {
		const { ports, backlogrun } = fake()

		await run_handoff_cli.run(['backlogrun', '--agent', 'codex'], ports)

		expect(backlogrun).toHaveBeenCalledWith(['--agent', 'codex'])
	})
})

describe('run_handoff_cli.run refusals', () => {
	it.each(REFUSALS)('refuses $why without starting a child', async ({ why, argv, overrides }) => {
		const { ports, lines, requests } = fake(overrides)

		expect(await run_handoff_cli.run(argv, ports)).toBe(1)
		expect(lines.at(-1)).toMatch(/^run:handoff: /u)
		expect(lines.some((line) => line.startsWith('log: '))).toBe(why === FAILED_START)
		expect(requests).toEqual([])
	})
})
