import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const GITIGNORE_DEST = '.gitignore'

describe('generate_eslint_config', () => {
	it('returns sveltekit config for sveltekit type', () => {
		expect(init_logic.generate_eslint_config('sveltekit')).toContain('create_sveltekit_config')
	})

	it('returns vanilla config for vanilla type', () => {
		expect(init_logic.generate_eslint_config('vanilla')).toContain('create_vanilla_config')
	})

	it('sveltekit config imports svelte.config.js', () => {
		expect(init_logic.generate_eslint_config('sveltekit')).toContain('./svelte.config.js')
	})
})

describe('generate_prettier_config', () => {
	it('imports config from the package', () => {
		expect(init_logic.generate_prettier_config()).toContain("from '@joshuafolkken/config/prettier'")
	})

	it('spreads config into export', () => {
		expect(init_logic.generate_prettier_config()).toContain('...config')
	})
})

describe('generate_tsconfig', () => {
	it('sveltekit includes svelte-kit extends and our config as direct jsonc path', () => {
		const result = init_logic.generate_tsconfig('sveltekit')

		expect(result).toContain('.svelte-kit/tsconfig.json')
		expect(result).toContain('node_modules/@joshuafolkken/config/tsconfig/sveltekit.jsonc')
	})

	it('vanilla includes only our config as direct jsonc path', () => {
		const result = init_logic.generate_tsconfig('vanilla')

		expect(result).toContain('node_modules/@joshuafolkken/config/tsconfig/base.jsonc')
		expect(result).not.toContain('.svelte-kit')
	})
})

describe('get_tsconfig_extends_entry', () => {
	it('returns direct node_modules jsonc path for each project type', () => {
		expect(init_logic.get_tsconfig_extends_entry('sveltekit')).toBe(
			'./node_modules/@joshuafolkken/config/tsconfig/sveltekit.jsonc',
		)
		expect(init_logic.get_tsconfig_extends_entry('vanilla')).toBe(
			'./node_modules/@joshuafolkken/config/tsconfig/base.jsonc',
		)
	})
})

describe('generate_lefthook_config', () => {
	it('sveltekit references the sveltekit yml', () => {
		expect(init_logic.generate_lefthook_config('sveltekit')).toContain('sveltekit.yml')
	})

	it('vanilla references the vanilla yml', () => {
		expect(init_logic.generate_lefthook_config('vanilla')).toContain('vanilla.yml')
	})
})

describe('generate_playwright_config', () => {
	it('imports create_playwright_config from the package', () => {
		expect(init_logic.generate_playwright_config()).toContain(
			"from '@joshuafolkken/config/playwright/base'",
		)
	})

	it('includes dev_port and preview_port', () => {
		const result = init_logic.generate_playwright_config()

		expect(result).toContain('dev_port')
		expect(result).toContain('preview_port')
	})
})

describe('get_ai_copy_files', () => {
	it('includes all AI markdown files', () => {
		const result = init_logic.get_ai_copy_files()

		expect(result).toContain('CLAUDE.md')
		expect(result).toContain('AGENTS.md')
		expect(result).toContain('GEMINI.md')
	})

	it('includes GitHub workflow and template files', () => {
		const result = init_logic.get_ai_copy_files()

		expect(result).toContain('.github/workflows/ci.yml')
		expect(result).toContain('.github/workflows/auto-tag.yml')
		expect(result).toContain('.github/workflows/production.yml')
		expect(result).toContain('.github/workflows/sonar-cube.yml')
		expect(result).toContain('.github/pull_request_template.md')
	})

	it('includes dotfiles and markdown files', () => {
		const result = init_logic.get_ai_copy_files()

		expect(result).toContain('.cursorrules')
		expect(result).toContain('.coderabbit.yaml')
		expect(result).toContain('.gitattributes')
		expect(result).not.toContain(GITIGNORE_DEST)
		expect(result).toContain('.mcp.json')
		expect(result).toContain('.ncurc.json')
		expect(result).toContain('.prettierignore')
		expect(result).toContain('SECURITY.md')
	})

	it('includes toolchain and sonar config files', () => {
		const result = init_logic.get_ai_copy_files()

		expect(result).toContain('pnpm-workspace.yaml')
		expect(result).toContain('tsconfig.sonar.json')
		expect(result).toContain('wrangler.jsonc')
		expect(result).not.toContain('sonar-project.properties')
	})
})

describe('get_ai_copy_file_mappings', () => {
	it('includes gitignore template mapping', () => {
		const result = init_logic.get_ai_copy_file_mappings()

		expect(result).toContainEqual({ src: 'templates/gitignore', dest: GITIGNORE_DEST })
	})

	it('does not duplicate gitignore in ai_copy_files', () => {
		expect(init_logic.get_ai_copy_files()).not.toContain(GITIGNORE_DEST)
	})
})

describe('get_ai_copy_directories', () => {
	it('includes prompts and scripts-ai', () => {
		const result = init_logic.get_ai_copy_directories()

		expect(result).toContain('prompts')
		expect(result).toContain('scripts-ai')
	})
})

