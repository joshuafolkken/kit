import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

describe('get_suggested_scripts common scripts', () => {
	it('includes postinstall for both types', () => {
		expect(init_logic.get_suggested_scripts('vanilla')).toHaveProperty('postinstall')
		expect(init_logic.get_suggested_scripts('sveltekit')).toHaveProperty('postinstall')
	})

	it('includes lint for both types', () => {
		expect(init_logic.get_suggested_scripts('vanilla')).toHaveProperty('lint')
		expect(init_logic.get_suggested_scripts('sveltekit')).toHaveProperty('lint')
	})

	it('includes sveltekit check scripts for sveltekit', () => {
		const result = init_logic.get_suggested_scripts('sveltekit')

		expect(result).toHaveProperty('check')
		expect(result).toHaveProperty('check:ci')
	})

	it('does not include check for vanilla', () => {
		expect(init_logic.get_suggested_scripts('vanilla')).not.toHaveProperty('check')
	})
})

describe('get_suggested_scripts bin commands', () => {
	it('uses jf-git bin command for git script', () => {
		expect(init_logic.get_suggested_scripts('vanilla')).toHaveProperty('git', 'jf-git')
	})

	it('uses jf-bin commands for git:followup and telegram:test', () => {
		const scripts = init_logic.get_suggested_scripts('vanilla')

		expect(scripts).toHaveProperty('git:followup', 'jf-git-followup')
		expect(scripts).toHaveProperty('telegram:test', 'jf-telegram-test')
	})

	it('uses jf-bin commands for prevent-main-commit and check-commit-message', () => {
		expect(init_logic.get_suggested_scripts('vanilla')).toHaveProperty(
			'prevent-main-commit',
			'jf-prevent-main-commit',
		)
		expect(init_logic.get_suggested_scripts('vanilla')).toHaveProperty(
			'check-commit-message',
			'jf-check-commit-message',
		)
	})
})

describe('transform_prompt_paths', () => {
	it('replaces prompts/ with node_modules package path', () => {
		const result = init_logic.transform_prompt_paths('see `prompts/refactoring.md`')

		expect(result).toBe('see `node_modules/@joshuafolkken/config/prompts/refactoring.md`')
	})

	it('replaces all occurrences in content', () => {
		const input = 'see `prompts/review.md` and `prompts/testing-guide.md`'
		const result = init_logic.transform_prompt_paths(input)

		expect(result).toContain('node_modules/@joshuafolkken/config/prompts/review.md')
		expect(result).toContain('node_modules/@joshuafolkken/config/prompts/testing-guide.md')
		expect(result).not.toContain('`prompts/')
	})

	it('returns content unchanged when no prompts/ references exist', () => {
		const input = 'no references here'

		expect(init_logic.transform_prompt_paths(input)).toBe(input)
	})

	it('does not replace non-backtick prompts/ occurrences', () => {
		const input = 'see prompts/refactoring.md without backticks'

		expect(init_logic.transform_prompt_paths(input)).toBe(input)
	})
})
