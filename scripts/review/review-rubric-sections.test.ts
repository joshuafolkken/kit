import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'
import { review_brief } from './review-brief'
import { review_rubric_sections } from './review-rubric-sections'

const RUBRIC = read_repo_file(review_brief.RUBRIC_RELATIVE_PATH)
const ROUND_ONE = 1
const ROUND_TWO = 2
const { ROUND_TWO_SECTION, omitted_headings, trim } = review_rubric_sections
const SECURITY = '### 2. Security'
const PERFORMANCE = '### 3. Performance'
const I18N = '### 5. i18n'
const TESTS = '### 6. Tests'
const AFTER = '## After'

const OMISSION_CASES: ReadonlyArray<[string, Array<string>, Array<string>]> = [
	['code only', ['scripts/a.ts'], [ROUND_TWO_SECTION, I18N]],
	[
		'tests only',
		['scripts/a.test.ts', 'e2e/b.spec.ts'],
		[ROUND_TWO_SECTION, SECURITY, PERFORMANCE, I18N],
	],
	[
		'code under a test directory',
		['scripts/test/a.ts', 'tools/test/b.ts'],
		[ROUND_TWO_SECTION, I18N],
	],
	[
		'docs only',
		['prompts/a.md', 'docs/b.md'],
		[ROUND_TWO_SECTION, SECURITY, PERFORMANCE, I18N, TESTS],
	],
	['config only', ['package.json', '.gitignore'], [ROUND_TWO_SECTION, PERFORMANCE, I18N]],
	['ui', ['src/routes/+page.svelte'], [ROUND_TWO_SECTION]],
	['mixed docs and tests', ['a.md', 'a.test.ts'], [ROUND_TWO_SECTION, SECURITY, PERFORMANCE, I18N]],
]

describe('omitted_headings', () => {
	it.each(OMISSION_CASES)('leaves out what a %s diff cannot trigger', (_label, paths, expected) => {
		expect(omitted_headings(paths, ROUND_ONE)).toStrictEqual(expected)
	})

	it.each([
		['an empty diff', []],
		['a path of no known kind', ['a.md', '.husky/pre-commit-hook/run']],
		['an extensionless file', ['a.md', 'LICENSE']],
	])('keeps every section for %s', (_label, paths) => {
		expect(omitted_headings(paths, ROUND_ONE)).toStrictEqual([])
	})

	it('keeps the round-two section in round 2', () => {
		expect(omitted_headings(['a.md'], ROUND_TWO)).toStrictEqual([
			SECURITY,
			PERFORMANCE,
			I18N,
			TESTS,
		])
	})
})

describe('trim', () => {
	it('returns the rubric unchanged when nothing can go', () => {
		expect(trim(RUBRIC, ['LICENSE'], ROUND_ONE)).toBe(RUBRIC)
	})

	it('names only headings the rubric has, so an omission never silently misses', () => {
		const lines = new Set(RUBRIC.split('\n'))
		const headings = [ROUND_TWO_SECTION, SECURITY, PERFORMANCE, I18N, TESTS]

		expect(headings.filter((heading) => !lines.has(heading))).toStrictEqual([])
	})

	it('drops each omitted section to its next sibling and keeps the rest', () => {
		const trimmed = trim(RUBRIC, ['a.md'], ROUND_ONE)

		expect(trimmed).not.toContain(SECURITY)
		expect(trimmed).not.toContain('Injection (SQL')
		expect(trimmed).not.toContain('Mutation check')
		expect(trimmed).not.toContain('### First-round findings')
		expect(trimmed).toContain('### 4. Project conventions')
		expect(trimmed).toContain('### 7. Comments & content')
		expect(trimmed).toContain('## Review output format')
		expect(trimmed).toContain('## Stop conditions')
		expect(trimmed).toContain('"2. Security"')
	})
})

describe('trim around code fences', () => {
	it('reads a heading inside a code fence as text, not a section boundary', () => {
		const text = [
			'# R',
			'## Keep',
			'```md',
			SECURITY,
			'```',
			'kept',
			SECURITY,
			'gone',
			AFTER,
			'',
		].join('\n')
		const trimmed = trim(text, ['a.md'], ROUND_TWO)

		expect(trimmed).toContain(`\`\`\`md\n${SECURITY}\n\`\`\`\nkept`)
		expect(trimmed).not.toContain('gone')
		expect(trimmed).toContain(AFTER)
	})

	it('drops a deeper heading with the section it sits under', () => {
		const nested = '### Nested'
		const text = ['# R', ROUND_TWO_SECTION, nested, 'gone', AFTER, ''].join('\n')
		const trimmed = trim(text, ['a.md'], ROUND_ONE)

		expect(trimmed).not.toContain(nested)
		expect(trimmed).not.toContain('gone')
		expect(trimmed).toContain(AFTER)
	})
})