describe('merge_npmrc', () => {
	const LINES = init_logic.get_npmrc_lines()
	const OTHER_LINE = 'other=value'
	const ALL_LINES = LINES.join('\n')

	it('adds all lines to empty content', () => {
		expect(init_logic.merge_npmrc('')).toBe(`${ALL_LINES}\n`)
	})

	it('appends missing lines to existing content', () => {
		const result = init_logic.merge_npmrc(`${OTHER_LINE}\n`)

		expect(result).toBe(`${OTHER_LINE}\n${ALL_LINES}\n`)
	})

	it('adds newline before appending when content lacks trailing newline', () => {
		const result = init_logic.merge_npmrc(OTHER_LINE)

		expect(result).toBe(`${OTHER_LINE}\n${ALL_LINES}\n`)
	})

	it('returns content unchanged when all lines already present', () => {
		const content = `${ALL_LINES}\n`

		expect(init_logic.merge_npmrc(content)).toBe(content)
	})

	it('adds only missing lines when some are already present', () => {
		const partial = `${LINES.slice(0, 1).join('')}\n`
		const result = init_logic.merge_npmrc(partial)

		for (const line of LINES) expect(result).toContain(line)
	})
})

describe('merge_json_extends', () => {
	it('adds extends when key is missing', () => {
		const result = JSON.parse(init_logic.merge_json_extends('{}', 'my-config')) as {
			extends: unknown
		}

		expect(result.extends).toStrictEqual(['my-config'])
	})

	it('converts string extends to array and prepends entry', () => {
		const result = JSON.parse(
			init_logic.merge_json_extends('{"extends":"existing"}', 'my-config'),
		) as { extends: unknown }

		expect(result.extends).toStrictEqual(['my-config', 'existing'])
	})

	it('prepends to existing array', () => {
		const result = JSON.parse(
			init_logic.merge_json_extends('{"extends":["existing"]}', 'my-config'),
		) as { extends: unknown }

		expect(result.extends).toStrictEqual(['my-config', 'existing'])
	})

	it('returns content unchanged when entry already in extends', () => {
		const content = '{"extends":["my-config"]}'
		const result = init_logic.merge_json_extends(content, 'my-config')

		expect(result).toBe(content)
	})

	it('handles tsconfig.json with JSONC line comments', () => {
		const content = '{\n\t// compiler options\n\t"extends": ["existing"]\n}'
		const result = JSON.parse(init_logic.merge_json_extends(content, 'my-config')) as {
			extends: unknown
		}

		expect(result.extends).toStrictEqual(['my-config', 'existing'])
	})
})

describe('merge_json_array_field', () => {
	it('adds values to an empty array', () => {
		const result = JSON.parse(
			init_logic.merge_json_array_field('{"recommendations":[]}', 'recommendations', ['a', 'b']),
		) as { recommendations: unknown }

		expect(result.recommendations).toStrictEqual(['a', 'b'])
	})

	it('adds only values not already present', () => {
		const result = JSON.parse(
			init_logic.merge_json_array_field('{"recommendations":["a"]}', 'recommendations', ['a', 'b']),
		) as { recommendations: unknown }

		expect(result.recommendations).toStrictEqual(['a', 'b'])
	})

	it('returns content unchanged when all values already present', () => {
		const content = '{"recommendations":["a","b"]}'
		const result = init_logic.merge_json_array_field(content, 'recommendations', ['a', 'b'])

		expect(result).toBe(content)
	})

	it('handles extensions.json with JSONC line comments', () => {
		const content = '{\n\t// extensions\n\t"recommendations": ["a"]\n}'
		const result = JSON.parse(
			init_logic.merge_json_array_field(content, 'recommendations', ['b']),
		) as { recommendations: unknown }

		expect(result.recommendations).toStrictEqual(['a', 'b'])
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

describe('get_suggested_scripts', () => {
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

describe('merge_package_scripts', () => {
	const SCRIPT_KEY = 'test:unit'
	const SCRIPT_VAL = 'vitest run'

	it('adds missing scripts', () => {
		const result = JSON.parse(
			init_logic.merge_package_scripts('{"scripts":{}}', { [SCRIPT_KEY]: SCRIPT_VAL }),
		) as { scripts: Record<string, string> }

		expect(result.scripts[SCRIPT_KEY]).toBe(SCRIPT_VAL)
	})

	it('does not overwrite existing scripts', () => {
		const result = JSON.parse(
			init_logic.merge_package_scripts(`{"scripts":{"${SCRIPT_KEY}":"existing"}}`, {
				[SCRIPT_KEY]: SCRIPT_VAL,
			}),
		) as { scripts: Record<string, string> }

		expect(result.scripts[SCRIPT_KEY]).toBe('existing')
	})

	it('returns content unchanged when all scripts present', () => {
		const content = `{"scripts":{"${SCRIPT_KEY}":"${SCRIPT_VAL}"}}`

		expect(init_logic.merge_package_scripts(content, { [SCRIPT_KEY]: SCRIPT_VAL })).toBe(content)
	})

	it('creates scripts key when missing from package json', () => {
		const result = JSON.parse(
			init_logic.merge_package_scripts('{}', { [SCRIPT_KEY]: SCRIPT_VAL }),
		) as { scripts: Record<string, string> }

		expect(result.scripts[SCRIPT_KEY]).toBe(SCRIPT_VAL)
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
