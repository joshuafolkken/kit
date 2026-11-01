import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_handoff_launch, type HandoffChild } from './run-handoff-launch'

// joshuafolkken/kit#5352: the child `josh run:handoff` starts — its role, argv, log and environment.

const CWD = '/repo'
// An explicit environment, so a JOSH_*_MODEL set where the tests run never reaches the profile.
const ENVIRONMENT = { HOME: '/home' }
const KICKOFF_LINE = 'kickoff new'
const KICKOFF = {
	kind: 'workflow',
	keyword: 'kickoff',
	line: KICKOFF_LINE,
	brief_file: 'b',
} as const
const WORKER = 'worker'
const SCHEDULER_MODEL = 'claude-opus-5-5'
const LOG = '/repo/.git/handoff.log'
const BRIEF = 'File the CSV export.'

beforeEach(() => {
	vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
})

afterEach(() => {
	vi.restoreAllMocks()
})

function child(overrides: Partial<HandoffChild>): HandoffChild {
	return { prompt: KICKOFF_LINE, role: 'scheduler', provider: 'anthropic', cwd: CWD, ...overrides }
}

describe('run_handoff_launch.role_of', () => {
	it.each([
		{ keyword: 'kickoff', role: 'scheduler' },
		{ keyword: 'fullrun', role: WORKER },
		{ keyword: 'halfrun', role: WORKER },
		{ keyword: 'prrun', role: WORKER },
	] as const)('runs $keyword as the $role', ({ keyword, role }) => {
		expect(run_handoff_launch.role_of(keyword)).toBe(role)
	})
})

describe('run_handoff_launch.prompt_of', () => {
	it('puts the keyword line first and the brief last', () => {
		const prompt = run_handoff_launch.prompt_of(KICKOFF, `  ${BRIEF}\n`)

		expect(prompt.startsWith(`${KICKOFF_LINE}\n\n`)).toBe(true)
		expect(prompt.endsWith(BRIEF)).toBe(true)
	})
})

describe('run_handoff_launch.argv_of', () => {
	it('hands kickoff new on anthropic to a claude child on the scheduler model', () => {
		const built = run_handoff_launch.argv_of(child({}), ENVIRONMENT)

		expect(built).toMatchObject({
			kind: 'argv',
			argv: { command: 'claude' },
			profile: { provider: 'anthropic', role: 'scheduler', model: SCHEDULER_MODEL },
		})
		expect(built.kind === 'argv' && built.argv.args).toEqual(
			expect.arrayContaining(['--model', SCHEDULER_MODEL]),
		)
	})

	it('hands kickoff new from a Codex session to a codex child on gpt-6.1-sol', () => {
		const built = run_handoff_launch.argv_of(child({ provider: 'openai' }), ENVIRONMENT)

		expect(built).toMatchObject({
			kind: 'argv',
			argv: { command: 'codex' },
			profile: { provider: 'openai', model: 'gpt-6.1-sol' },
		})
	})

	it('hands fullrun to the worker profile', () => {
		const built = run_handoff_launch.argv_of(child({ role: WORKER }), ENVIRONMENT)

		expect(built).toMatchObject({ kind: 'argv', profile: { role: WORKER } })
	})
})

describe('run_handoff_launch.request_of', () => {
	it('clears the Codex session key and hands the child its provider', () => {
		const built = run_handoff_launch.argv_of(child({ provider: 'openai' }), ENVIRONMENT)

		if (built.kind !== 'argv') throw new Error('expected an argv')

		const request = run_handoff_launch.request_of(built, CWD, LOG)

		expect(request).toMatchObject({ cwd: CWD, log_path: LOG })
		expect(request.env).toEqual({ CODEX_THREAD_ID: undefined, JOSH_AGENT_PROVIDER: 'openai' })
	})
})

describe('run_handoff_launch.log_path / is_waited', () => {
	it('names the log after the keyword and the start time', () => {
		expect(run_handoff_launch.log_path('/repo/.git', 'fullrun', 7)).toMatch(/-fullrun-7\.log$/u)
	})

	it('waits for kickoff only', () => {
		expect([
			run_handoff_launch.is_waited('kickoff'),
			run_handoff_launch.is_waited('fullrun'),
		]).toEqual([true, false])
	})
})
