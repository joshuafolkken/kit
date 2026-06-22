import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import {
	CENTRALIZED_TESTS_DIRECTORY_PATTERNS,
	centralized_tests_directory_rules,
	SPEC_FILENAME_PATTERNS,
	spec_filename_rules,
} from './test-filename.js'

const ECMA_VERSION = 2024
const COLOCATED_TEST_FILE = 'src/lib/foo.test.ts'

// Minimal flat config mirroring how create_sveltekit_config wires the fragments:
// each rule object is scoped to its filename patterns. Linting with a virtual
// filename exercises the glob + rule combination without needing a real tsconfig.
function lint_as(file_name: string, source = ''): Array<Linter.LintMessage> {
	const linter = new Linter()

	return linter.verify(
		source,
		[
			{ languageOptions: { ecmaVersion: ECMA_VERSION, sourceType: 'module' } },
			{ files: SPEC_FILENAME_PATTERNS, rules: spec_filename_rules },
			{
				files: CENTRALIZED_TESTS_DIRECTORY_PATTERNS,
				rules: centralized_tests_directory_rules,
			},
		],
		file_name,
	)
}

function restricted_messages(file_name: string, source = ''): Array<Linter.LintMessage> {
	return lint_as(file_name, source).filter((message) => message.ruleId === 'no-restricted-syntax')
}

describe('test-filename — forbids *.spec.ts / *.spec.js', () => {
	it('flags a colocated *.spec.ts file', () => {
		const messages = restricted_messages('src/lib/foo.spec.ts')

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
