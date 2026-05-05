import { describe, expect, it } from 'vitest'
import { init_logic_templates } from './init-logic-templates'

const DEFAULT_STYLESHEET = "tailwindStylesheet: './src/routes/layout.css'"
const APP_CSS_STYLESHEET = "tailwindStylesheet: './src/app.css'"
const KIT_PRETTIER_IMPORT = "from '@joshuafolkken/kit/prettier'"

describe('init_logic_templates.generate_eslint_config', () => {
	it('returns sveltekit config for sveltekit project type', () => {
		expect(init_logic_templates.generate_eslint_config('sveltekit')).toContain(
			'create_sveltekit_config',
		)
	})

	it('returns vanilla config for vanilla project type', () => {
		expect(init_logic_templates.generate_eslint_config('vanilla')).toContain(
			'create_vanilla_config',
		)
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

const DEFAULT_PLAYWRIGHT_CONFIG = `import { create_playwright_config } from '@joshuafolkken/kit/playwright/base'

export default create_playwright_config({
\tdev_port: 5173,
\tpreview_port: 4173,
})
`
const CUSTOM_DEV_PORT = 'dev_port: 3000'
const CUSTOM_PREVIEW_PORT = 'preview_port: 8080'

describe('init_logic_templates.generate_playwright_config', () => {
	it('contains create_playwright_config', () => {
		expect(init_logic_templates.generate_playwright_config()).toContain('create_playwright_config')
	})

	it('uses default ports when no args given', () => {
		expect(init_logic_templates.generate_playwright_config()).toBe(DEFAULT_PLAYWRIGHT_CONFIG)
	})

	it('uses provided ports when given', () => {
		const result = init_logic_templates.generate_playwright_config(3000, 8080)

		expect(result).toContain(CUSTOM_DEV_PORT)
		expect(result).toContain(CUSTOM_PREVIEW_PORT)
	})
})

describe('init_logic_templates.merge_playwright_config', () => {
	it('preserves custom dev_port from existing config', () => {
		const existing = `export default create_playwright_config({ dev_port: 3000, preview_port: 4173 })`

		expect(init_logic_templates.merge_playwright_config(existing)).toContain(CUSTOM_DEV_PORT)
	})

	it('preserves custom preview_port from existing config', () => {
		const existing = `export default create_playwright_config({ dev_port: 5173, preview_port: 8080 })`

		expect(init_logic_templates.merge_playwright_config(existing)).toContain(CUSTOM_PREVIEW_PORT)
	})

	it('falls back to default dev_port when missing', () => {
		const existing = `export default create_playwright_config({ preview_port: 4173 })`

		expect(init_logic_templates.merge_playwright_config(existing)).toContain('dev_port: 5173')
	})

	it('falls back to default preview_port when missing', () => {
		const existing = `export default create_playwright_config({ dev_port: 5173 })`

		expect(init_logic_templates.merge_playwright_config(existing)).toContain('preview_port: 4173')
	})

	it('returns idempotent result for default config', () => {
		expect(init_logic_templates.merge_playwright_config(DEFAULT_PLAYWRIGHT_CONFIG)).toBe(
			DEFAULT_PLAYWRIGHT_CONFIG,
		)
	})
})

describe('init_logic_templates.generate_vite_config', () => {
	it('contains the rollup-plugin-visualizer reference', () => {
		expect(init_logic_templates.generate_vite_config()).toContain('rollup-plugin-visualizer')
	})
})
