import { describe, expect, it } from 'vitest'
import { agent_model_alias } from './agent-model-alias'

const OPUS_MODEL = 'claude-opus-5-5'
const OPENAI_MODEL = 'gpt-6.1-sol'

describe('alias_of', () => {
	it.each([
		[OPUS_MODEL, 'opus'],
		['claude-sonnet-5-5', 'sonnet'],
		['claude-haiku-5-5', 'haiku'],
		['claude-fable-5-1', 'fable'],
	])('maps %s to %s', (model, alias) => {
		expect(agent_model_alias.alias_of(model)).toBe(alias)
	})

	it.each([OPENAI_MODEL, 'opus', 'claude-unknown-5-5', `prefix-${OPUS_MODEL}`])(
		'gives %s no alias',
		(model) => {
			expect(agent_model_alias.alias_of(model)).toBeUndefined()
		},
	)
})

describe('suffix_of', () => {
	it('wraps the alias of a Claude model in parentheses', () => {
		expect(agent_model_alias.suffix_of(OPUS_MODEL)).toBe(' (opus)')
	})

	it('is empty for a model with no alias', () => {
		expect(agent_model_alias.suffix_of(OPENAI_MODEL)).toBe('')
	})
})
