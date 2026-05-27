import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ROUTE_NO_RESTRICTED_SYNTAX } from './rules/svelte.js'
import { create_sveltekit_config } from './sveltekit.js'

const GITIGNORE_PATH = new URL('../.gitignore', import.meta.url)
const TSCONFIG_ROOT_DIR = fileURLToPath(new URL('..', import.meta.url))
const MOCK_SVELTE_CONFIG = {}

const EXPECTED_SVELTE_FILE_PATTERNS = [
	'**/*.svelte',
	'**/*.svelte.ts',
	'**/*.svelte.test.ts',
	'**/*.svelte.spec.ts',
] as const

function find_routes_block(
	config: ReturnType<typeof create_sveltekit_config>,
): (typeof config)[number] | undefined {
	return config.find(
		(block) =>
			Array.isArray(block.files) &&
			block.files.includes('src/routes/**/+*.ts') &&
			block.files.includes('src/routes/**/+*.js'),
	)
}

describe('create_sveltekit_config — routes block', () => {
	it('applies ROUTE_NO_RESTRICTED_SYNTAX to route files', () => {
		const config = create_sveltekit_config({
			gitignore_path: GITIGNORE_PATH,
			tsconfig_root_dir: TSCONFIG_ROOT_DIR,
			svelte_config: MOCK_SVELTE_CONFIG,
		})

		const routes_block = find_routes_block(config)
		const rules = routes_block?.rules as Record<string, unknown>

		expect(rules['no-restricted-syntax']).toBe(ROUTE_NO_RESTRICTED_SYNTAX)
	})
})

describe('create_sveltekit_config — svelte file patterns', () => {
	it('applies rules to svelte component and test files', () => {
		const config = create_sveltekit_config({
			gitignore_path: GITIGNORE_PATH,
			tsconfig_root_dir: TSCONFIG_ROOT_DIR,
			svelte_config: MOCK_SVELTE_CONFIG,
		})

		const svelte_block = config.find(
			(block) =>
				Array.isArray(block.files) &&
				block.files.includes(EXPECTED_SVELTE_FILE_PATTERNS[0]) &&
				block.files.includes(EXPECTED_SVELTE_FILE_PATTERNS[1]),
		)

		expect(svelte_block).toBeDefined()
		expect(svelte_block?.files).toEqual(EXPECTED_SVELTE_FILE_PATTERNS)

		const rules = svelte_block?.rules as Record<string, unknown>

		expect(rules['unicorn/filename-case']).toEqual([
			'error',
			{ case: 'pascalCase', ignore: expect.any(Array) },
		])
	})
})
