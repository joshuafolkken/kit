import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import { create_base_config } from './base.js'

const GITIGNORE_PATH = new URL('../.gitignore', import.meta.url)
const TSCONFIG_ROOT_DIR = fileURLToPath(new URL('..', import.meta.url))
const REPO_ROOT = TSCONFIG_ROOT_DIR

type ConfigBlock = ReturnType<typeof create_base_config>[number]
type RuleMap = NonNullable<ConfigBlock['rules']>

function build_config(): Array<ConfigBlock> {
	return create_base_config({
		gitignore_path: GITIGNORE_PATH,
		tsconfig_root_dir: TSCONFIG_ROOT_DIR,
	})
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

// The scripts block is identified by `unicorn/no-process-exit`: the scripts-ai block shares the
// `scripts-ai/` glob but carries a different rule set.
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

describe('create_base_config — scripts block', () => {
	it('includes scripts-ai in the scripts file pattern', () => {
		const scripts_block = build_config().find((block) => has_file_pattern(block, 'scripts-ai'))

		expect(scripts_block).toBeDefined()
	})

	it('turns off no-restricted-imports for scripts-ai to allow ../scripts/ imports', () => {
		const scripts_ai_block = build_config().find(
			(block) =>
				Array.isArray(block.files) &&
				block.files.every((pattern) => String(pattern).startsWith('scripts-ai/')),
		)

		expect(scripts_ai_block).toBeDefined()
		expect(rules_of(scripts_ai_block)['@typescript-eslint/no-restricted-imports']).toBe('off')
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

// Severity of a rule as ESLint itself resolves it for a given file. The block-shape assertions
// above prove the tests override carries the entries; this proves the entries actually win, and
// that no other block — scoped or unscoped — disables the rules on the source surface.
const OFF = 0
const ERROR = 2
const SOURCE_FILE = 'scripts/josh/josh.ts'
const TEST_FILE = 'eslint/base.test.ts'

async function resolve_severity(file_path: string, rule_name: string): Promise<unknown> {
	const linter = new ESLint({ cwd: REPO_ROOT })
	const config = await linter.calculateConfigForFile(file_path)
	const entry = (config.rules as RuleMap)[rule_name]

	return Array.isArray(entry) ? entry[0] : entry
}

describe('create_base_config — tests block (issue #867)', () => {
	it('disables init-declarations and no-floating-point-equality for vitest idioms', () => {
		const tests_block = find_tests_block(build_config())

		expect(tests_block).toBeDefined()

		const rules = rules_of(tests_block)

		expect(rules[INIT_DECLARATIONS_RULE]).toBe('off')
		expect(rules[FLOATING_POINT_EQUALITY_RULE]).toBe('off')
	})

	it('resolves both rules to off for a test file', async () => {
		await expect(resolve_severity(TEST_FILE, INIT_DECLARATIONS_RULE)).resolves.toBe(OFF)
		await expect(resolve_severity(TEST_FILE, FLOATING_POINT_EQUALITY_RULE)).resolves.toBe(OFF)
	})

	it('keeps both rules at error for a non-test source file', async () => {
		await expect(resolve_severity(SOURCE_FILE, INIT_DECLARATIONS_RULE)).resolves.toBe(ERROR)
		await expect(resolve_severity(SOURCE_FILE, FLOATING_POINT_EQUALITY_RULE)).resolves.toBe(ERROR)
	})
})

const EXPLICIT_RETURN_TYPE_RULE = '@typescript-eslint/explicit-function-return-type'
const EXPLICIT_BOUNDARY_RULE = '@typescript-eslint/explicit-module-boundary-types'

describe('create_base_config — js block (issue #624)', () => {
	it('disables the annotation-presence rules for **/*.js (unsatisfiable in plain JS)', () => {
		const js_block = build_config().find(
			(block) =>
				Array.isArray(block.files) && block.files.length === 1 && block.files[0] === '**/*.js',
		)

		expect(js_block).toBeDefined()

		const rules = rules_of(js_block)

		expect(rules[EXPLICIT_RETURN_TYPE_RULE]).toBe('off')
		expect(rules[EXPLICIT_BOUNDARY_RULE]).toBe('off')
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

// joshuafolkken/kit#1112: asserted through the linter's own ignore resolution rather than by
// matching the glob in the config, because what has to hold is that eslint does not open the file —
// and a glob that reads correctly can still miss, since these paths are relative to the project
// root while a work tree's files are addressed through it. The second expectation is the other half
// of the same claim: an exclusion wide enough to catch a work tree must not reach the project's own
// sources, which sit one directory away from it.
describe('create_base_config — nested checkouts', () => {
	const WORKTREE_FILE = '.claude/worktrees/bridge-example/env/index.js'
	// A monorepo puts a package's work trees here, and a root-anchored pattern would lint them all.
	const NESTED_WORKTREE_FILE = 'packages/web/.claude/worktrees/bridge-example/env/index.js'

	it('does not lint a bridge work tree, and still lints the project', async () => {
		const linter = new ESLint({ cwd: REPO_ROOT })

		expect(await linter.isPathIgnored(WORKTREE_FILE)).toBe(true)
		expect(await linter.isPathIgnored(NESTED_WORKTREE_FILE)).toBe(true)
		expect(await linter.isPathIgnored(SOURCE_FILE)).toBe(false)
	})
})

const RESTRICTED_SYNTAX_RULE = 'no-restricted-syntax'
const SPEC_BAN_FRAGMENT = 'the *.spec.ts / *.spec.js suffix is forbidden'
const CENTRALIZED_TESTS_BAN_FRAGMENT = 'A top-level tests/ directory is forbidden'
const PROBE_SOURCE = 'export const PROBE = 1\n'

// joshuafolkken/kit#1233: asserted by running the repository's own config over a virtual file
// rather than by matching a glob, because the claim is that the ban reaches kit itself — which a
// block-shape assertion cannot show, since `eslint.config.js` may still switch the rule off after
// the base config sets it. The `.ts` cases are the load-bearing ones: they are the names the
// documents actually forbid, and they are the ones that report a tsconfig parse error instead of
// the rule's own message when the ban is wired without `disableTypeChecked`.
async function restricted_syntax_messages(file_path: string): Promise<Array<string>> {
	const linter = new ESLint({ cwd: REPO_ROOT })
	const [result] = await linter.lintText(PROBE_SOURCE, { filePath: file_path })

	return (result?.messages ?? [])
		.filter((message) => message.ruleId === RESTRICTED_SYNTAX_RULE)
		.map((message) => message.message)
}

describe('create_base_config — the *.spec ban (issue #1233)', () => {
	it('flags a *.spec.ts file outside the tsconfig project, with the rule message', async () => {
		const messages = await restricted_syntax_messages('src/lib/probe.spec.ts')

		expect(messages).toHaveLength(1)
		expect(messages[0]).toContain(SPEC_BAN_FRAGMENT)
	})

	it('flags a *.spec.js file too', async () => {
		await expect(restricted_syntax_messages('src/lib/probe.spec.js')).resolves.toHaveLength(1)
	})

	// `eslint/*.js` is one of the directories whose trailing block switches `no-restricted-syntax`
	// off for the export-convention selectors; the ban has to survive that.
	it('flags a *.spec.js under a directory that relaxes no-restricted-syntax', async () => {
		await expect(restricted_syntax_messages('eslint/probe.spec.js')).resolves.toHaveLength(1)
	})

	it('leaves the canonical *.test.ts name alone', async () => {
		await expect(restricted_syntax_messages('scripts/probe.test.ts')).resolves.toEqual([])
	})
})

describe('create_base_config — the top-level tests/ ban (issue #1233)', () => {
	it('flags a tests/*.ts file with the rule message, not a tsconfig parse error', async () => {
		const messages = await restricted_syntax_messages('tests/probe.ts')

		expect(messages).toHaveLength(1)
		expect(messages[0]).toContain(CENTRALIZED_TESTS_BAN_FRAGMENT)
	})

	it('flags a tests/*.js file too', async () => {
		await expect(restricted_syntax_messages('tests/probe.js')).resolves.toHaveLength(1)
	})

	it('does not flag a nested tests/ path (only the top-level directory)', async () => {
		await expect(restricted_syntax_messages('src/lib/tests/probe.js')).resolves.toEqual([])
	})
})
