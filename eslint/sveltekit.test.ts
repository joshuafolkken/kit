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

function build_config(): ReturnType<typeof create_sveltekit_config> {
	return create_sveltekit_config({
		gitignore_path: GITIGNORE_PATH,
		tsconfig_root_dir: TSCONFIG_ROOT_DIR,
		svelte_config: MOCK_SVELTE_CONFIG,
	})
}

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

function find_block_with_rule(
	config: ReturnType<typeof create_sveltekit_config>,
	rule_name: string,
): (typeof config)[number] | undefined {
	return config.find((block) => {
		const rules = block.rules as Record<string, unknown> | undefined

		return rules !== undefined && rule_name in rules
	})
}

describe('create_sveltekit_config — routes block', () => {
	it('applies ROUTE_NO_RESTRICTED_SYNTAX to route files', () => {
		const config = build_config()

		const routes_block = find_routes_block(config)
		const rules = routes_block?.rules as Record<string, unknown>

		expect(rules['no-restricted-syntax']).toBe(ROUTE_NO_RESTRICTED_SYNTAX)
	})
})

describe('create_sveltekit_config — import/extensions allowList', () => {
	it('bakes in js/json/svelte/opus allowList so consumers do not need to override', () => {
		const config = build_config()

		const block = find_block_with_rule(config, 'import/extensions')
		const rules = block?.rules as Record<string, unknown>
		const rule_value = rules['import/extensions'] as [
			string,
			{ pattern: { js: string; json: string; svelte: string; opus: string } },
		]
		const [, { pattern }] = rule_value

		expect(pattern.js).toBe('always')
		expect(pattern.json).toBe('always')
		expect(pattern.svelte).toBe('always')
		expect(pattern.opus).toBe('always')
	})
})

describe('create_sveltekit_config — svelte file patterns', () => {
	it('applies rules to svelte component and test files', () => {
		const config = build_config()

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
