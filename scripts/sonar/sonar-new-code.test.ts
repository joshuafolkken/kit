import { describe, expect, it } from 'vitest'
import {
	CLEAN,
	FINDINGS,
	sonar_new_code,
	UNREADABLE,
	type NewCodeIssue,
	type NewCodeReading,
} from './sonar-new-code'

// joshuafolkken/kit#3045: the built-in Quality Gate passed a pull request that added code smells and
// a copied block, because it judges ratios. The verdict here is a count — one finding of either kind
// fails the check.

const ISSUE: NewCodeIssue = {
	rule: 'typescript:S1854',
	severity: 'MINOR',
	type: 'CODE_SMELL',
	component: 'demo:src/a.ts',
	line: 3,
	message: 'Remove this useless assignment.',
}

function reading(overrides: Partial<NewCodeReading>): NewCodeReading {
	return { issues: [], issue_total: 0, duplicated_blocks: 0, ...overrides }
}

describe('sonar_new_code.verdict_of', () => {
	it('is clean when the pull request adds no issue and no duplicated block', () => {
		expect(sonar_new_code.verdict_of(reading({}))).toBe(CLEAN)
	})

	it('is a finding for a single new MINOR code smell', () => {
		expect(sonar_new_code.verdict_of(reading({ issues: [ISSUE], issue_total: 1 }))).toBe(FINDINGS)
	})

	it('is a finding for a single new duplicated block', () => {
		expect(sonar_new_code.verdict_of(reading({ duplicated_blocks: 1 }))).toBe(FINDINGS)
	})

	it('counts the API total, not the issues one page carries', () => {
		expect(sonar_new_code.verdict_of(reading({ issue_total: 120 }))).toBe(FINDINGS)
	})

	it('reports a failed read as unreadable, never as clean', () => {
		expect(sonar_new_code.verdict_of({ error: 'HTTP 500' })).toBe(UNREADABLE)
	})
})

describe('sonar_new_code.measure_value', () => {
	it('reads a new_* metric from its periods', () => {
		expect(sonar_new_code.measure_value({ periods: [{ value: '2' }] })).toBe(2)
	})

	it('reads a plain metric from its value', () => {
		expect(sonar_new_code.measure_value({ value: '1' })).toBe(1)
	})

	it('treats a measure the response leaves out as zero', () => {
		expect(sonar_new_code.measure_value(undefined)).toBe(0)
	})

	it('answers undefined for a measure with no value or a value that is not a number', () => {
		expect(sonar_new_code.measure_value({})).toBeUndefined()
		expect(sonar_new_code.measure_value({ value: 'n/a' })).toBeUndefined()
	})
})
