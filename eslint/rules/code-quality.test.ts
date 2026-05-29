import { describe, expect, it } from 'vitest'
import { code_quality_rules } from './code-quality.js'

interface NoRestrictedEntry {
	selector: string
	message: string
}

function find_upper_case_entry(): NoRestrictedEntry {
	const rule = code_quality_rules['no-restricted-syntax'] as Array<unknown>
	const entries = rule.slice(1) as Array<NoRestrictedEntry>
	const entry = entries.find((restriction) => restriction.message.includes('UPPER_CASE'))
	if (!entry) throw new Error('UPPER_CASE entry not found in no-restricted-syntax')

	return entry
}

function get_upper_case_pattern(): RegExp {
	const { selector } = find_upper_case_entry()
	const exec_result = /id\.name=\/\^(.+?)\$\//u.exec(selector)
	const captured = exec_result?.[1]
	if (!captured) throw new Error('UPPER_CASE regex not found in selector')

	return new RegExp(`^${captured}$`, 'u')
}

function get_upper_case_selector(): string {
	return find_upper_case_entry().selector
}

interface IdLengthOptions {
	min: number
	max: number
	exceptions: ReadonlyArray<string>
	properties: string
}

function get_id_length_options(): IdLengthOptions {
	// Drop the leading 'error' severity entry; index 1 holds the options object.
	const rule = code_quality_rules['id-length']

	return rule[1] as IdLengthOptions
}

describe('code_quality_rules — no-restricted-syntax UPPER_CASE selector (issue #430)', () => {
	it('allows UPPER_CASE constants with digits (STEP_MS_1_5, FPS_BAR_2_H)', () => {
		const pattern = get_upper_case_pattern()

		expect(pattern.test('STEP_MS_1_5')).toBe(true)
		expect(pattern.test('FPS_BAR_2_H')).toBe(true)
		expect(pattern.test('STEP_MS_6_13')).toBe(true)
		expect(pattern.test('STEP_MS_14_20')).toBe(true)
		expect(pattern.test('STEP_MS_21_PLUS')).toBe(true)
	})

	it('still flags lowercase single exports', () => {
		const pattern = get_upper_case_pattern()

		expect(pattern.test('my_constant')).toBe(false)
		expect(pattern.test('myConst')).toBe(false)
	})

	it('uses the updated regex that allows digits in UPPER_CASE names', () => {
		const selector = get_upper_case_selector()

		expect(selector).toContain('[A-Z_0-9]')
		expect(selector).not.toContain('[A-Z_]+$')
	})
})

describe('code_quality_rules — id-length exceptions (issue #428 Gap 1)', () => {
	it('exempts idiomatic single-char names e and t for event handlers and Touch/time', () => {
		const { exceptions } = get_id_length_options()

		expect(exceptions).toContain('e')
		expect(exceptions).toContain('t')
	})

	it('retains the previously allowed single-char names', () => {
		const { exceptions } = get_id_length_options()

		for (const name of ['_', 'i', 'j', 'k', 'x', 'y', 'z']) {
			expect(exceptions).toContain(name)
		}
	})
})

describe('code_quality_rules — id-length max (issue #428 Gap 2)', () => {
	it('raises max to 45 so descriptive constant/function names are not penalized', () => {
		const { max } = get_id_length_options()

		expect(max).toBe(45)
	})

	it('keeps the minimum length at 2', () => {
		const { min } = get_id_length_options()

		expect(min).toBe(2)
	})
})
