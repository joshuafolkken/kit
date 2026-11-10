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

describe('agent_consultation_model.rated_provider — a main model above the investigation rate', () => {
	it.each([
		[OPUS, ANTHROPIC],
		['claude-opus-4-1', ANTHROPIC],
		[FABLE, ANTHROPIC],
		[ASTRA, OPENAI],
	])('places %s under %s', (model, provider) => {
		expect(agent_consultation_model.rated_provider(model)).toBe(provider)
	})

	it.each(['claude-sonnet-5-5', 'claude-haiku-4-5', SOL, '<synthetic>', ''])(
		'places %s under no provider',
		(model) => {
			expect(agent_consultation_model.rated_provider(model)).toBeUndefined()
		},
	)
})
