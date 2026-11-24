import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { JOSH_TMP_DIRECTORY } from '#scripts/lib/josh-temporary-directory'
import { PACKAGE_JSON } from '#scripts/lib/package-manifest'
import { temporary_directory } from '#tools/test/temporary-directory'
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
const SONNET_MODEL = 'claude-sonnet-5-5'
const SONNET = { name: 'sonnet', model: SONNET_MODEL, effort: 'low', when: 'Small work' }
const OPUS = { name: 'opus', model: SCHEDULER_MODEL, effort: 'high', when: 'Design work' }
const ROUTED_JOSH = {
	handoff: { route: true },
	worker: { default: 'opus', profiles: [SONNET, OPUS] },
}
const make_directory = temporary_directory()
const LOG = '/repo/.git/handoff.log'
const BRIEF = 'File the CSV export.'
const SCRATCH = '.josh/tmp/handoff-kickoff-1'
const GIT_DIRECTORY = '/repo/.git'

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
		const prompt = run_handoff_launch.prompt_of(KICKOFF, `  ${BRIEF}\n`, SCRATCH)

		expect(prompt.startsWith(`${KICKOFF_LINE}\n\n`)).toBe(true)
		expect(prompt.endsWith(BRIEF)).toBe(true)
	})

	// joshuafolkken/kit#6898: `josh cost:audit` reads a handed-over run off this origin.
	it('names the child’s origin', () => {
		expect(run_handoff_launch.prompt_of(KICKOFF, BRIEF, SCRATCH)).toContain(
			run_handoff_launch.ORIGIN_MARKER,
		)
	})

	// joshuafolkken/kit#7811: two kickoff children started in one checkout never share a body file.
	it('names a different scratch directory to two children of one keyword started apart', () => {
		const prompts = [1, 2].map((now) =>
			run_handoff_launch.prompt_of(
				KICKOFF,
				BRIEF,
				run_handoff_launch.scratch_directory('kickoff', now),
			),
		)

		expect(prompts[0]).toContain('.josh/tmp/handoff-kickoff-1/')
		expect(prompts[1]).toContain('.josh/tmp/handoff-kickoff-2/')
	})
})

describe('run_handoff_launch.scratch_directory', () => {
	it('sits under the scratch directory, named for the keyword and the log’s start time', () => {
		const scratch = run_handoff_launch.scratch_directory('fullrun', 7)

		expect(scratch).toBe(`${JOSH_TMP_DIRECTORY}/handoff-fullrun-7`)
		expect(run_handoff_launch.log_path(GIT_DIRECTORY, 'fullrun', 7)).toMatch(/-fullrun-7\.log$/u)
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

	it('refuses a role profile that resolves to a consultation model', () => {
		const consultation_model = 'claude-fable-5-1'
		const environment = { ...ENVIRONMENT, JOSH_WORKER_MODEL: consultation_model }
		const built = run_handoff_launch.argv_of(child({ role: WORKER }), environment)

		expect(built.kind).toBe('rejected')
		expect(built.kind === 'rejected' && built.note).toContain(consultation_model)
	})
})

function routed_repository(): string {
	const directory = make_directory('handoff-launch-route-')
	const manifest = JSON.stringify({ name: 'app', josh: ROUTED_JOSH })

	writeFileSync(path.join(directory, PACKAGE_JSON), manifest)

	return directory
}

// joshuafolkken/kit#8891: `josh.handoff.route` runs the kickoff child on the weakest worker profile.
describe('run_handoff_launch.argv_of — josh.handoff.route', () => {
	const routed = { cwd: '' }

	beforeEach(() => {
		routed.cwd = routed_repository()
	})

	it('hands kickoff in a repository with josh.handoff.route on to the weakest worker profile', () => {
		const built = run_handoff_launch.argv_of(
			child({ keyword: 'kickoff', cwd: routed.cwd }),
			ENVIRONMENT,
		)

		expect(built).toMatchObject({
			kind: 'argv',
			profile: { role: 'scheduler', model: SONNET_MODEL },
		})
		expect(built.kind === 'argv' && built.argv.args).toEqual(
			expect.arrayContaining(['--model', SONNET_MODEL]),
		)
	})

	it('keeps the retrospective child on the scheduler model in that repository', () => {
		const built = run_handoff_launch.argv_of(
			child({ keyword: 'retrospective', cwd: routed.cwd }),
			ENVIRONMENT,
		)

		expect(built).toMatchObject({ kind: 'argv', profile: { model: SCHEDULER_MODEL } })
	})

	it('keeps a fullrun child on the worker profile in that repository', () => {
		const fullrun = child({ keyword: 'fullrun', role: WORKER, cwd: routed.cwd })

		expect(run_handoff_launch.argv_of(fullrun, ENVIRONMENT)).toMatchObject({
			kind: 'argv',
			profile: { role: WORKER, model: SCHEDULER_MODEL },
		})
	})
})

describe('run_handoff_launch.request_of', () => {
	it('clears the Codex session key and the headless mark, marks the hand-off and hands the child its provider', () => {
		const built = run_handoff_launch.argv_of(child({ provider: 'openai' }), ENVIRONMENT)

		if (built.kind !== 'argv') throw new Error('expected an argv')

		const request = run_handoff_launch.request_of(built, CWD, LOG)

		expect(request).toMatchObject({ cwd: CWD, log_path: LOG })
		expect(request.env).toEqual({
			CODEX_THREAD_ID: undefined,
			JOSH_AGENT_PROVIDER: 'openai',
			JOSH_HANDOFF_CHILD: '1',
			JOSH_RUN_HEADLESS: undefined,
		})
	})
})

describe('run_handoff_launch.log_path / is_waited', () => {
	it('names the log after the keyword and the start time', () => {
		expect(run_handoff_launch.log_path(GIT_DIRECTORY, 'fullrun', 7)).toMatch(/-fullrun-7\.log$/u)
	})

	it('waits for kickoff and retrospective only', () => {
		expect([
			run_handoff_launch.is_waited('kickoff'),
			run_handoff_launch.is_waited('retrospective'),
			run_handoff_launch.is_waited('fullrun'),
		]).toEqual([true, true, false])
	})
})
