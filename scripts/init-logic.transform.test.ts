import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const JOSH_SCRIPT_VALUE = 'josh'

const SAFE_CHAIN_SCRIPT_VALUE = 'pnpm dlx @aikidosec/safe-chain setup-ci'

describe('get_suggested_scripts common scripts', () => {
	it('includes preinstall for both types', () => {
		expect(init_logic.get_suggested_scripts('vanilla')).toHaveProperty(
			'preinstall',
			SAFE_CHAIN_SCRIPT_VALUE,
		)
		expect(init_logic.get_suggested_scripts('sveltekit')).toHaveProperty(
			'preinstall',
			SAFE_CHAIN_SCRIPT_VALUE,
		)
	})

	it('includes postinstall for both types', () => {
		expect(init_logic.get_suggested_scripts('vanilla')).toHaveProperty('postinstall')
		expect(init_logic.get_suggested_scripts('sveltekit')).toHaveProperty('postinstall')
	})

	it('does not include commands replaced by josh subcommands', () => {
		const vanilla = init_logic.get_suggested_scripts('vanilla')
		const sveltekit = init_logic.get_suggested_scripts('sveltekit')

		for (const scripts of [vanilla, sveltekit]) {
			expect(scripts).not.toHaveProperty('lint')
			expect(scripts).not.toHaveProperty('check')
			expect(scripts).not.toHaveProperty('check:ci')
			expect(scripts).not.toHaveProperty('check:svelte')
			expect(scripts).not.toHaveProperty('check:svelte:ci')
			expect(scripts).not.toHaveProperty('test:unit')
		}
	})
})

describe('get_suggested_scripts bin commands', () => {
	it('includes josh script pointing to josh binary', () => {
		expect(init_logic.get_suggested_scripts('vanilla')).toHaveProperty(
			JOSH_SCRIPT_VALUE,
			JOSH_SCRIPT_VALUE,
		)
	})

	it('does not include alias scripts replaced by pnpm josh', () => {
		const scripts = init_logic.get_suggested_scripts('vanilla')

		expect(scripts).not.toHaveProperty('git')
		expect(scripts).not.toHaveProperty('git:followup')
		expect(scripts).not.toHaveProperty('telegram:test')
		expect(scripts).not.toHaveProperty('prevent-main-commit')
		expect(scripts).not.toHaveProperty('check-commit-message')
		expect(scripts).not.toHaveProperty('audit:security')
	})
})

