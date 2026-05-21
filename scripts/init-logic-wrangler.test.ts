import { describe, expect, it } from 'vitest'
import { init_logic_wrangler } from './init-logic-wrangler'

const DATE_2026 = '2026-05-12'
const DATE_2025 = '2025-01-01'
const TEMPLATE = `{\n\t"compatibility_date": "${DATE_2026}"\n}\n`
const EXISTING = `{\n\t// comment\n\t"compatibility_date": "${DATE_2025}",\n\t"name": "myapp"\n}\n`

describe('init_logic_wrangler.extract_compatibility_date', () => {
	it('extracts date from template with compatibility_date field', () => {
		expect(init_logic_wrangler.extract_compatibility_date(TEMPLATE)).toBe(DATE_2026)
	})

	it('returns undefined when content has no compatibility_date field', () => {
		expect(init_logic_wrangler.extract_compatibility_date('{"name": "x"}\n')).toBeUndefined()
	})

	it('extracts date with extra whitespace around colon', () => {
		expect(
			init_logic_wrangler.extract_compatibility_date('{"compatibility_date" : "2026-01-01"}'),
		).toBe('2026-01-01')
	})
})

describe('init_logic_wrangler.merge_wrangler_jsonc', () => {
	it('updates compatibility_date in existing file', () => {
		const result = init_logic_wrangler.merge_wrangler_jsonc(EXISTING, TEMPLATE)

		expect(result).toContain(`"compatibility_date": "${DATE_2026}"`)
	})

	it('preserves other JSONC content when updating', () => {
		const result = init_logic_wrangler.merge_wrangler_jsonc(EXISTING, TEMPLATE)

		expect(result).toContain('"name": "myapp"')
		expect(result).toContain('// comment')
	})

	it('returns existing unchanged when template has no compatibility_date', () => {
		const template_no_date = '{"name": "template"}\n'

		expect(init_logic_wrangler.merge_wrangler_jsonc(EXISTING, template_no_date)).toBe(EXISTING)
	})

	it('does not change existing when compatibility_date already matches template', () => {
		const same_date_existing = `{\n\t"compatibility_date": "${DATE_2026}"\n}\n`

		const result = init_logic_wrangler.merge_wrangler_jsonc(same_date_existing, TEMPLATE)

		expect(result).toBe(same_date_existing)
	})

	it('returns existing unchanged when existing has no compatibility_date field', () => {
		const existing_no_date = '{\n\t"name": "myapp"\n}\n'

		expect(init_logic_wrangler.merge_wrangler_jsonc(existing_no_date, TEMPLATE)).toBe(
			existing_no_date,
		)
	})
})
