import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import {
	CLEAR_ALL_MOCKS_IN_BEFORE_EACH_ENTRY,
	MKDTEMP_SYNC_ENTRY,
	TEST_HELPER_BAN_ENTRIES,
	TEST_HELPER_BAN_PATTERNS,
} from './test-helper-bans.js'

const ECMA_VERSION = 2024
const TEST_FILE = 'scripts/example.test.ts'
const BARE_MKDTEMP_SYNC_CALL = "mkdtempSync('x')"

function banned_messages(source: string, file_name = TEST_FILE): Array<string> {
	const linter = new Linter()
	const messages = linter.verify(
		source,
		[
			// A config that matches every `.ts` file, so a module outside the ban is linted rather than
			// skipped for having no config.
			{
				files: ['**/*.ts'],
				languageOptions: { ecmaVersion: ECMA_VERSION, sourceType: 'module' },
			},
			{
				files: TEST_HELPER_BAN_PATTERNS,
				rules: { 'no-restricted-syntax': ['error', ...TEST_HELPER_BAN_ENTRIES] },
			},
		],
		file_name,
	)

	return messages.map((message) => message.message)
}

const flagged_cases = [
	{ name: 'a bare mkdtempSync call', source: BARE_MKDTEMP_SYNC_CALL, entry: MKDTEMP_SYNC_ENTRY },
	{ name: 'a member mkdtempSync call', source: "fs.mkdtempSync('x')", entry: MKDTEMP_SYNC_ENTRY },
	{
		name: 'vi.clearAllMocks() in a beforeEach callback',
		source: 'beforeEach(() => { vi.clearAllMocks() })',
		entry: CLEAR_ALL_MOCKS_IN_BEFORE_EACH_ENTRY,
	},
]

const allowed_cases = [
	{
		name: 'a mkdtempSync key in a vi.mock factory',
		source: 'vi.mock(m, () => ({ mkdtempSync: f }))',
	},
	{ name: 'mkdtempSync named in a string', source: "const NAME = 'mkdtempSync'" },
	{
		name: 'vi.clearAllMocks() inside a test body',
		source: "it('t', () => { vi.clearAllMocks() })",
	},
	{
		name: 'other work in a beforeEach callback',
		source: 'beforeEach(() => { vi.resetModules() })',
	},
]

describe('test-helper-bans', () => {
	it.each(flagged_cases)('flags $name', ({ source, entry }) => {
		expect(banned_messages(source)).toEqual([entry.message])
	})

	it.each(allowed_cases)('allows $name', ({ source }) => {
		expect(banned_messages(source)).toEqual([])
	})

	it('leaves a non-test module alone', () => {
		expect(banned_messages(BARE_MKDTEMP_SYNC_CALL, 'scripts/example.ts')).toEqual([])
	})
})
