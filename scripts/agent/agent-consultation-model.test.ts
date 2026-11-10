import { describe, expect, it } from 'vitest'
import { agent_consultation_model } from './agent-consultation-model'

// joshuafolkken/kit#5351: the consultation models.

const ANTHROPIC = 'anthropic'
const OPENAI = 'openai'
const FABLE = 'claude-fable-5-1'
const OPUS = 'claude-opus-5-5'
const ASTRA = 'gpt-6.1-astra'
const SOL = 'gpt-6.1-sol'

describe('agent_consultation_model.consultation_provider — which provider a consultation model is', () => {
	it.each([
		[FABLE, ANTHROPIC],
		['fable', ANTHROPIC],
		[ASTRA, OPENAI],
	])('reads %s as %s', (model, provider) => {
		expect(agent_consultation_model.consultation_provider(model)).toBe(provider)
	})

	it.each([OPUS, 'opus', 'sonnet', SOL, ''])('reads %s as none', (model) => {
		expect(agent_consultation_model.consultation_provider(model)).toBeUndefined()
	})
})

// joshuafolkken/kit#6901: the consultation main line defaults to Opus, Fable stays for design units.
describe('agent_consultation_model.CONSULTATION_MAIN_MODEL — the consultation main default', () => {
	it('is Opus 5.5, not a consultation model', () => {
		const model = agent_consultation_model.CONSULTATION_MAIN_MODEL

		expect(model).toBe(OPUS)
		expect(agent_consultation_model.consultation_provider(model)).toBeUndefined()
	})
})

describe('agent_consultation_model.model_provider — which provider a main model belongs to', () => {
	it.each([
		[OPUS, ANTHROPIC],
		[FABLE, ANTHROPIC],
		[ASTRA, OPENAI],
		[SOL, OPENAI],
	])('places %s under %s', (model, provider) => {
		expect(agent_consultation_model.model_provider(model)).toBe(provider)
	})

	it.each(['<synthetic>', 'haiku', ''])('places %s under no provider', (model) => {
		expect(agent_consultation_model.model_provider(model)).toBeUndefined()
	})
})
