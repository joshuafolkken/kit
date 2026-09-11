import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import ts from 'typescript-eslint'
import { describe, expect, it, vi } from 'vitest'

// Everything in this file is asserted through ESLint's own resolution — `calculateConfigForFile`,
// `isPathIgnored` and `lintText` over this repository's real config — rather than by reading the
// blocks `create_base_config` returns. `base.test.ts` keeps the block-shape assertions; the split is
// what keeps every engine-driving test, and the budget they need, in one place.
//
// joshuafolkken/kit#1755: loading a cold flat config is seconds rather than milliseconds, and the
// suite pays it again whenever `pnpm josh gate` runs enough workers to saturate the CPU. On the
// default 10-second budget that reddened gates for changes touching neither ESLint's config nor any
// file these tests read. `scripts/lines/effective-limit.test.ts` and
// `scripts/cspell-distributed-words.test.ts` already declare their own budget for the same reason.
const LINT_PROBE_TIMEOUT_MS = 60_000

vi.setConfig({ testTimeout: LINT_PROBE_TIMEOUT_MS })

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

// One instance for the whole file. `lintText`, `calculateConfigForFile` and `isPathIgnored` only
// read, so a fresh instance per probe buys nothing and re-normalizes the flat config each time.
const linter = new ESLint({ cwd: REPO_ROOT })

// joshuafolkken/kit#1755. A canonical `*.test.ts` name is the one probe path here that no ban block
// matches, so it does not inherit their `disableTypeChecked` carry — and a probe is a virtual file
// no tsconfig lists, so typescript-eslint answered it by building the whole project and then
// reporting a parse error, at which point no rule ran at all. That cost a full TypeScript program
// on every run (1.3 s alone, 2.5 s inside the suite, past the budget under a saturated gate) and it
// made the assertion vacuous: the empty message list came from the parse error, not from the ban
// standing off. Disabling type-aware linting for this one instance removes an artifact of the file
// being virtual and nothing else — `no-restricted-syntax` is syntactic and reads no type
// information — and the fatal check in `restricted_syntax_messages` is what stops a parse error
// ever passing as an empty result again.
const untyped_linter = new ESLint({ cwd: REPO_ROOT, overrideConfig: ts.configs.disableTypeChecked })

type RuleMap = Record<string, unknown>

// Severity of a rule as ESLint itself resolves it for a given file. The block-shape assertions in
// `base.test.ts` prove the tests override carries the entries; this proves the entries actually
// win, and that no other block — scoped or unscoped — disables the rules on the source surface.
const OFF = 0
const ERROR = 2
const SOURCE_FILE = 'scripts/josh/josh.ts'
const TEST_FILE = 'eslint/base.test.ts'
const INIT_DECLARATIONS_RULE = 'init-declarations'
const FLOATING_POINT_EQUALITY_RULE = 'sonarjs/no-floating-point-equality'

async function resolve_rule_entry(file_path: string, rule_name: string): Promise<unknown> {
	const config = await linter.calculateConfigForFile(file_path)

	return (config.rules as RuleMap)[rule_name]
}

async function resolve_severity(file_path: string, rule_name: string): Promise<unknown> {
	const entry = await resolve_rule_entry(file_path, rule_name)

	return Array.isArray(entry) ? entry[0] : entry
}

describe('create_base_config — tests block (issue #867)', () => {
	it('resolves both rules to off for a test file', async () => {
		await expect(resolve_severity(TEST_FILE, INIT_DECLARATIONS_RULE)).resolves.toBe(OFF)
		await expect(resolve_severity(TEST_FILE, FLOATING_POINT_EQUALITY_RULE)).resolves.toBe(OFF)
	})

	it('keeps both rules at error for a non-test source file', async () => {
		await expect(resolve_severity(SOURCE_FILE, INIT_DECLARATIONS_RULE)).resolves.toBe(ERROR)
		await expect(resolve_severity(SOURCE_FILE, FLOATING_POINT_EQUALITY_RULE)).resolves.toBe(ERROR)
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
		expect(await linter.isPathIgnored(WORKTREE_FILE)).toBe(true)
		expect(await linter.isPathIgnored(NESTED_WORKTREE_FILE)).toBe(true)
		expect(await linter.isPathIgnored(SOURCE_FILE)).toBe(false)
	})
})

