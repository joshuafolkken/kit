import { describe, expect, it } from 'vitest'
import { code_quality_rules } from './code-quality.js'

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
