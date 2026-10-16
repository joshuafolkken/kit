import { describe, expect, it } from 'vitest'
import { agent_role_profile } from './agent-role-profile'

// joshuafolkken/kit#3964: a ship-stop prompt carries the failed output's lines, so the prompt alone
// may break lines while every other value keeps refusing each control character.
describe('the prompt value check', () => {
	it('lets a line break into a prompt and not into any other value', () => {
		const lines = 'Fix the gate\nFAIL gate'

		expect(agent_role_profile.is_safe_prompt(lines)).toBe(true)
		expect(agent_role_profile.is_safe_value(lines)).toBe(false)
	})

	it('refuses every other control character, an empty prompt and one over the cap', () => {
		expect(agent_role_profile.is_safe_prompt('FAIL\tgate')).toBe(false)
		expect(agent_role_profile.is_safe_prompt('FAIL\u{0}gate')).toBe(false)
		expect(agent_role_profile.is_safe_prompt('FAIL\rgate')).toBe(false)
		expect(agent_role_profile.is_safe_prompt('')).toBe(false)
		expect(
			agent_role_profile.is_safe_prompt('x'.repeat(agent_role_profile.MAX_VALUE_LENGTH + 1)),
		).toBe(false)
	})
})

describe('printable', () => {
	it('turns every control character but a line break into a space', () => {
		const text = agent_role_profile.printable('a\tb\u{7}c\nd\u{7F}e')

		expect(text).toBe('a b c\nd e')
		expect(agent_role_profile.is_safe_prompt(text)).toBe(true)
	})
})
