import { describe, expect, it } from 'vitest'
import { agent_consultation_model } from './agent-consultation-model'

// joshuafolkken/kit#5351: the consultation models.

const ANTHROPIC = 'anthropic'

describe('agent_consultation_model.consultation_provider — which provider a consultation model is', () => {
	it.each([
		['claude-fable-5-1', ANTHROPIC],
		['fable', ANTHROPIC],
		['gpt-6.1-astra', 'openai'],
	])('reads %s as %s', (model, provider) => {
		expect(agent_consultation_model.consultation_provider(model)).toBe(provider)
	})

	it.each(['claude-opus-5-5', 'opus', 'sonnet', 'gpt-6.1-sol', ''])('reads %s as none', (model) => {
		expect(agent_consultation_model.consultation_provider(model)).toBeUndefined()
	})
})
