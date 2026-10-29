import { describe, expect, it } from 'vitest'
import { agent_role_profile } from './agent-role-profile'

// joshuafolkken/kit#5351: the consultation models, and the model each provider's main line hands its
// investigation to.

const KEY = agent_role_profile.INVESTIGATION_MODEL_KEY
const OVERRIDE = 'claude-sonnet-5-5'
const OPUS = 'claude-opus-5-5'
const SOL = 'gpt-6.1-sol'
const ANTHROPIC = 'anthropic'
const OPENAI = 'openai'

describe('agent_role_profile.consultation_provider — which provider a consultation model is', () => {
	it.each([
		['claude-fable-5-1', ANTHROPIC],
		['fable', ANTHROPIC],
		['gpt-6.1-astra', OPENAI],
	])('reads %s as %s', (model, provider) => {
		expect(agent_role_profile.consultation_provider(model)).toBe(provider)
	})

	it.each([OPUS, 'opus', 'sonnet', SOL, ''])('reads %s as none', (model) => {
		expect(agent_role_profile.consultation_provider(model)).toBeUndefined()
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
