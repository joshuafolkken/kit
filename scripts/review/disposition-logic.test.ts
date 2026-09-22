import { describe, expect, it } from 'vitest'
import { disposition } from './disposition-logic'
import { review_level } from './review-level'

// joshuafolkken/kit#2181: the disposition shares `review-level.ts`'s inert set, so a finding reaches a
// runtime path exactly when the review level is not reduced — the single-source property is pinned here.

const CODE_FILE = 'scripts/foo.ts'
const INERT_FILE = '.editorconfig'
const RUNTIME = 'runtime'
const NON_RUNTIME = 'non-runtime'

describe('disposition.disposition_for', () => {
	it('reaches a runtime path for a code file', () => {
		expect(disposition.disposition_for([CODE_FILE])).toBe(RUNTIME)
	})

	it('reaches a runtime path for a distributed document', () => {
		expect(disposition.disposition_for(['prompts/review.md'])).toBe(RUNTIME)
	})

	it('is non-runtime when every path is inert', () => {
		expect(disposition.disposition_for([INERT_FILE, 'CHANGELOG.md'])).toBe(NON_RUNTIME)
	})

	it('reaches when any one path is non-inert', () => {
		expect(disposition.disposition_for([INERT_FILE, CODE_FILE])).toBe(RUNTIME)
	})

	it('takes the file-eligible answer for no paths', () => {
		expect(disposition.disposition_for([])).toBe(RUNTIME)
	})

	it('ignores blank entries', () => {
		expect(disposition.disposition_for(['  ', '.gitignore'])).toBe(NON_RUNTIME)
	})
})

describe('disposition shares the review-level inert set', () => {
	it('answers non-runtime for exactly the inert paths', () => {
		for (const path of review_level.INERT_PATHS) {
			expect(disposition.disposition_for([path])).toBe(NON_RUNTIME)
		}
	})

	it('names the non-inert paths as the reaching ones', () => {
		expect(disposition.reaching_paths([INERT_FILE, CODE_FILE])).toStrictEqual([CODE_FILE])
	})
})
