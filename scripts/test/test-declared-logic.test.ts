import { describe, expect, it } from 'vitest'
import { test_declared_logic } from './test-declared-logic'

// joshuafolkken/kit#2118: the verdict is a set comparison over changed paths, so it is pinned as one —
// a runtime change with no test is `required`, documentation is `exempt`, and a test in the diff is
// `satisfied`.

const RUNTIME_FILE = 'scripts/foo.ts'
const TEST_FILE = 'scripts/foo.test.ts'
const DOC_FILE = 'docs/x.md'
const SATISFIED = 'satisfied'
const EXEMPT = 'exempt'
const PROMPT_DOC = 'prompts/review.md'

describe('test_declared_logic.verdict_for', () => {
	it('is required when a runtime file changed with no test beside it', () => {
		expect(test_declared_logic.verdict_for([RUNTIME_FILE])).toBe('required')
	})

	it('is required when a runtime file and an exempt file changed but no test', () => {
		expect(test_declared_logic.verdict_for([RUNTIME_FILE, DOC_FILE])).toBe('required')
	})

	it('is satisfied when a test file changed, whatever else did', () => {
		expect(test_declared_logic.verdict_for([RUNTIME_FILE, TEST_FILE])).toBe(SATISFIED)
	})

	it('reads an e2e file as a test file', () => {
		expect(test_declared_logic.verdict_for(['scripts/foo.e2e.ts'])).toBe(SATISFIED)
	})

	it('reads a svelte component test as a test file', () => {
		expect(test_declared_logic.verdict_for(['src/Thing.svelte.test.ts'])).toBe(SATISFIED)
	})

	it('is exempt when only documentation changed', () => {
		expect(test_declared_logic.verdict_for(['README.md', PROMPT_DOC])).toBe(EXEMPT)
	})

	it('is exempt for editor and IDE settings', () => {
		expect(test_declared_logic.verdict_for(['.vscode/settings.json', '.editorconfig'])).toBe(
			'exempt',
		)
	})

	it('is exempt for the empty diff', () => {
		expect(test_declared_logic.verdict_for([])).toBe(EXEMPT)
	})

	it('ignores blank entries', () => {
		expect(test_declared_logic.verdict_for(['  ', ''])).toBe(EXEMPT)
	})
})

describe('test_declared_logic classification', () => {
	it('names only the untested runtime files for the required detail', () => {
		expect(test_declared_logic.runtime_files([RUNTIME_FILE, DOC_FILE, TEST_FILE])).toStrictEqual([
			RUNTIME_FILE,
		])
	})

	it('names only the exempt paths for the exempt detail', () => {
		expect(test_declared_logic.exempt_files([DOC_FILE, RUNTIME_FILE])).toStrictEqual([DOC_FILE])
	})

	it('treats a prompts markdown file as exempt but a scripts .ts as runtime', () => {
		expect(test_declared_logic.is_exempt(PROMPT_DOC)).toBe(true)
		expect(test_declared_logic.is_runtime('scripts/prompts.ts')).toBe(true)
	})
})
