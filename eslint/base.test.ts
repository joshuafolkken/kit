import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { create_base_config } from './base.js'

// This file reads the blocks `create_base_config` returns and asserts their shape. Everything that
// drives the real ESLint engine over this repository's config — `calculateConfigForFile`,
// `isPathIgnored`, `lintText` — is `base-resolution.test.ts`, split out so the one budget those
// probes need is declared in one place (joshuafolkken/kit#1755).

const GITIGNORE_PATH = new URL('../.gitignore', import.meta.url)
const TSCONFIG_ROOT_DIR = fileURLToPath(new URL('..', import.meta.url))

type ConfigBlock = ReturnType<typeof create_base_config>[number]
type RuleMap = NonNullable<ConfigBlock['rules']>

function build_config(): Array<ConfigBlock> {
	return create_base_config({
		gitignore_path: GITIGNORE_PATH,
		tsconfig_root_dir: TSCONFIG_ROOT_DIR,
	})
}

// The name `includeIgnoreFile` gives the block it builds from a `.gitignore`.
const GITIGNORE_BLOCK_NAME = 'Imported .gitignore patterns'
const MISSING_GITIGNORE_PATH = new URL('no-such-directory/.gitignore', import.meta.url)

function has_gitignore_block(gitignore_path: URL): boolean {
	const config = create_base_config({ gitignore_path, tsconfig_root_dir: TSCONFIG_ROOT_DIR })

	return config.some((block) => block.name === GITIGNORE_BLOCK_NAME)
}

function rules_of(block: ConfigBlock | undefined): RuleMap {
	return block?.rules ?? {}
}

function has_file_pattern(block: ConfigBlock, fragment: string): boolean {
	return (
		Array.isArray(block.files) && block.files.some((pattern) => String(pattern).includes(fragment))
	)
}

function find_tests_block(config: Array<ConfigBlock>): ConfigBlock | undefined {
	return config.find((block) => has_file_pattern(block, '*.test.ts'))
}

// The scripts block is identified by its `scripts/` glob together with `unicorn/no-process-exit`.
function find_scripts_block(config: Array<ConfigBlock>): ConfigBlock | undefined {
	return config.find(
		(block) =>
			Array.isArray(block.files) &&
			block.files.some((pattern) => String(pattern).startsWith('scripts/')) &&
			typeof block.rules?.['unicorn/no-process-exit'] === 'string',
	)
}

// The project-wide rules block is uniquely identified by the @stylistic plugin registration:
// typescript-eslint's preset blocks and eslint-plugin-promise's recommended block carry
// overlapping rule keys, so matching on a rule name alone would find one of those instead.
function find_global_block(config: Array<ConfigBlock>): ConfigBlock | undefined {
	return config.find(
		(block) =>
			!('files' in block) &&
			Boolean((block.plugins as Record<string, unknown> | undefined)?.['@stylistic']),
	)
}

// joshuafolkken/kit#3653: `josh init` without Git writes no `.gitignore`, and the config it generates
// still names one — a missing file has to read as no patterns rather than stop lint with ENOENT.
describe('create_base_config — gitignore block (issue #3653)', () => {
	it('imports the patterns of a .gitignore that exists', () => {
		expect(has_gitignore_block(GITIGNORE_PATH)).toBe(true)
	})

	it('builds a config with no imported patterns when the .gitignore is missing', () => {
		expect(has_gitignore_block(MISSING_GITIGNORE_PATH)).toBe(false)
	})
})

// joshuafolkken/kit#2903 moved the `scripts-ai/` entry points under `scripts/`, so they follow the
// `scripts/` import rules and no block relaxes them any more.
describe('create_base_config — scripts block', () => {
	it('names no scripts-ai pattern in any block', () => {
		const scripts_ai_blocks = build_config().filter((block) =>
			has_file_pattern(block, 'scripts-ai'),
		)

		expect(scripts_ai_blocks).toStrictEqual([])
	})

	it('leaves no-restricted-imports on for scripts', () => {
		const scripts_block = find_scripts_block(build_config())

		expect(rules_of(scripts_block)['@typescript-eslint/no-restricted-imports']).toBeUndefined()
	})
})

// joshuafolkken/kit#3047: the local gate reports what Sonar's S9382 reports.
describe('create_base_config — global block', () => {
	it('reports an await inside a loop as an error', () => {
		const global_block = find_global_block(build_config())

		expect(rules_of(global_block)['no-await-in-loop']).toBe('error')
	})
})

