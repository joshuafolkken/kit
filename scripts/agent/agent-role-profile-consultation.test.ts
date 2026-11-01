import { describe, expect, it } from 'vitest'
import { agent_role_profile } from './agent-role-profile'

// joshuafolkken/kit#5351: the model each provider's main line hands its investigation to.

const KEY = agent_role_profile.INVESTIGATION_MODEL_KEY
const OVERRIDE = 'claude-sonnet-5-5'
const OPUS = 'claude-opus-5-5'
const SOL = 'gpt-6.1-sol'
const FABLE = 'claude-fable-5-1'
const ANTHROPIC = 'anthropic'
const OPENAI = 'openai'

// joshuafolkken/kit#5616: a launched main line on a consultation model would be refused its run:entry.
describe('agent_role_profile.resolve — a consultation model on a launched role', () => {
	it.each([
		['worker', { JOSH_WORKER_MODEL: FABLE }],
		['scheduler', { JOSH_SCHEDULER_MODEL: FABLE }],
		['worker', { JOSH_LANE_MODEL: 'fable' }],
	] as const)('refuses the %s on %o', (role, environment) => {
		const resolved = agent_role_profile.resolve(role, environment)

		expect(resolved.kind).toBe('rejected')
		expect(resolved.kind === 'rejected' && resolved.note).toContain('consultation model')
	})

	it('refuses the worker ship phase on a consultation model', () => {
		const environment = { JOSH_WORKER_SHIP_MODEL: FABLE }
		const resolved = agent_role_profile.resolve('worker', environment, 'pre-gate')

		expect(resolved.kind).toBe('rejected')
	})

	it('leaves the reviewer free to run on a consultation model', () => {
		const resolved = agent_role_profile.resolve('reviewer', { JOSH_REVIEWER_MODEL: FABLE })

		expect(resolved).toMatchObject({ kind: 'profile', profile: { model: FABLE } })
	})
})

describe('agent_role_profile.investigation_model — where the investigation goes', () => {
	it.each([
		['defaults Claude to its investigation model', ANTHROPIC, {}, OPUS],
		['defaults Codex to its investigation model', OPENAI, {}, SOL],
		['moves the Claude model by its key', ANTHROPIC, { [KEY]: OVERRIDE }, OVERRIDE],
		['ignores a blank key', ANTHROPIC, { [KEY]: '  ' }, OPUS],
		['never reads the OpenAI model from env', OPENAI, { [KEY]: OVERRIDE }, SOL],
	] as const)('%s', (_case, provider, environment, expected) => {
		expect(agent_role_profile.investigation_model(provider, environment)).toBe(expected)
	})
})
