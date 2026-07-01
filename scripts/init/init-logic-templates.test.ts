import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { init_logic_templates } from './init-logic-templates'
import { PACKAGE_DIR } from './init-paths'

const DEFAULT_STYLESHEET = "tailwindStylesheet: './src/routes/layout.css'"
const APP_CSS_STYLESHEET = "tailwindStylesheet: './src/app.css'"
const KIT_PRETTIER_IMPORT = "from '@joshuafolkken/kit/prettier'"

const CREATE_VANILLA_CONFIG = 'create_vanilla_config'
const KIT_ESLINT_VANILLA_IMPORT = '@joshuafolkken/kit/eslint/vanilla'
const NO_CONSOLE_RULE = "'no-console': 'warn'"

describe('init_logic_templates.generate_eslint_config', () => {
	it('returns the vanilla config', () => {
		expect(init_logic_templates.generate_eslint_config()).toContain(CREATE_VANILLA_CONFIG)
	})
})

describe('init_logic_templates.generate_prettier_config', () => {
	it('contains the kit prettier module reference', () => {
		expect(init_logic_templates.generate_prettier_config()).toContain('@joshuafolkken/kit/prettier')
	})

	it('includes default tailwindStylesheet', () => {
		expect(init_logic_templates.generate_prettier_config()).toContain(DEFAULT_STYLESHEET)
	})

	it('uses provided stylesheet when given', () => {
		expect(init_logic_templates.generate_prettier_config('./src/app.css')).toContain(
			APP_CSS_STYLESHEET,
		)
	})
})

const VANILLA_CONFIG_WITH_RULES = `import js from '@eslint/js'
import ts from 'typescript-eslint'

export default ts.config(
\tjs.configs.recommended,
\t...ts.configs.recommended,
\t{
\t\trules: {
\t\t\t'no-console': 'warn',
\t\t\t'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
\t\t},
\t},
)
`

const STRICT_VANILLA_CONFIG = init_logic_templates.generate_eslint_config()

describe('init_logic_templates.merge_eslint_config', () => {
	it('preserves user-added rules when migrating vanilla config', () => {
		const result = init_logic_templates.merge_eslint_config(VANILLA_CONFIG_WITH_RULES)

		expect(result).toContain(NO_CONSOLE_RULE)
		expect(result).toContain("'no-unused-vars': ['error', { argsIgnorePattern: '^_' }]")
		expect(result).toContain(CREATE_VANILLA_CONFIG)
		expect(result).toContain(KIT_ESLINT_VANILLA_IMPORT)
	})
})

describe('init_logic_templates.merge_eslint_config fallbacks', () => {
	it('returns identical content for already-strict config (no-op)', () => {
		expect(init_logic_templates.merge_eslint_config(STRICT_VANILLA_CONFIG)).toBe(
			STRICT_VANILLA_CONFIG,
		)
	})

	it('returns identical content for hand-rolled non-vanilla config (safe fallback)', () => {
		const hand_rolled = `import { custom_config } from './my-config.js'\n\nexport default custom_config()\n`

		expect(init_logic_templates.merge_eslint_config(hand_rolled)).toBe(hand_rolled)
	})

	it('rewrites vanilla project config to create_vanilla_config shape', () => {
		const vanilla_project_config = `import js from '@eslint/js'\nimport ts from 'typescript-eslint'\n\nexport default ts.config(\n\tjs.configs.recommended,\n\t...ts.configs.recommended,\n)\n`
		const result = init_logic_templates.merge_eslint_config(vanilla_project_config)

		expect(result).toContain(CREATE_VANILLA_CONFIG)
		expect(result).toContain(KIT_ESLINT_VANILLA_IMPORT)
	})
})

describe('init_logic_templates.merge_prettier_config', () => {
	it('preserves tailwindStylesheet from new template format', () => {
		const existing = `import { config } from '@joshuafolkken/kit/prettier'\n\nexport default {\n\t...config,\n\ttailwindStylesheet: './src/app.css',\n}\n`

		expect(init_logic_templates.merge_prettier_config(existing)).toContain(APP_CSS_STYLESHEET)
	})

	it('preserves tailwindStylesheet from old JSON format', () => {
		const existing = `{\n\t"useTabs": true,\n\t"tailwindStylesheet": "./src/app.css"\n}`

		expect(init_logic_templates.merge_prettier_config(existing)).toContain(APP_CSS_STYLESHEET)
	})

	it('uses default when existing file has no tailwindStylesheet', () => {
		const existing = `import { config } from '@joshuafolkken/kit/prettier'\n\nexport default {\n\t...config,\n}\n`

		expect(init_logic_templates.merge_prettier_config(existing)).toContain(DEFAULT_STYLESHEET)
	})

	it('rewrites old format to use kit prettier import', () => {
		const existing = `{\n\t"useTabs": true,\n\t"singleQuote": true\n}`

		expect(init_logic_templates.merge_prettier_config(existing)).toContain(KIT_PRETTIER_IMPORT)
	})
})

const PLAYWRIGHT_CONFIG = readFileSync(path.join(PACKAGE_DIR, 'playwright.config.ts'), 'utf8')

describe('init_logic_templates.generate_playwright_config', () => {
	it('contains defineConfig and devices imports', () => {
		expect(init_logic_templates.generate_playwright_config()).toContain('defineConfig, devices')
	})

	it('returns the playwright.config.ts template file content', () => {
		expect(init_logic_templates.generate_playwright_config()).toBe(PLAYWRIGHT_CONFIG)
	})
})

const CI_YML_CONTENT = readFileSync(
	path.join(PACKAGE_DIR, 'templates', 'workflows', 'ci.yml'),
	'utf8',
)

describe('ci.yml template content', () => {
	it('does not have a separate build step before E2E (build runs inside webServer)', () => {
		expect(CI_YML_CONTENT).not.toContain('E2E_CLEANUP_ENABLED')
	})

	it('does not have a dedicated Build application step in the e2e job', () => {
		expect(CI_YML_CONTENT).not.toContain('Build application')
	})

	it('includes notify-auto-tag job that dispatches ci-passed-on-main event', () => {
		expect(CI_YML_CONTENT).toContain('notify-auto-tag')
		expect(CI_YML_CONTENT).toContain('ci-passed-on-main')
	})

	it('includes playwright-image job that resolves the image dynamically', () => {
		expect(CI_YML_CONTENT).toContain('playwright-image:')
		expect(CI_YML_CONTENT).toContain('steps.resolve.outputs.image')
	})

	it('has no hardcoded playwright docker image tag', () => {
		expect(CI_YML_CONTENT).not.toMatch(/mcr\.microsoft\.com\/playwright:v\d+\.\d+\.\d+-noble/u)
	})

	it('checks and e2e jobs reference the dynamic playwright image output', () => {
		expect(CI_YML_CONTENT).toContain('needs.playwright-image.outputs.image')
	})
})
