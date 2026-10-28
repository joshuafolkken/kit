import { describe, expect, it } from 'vitest'
import { agent_safe_text } from './agent-safe-text'

// joshuafolkken/kit#3964: a ship-stop prompt carries the failed output's lines, so the prompt alone
// may break lines while every other value keeps refusing each control character.
describe('the prompt value check', () => {
	it('lets a line break into a prompt and not into any other value', () => {
		const lines = 'Fix the gate\nFAIL gate'

		expect(agent_safe_text.is_safe_prompt(lines)).toBe(true)
		expect(agent_safe_text.is_safe_value(lines)).toBe(false)
	})

	it('refuses every other control character, an empty prompt and one over the cap', () => {
		expect(agent_safe_text.is_safe_prompt('FAIL\tgate')).toBe(false)
		expect(agent_safe_text.is_safe_prompt('FAIL\u{0}gate')).toBe(false)
		expect(agent_safe_text.is_safe_prompt('FAIL\rgate')).toBe(false)
		expect(agent_safe_text.is_safe_prompt('')).toBe(false)
		expect(agent_safe_text.is_safe_prompt('x'.repeat(agent_safe_text.MAX_PROMPT_LENGTH + 1))).toBe(
			false,
		)
	})
})

// joshuafolkken/kit#4930: an overrun investigation's prompt grew past a value's cap and was refused.
describe('the prompt length cap', () => {
	it('lets a prompt run past a value’s cap, up to its own', () => {
		const long = 'x'.repeat(agent_safe_text.MAX_VALUE_LENGTH + 1)

		expect(agent_safe_text.is_safe_prompt(long)).toBe(true)
		expect(agent_safe_text.is_safe_value(long)).toBe(false)
		expect(agent_safe_text.is_safe_prompt('x'.repeat(agent_safe_text.MAX_PROMPT_LENGTH))).toBe(true)
	})
})

describe('printable', () => {
	it('turns every control character but a line break into a space', () => {
		const text = agent_safe_text.printable('a\tb\u{7}c\nd\u{7F}e')

		expect(text).toBe('a b c\nd e')
		expect(agent_safe_text.is_safe_prompt(text)).toBe(true)
	})
})
