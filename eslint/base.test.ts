import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { create_base_config } from './base.js'

const GITIGNORE_PATH = new URL('../.gitignore', import.meta.url)
const TSCONFIG_ROOT_DIR = fileURLToPath(new URL('..', import.meta.url))

describe('create_base_config — scripts block', () => {
	it('includes scripts-ai in the scripts file pattern', () => {
		const config = create_base_config({
			gitignore_path: GITIGNORE_PATH,
			tsconfig_root_dir: TSCONFIG_ROOT_DIR,
		})

		const scripts_block = config.find(
			(block) =>
				Array.isArray(block.files) &&
				block.files.some((pattern) => String(pattern).includes('scripts-ai')),
		)

		expect(scripts_block).toBeDefined()
	})

	it('turns off no-restricted-imports for scripts-ai to allow ../scripts/ imports', () => {
		const config = create_base_config({
			gitignore_path: GITIGNORE_PATH,
			tsconfig_root_dir: TSCONFIG_ROOT_DIR,
		})

		const scripts_ai_block = config.find(
			(block) =>
				Array.isArray(block.files) &&
				block.files.every((pattern) => String(pattern).startsWith('scripts-ai/')),
		)

		expect(scripts_ai_block).toBeDefined()

		const rules = scripts_ai_block?.rules as Record<string, unknown>

		expect(rules['@typescript-eslint/no-restricted-imports']).toBe('off')
	})
})

describe('create_base_config — typescript block', () => {
	it('excludes .svelte.ts files from the TypeScript parser block', () => {
		const config = create_base_config({
			gitignore_path: GITIGNORE_PATH,
			tsconfig_root_dir: TSCONFIG_ROOT_DIR,
		})

		const typescript_block = config.find(
			(block) =>
				Array.isArray(block.files) &&
				block.files.some((pattern) => String(pattern).includes('**/*.ts')) &&
				'languageOptions' in block,
		)

		expect(typescript_block).toBeDefined()
		expect(typescript_block?.ignores).toContain('**/*.svelte.ts')
	})
})