const RESTRICTED_SYNTAX_RULE = 'no-restricted-syntax'
const SPEC_BAN_FRAGMENT = 'the *.spec.* suffix is forbidden'
const CENTRALIZED_TESTS_BAN_FRAGMENT = 'A top-level tests/ directory is forbidden'
const PROBE_SOURCE = 'export const PROBE = 1\n'
const SPEC_PROBE_FILE = 'src/lib/probe.spec.ts'
const TESTS_PROBE_FILE = 'tests/probe.ts'
const CANONICAL_PROBE_FILE = 'scripts/probe.test.ts'

// joshuafolkken/kit#1233: asserted by running the repository's own config over a virtual file
// rather than by matching a glob, because the claim is that the ban reaches kit itself — which a
// block-shape assertion cannot show, since `eslint.config.js` may still switch the rule off after
// the base config sets it. The `.ts` cases are the load-bearing ones: they are the names the
// documents actually forbid, and they are the ones that report a tsconfig parse error instead of
// the rule's own message when the ban is wired without `disableTypeChecked`.
//
// joshuafolkken/kit#1755: a fatal message means the file never reached the rules at all, so
// filtering for one rule afterwards answers `[]` for a probe that asserted nothing. Every probe
// goes through that check here, so a parse error fails the test that caused it instead of passing
// quietly as an empty result.
async function restricted_syntax_messages(
	file_path: string,
	source = PROBE_SOURCE,
	probe = linter,
): Promise<Array<string>> {
	const [result] = await probe.lintText(source, { filePath: file_path })
	const messages = result?.messages ?? []

	expect(messages.filter((message) => message.fatal).map((message) => message.message)).toEqual([])

	return messages
		.filter((message) => message.ruleId === RESTRICTED_SYNTAX_RULE)
		.map((message) => message.message)
}

describe('create_base_config — the *.spec ban (issue #1233)', () => {
	it('flags a *.spec.ts file outside the tsconfig project, with the rule message', async () => {
		const messages = await restricted_syntax_messages(SPEC_PROBE_FILE)

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
		await expect(
			restricted_syntax_messages(CANONICAL_PROBE_FILE, PROBE_SOURCE, untyped_linter),
		).resolves.toEqual([])
	})
})

