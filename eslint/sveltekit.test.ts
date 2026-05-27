import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ROUTE_NO_RESTRICTED_SYNTAX } from './rules/svelte.js'
import { create_sveltekit_config } from './sveltekit.js'

const GITIGNORE_PATH = new URL('../.gitignore', import.meta.url)
const TSCONFIG_ROOT_DIR = fileURLToPath(new URL('..', import.meta.url))
const MOCK_SVELTE_CONFIG = {}

const SVELTE_COMPONENT_GLOB = '**/*.svelte'
const SVELTE_TS_GLOB = '**/*.svelte.ts'

const EXPECTED_SVELTE_FILE_PATTERNS = [
	SVELTE_COMPONENT_GLOB,
	SVELTE_TS_GLOB,
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
	// findLast: flat config applies later-wins, so the rightmost block
	// with the rule is what actually takes effect.
	return config.findLast((block) => {
		const rules = block.rules as Record<string, unknown> | undefined

		return rules !== undefined && rule_name in rules
	})
}

function matches_patterns(
	files: unknown,
	expected: ReadonlyArray<string>,
): files is ReadonlyArray<string> {
	return (
		Array.isArray(files) &&
		files.length === expected.length &&
		expected.every((pattern) => files.includes(pattern))
	)
}

function find_svelte_files_block(
	config: ReturnType<typeof create_sveltekit_config>,
): (typeof config)[number] | undefined {
	// Match the rules block (4 patterns including .svelte.test.ts / .svelte.spec.ts),
	// not the parser-options block (2 patterns) which now lives in a separate flat-config entry.
	return config.find((block) => matches_patterns(block.files, EXPECTED_SVELTE_FILE_PATTERNS))
}

const EXPECTED_SVELTE_SRC_PATTERNS = [SVELTE_COMPONENT_GLOB, SVELTE_TS_GLOB] as const

function find_svelte_source_block(
	config: ReturnType<typeof create_sveltekit_config>,
): (typeof config)[number] | undefined {
	return config.find((block) => matches_patterns(block.files, EXPECTED_SVELTE_SRC_PATTERNS))
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

		const svelte_block = find_svelte_files_block(config)

		expect(svelte_block).toBeDefined()
		expect(svelte_block?.files).toEqual(EXPECTED_SVELTE_FILE_PATTERNS)

		const rules = svelte_block?.rules as Record<string, unknown>

		expect(rules['unicorn/filename-case']).toEqual([
			'error',
			{ case: 'pascalCase', ignore: expect.any(Array) },
		])
	})
})

interface LanguageOptionsShape {
	parserOptions?: { extraFileExtensions?: ReadonlyArray<string> }
}

describe('create_sveltekit_config — parser options scoping (regression #424)', () => {
	it('applies Svelte parserOptions only to .svelte / .svelte.ts source files', () => {
		const config = build_config()

		const source_block = find_svelte_source_block(config)
		const language_options = source_block?.languageOptions as LanguageOptionsShape | undefined

		expect(source_block?.files).toEqual(EXPECTED_SVELTE_SRC_PATTERNS)
		expect(language_options?.parserOptions?.extraFileExtensions).toEqual(['.svelte'])
	})

	it('does not apply Svelte parserOptions to the rules block (which covers .svelte.test.ts / .svelte.spec.ts)', () => {
		const config = build_config()

		const rules_block = find_svelte_files_block(config)
		const language_options = rules_block?.languageOptions as LanguageOptionsShape | undefined

		expect(language_options?.parserOptions?.extraFileExtensions).toBeUndefined()
	})
})

describe('create_sveltekit_config — unicorn/number-literal-case', () => {
	it('aligns hex literal case with prettier (lowercase) to avoid eslint↔prettier fix loop', () => {
		const config = build_config()

		const block = find_block_with_rule(config, 'unicorn/number-literal-case')
		const rules = block?.rules as Record<string, unknown>
		const rule_value = rules['unicorn/number-literal-case'] as [
			string,
			{ hexadecimalValue: string },
		]
		const [, { hexadecimalValue: hexadecimal_value }] = rule_value

		expect(hexadecimal_value).toBe('lowercase')
	})
})

describe('create_sveltekit_config — unicorn/prevent-abbreviations allowList', () => {
	it('allows idiomatic short identifiers (e, el, ctx, btn, idx, opts, params, args) plus Props', () => {
		const config = build_config()

		const svelte_block = find_svelte_files_block(config)
		const rules = svelte_block?.rules as Record<string, unknown>
		const rule_value = rules['unicorn/prevent-abbreviations'] as [
			string,
			{ allowList: Record<string, boolean> },
		]
		const [, { allowList: allow_list }] = rule_value

		expect(allow_list).toMatchObject({
			Props: true,
			e: true,
			el: true,
			ctx: true,
			btn: true,
			idx: true,
			opts: true,
			params: true,
			args: true,
		})
	})
})