describe('create_base_config — scripts block (issue #442)', () => {
	it('turns off no-os-command-from-path and unbound-method for scripts', () => {
		const scripts_block = find_scripts_block(build_config())

		expect(scripts_block).toBeDefined()

		const rules = rules_of(scripts_block)

		expect(rules['sonarjs/no-os-command-from-path']).toBe('off')
		expect(rules['@typescript-eslint/unbound-method']).toBe('off')
	})
})

describe('create_base_config — scripts block (issue #525)', () => {
	it('turns off unicorn/no-exports-in-scripts for dual-purpose shebang modules', () => {
		const scripts_block = find_scripts_block(build_config())

		expect(scripts_block).toBeDefined()
		expect(rules_of(scripts_block)['unicorn/no-exports-in-scripts']).toBe('off')
	})
})

const INIT_DECLARATIONS_RULE = 'init-declarations'
const FLOATING_POINT_EQUALITY_RULE = 'sonarjs/no-floating-point-equality'

describe('create_base_config — tests block (issue #433)', () => {
	it('disables unicorn/no-useless-undefined for vi mock/stub patterns', () => {
		const tests_block = find_tests_block(build_config())

		expect(tests_block).toBeDefined()
		expect(rules_of(tests_block)['unicorn/no-useless-undefined']).toBe('off')
	})

	it('includes **/*.e2e.ts so Playwright e2e specs inherit the test rules (issue #440)', () => {
		const tests_block = find_tests_block(build_config())

		expect(tests_block).toBeDefined()
		expect(tests_block?.files).toContain('**/*.e2e.ts')
	})
})

describe('create_base_config — tests block (issue #867)', () => {
	it('disables init-declarations and no-floating-point-equality for vitest idioms', () => {
		const tests_block = find_tests_block(build_config())

		expect(tests_block).toBeDefined()

		const rules = rules_of(tests_block)

		expect(rules[INIT_DECLARATIONS_RULE]).toBe('off')
		expect(rules[FLOATING_POINT_EQUALITY_RULE]).toBe('off')
	})
})

describe('create_base_config — tests block (issue #3273)', () => {
	it('disables no-unnecessary-parameters so fixture helpers keep their varying axis', () => {
		const rules = rules_of(find_tests_block(build_config()))

		expect(rules['unicorn/no-unnecessary-parameters']).toBe('off')
	})
})

const EXPLICIT_RETURN_TYPE_RULE = '@typescript-eslint/explicit-function-return-type'
const EXPLICIT_BOUNDARY_RULE = '@typescript-eslint/explicit-module-boundary-types'

describe('create_base_config — js block (issue #624)', () => {
	// `.mjs` / `.cjs` included (joshuafolkken/kit#2693): left on the typed surface, a hand-authored
	// module in either extension crashed the run on the first type-aware rule.
	it('disables type-aware and annotation-presence rules for .js, .mjs and .cjs', () => {
		const js_block = build_config().find(
			(block) =>
				Array.isArray(block.files) &&
				block.files.length === 1 &&
				block.files[0] === '**/*.{js,mjs,cjs}',
		)

		expect(js_block).toBeDefined()

		const rules = rules_of(js_block)

		expect(rules[EXPLICIT_RETURN_TYPE_RULE]).toBe('off')
		expect(rules[EXPLICIT_BOUNDARY_RULE]).toBe('off')
		expect(rules['@typescript-eslint/await-thenable']).toBe('off')
	})

	it('keeps the annotation-presence rules enabled on the typed surface (no .ts regression)', () => {
		const global_block = find_global_block(build_config())

		expect(global_block).toBeDefined()

		const rules = rules_of(global_block)

		expect(rules[EXPLICIT_RETURN_TYPE_RULE]).not.toBe('off')
		expect(rules[EXPLICIT_BOUNDARY_RULE]).not.toBe('off')
	})
})

describe('create_base_config — typescript block', () => {
	it('excludes .svelte.ts files from the TypeScript parser block', () => {
		const typescript_block = build_config().find(
			(block) => has_file_pattern(block, '**/*.ts') && 'languageOptions' in block,
		)

		expect(typescript_block).toBeDefined()
		expect(typescript_block?.ignores).toContain('**/*.svelte.ts')
	})
})

// `promise-function-async` guarantees that promise-returning functions are async, so
// `require-await` only adds an unsatisfiable constraint for functions with no awaitable
// work (async mocks). Both spellings must stay off for that pattern to lint cleanly.
describe('create_base_config — require-await', () => {
	it('turns off both spellings of require-await in the global block', () => {
		const rules = rules_of(find_global_block(build_config()))

		expect(rules['require-await']).toBe('off')
		expect(rules['@typescript-eslint/require-await']).toBe('off')
	})
})
