import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import {
	CENTRALIZED_TESTS_DIRECTORY_ENTRY,
	CENTRALIZED_TESTS_DIRECTORY_PATTERNS,
	centralized_tests_directory_rules,
	extend_restricted_syntax,
	SPEC_FILENAME_ENTRY,
	SPEC_FILENAME_PATTERNS,
	spec_filename_rules,
} from './test-filename.js'

const ECMA_VERSION = 2024
const COLOCATED_TEST_FILE = 'src/lib/foo.test.ts'
const SPEC_FILE = 'src/lib/foo.spec.ts'
const RESTRICTED_SYNTAX_RULE = 'no-restricted-syntax'

// A stand-in for whatever `no-restricted-syntax` the surrounding config already carries — kit's base
// composes the ban onto `eslint/rules/code-quality.js`. Importing that module here would tie this
// suite to rules that are not part of the standalone building blocks it covers, so the shape is
// mirrored rather than borrowed (joshuafolkken/kit#1414).
const SURROUNDING_ENTRY = { selector: 'ForInStatement', message: 'no for..in' }
const SURROUNDING_RESTRICTION: Linter.RulesRecord = {
	[RESTRICTED_SYNTAX_RULE]: ['error', SURROUNDING_ENTRY],
}

// A source that trips the stand-in selector, so the wiring above is self-checking: drop the
// composition and this file's own cases fall from two reports to one (joshuafolkken/kit#1414).
const FOR_IN_SOURCE = 'const PROBE = { a: 1 }\nfor (const key in PROBE) globalThis.log(key)\n'
const BAN_PLUS_SURROUNDING = 2

// Minimal flat config mirroring how the kit eslint config wires the fragments: each ban is composed
// onto the surrounding restriction and scoped to its filename patterns. Linting with a virtual
// filename exercises the glob + rule combination without needing a real tsconfig.
function lint_as(file_name: string, source = ''): Array<Linter.LintMessage> {
	const linter = new Linter()

	return linter.verify(
		source,
		[
			{ languageOptions: { ecmaVersion: ECMA_VERSION, sourceType: 'module' } },
			{
				files: SPEC_FILENAME_PATTERNS,
				rules: extend_restricted_syntax(SURROUNDING_RESTRICTION, SPEC_FILENAME_ENTRY),
			},
			{
				files: CENTRALIZED_TESTS_DIRECTORY_PATTERNS,
				rules: extend_restricted_syntax(SURROUNDING_RESTRICTION, CENTRALIZED_TESTS_DIRECTORY_ENTRY),
			},
		],
		file_name,
	)
}

function restricted_messages(file_name: string, source = ''): Array<Linter.LintMessage> {
	return lint_as(file_name, source).filter((message) => message.ruleId === RESTRICTED_SYNTAX_RULE)
}

describe('test-filename — forbids *.spec.ts / *.spec.js', () => {
	it('flags a colocated *.spec.ts file', () => {
		const messages = restricted_messages(SPEC_FILE)

		expect(messages).toHaveLength(1)
		expect(messages[0]?.message).toContain('*.test.ts')
	})

	it('flags *.spec.js', () => {
		expect(restricted_messages('src/lib/foo.spec.js')).toHaveLength(1)
	})

	it('flags *.svelte.spec.ts (the component-test drift form)', () => {
		expect(restricted_messages('src/lib/Foo.svelte.spec.ts')).toHaveLength(1)
	})

	it('allows the canonical *.test.ts and *.svelte.test.ts names', () => {
		expect(restricted_messages(COLOCATED_TEST_FILE)).toHaveLength(0)
		expect(restricted_messages('src/lib/Foo.svelte.test.ts')).toHaveLength(0)
	})

	it('reports even on an empty spec file (Program node always exists)', () => {
		expect(restricted_messages('src/lib/empty.spec.ts', '')).toHaveLength(1)
	})
})

describe('test-filename — forbids a top-level tests/ directory', () => {
	it('flags a file under top-level tests/', () => {
		const messages = restricted_messages('tests/foo.test.ts')

		expect(messages).toHaveLength(1)
		expect(messages[0]?.message).toContain('Colocate')
	})

	it('does not flag a nested src/.../tests path (only top-level tests/)', () => {
		expect(restricted_messages('src/lib/tests/foo.test.ts')).toHaveLength(0)
	})

	it('does not flag a colocated test outside tests/', () => {
		expect(restricted_messages(COLOCATED_TEST_FILE)).toHaveLength(0)
	})
})

