import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { cli_body_repository } from '#scripts/josh/cli-body-repository-fixture'
import type { LaunchRequest } from '#scripts/run/detached-launch'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_handoff_cli, type HandoffPorts } from './run-handoff-cli'
import { run_handoff_retrospective } from './run-handoff-retrospective'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#5352: `josh run:handoff` waits for a kickoff, detaches a run and hands backlogrun on.

// joshuafolkken/kit#6056: the brief is read through `cli_body`, so it is a real file outside any work tree.
const TEMPORARY = make_directory('josh-run-handoff-')
const BRIEF_FILE = path.join(TEMPORARY, 'brief.md')
const MISSING_BRIEF = path.join(TEMPORARY, 'missing.md')
const BRIEF_FLAG = '--brief-file'
const ISSUE_URL = 'https://github.com/joshuafolkken/kit/issues/5400'
const FINAL = JSON.stringify({ type: 'result', result: `Filed ${ISSUE_URL}` })
const CLAUDE_SESSION = { CLAUDE_CODE_SESSION_ID: 'session', HOME: '/home' }
const PID = 42
const BRIEF_TEXT = 'Agreed brief'
const LANE_DIRECTORY = '/home/dev/.kit-lanes/12'

writeFileSync(BRIEF_FILE, BRIEF_TEXT)

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
		read_text: () => FINAL,
		launch: (request) => {
			requests.push(request)

			return { kind: 'launched', pid: PID }
		},
		launch_attached: async (request) => {
			requests.push(request)

			return { kind: 'completed', pid: PID, exit_code: 0 }
		},
		backlogrun,
		is_retrospective_done: () => true,
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
		argv: ['kickoff', 'new', BRIEF_FLAG, MISSING_BRIEF],
		overrides: {},
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
			read_text: () => '',
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

// The carry as read before the launch and then after the unit ends.
function marks_of(before: boolean, after: boolean): () => boolean {
	const reads = [before, after]

	return () => reads.shift() ?? after
}

// joshuafolkken/kit#6743: the retrospective unit is waited for and judged by its carry mark.
describe('run_handoff_cli.run retrospective', () => {
	it('hands the unit the generated brief and exits 0 once the carry marks it', async () => {
		const { ports, requests } = fake({ is_retrospective_done: marks_of(false, true) })
		const code = await run_handoff_cli.run(['retrospective'], ports)

		expect(code).toBe(0)
		expect(requests[0]?.profile).toMatchObject({ role: 'scheduler' })
		expect(JSON.stringify(requests[0]?.argv)).toContain(run_handoff_retrospective.DIGEST_COMMAND)
	})

	it('names the calling session as the close owner, since the carry is its record', async () => {
		const { ports, requests } = fake({
			environment: { ...CLAUDE_SESSION, CLAUDE_PID: '777' },
			is_retrospective_done: marks_of(false, true),
		})

		await run_handoff_cli.run(['retrospective'], ports)

		expect(JSON.stringify(requests[0]?.argv)).toContain(
			`${run_handoff_retrospective.CLOSE_COMMAND} ${run_handoff_retrospective.OWNER_FLAG} 777`,
		)
	})

	it('exits 1 when the unit ended cleanly without the carry mark', async () => {
		const { ports, lines } = fake({ is_retrospective_done: marks_of(false, false) })
		const code = await run_handoff_cli.run(['retrospective'], ports)

		expect(code).toBe(1)
		expect(lines.at(-1)).toContain('without run:carry --retrospective')
	})

	it('refuses without starting a unit when the carry is already marked', async () => {
		const { ports, lines, requests } = fake()
		const code = await run_handoff_cli.run(['retrospective'], ports)

		expect([code, requests]).toEqual([1, []])
		expect(lines.at(-1)).toContain('already marks the retrospective')
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

describe('run_handoff_cli.run lane boundary', () => {
	it.each(['kickoff', 'fullrun', 'halfrun', 'prrun', 'backlogrun'])(
		'refuses %s in a lane child before starting any worker',
		async (keyword) => {
			const { ports, lines, requests, backlogrun } = fake({
				cwd: LANE_DIRECTORY,
				environment: { ...CLAUDE_SESSION, JOSH_LANE_CHILD: '12' },
			})

			expect(await run_handoff_cli.run([keyword, '12', BRIEF_FLAG, BRIEF_FILE], ports)).toBe(1)
			expect(lines).toEqual([expect.stringContaining('continue the workflow in this session')])
			expect(requests).toEqual([])
			expect(backlogrun).not.toHaveBeenCalled()
		},
	)

	it.each([undefined, '99'])(
		'starts a consultation run with unrelated lane mark %s',
		async (mark) => {
			const { ports, requests } = fake({
				cwd: LANE_DIRECTORY,
				environment: { ...CLAUDE_SESSION, JOSH_LANE_CHILD: mark },
			})

			expect(await run_handoff_cli.run(['fullrun', '12', BRIEF_FLAG, BRIEF_FILE], ports)).toBe(0)
			expect(requests).toHaveLength(1)
		},
	)
})

describe('run_handoff_cli.run refusals', () => {
	it.each(REFUSALS)('refuses $why without starting a child', async ({ why, argv, overrides }) => {
		const { ports, lines, requests } = fake(overrides)

		expect(await run_handoff_cli.run(argv, ports)).toBe(1)
		expect(lines.at(-1)).toMatch(/^run:handoff: /u)
		expect(lines.some((line) => line.startsWith('log: '))).toBe(why === FAILED_START)
		expect(requests).toEqual([])
	})

	// joshuafolkken/kit#6743: the usage a bad argument prints names the retrospective keyword too.
	it('names retrospective in the usage it prints for a bad argument', async () => {
		const { ports, lines } = fake()

		await run_handoff_cli.run(['unknown'], ports)

		expect(lines.at(-1)).toContain('| retrospective |')
	})

	// joshuafolkken/kit#6056: the brief read is `cli_body`'s, so a brief in the work tree is refused.
	it('refuses a brief in the work tree that git does not ignore, naming why', async () => {
		const repository = cli_body_repository.create(make_directory('josh-run-handoff-repository-'))
		const brief_file = repository.write(cli_body_repository.UNIGNORED_DIRECTORY, BRIEF_TEXT)
		const { ports, lines, requests } = fake()
		const code = await run_handoff_cli.run(['kickoff', 'new', BRIEF_FLAG, brief_file], ports)

		expect(code).toBe(1)
		expect(lines.at(-1)).toContain('not git-ignored')
		expect(requests).toEqual([])
	})
})
