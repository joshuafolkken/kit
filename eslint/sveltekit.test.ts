import { fileURLToPath } from 'node:url'
import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import { ROUTE_NO_RESTRICTED_SYNTAX } from './rules/svelte.js'
import {
	CENTRALIZED_TESTS_DIRECTORY_PATTERNS,
	SPEC_FILENAME_PATTERNS,
} from './rules/test-filename.js'
import { create_sveltekit_config } from './sveltekit.js'

const ECMA_VERSION = 2024

function count_route_restricted_messages(source: string): number {
	const linter = new Linter()
	const messages = linter.verify(source, {
		languageOptions: { ecmaVersion: ECMA_VERSION, sourceType: 'module' },
		rules: { 'no-restricted-syntax': ROUTE_NO_RESTRICTED_SYNTAX as Linter.RuleEntry },
	})

	return messages.filter((message) => message.ruleId === 'no-restricted-syntax').length
}

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

		return rules !== undefined && Object.hasOwn(rules, rule_name)
	})
}

function is_pattern_match(
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
	return config.find((block) => is_pattern_match(block.files, EXPECTED_SVELTE_FILE_PATTERNS))
}

const EXPECTED_SVELTE_SRC_PATTERNS = [SVELTE_COMPONENT_GLOB, SVELTE_TS_GLOB] as const

function find_svelte_source_block(
	config: ReturnType<typeof create_sveltekit_config>,
): (typeof config)[number] | undefined {
	return config.find((block) => is_pattern_match(block.files, EXPECTED_SVELTE_SRC_PATTERNS))
}

describe('create_sveltekit_config — routes block', () => {
	it('applies ROUTE_NO_RESTRICTED_SYNTAX to route files', () => {
		const config = build_config()

		const routes_block = find_routes_block(config)
		const rules = routes_block?.rules as Record<string, unknown>

		expect(rules['no-restricted-syntax']).toBe(ROUTE_NO_RESTRICTED_SYNTAX)
	})
})

describe('ROUTE_NO_RESTRICTED_SYNTAX — arrow exports in route files (issue #474)', () => {
	it('allows the typed-const arrow form for route handler names', () => {
		expect(count_route_restricted_messages('export const load = () => {}')).toBe(0)
		expect(count_route_restricted_messages('export const GET = () => {}')).toBe(0)
		expect(count_route_restricted_messages('export const actions = () => {}')).toBe(0)
	})

	it('flags a non-handler arrow const export', () => {
		expect(count_route_restricted_messages('export const my_helper = () => {}')).toBe(1)
	})

	it('leaves function declarations and non-arrow exports unaffected', () => {
		expect(count_route_restricted_messages('export function GET() {}')).toBe(0)
		expect(count_route_restricted_messages('export function my_helper() {}')).toBe(0)
		expect(count_route_restricted_messages('export const prerender = true')).toBe(0)
	})

	it('keeps the for-in and labeled-statement guards', () => {
		expect(count_route_restricted_messages('for (const k in obj) {}')).toBe(1)
		expect(count_route_restricted_messages('outer: for (;;) {}')).toBe(1)
	})
})

describe('create_sveltekit_config — app.d.ts ignore (issue #474)', () => {
	it('ignores src/app.d.ts by default', () => {
		const config = build_config()

		const has_ignore_block = config.some(
			(block) =>
				Array.isArray(block.ignores) &&
				block.ignores.includes('src/app.d.ts') &&
				block.files === undefined,
		)

		expect(has_ignore_block).toBe(true)
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
			{ case: 'pascalCase', ignore: expect.any(Array), checkDirectories: false },
		])
	})

	it('disables checkDirectories on the Svelte filename-case override (regression #528)', () => {
		const config = build_config()

		const svelte_block = find_svelte_files_block(config)
		const rules = svelte_block?.rules as Record<string, unknown>
		const rule_value = rules['unicorn/filename-case'] as [string, { checkDirectories: boolean }]
		const [, options] = rule_value

		expect(options.checkDirectories).toBe(false)
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

		expect(rules_block).toBeDefined()
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

describe('create_sveltekit_config — sonarjs/no-use-of-empty-return-value (issue #434)', () => {
	it('disables the rule in the svelte override for {@render snippet()} false positives', () => {
		const config = build_config()

		const svelte_block = find_svelte_files_block(config)
		const rules = svelte_block?.rules as Record<string, unknown>

		expect(rules['sonarjs/no-use-of-empty-return-value']).toBe('off')
	})
})

describe('create_sveltekit_config — unicorn/prevent-abbreviations allowList (issue #435)', () => {
	it('applies the idiomatic-name allowList project-wide, including e2e for Playwright specs', () => {
		const config = build_config()

		// The allowList now lives in the project-wide unicorn rules block (eslint/rules/unicorn.js),
		// not the svelte override, so consumers get it for plain .ts files too.
		const block = find_block_with_rule(config, 'unicorn/prevent-abbreviations')
		const rules = block?.rules as Record<string, unknown>
		const rule_value = rules['unicorn/prevent-abbreviations'] as [
			string,
			{ allowList: Record<string, boolean> },
		]
		const [, { allowList: allow_list }] = rule_value

		expect(allow_list).toMatchObject({
			Props: true,
			e: true,
			e2e: true,
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

function get_restricted_syntax(files: ReadonlyArray<string>): { message?: string } | undefined {
	const config = build_config()
	const block = config.findLast((entry) => is_pattern_match(entry.files, files))
	const rules = block?.rules as Record<string, unknown> | undefined
	const rule_value = rules?.['no-restricted-syntax'] as [string, { message?: string }] | undefined

	return rule_value?.[1]
}

describe('create_sveltekit_config — test-filename enforcement (issue #593)', () => {
	it('wires a trailing block forbidding *.spec.ts / *.spec.js', () => {
		const option = get_restricted_syntax(SPEC_FILENAME_PATTERNS)

		expect(option?.message).toContain('*.test.ts')
	})

	it('wires a trailing block forbidding a top-level tests/ directory', () => {
		const option = get_restricted_syntax(CENTRALIZED_TESTS_DIRECTORY_PATTERNS)

		expect(option?.message).toContain('Colocate')
	})
})
