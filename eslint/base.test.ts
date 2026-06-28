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

describe('create_base_config — scripts block (issue #442)', () => {
	it('turns off no-os-command-from-path and unbound-method for scripts', () => {
		const config = create_base_config({
			gitignore_path: GITIGNORE_PATH,
			tsconfig_root_dir: TSCONFIG_ROOT_DIR,
		})

		const scripts_block = config.find(
			(block) =>
				Array.isArray(block.files) &&
				block.files.some((pattern) => String(pattern).startsWith('scripts/')) &&
				typeof block.rules?.['unicorn/no-process-exit'] === 'string',
		)

		expect(scripts_block).toBeDefined()

		const rules = scripts_block?.rules as Record<string, unknown>

		expect(rules['sonarjs/no-os-command-from-path']).toBe('off')
		expect(rules['@typescript-eslint/unbound-method']).toBe('off')
	})
})

describe('create_base_config — scripts block (issue #525)', () => {
	it('turns off unicorn/no-exports-in-scripts for dual-purpose shebang modules', () => {
		const config = create_base_config({
			gitignore_path: GITIGNORE_PATH,
			tsconfig_root_dir: TSCONFIG_ROOT_DIR,
		})

		const scripts_block = config.find(
			(block) =>
				Array.isArray(block.files) &&
				block.files.some((pattern) => String(pattern).startsWith('scripts/')) &&
				typeof block.rules?.['unicorn/no-process-exit'] === 'string',
		)

		expect(scripts_block).toBeDefined()

		const rules = scripts_block?.rules as Record<string, unknown>

		expect(rules['unicorn/no-exports-in-scripts']).toBe('off')
	})
})

describe('create_base_config — tests block (issue #433)', () => {
	it('disables unicorn/no-useless-undefined for vi mock/stub patterns', () => {
		const config = create_base_config({
			gitignore_path: GITIGNORE_PATH,
			tsconfig_root_dir: TSCONFIG_ROOT_DIR,
		})

		const tests_block = config.find(
			(block) =>
				Array.isArray(block.files) &&
				block.files.some((pattern) => String(pattern).includes('*.test.ts')),
		)

		expect(tests_block).toBeDefined()

		const rules = tests_block?.rules as Record<string, unknown>

		expect(rules['unicorn/no-useless-undefined']).toBe('off')
	})

	it('includes **/*.e2e.ts so Playwright e2e specs inherit the test rules (issue #440)', () => {
		const config = create_base_config({
			gitignore_path: GITIGNORE_PATH,
			tsconfig_root_dir: TSCONFIG_ROOT_DIR,
		})

		const tests_block = config.find(
			(block) =>
				Array.isArray(block.files) &&
				block.files.some((pattern) => String(pattern).includes('*.test.ts')),
		)

		expect(tests_block).toBeDefined()
		expect(tests_block?.files).toContain('**/*.e2e.ts')
	})
})

const EXPLICIT_RETURN_TYPE_RULE = '@typescript-eslint/explicit-function-return-type'
const EXPLICIT_BOUNDARY_RULE = '@typescript-eslint/explicit-module-boundary-types'

describe('create_base_config — js block (issue #624)', () => {
	it('disables the annotation-presence rules for **/*.js (unsatisfiable in plain JS)', () => {
		const config = create_base_config({
			gitignore_path: GITIGNORE_PATH,
			tsconfig_root_dir: TSCONFIG_ROOT_DIR,
		})

		const js_block = config.find(
			(block) =>
				Array.isArray(block.files) && block.files.length === 1 && block.files[0] === '**/*.js',
		)

		expect(js_block).toBeDefined()

		const rules = js_block?.rules as Record<string, unknown>

		expect(rules[EXPLICIT_RETURN_TYPE_RULE]).toBe('off')
		expect(rules[EXPLICIT_BOUNDARY_RULE]).toBe('off')
	})

	it('keeps the annotation-presence rules enabled on the typed surface (no .ts regression)', () => {
		const config = create_base_config({
			gitignore_path: GITIGNORE_PATH,
			tsconfig_root_dir: TSCONFIG_ROOT_DIR,
		})

		// The project-wide rules block is uniquely identified by the @stylistic plugin
		// registration; it carries the typescript_rules that the .js block overrides.
		const global_block = config.find(
			(block) =>
				!('files' in block) &&
				Boolean((block.plugins as Record<string, unknown> | undefined)?.['@stylistic']),
		)

		expect(global_block).toBeDefined()

		const rules = global_block?.rules as Record<string, unknown>

		expect(rules[EXPLICIT_RETURN_TYPE_RULE]).not.toBe('off')
		expect(rules[EXPLICIT_BOUNDARY_RULE]).not.toBe('off')
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