describe('create_base_config — the top-level tests/ ban (issue #1233)', () => {
	it('flags a tests/*.ts file with the rule message, not a tsconfig parse error', async () => {
		const messages = await restricted_syntax_messages(TESTS_PROBE_FILE)

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

// joshuafolkken/kit#1414, symptom 1: flat config replaces a rule's options rather than merging them,
// so a ban block that set `no-restricted-syntax` on its own silently took `code-quality.js`'s
// selectors away on exactly the files it applied to. Asserted by linting a banned file that also
// violates one of those selectors — a config-shape assertion cannot see which entry list wins.
const FOR_IN_SOURCE =
	'export const PROBE = { a: 1 }\nfor (const key in PROBE) globalThis.log(key)\n'
const FOR_IN_FRAGMENT = 'for..in loops iterate over the entire prototype chain'
const BAN_PLUS_SELECTOR = 2

describe('create_base_config — a banned file keeps the shared selectors (issue #1414)', () => {
	it('reports the *.spec ban and the code-quality selector on one file', async () => {
		const messages = await restricted_syntax_messages(SPEC_PROBE_FILE, FOR_IN_SOURCE)

		expect(messages).toHaveLength(BAN_PLUS_SELECTOR)
		expect(messages.join('\n')).toContain(FOR_IN_FRAGMENT)
	})

	it('reports the tests/ ban and the code-quality selector on one file', async () => {
		const messages = await restricted_syntax_messages(TESTS_PROBE_FILE, FOR_IN_SOURCE)

		expect(messages).toHaveLength(BAN_PLUS_SELECTOR)
		expect(messages.join('\n')).toContain(FOR_IN_FRAGMENT)
	})
})

// joshuafolkken/kit#1755: the canonical name's own positive control. `leaves the canonical *.test.ts
// name alone` asserts an absence, and an absence is only an answer once the rule is known to have
// run — which is exactly what the old arrangement could not show, since its empty list came from a
// parse error. `for..in` is one of `code-quality.js`'s shared selectors, so a probe that reports it
// has provably run `no-restricted-syntax` on that file and still not reported the ban.
describe('create_base_config — the canonical name runs the rule (issue #1755)', () => {
	it('reports the shared selector on a *.test.ts file, and no ban with it', async () => {
		const messages = await restricted_syntax_messages(
			CANONICAL_PROBE_FILE,
			FOR_IN_SOURCE,
			untyped_linter,
		)

		expect(messages).toHaveLength(1)
		expect(messages[0]).toContain(FOR_IN_FRAGMENT)
	})
})

// joshuafolkken/kit#1414, symptom 2: the globs listed `.ts` and `.js` only. The typed source is what
// makes these load-bearing. The ban blocks name no parser of their own — typescript-eslint's base
// block installs one with no `files` restriction, which is what reads `.mts` / `.cts` / `.tsx` — so
// these cases are the assertion that the arrangement holds: narrow that parser, or drop the
// `disableTypeChecked` carry, and the file reports a parse error instead of the rule's own message.
const TYPED_PROBE_SOURCE = 'export const PROBE: number = 1\n'
const TYPED_BAN_FILES = [
	'src/lib/probe.spec.tsx',
	'src/lib/probe.spec.mts',
	'src/lib/probe.spec.cts',
	'tests/probe.tsx',
	'tests/probe.mts',
	'tests/probe.cts',
]
const PLAIN_BAN_FILES = [
	'src/lib/probe.spec.jsx',
	'src/lib/probe.spec.mjs',
	'src/lib/probe.spec.cjs',
	'tests/probe.jsx',
	'tests/probe.mjs',
	'tests/probe.cjs',
]

describe('create_base_config — the bans reach every JS/TS extension (issue #1414)', () => {
	it.each(TYPED_BAN_FILES)('flags %s with the rule message, not a parse error', async (path) => {
		const messages = await restricted_syntax_messages(path, TYPED_PROBE_SOURCE)

		expect(messages).toHaveLength(1)
	})

	it.each(PLAIN_BAN_FILES)('flags %s', async (path) => {
		await expect(restricted_syntax_messages(path)).resolves.toHaveLength(1)
	})
})

// joshuafolkken/kit#1414, symptom 3: `FILE_PATTERNS.tests` listed `**/*.spec.ts`, so the same config
// banned a name and handed it the test relaxation. Read back through the linter's own resolution
// rather than off the block, because what has to hold is which block wins for that file.
const MAX_LINES_PER_FUNCTION_RULE = 'max-lines-per-function'
const DEFAULT_LINES_PER_FUNCTION = 25
const TEST_LINES_PER_FUNCTION = 35

async function resolve_options(file_path: string, rule_name: string): Promise<unknown> {
	const entry = await resolve_rule_entry(file_path, rule_name)

	return Array.isArray(entry) ? entry[1] : undefined
}

async function resolved_max_lines_per_function(file_path: string): Promise<unknown> {
	return await resolve_options(file_path, MAX_LINES_PER_FUNCTION_RULE)
}

describe('create_base_config — the test relaxation skips the banned name (issue #1414)', () => {
	it('leaves a *.spec.ts file on the default per-function limit', async () => {
		await expect(resolved_max_lines_per_function(SPEC_PROBE_FILE)).resolves.toMatchObject({
			max: DEFAULT_LINES_PER_FUNCTION,
		})
	})

	it('still raises it for the canonical *.test.ts name', async () => {
		await expect(resolved_max_lines_per_function('src/lib/probe.test.ts')).resolves.toMatchObject({
			max: TEST_LINES_PER_FUNCTION,
		})
	})
})
