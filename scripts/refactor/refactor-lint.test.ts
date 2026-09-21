import { describe, expect, it } from 'vitest'
import { refactor_lint } from './refactor-lint'

const ROOT = '/repo'
const FILE = '/repo/scripts/a.ts'
const MAX_LINES = 'max-lines'
const NO_ANY = '@typescript-eslint/no-explicit-any'
const NO_MAGIC = '@typescript-eslint/no-magic-numbers'
const NO_UNUSED = '@typescript-eslint/no-unused-vars'
const LINES_COMPLEXITY = 'lines-complexity'

interface RawMessage {
	ruleId?: string | null
	line?: number
}

interface RawResult {
	filePath: string
	messages: Array<RawMessage>
}

function results(messages: ReadonlyArray<RawMessage>): Array<RawResult> {
	return [{ filePath: FILE, messages: [...messages] }]
}

function candidates_of(key: string, messages: ReadonlyArray<RawMessage>): ReadonlyArray<unknown> {
	const categories = refactor_lint.categorize(results(messages), ROOT)

	return categories.find((category) => category.key === key)?.candidates ?? []
}

describe('refactor_lint.categorize', () => {
	it('buckets a max-lines finding under lines & complexity with its location', () => {
		expect(candidates_of(LINES_COMPLEXITY, [{ ruleId: MAX_LINES, line: 40 }])).toStrictEqual([
			{ location: 'scripts/a.ts:40', rule: MAX_LINES },
		])
	})

	it('buckets no-explicit-any under type safety', () => {
		expect(candidates_of('type-safety', [{ ruleId: NO_ANY, line: 7 }])).toHaveLength(1)
	})

	it('buckets no-magic-numbers under magic number', () => {
		expect(candidates_of('magic-number', [{ ruleId: NO_MAGIC, line: 3 }])).toHaveLength(1)
	})

	it('ignores a rule that is not on the checklist', () => {
		const categories = refactor_lint.categorize(results([{ ruleId: 'no-console', line: 1 }]), ROOT)
		const total = categories.reduce((sum, category) => sum + category.candidates.length, 0)

		expect(total).toBe(0)
	})

	it('ignores a message with no ruleId', () => {
		expect(candidates_of(LINES_COMPLEXITY, [{ line: 1 }])).toHaveLength(0)
	})

	it('keeps every category present even with no findings', () => {
		const categories = refactor_lint.categorize([], ROOT)

		expect(categories).toHaveLength(refactor_lint.CATEGORIES.length)
		expect(categories.every((category) => category.candidates.length === 0)).toBe(true)
	})
})

describe('refactor_lint.categorize buckets the rules added in #2255', () => {
	it('buckets local/namespace-object-export under namespace-object export', () => {
		expect(
			candidates_of('namespace-export', [{ ruleId: 'local/namespace-object-export', line: 5 }]),
		).toHaveLength(1)
	})

	it('buckets naming-convention under variable naming', () => {
		expect(
			candidates_of('naming-convention', [
				{ ruleId: '@typescript-eslint/naming-convention', line: 2 },
			]),
		).toHaveLength(1)
	})

	it('buckets no-unused-vars under unused code with its location', () => {
		expect(candidates_of('unused-code', [{ ruleId: NO_UNUSED, line: 9 }])).toStrictEqual([
			{ location: 'scripts/a.ts:9', rule: NO_UNUSED },
		])
	})
})

describe('refactor_lint.parse_results', () => {
	it('parses a valid eslint json payload', () => {
		const raw = JSON.stringify([{ filePath: FILE, messages: [{ ruleId: MAX_LINES, line: 5 }] }])

		expect(refactor_lint.parse_results(raw)).toHaveLength(1)
	})

	it('returns undefined on unparseable output, distinct from a clean empty array', () => {
		expect(refactor_lint.parse_results('not json')).toBeUndefined()
		expect(refactor_lint.parse_results(undefined)).toBeUndefined()
		expect(refactor_lint.parse_results('[]')).toStrictEqual([])
	})
})
