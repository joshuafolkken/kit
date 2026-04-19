import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const JOSH_GIT = 'josh git'
const JOSH_GIT_FOLLOWUP = 'josh git-followup'
const JOSH_TELEGRAM_TEST = 'josh telegram-test'
const SCRIPTS_GIT_KEY = 'scripts.git'

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
	it('uses josh subcommand for git script', () => {
		expect(init_logic.get_suggested_scripts('vanilla')).toHaveProperty('git', 'josh git')
	})

	it('uses josh subcommands for git:followup and telegram:test', () => {
		const scripts = init_logic.get_suggested_scripts('vanilla')

		expect(scripts).toHaveProperty('git:followup', JOSH_GIT_FOLLOWUP)
		expect(scripts).toHaveProperty('telegram:test', JOSH_TELEGRAM_TEST)
	})

	it('uses josh subcommands for prevent-main-commit and check-commit-message', () => {
		expect(init_logic.get_suggested_scripts('vanilla')).toHaveProperty(
			'prevent-main-commit',
			'josh prevent-main-commit',
		)
		expect(init_logic.get_suggested_scripts('vanilla')).toHaveProperty(
			'check-commit-message',
			'josh check-commit-message',
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

describe('merge_package_scripts jf-* migration', () => {
	it('migrates existing jf-git value to josh git', () => {
		const content = '{"scripts":{"git":"jf-git"}}'
		const parsed: unknown = JSON.parse(init_logic.merge_package_scripts(content, {}))

		expect(parsed).toHaveProperty(SCRIPTS_GIT_KEY, JOSH_GIT)
	})

	it('migrates multiple jf-* values in one pass', () => {
		const content =
			'{"scripts":{"git":"jf-git","git:followup":"jf-git-followup","telegram:test":"jf-telegram-test"}}'
		const parsed: unknown = JSON.parse(init_logic.merge_package_scripts(content, {}))

		expect(parsed).toHaveProperty(SCRIPTS_GIT_KEY, JOSH_GIT)
		expect(parsed).toHaveProperty('scripts.git:followup', JOSH_GIT_FOLLOWUP)
		expect(parsed).toHaveProperty('scripts.telegram:test', JOSH_TELEGRAM_TEST)
	})

	it('leaves non-jf-* script values unchanged', () => {
		const content = '{"scripts":{"build":"tsc"}}'

		expect(init_logic.merge_package_scripts(content, {})).toBe(content)
	})
})
