import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const GITIGNORE_DEST = '.gitignore'
const CI_YML_DEST = '.github/workflows/ci.yml'

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
		expect(init_logic.generate_prettier_config()).toContain("from '@joshuafolkken/kit/prettier'")
	})

	it('spreads config into export', () => {
		expect(init_logic.generate_prettier_config()).toContain('...config')
	})
})

describe('generate_tsconfig', () => {
	it('sveltekit includes svelte-kit extends and our config as direct jsonc path', () => {
		const result = init_logic.generate_tsconfig('sveltekit')

		expect(result).toContain('.svelte-kit/tsconfig.json')
		expect(result).toContain('node_modules/@joshuafolkken/kit/tsconfig/sveltekit.jsonc')
	})

	it('vanilla includes only our config as direct jsonc path', () => {
		const result = init_logic.generate_tsconfig('vanilla')

		expect(result).toContain('node_modules/@joshuafolkken/kit/tsconfig/base.jsonc')
		expect(result).not.toContain('.svelte-kit')
	})
})

describe('get_tsconfig_extends_entry', () => {
	it('returns direct node_modules jsonc path for each project type', () => {
		expect(init_logic.get_tsconfig_extends_entry('sveltekit')).toBe(
			'./node_modules/@joshuafolkken/kit/tsconfig/sveltekit.jsonc',
		)
		expect(init_logic.get_tsconfig_extends_entry('vanilla')).toBe(
			'./node_modules/@joshuafolkken/kit/tsconfig/base.jsonc',
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
			"from '@joshuafolkken/kit/playwright/base'",
		)
	})

	it('includes dev_port and preview_port', () => {
		const result = init_logic.generate_playwright_config()

		expect(result).toContain('dev_port')
		expect(result).toContain('preview_port')
	})
})

describe('generate_vite_config', () => {
	it('contains visualizer import', () => {
		expect(init_logic.generate_vite_config()).toContain("from 'rollup-plugin-visualizer'")
	})

	it('contains visualizer plugin call', () => {
		expect(init_logic.generate_vite_config()).toContain(
			"visualizer({ open: true, filename: 'stats.html' })",
		)
	})
})

describe('get_ai_copy_files - AI and community files', () => {
	it('includes all AI markdown and community files', () => {
		const result = init_logic.get_ai_copy_files()

		expect(result).toContain('CLAUDE.md')
		expect(result).toContain('AGENTS.md')
		expect(result).toContain('GEMINI.md')
		expect(result).toContain('CODE_OF_CONDUCT.md')
	})

	it('includes GitHub workflow and template files (except ci.yml which uses file mapping)', () => {
		const result = init_logic.get_ai_copy_files()

		expect(result).not.toContain(CI_YML_DEST)
		expect(result).toContain('.github/workflows/auto-tag.yml')
		expect(result).toContain('.github/workflows/production.yml')
		expect(result).toContain('.github/workflows/sonar-cube.yml')
		expect(result).toContain('.github/pull_request_template.md')
		expect(result).toContain('.github/release.yml')
	})
})

describe('get_ai_copy_files - dotfiles and config', () => {
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

	it('includes ci.yml template mapping to .github/workflows/ci.yml', () => {
		const result = init_logic.get_ai_copy_file_mappings()

		expect(result).toContainEqual({
			src: 'templates/workflows/ci.yml',
			dest: CI_YML_DEST,
		})
	})

	it('does not duplicate gitignore in ai_copy_files', () => {
		expect(init_logic.get_ai_copy_files()).not.toContain(GITIGNORE_DEST)
	})
})

const RETIRED_SCRIPTS = [
	'lint',
	'lint:prettier',
	'lint:eslint',
	'format',
	'format:prettier',
	'format:eslint',
	'cspell',
	'cspell:dot',
	'test:unit',
	'test:e2e',
	'test',
	'lefthook:install',
	'lefthook:uninstall',
	'lefthook:commit',
	'lefthook:push',
	'main:sync',
	'main:merge',
	'latest',
	'latest:corepack',
	'latest:update',
	'check',
	'check:ci',
	'check:svelte',
	'check:svelte:ci',
]

const SIZE_LIMIT_SCRIPT = 'size-limit'

describe('get_suggested_scripts', () => {
	it('vanilla returns only postinstall and josh', () => {
		const result = init_logic.get_suggested_scripts('vanilla')

		expect(Object.keys(result)).toHaveLength(2)
		expect(result).toHaveProperty('postinstall')
		expect(result).toHaveProperty('josh')
	})

	it('sveltekit returns postinstall, josh, and size-limit', () => {
		const result = init_logic.get_suggested_scripts('sveltekit')

		expect(Object.keys(result)).toHaveLength(3)
		expect(result).toHaveProperty('postinstall')
		expect(result).toHaveProperty('josh')
		expect(result).toHaveProperty(SIZE_LIMIT_SCRIPT, SIZE_LIMIT_SCRIPT)
	})

	it('does not include retired script keys', () => {
		const vanilla = init_logic.get_suggested_scripts('vanilla')
		const sveltekit = init_logic.get_suggested_scripts('sveltekit')

		for (const key of RETIRED_SCRIPTS) {
			expect(vanilla).not.toHaveProperty(key)
			expect(sveltekit).not.toHaveProperty(key)
		}
	})
})

describe('merge_package_scripts retired scripts', () => {
	it('removes retired script keys from existing package.json content', () => {
		const content = JSON.stringify({
			scripts: { lint: 'pnpm lint:prettier && pnpm lint:eslint', josh: 'josh' },
		})
		const result = init_logic.merge_package_scripts(content, {})

		expect(result).not.toContain('"lint"')
		expect(result).toContain('"josh"')
	})

	it('removes all retired managed scripts', () => {
		const existing = Object.fromEntries(RETIRED_SCRIPTS.map((k) => [k, 'some-value']))
		const content = JSON.stringify({ scripts: { ...existing, josh: 'josh' } })
		const result = JSON.parse(init_logic.merge_package_scripts(content, {})) as {
			scripts: Record<string, string>
		}

		for (const key of RETIRED_SCRIPTS) {
			expect(result.scripts).not.toHaveProperty(key)
		}

		expect(result.scripts).toHaveProperty('josh')
	})
})

describe('get_ai_copy_directories', () => {
	it('returns an empty array', () => {
		expect(init_logic.get_ai_copy_directories()).toHaveLength(0)
	})
})

describe('get_npmrc_lines', () => {
	it('includes the GitHub Packages auth token line', () => {
		expect(init_logic.get_npmrc_lines()).toContain(
			'//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}',
		)
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
