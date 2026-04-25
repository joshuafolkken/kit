import { describe, expect, it } from 'vitest'
import { init_logic_templates } from './init-logic-templates'

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
})

describe('init_logic_templates.generate_playwright_config', () => {
	it('contains create_playwright_config', () => {
		expect(init_logic_templates.generate_playwright_config()).toContain('create_playwright_config')
	})
})

describe('init_logic_templates.generate_vite_config', () => {
	it('contains the rollup-plugin-visualizer reference', () => {
		expect(init_logic_templates.generate_vite_config()).toContain('rollup-plugin-visualizer')
	})
})