// joshuafolkken/kit#1414: the globs used to list `.ts` and `.js` only, so `Foo.spec.tsx`,
// `tests/foo.mts` and every other extension in this ecosystem walked past both bans while the
// documents claimed the top-level directory itself was forbidden.
const BANNED_SPEC_FILES = [
	'src/lib/Foo.spec.tsx',
	'src/lib/foo.spec.mts',
	'src/lib/foo.spec.cts',
	'src/lib/foo.spec.jsx',
	'src/lib/foo.spec.mjs',
	'src/lib/foo.spec.cjs',
]

const BANNED_TESTS_DIRECTORY_FILES = [
	'tests/foo.tsx',
	'tests/foo.mts',
	'tests/foo.cts',
	'tests/foo.jsx',
	'tests/foo.mjs',
	'tests/foo.cjs',
]

describe('test-filename — both bans cover every JS/TS extension (issue #1414)', () => {
	it.each(BANNED_SPEC_FILES)('flags %s', (file_name) => {
		expect(restricted_messages(file_name)).toHaveLength(1)
	})

	it.each(BANNED_TESTS_DIRECTORY_FILES)('flags %s', (file_name) => {
		expect(restricted_messages(file_name)).toHaveLength(1)
	})

	// The one deliberate omission: the base config has no Svelte parser, so a `.svelte` file in the
	// glob would report a parse error instead of the move instruction the ban exists to give.
	it('leaves a .svelte file outside both bans', () => {
		expect(restricted_messages('tests/Foo.svelte')).toHaveLength(0)
	})
})

describe('test-filename — the composed wiring keeps the surrounding restriction (issue #1414)', () => {
	it('reports the spec ban beside the surrounding selector', () => {
		expect(restricted_messages(SPEC_FILE, FOR_IN_SOURCE)).toHaveLength(BAN_PLUS_SURROUNDING)
	})

	it('reports the tests/ ban beside the surrounding selector', () => {
		expect(restricted_messages('tests/foo.ts', FOR_IN_SOURCE)).toHaveLength(BAN_PLUS_SURROUNDING)
	})
})

// joshuafolkken/kit#1414: flat config replaces a rule's options rather than merging them, so a ban
// set on its own erases whatever the shared config already restricted. This is the composition that
// prevents it; the base config's own wiring is asserted end to end in `eslint/base.test.ts`.
describe('extend_restricted_syntax (issue #1414)', () => {
	const BASE_RULES: Linter.RulesRecord = { [RESTRICTED_SYNTAX_RULE]: ['error', SURROUNDING_ENTRY] }

	it('keeps the existing entries and appends the ban after them', () => {
		const rules = extend_restricted_syntax(BASE_RULES, SPEC_FILENAME_ENTRY)

		expect(rules[RESTRICTED_SYNTAX_RULE]).toEqual(['error', SURROUNDING_ENTRY, SPEC_FILENAME_ENTRY])
	})

	it('falls back to the ban alone when the base restricts nothing', () => {
		const rules = extend_restricted_syntax({}, SPEC_FILENAME_ENTRY)

		expect(rules[RESTRICTED_SYNTAX_RULE]).toEqual(['error', SPEC_FILENAME_ENTRY])
	})
})

// The two ready-made records stay a public subpath export (`@joshuafolkken/kit/eslint/test-filename`)
// for a config that does not use kit's base. They carry the ban alone on purpose — composing kit's
// own selectors into them would push rules a standalone consumer never asked for — which is exactly
// why the module documents `extend_restricted_syntax` as the way to keep the surrounding
// restrictions (joshuafolkken/kit#1414).
describe('test-filename — the standalone records carry the ban alone', () => {
	it('sets no-restricted-syntax to the spec ban', () => {
		expect(spec_filename_rules[RESTRICTED_SYNTAX_RULE]).toEqual(['error', SPEC_FILENAME_ENTRY])
	})

	it('sets no-restricted-syntax to the tests/ ban', () => {
		expect(centralized_tests_directory_rules[RESTRICTED_SYNTAX_RULE]).toEqual([
			'error',
			CENTRALIZED_TESTS_DIRECTORY_ENTRY,
		])
	})
})
