import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { PACKAGE_JSON } from '#scripts/lib/package-manifest'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agent_argv, type AgentArgvResult } from './agent-argv'
import { agent_diagnostics } from './agent-diagnostics'
import { agent_role_profile, type AgentProfile } from './agent-role-profile'

// joshuafolkken/kit#2415: a lane created before the model migration keeps the model it recorded, and a
// CLI that cannot run the resolved model refuses the launch instead of falling back to another model.

const INVOCATION = 'fullrun #2415'
const LANE = '/lanes/2415'
const LEGACY_MODEL = 'opus'
const { PRE_GATE_PHASE, DEFAULT_PROFILES } = agent_role_profile
const LEGACY_WORKER: AgentProfile = { ...DEFAULT_PROFILES.worker, model: LEGACY_MODEL }
const OUTDATED = 'Claude Code 2.1.156 cannot run claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'
const HAIKU = 'claude-haiku-5-5'
const SHIP_ARGS: ReadonlyArray<string> = [
	'-p',
	'--verbose',
	'--output-format',
	'stream-json',
	'--permission-mode',
	'bypassPermissions',
	'--tools',
	'Bash,Read,Edit,Write,Agent,ToolSearch,SendMessage,TaskStop,Monitor,TodoWrite',
	'--strict-mcp-config',
	'--model',
	SONNET,
	'--effort',
	'low',
	INVOCATION,
]
type Labels = () => Promise<ReadonlyArray<string> | undefined>

const SITE = { cwd: LANE, labels: async (): Promise<ReadonlyArray<string>> => [] }
const make_directory = temporary_directory()

const check = vi.spyOn(agent_diagnostics, 'check')

afterEach(() => {
	check.mockReset()
})

async function ship_argv(cwd: string, labels: Labels): Promise<AgentArgvResult> {
	check.mockReturnValue({ kind: 'ready' })

	return await agent_argv.resume_argv(INVOCATION, undefined, PRE_GATE_PHASE, { cwd, labels })
}

function worker_directory(): string {
	const directory = make_directory('agent-argv-worker-')
	const haiku = { name: 'haiku', model: HAIKU, effort: 'low', when: 'Mechanical work' }
	const sonnet = { name: 'sonnet', model: SONNET, effort: 'medium', when: 'A brief' }
	const worker = { default: 'sonnet', profiles: [haiku, sonnet] }

	writeFileSync(path.join(directory, PACKAGE_JSON), JSON.stringify({ josh: { worker } }))

	return directory
}

// joshuafolkken/kit#7354: `josh.worker` caps the ship phase; without it the launch is byte-identical.
describe('the ship phase under josh.worker', () => {
	it('keeps the ship model, effort and argv unchanged and reads no labels without the setting', async () => {
		const labels = vi.fn(SITE.labels)
		const built = await ship_argv(make_directory('agent-argv-unset-'), labels)

		expect(built).toMatchObject({ kind: 'argv', profile: { model: SONNET, effort: 'low' } })
		expect(built.kind === 'argv' && built.argv.args).toEqual(SHIP_ARGS)
		expect(labels).not.toHaveBeenCalled()
	})

	it('relaunches the ship phase on the weaker profile the Issue label selects', async () => {
		const built = await ship_argv(worker_directory(), async () => ['worker:haiku'])

		expect(built).toMatchObject({ kind: 'argv', profile: { model: HAIKU, effort: 'low' } })
		expect(built.kind === 'argv' && built.argv.args).toContain(HAIKU)
	})

	it('refuses the relaunch when the Issue labels cannot be read', async () => {
		const built = await ship_argv(worker_directory(), async () => await undefined)

		expect(built).toMatchObject({ kind: 'rejected' })
	})
})

describe('a stored lane profile across a cut', () => {
	it('relaunches on the ship default model with the phase effort', async () => {
		check.mockReturnValue({ kind: 'ready' })
		const built = await agent_argv.resume_argv(INVOCATION, LEGACY_WORKER, PRE_GATE_PHASE, SITE)

		expect(built).toMatchObject({ kind: 'argv', profile: { model: SONNET, effort: 'low' } })
		expect(built.kind === 'argv' && built.argv.args).toContain(SONNET)
	})

	// joshuafolkken/kit#5343: the ship key moves the pre-gate relaunch off the recorded model.
	it('relaunches the pre-gate phase on the ship model when its key is set', async () => {
		check.mockReturnValue({ kind: 'ready' })
		vi.stubEnv('JOSH_WORKER_SHIP_MODEL', SONNET)
		const built = await agent_argv.resume_argv(INVOCATION, LEGACY_WORKER, PRE_GATE_PHASE, SITE)

		vi.unstubAllEnvs()

		expect(built).toMatchObject({ kind: 'argv', profile: { model: SONNET, effort: 'low' } })
		expect(built.kind === 'argv' && built.argv.args).toContain(SONNET)
	})

	it('resumes a session on the recorded model', () => {
		check.mockReturnValue({ kind: 'ready' })
		const built = agent_argv.with_resume_in(INVOCATION, LEGACY_WORKER, 'session', LANE)

		expect(built).toMatchObject({ kind: 'argv', profile: { model: LEGACY_MODEL } })
	})
})

// joshuafolkken/kit#3926: a verification round builds under its own reviewer profile.
describe('a review round', () => {
	it.each(['low', 'medium'])('launches the model selected for a %s first round', (level) => {
		check.mockReturnValue({ kind: 'ready' })
		const built = agent_argv.review_in(`${level} — review the brief`, 1, LANE, {
			JOSH_AGENT_PROVIDER: 'anthropic',
		})
		const model = level === 'low' ? SONNET : DEFAULT_PROFILES.reviewer.model

		expect(built).toMatchObject({ kind: 'argv', profile: { model } })
		expect(built.kind === 'argv' && built.argv.args).toContain(model)
	})

	it.each([1, 2])('keeps the trusted local policy for OpenAI review round %s', (round) => {
		check.mockReturnValue({ kind: 'ready' })
		const built = agent_argv.review_in(INVOCATION, round, LANE, { JOSH_AGENT_PROVIDER: 'openai' })

		expect(built.kind === 'argv' && built.argv.args).toContain(
			'default_permissions=":danger-full-access"',
		)
		expect(built.kind === 'argv' && built.argv.args).toContain('approval_policy="never"')
		expect(built.kind === 'argv' && built.argv.args).toContain('--ephemeral')
	})

	it('builds a later round under the verification profile', () => {
		check.mockReturnValue({ kind: 'ready' })
		const built = agent_argv.review_in(INVOCATION, 2, LANE, {
			JOSH_REVIEWER_VERIFICATION_MODEL: SONNET,
		})

		expect(built).toMatchObject({ kind: 'argv', profile: { model: SONNET } })
		expect(built.kind === 'argv' && built.argv.args).toContain(SONNET)
	})
})

describe('an unsupported CLI', () => {
	it('refuses with the diagnostic note and checks no other model', () => {
		check.mockReturnValue({ kind: 'rejected', note: OUTDATED })
		const profile = DEFAULT_PROFILES.worker

		expect(agent_argv.with_profile_in(INVOCATION, profile, LANE)).toStrictEqual({
			kind: 'rejected',
			note: OUTDATED,
		})
		expect(check).toHaveBeenCalledExactlyOnceWith(profile)
	})
})