describe('transform_prompt_paths', () => {
	it('replaces prompts/ with node_modules package path', () => {
		const result = init_logic.transform_prompt_paths('see `prompts/refactoring.md`')

		expect(result).toBe('see `node_modules/@joshuafolkken/kit/prompts/refactoring.md`')
	})

	it('replaces all occurrences in content', () => {
		const input = 'see `prompts/review.md` and `prompts/testing-guide.md`'
		const result = init_logic.transform_prompt_paths(input)

		expect(result).toContain('node_modules/@joshuafolkken/kit/prompts/review.md')
		expect(result).toContain('node_modules/@joshuafolkken/kit/prompts/testing-guide.md')
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
	/* eslint-disable dot-notation -- index signature requires bracket notation */
	it('removes jf-git script since git is a retired alias', () => {
		const content = '{"scripts":{"git":"jf-git"}}'
		const parsed = JSON.parse(init_logic.merge_package_scripts(content, {})) as {
			scripts: Record<string, string>
		}

		expect(parsed.scripts['git']).toBeUndefined()
	})

	it('removes all jf-* aliases that map to retired script keys', () => {
		const content =
			'{"scripts":{"git":"jf-git","git:followup":"jf-git-followup","telegram:test":"jf-telegram-test","build":"tsc"}}'
		const parsed = JSON.parse(init_logic.merge_package_scripts(content, {})) as {
			scripts: Record<string, string>
		}

		expect(parsed.scripts['git']).toBeUndefined()
		expect(parsed.scripts['git:followup']).toBeUndefined()
		expect(parsed.scripts['telegram:test']).toBeUndefined()
		expect(parsed.scripts['build']).toBe('tsc')
	})

	it('leaves non-jf-* script values unchanged', () => {
		const content = '{"scripts":{"build":"tsc"}}'

		expect(init_logic.merge_package_scripts(content, {})).toBe(content)
	})

	it('removes retired alias scripts from existing package json', () => {
		const content =
			'{"scripts":{"git":"josh git","git:followup":"josh git-followup","telegram:test":"josh telegram-test","test:unit":"vitest run"}}'
		const result = JSON.parse(init_logic.merge_package_scripts(content, {})) as {
			scripts: Record<string, string>
		}

		expect(result.scripts['git']).toBeUndefined()
		expect(result.scripts['git:followup']).toBeUndefined()
		expect(result.scripts['telegram:test']).toBeUndefined()
		expect(result.scripts['test:unit']).toBeUndefined()
	})

	/* eslint-enable dot-notation */
})

describe('merge_package_scripts preinstall ordering', () => {
	it('inserts preinstall as the first script key when merging into existing scripts', () => {
		/* eslint-disable dot-notation -- index signature requires bracket notation */
		const content = '{"scripts":{"build":"tsc","postinstall":"lefthook install"}}'
		const result = JSON.parse(
			init_logic.merge_package_scripts(content, { preinstall: SAFE_CHAIN_SCRIPT_VALUE }),
		) as { scripts: Record<string, string> }

		expect(Object.keys(result.scripts)[0]).toBe('preinstall')
		expect(result.scripts['preinstall']).toBe(SAFE_CHAIN_SCRIPT_VALUE)
		/* eslint-enable dot-notation */
	})
})

describe('merge_json_object', () => {
	it('adds missing keys from updates', () => {
		const result = JSON.parse(init_logic.merge_json_object('{"a":1}', { b: 2 })) as { b: number }

		expect(result.b).toBe(2)
	})

	it('does not overwrite existing keys', () => {
		const result = JSON.parse(init_logic.merge_json_object('{"a":1}', { a: 99, b: 2 })) as {
			a: number
			b: number
		}

		expect(result.a).toBe(1)
		expect(result.b).toBe(2)
	})

	it('returns content unchanged when no new keys to add', () => {
		const content = '{"a":1}'
		const result = init_logic.merge_json_object(content, { a: 99 })

		expect(result).toBe(content)
	})

	it('handles settings.json with JSONC line comments', () => {
		const content = '{\n\t// settings\n\t"a": 1\n}'
		const result = JSON.parse(init_logic.merge_json_object(content, { b: 2 })) as {
			a: number
			b: number
		}

		expect(result.a).toBe(1)
		expect(result.b).toBe(2)
	})
})

describe('merge_yaml_list_entry', () => {
	it('creates the key block when it does not exist', () => {
		const result = init_logic.merge_yaml_list_entry('', 'extends', 'my-value')

		expect(result).toContain('extends:')
		expect(result).toContain('- my-value')
	})

	it('adds entry at the top of an existing list', () => {
		const existing = 'extends:\n  - other-value\n'
		const result = init_logic.merge_yaml_list_entry(existing, 'extends', 'my-value')

		expect(result).toContain('my-value')
		expect(result).toContain('other-value')
	})

	it('returns content unchanged when value already present', () => {
		const content = 'extends:\n  - my-value\n'
		const result = init_logic.merge_yaml_list_entry(content, 'extends', 'my-value')

		expect(result).toBe(content)
	})

	it('prepends key block at the top when key does not exist and content has other keys', () => {
		const result = init_logic.merge_yaml_list_entry('other: value\n', 'extends', 'my-value')

		expect(result).toMatch(/^extends:\n {2}- my-value\n/u)
	})

	it('prepends key block at the top when content is non-empty', () => {
		const content = 'pre-commit:\n  commands:\n    test:\n      run: pnpm test\n'
		const result = init_logic.merge_yaml_list_entry(content, 'extends', 'my-value')

		expect(result.indexOf('extends:')).toBe(0)
		expect(result).toContain('pre-commit:')
	})
})
